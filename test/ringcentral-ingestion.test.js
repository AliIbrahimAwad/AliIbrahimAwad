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
      "SELECT * FROM lead_status_audits WHERE lead_id = ? AND source = ? ORDER BY created_at DESC LIMIT 1",
      [lead.id, "ai_message_analysis"]
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

    const task = await db.get(
      "SELECT * FROM tasks WHERE lead_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
      [lead.id, "ai_follow_up"]
    );
    assert.ok(task);
    assert.match(String(task.title), /confirm appointment|follow up|appointment/i);

    const activities = await db.all("SELECT * FROM activities WHERE lead_id = ? ORDER BY created_at DESC", [lead.id]);
    assert.ok(activities.some((activity) => String(activity.content).includes("appointment")));
  });
});

test("RingCentral webhook resolves the correct CRM user by extension id", async () => {
  await withDb(async ({ db, temp }) => {
    const lead = await db.createApiLead({
      source: "website",
      customer_name: "Extension Match",
      phone: "+1 (647) 555-0198",
      email: "extension@example.com",
      vehicle_interest: "2024 Sedan",
      status: "new",
    });

    const fetchImpl = async (url) => {
      if (String(url).includes("/message-store/msg-extension")) {
        return new Response(
          JSON.stringify({
            id: "msg-extension",
            ownerId: "ext-2",
            direction: "Inbound",
            from: { phoneNumber: "+1 (647) 555-0198" },
            to: [{ phoneNumber: "+1 (647) 555-1212", extensionId: "ext-2" }],
            subject: "Please text me the details.",
            messageStatus: "Received",
            creationTime: "2026-03-16T17:00:00.000Z",
            lastModifiedTime: "2026-03-16T17:00:10.000Z",
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
      access_token: "token-1",
      refresh_token: "refresh-1",
      token_type: "Bearer",
      scope: "ReadMessages",
      status: "active",
    });

    await service.store.upsertConnection({
      user_id: 2,
      ringcentral_account_id: "acct-1",
      ringcentral_extension_id: "ext-2",
      server_url: "https://platform.ringcentral.com",
      access_token: "token-2",
      refresh_token: "refresh-2",
      token_type: "Bearer",
      scope: "ReadMessages",
      status: "active",
    });

    const envelope = service.getEventEnvelope({
      event: "/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS",
      ownerId: "ext-2",
      body: {
        id: "msg-extension",
        ownerId: "ext-2",
      },
    });

    const result = await service.processWebhookEnvelope(envelope);
    assert.equal(result.accepted, true);

    const message = await db.get(
      "SELECT crm_user_id, provider_extension_id, lead_id FROM lead_messages WHERE provider_message_id = ?",
      ["msg-extension"]
    );
    assert.ok(message);
    assert.equal(Number(message.crm_user_id), 2);
    assert.equal(message.provider_extension_id, "ext-2");
    assert.equal(Number(message.lead_id), Number(lead.id));
  });
});

test("RingCentral status omits live tokens from the returned connection payload", async () => {
  await withDb(async ({ db, temp }) => {
    const service = await createRingCentralService(
      {
        recordingsDir: path.join(temp.dir, "recordings"),
      },
      { db }
    );

    await service.store.upsertConnection({
      user_id: 1,
      ringcentral_account_id: "acct-1",
      ringcentral_extension_id: "ext-1",
      server_url: "https://platform.ringcentral.com",
      access_token: "live-access-token",
      refresh_token: "live-refresh-token",
      token_type: "Bearer",
      scope: "ReadMessages",
      status: "active",
    });

    const status = await service.getConnectionStatusForUser(1);
    assert.equal(status.connected, true);
    assert.equal(status.connection.access_token, undefined);
    assert.equal(status.connection.refresh_token, undefined);
    assert.equal(status.connection.has_access_token, true);
    assert.equal(status.connection.has_refresh_token, true);
  });
});

test("RingCentral call analysis deletes the local temp recording after success", async () => {
  await withDb(async ({ db, temp }) => {
    const lead = await db.createApiLead({
      source: "website",
      customer_name: "Call Shopper",
      phone: "+1 (647) 555-0188",
      email: "call@example.com",
      vehicle_interest: "2024 Coupe",
      status: "new",
    });

    const service = await createRingCentralService(
      {
        recordingsDir: path.join(temp.dir, "recordings"),
      },
      { db }
    );

    const leadCall = await service.store.upsertLeadCall({
      lead_id: Number(lead.id),
      provider: "ringcentral",
      provider_call_id: "call-provider-1",
      session_id: "session-1",
      telephony_session_id: "telephony-1",
      direction: "inbound",
      from_number: "+16475550188",
      to_number: "+16475551212",
      external_number: "6475550188",
      result: "Accepted",
      duration_seconds: 42,
      start_time: "2026-03-16T15:00:00.000Z",
      crm_user_id: 1,
      provider_extension_id: "ext-1",
      recording_id: "recording-provider-1",
      recording_status: "available",
      transcript_status: "pending",
      raw: {},
    });

    const localPath = path.join(temp.dir, "recordings", "recording-provider-1.mp3");
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, "fake-audio-data");

    const recording = await service.store.upsertCallRecording({
      lead_call_id: leadCall.record.id,
      provider: "ringcentral",
      provider_recording_id: "recording-provider-1",
      content_uri: "https://platform.ringcentral.com/recordings/1",
      local_path: localPath,
      mime_type: "audio/mpeg",
      fetched_at: "2026-03-16T15:01:00.000Z",
      transcript_status: "pending",
      raw: {},
    });

    const result = await service.analyzeCallRecording(recording.record);
    assert.ok(result);
    assert.equal(fs.existsSync(localPath), false);

    const savedRecording = await db.get("SELECT * FROM call_recordings WHERE id = ?", [recording.record.id]);
    assert.ok(savedRecording);
    assert.equal(savedRecording.local_path, null);
    assert.equal(savedRecording.transcript_status, "unavailable");

    const analysis = await db.get(
      "SELECT * FROM communication_ai_analyses WHERE lead_id = ? AND source_type = ? ORDER BY created_at DESC LIMIT 1",
      [lead.id, "call"]
    );
    assert.ok(analysis);
  });
});

test("RingCentral call analysis deletes temp recordings for unmatched calls too", async () => {
  await withDb(async ({ db, temp }) => {
    const service = await createRingCentralService(
      {
        recordingsDir: path.join(temp.dir, "recordings"),
      },
      { db }
    );

    const leadCall = await service.store.upsertLeadCall({
      lead_id: null,
      provider: "ringcentral",
      provider_call_id: "call-provider-unmatched",
      session_id: "session-unmatched",
      telephony_session_id: "telephony-unmatched",
      direction: "inbound",
      from_number: "+16475559999",
      to_number: "+16475551212",
      external_number: "6475559999",
      result: "Accepted",
      duration_seconds: 31,
      start_time: "2026-03-16T15:00:00.000Z",
      crm_user_id: 1,
      provider_extension_id: "ext-1",
      recording_id: "recording-provider-unmatched",
      recording_status: "available",
      transcript_status: "pending",
      raw: {},
    });

    const localPath = path.join(temp.dir, "recordings", "recording-provider-unmatched.mp3");
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, "fake-audio-data");

    const recording = await service.store.upsertCallRecording({
      lead_call_id: leadCall.record.id,
      provider: "ringcentral",
      provider_recording_id: "recording-provider-unmatched",
      content_uri: "https://platform.ringcentral.com/recordings/unmatched",
      local_path: localPath,
      mime_type: "audio/mpeg",
      fetched_at: "2026-03-16T15:01:00.000Z",
      transcript_status: "pending",
      raw: {},
    });

    const result = await service.analyzeCallRecording(recording.record);
    assert.equal(result, null);
    assert.equal(fs.existsSync(localPath), false);

    const savedRecording = await db.get("SELECT * FROM call_recordings WHERE id = ?", [recording.record.id]);
    assert.ok(savedRecording);
    assert.equal(savedRecording.local_path, null);
    assert.equal(savedRecording.transcript_status, "skipped");
  });
});

test("RingCentral skips very short unmatched calls during reconciliation", async () => {
  await withDb(async ({ db, temp }) => {
    const service = await createRingCentralService(
      {
        recordingsDir: path.join(temp.dir, "recordings"),
        minStoredCallSeconds: 10,
      },
      { db }
    );

    const decision = service.shouldSkipCallRecord(
      {
        id: "short-1",
        duration: 4,
        direction: "Inbound",
        result: "Accepted",
      },
      null
    );

    assert.equal(decision.skip, true);
    assert.equal(decision.reason, "short_unmatched_call");
  });
});

test("RingCentral skips forwarded calls during reconciliation", async () => {
  await withDb(async ({ db, temp }) => {
    const service = await createRingCentralService(
      {
        recordingsDir: path.join(temp.dir, "recordings"),
        skipForwardedCalls: true,
      },
      { db }
    );

    const decision = service.shouldSkipCallRecord(
      {
        id: "forwarded-1",
        duration: 45,
        action: "Forwarded",
        result: "Accepted",
      },
      { id: 123 }
    );

    assert.equal(decision.skip, true);
    assert.equal(decision.reason, "forwarded_call");
  });
});
