const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { initializeDatabase } = require("../src/data");
const { createRingCentralService } = require("../services/ringcentral");

function createTempDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-rc-test-"));
  return {
    dir: tempDir,
    dbPath: path.join(tempDir, "crm.sqlite"),
  };
}

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "ringcentral", name), "utf8")
  );
}

async function withDb(run, options = {}) {
  const temp = createTempDbPath();
  const previousThreshold = process.env.RINGCENTRAL_AI_CONFIDENCE_THRESHOLD;
  const previousAuto = process.env.RINGCENTRAL_AUTO_STATUS_UPDATES;
  process.env.RINGCENTRAL_AI_CONFIDENCE_THRESHOLD = "0.6";
  process.env.RINGCENTRAL_AUTO_STATUS_UPDATES = "true";

  const db = await initializeDatabase({ dbPath: temp.dbPath });

  try {
    await run({ db, temp });
  } finally {
    process.env.RINGCENTRAL_AI_CONFIDENCE_THRESHOLD = previousThreshold;
    process.env.RINGCENTRAL_AUTO_STATUS_UPDATES = previousAuto;
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
}

test("findLeadByPhone matches leads stored directly on the lead record", async () => {
  await withDb(async ({ db }) => {
    const lead = await db.createApiLead({
      source: "website",
      customer_name: "Phone Match",
      phone: "(647) 555-0100",
      email: "match@example.com",
      vehicle_interest: "2024 Sedan",
      status: "new",
    });

    const found = await db.findLeadByPhone("+1 647-555-0100");
    assert.ok(found);
    assert.equal(Number(found.id), Number(lead.id));
    assert.equal(Number(found.dealership_id), 1);
  });
});

test("RingCentral SMS webhook ingestion stores the message, queues AI, and updates lead status with audit", async () => {
  await withDb(async ({ db, temp }) => {
    const lead = await db.createApiLead({
      source: "website",
      customer_name: "SMS Shopper",
      phone: "+1 (647) 555-0100",
      email: "sms@example.com",
      vehicle_interest: "2024 SUV",
      status: "new",
    });

    const fixture = loadFixture("instant-sms.json");
    const fetchImpl = async (url) => {
      if (String(url).includes("/message-store/msg-1")) {
        return new Response(
          JSON.stringify({
            id: "msg-1",
            direction: "Inbound",
            from: { phoneNumber: "+1 (647) 555-0100" },
            to: [{ phoneNumber: "+1 (647) 555-1212" }],
            subject: "Can I book an appointment for tomorrow?",
            messageStatus: "Received",
            creationTime: "2026-03-16T15:00:00.000Z",
            lastModifiedTime: "2026-03-16T15:00:10.000Z",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    };

    const service = await createRingCentralService(
      {
        recordingsDir: path.join(temp.dir, "recordings"),
      },
      { db, fetchImpl }
    );

    await service.store.upsertConnection({
      user_id: 1,
      ringcentral_account_id: "acct-1",
      ringcentral_extension_id: "ext-1",
      server_url: "https://platform.ringcentral.com",
      access_token: "token",
      refresh_token: "refresh",
      token_type: "Bearer",
      scope: "ReadMessages",
      status: "active",
    });

    const webhookResult = await service.processWebhookEnvelope(service.getEventEnvelope(fixture));
    assert.equal(webhookResult.accepted, true);

    const message = await db.get(
      "SELECT * FROM lead_messages WHERE provider = ? AND provider_message_id = ?",
      ["ringcentral", "msg-1"]
    );
    assert.ok(message);
    assert.equal(Number(message.lead_id), Number(lead.id));
    assert.equal(Number(message.dealership_id), 1);

    const jobsBefore = await db.all("SELECT * FROM processing_jobs WHERE job_type = ?", ["analyze_sms_thread"]);
    assert.equal(jobsBefore.length, 1);

    const results = await service.processPendingJobs({ limit: 5 });
    assert.ok(results.some((item) => item.type === "analyze_sms_thread"));

    const updatedLead = await db.getApiLead(Number(lead.id));
    assert.equal(updatedLead.status, "appointment");

    const audit = await db.get(
      "SELECT * FROM lead_status_audits WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1",
      [lead.id]
    );
    assert.ok(audit);
    assert.equal(audit.source, "ai_message_analysis");
    assert.equal(audit.new_status, "appointment");
    assert.equal(Number(audit.dealership_id), 1);

    const analysis = await db.get(
      "SELECT * FROM communication_ai_analyses WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1",
      [lead.id]
    );
    assert.ok(analysis);
    assert.equal(analysis.source_type, "sms");
    assert.equal(Number(analysis.dealership_id), 1);

    const activities = await db.all("SELECT * FROM activities WHERE lead_id = ? ORDER BY created_at DESC", [lead.id]);
    assert.ok(activities.some((activity) => String(activity.content).includes("appointment")));
  });
});
