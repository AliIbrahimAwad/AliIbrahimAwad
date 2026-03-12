const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { createApp } = require("../app");
const { toDateOnlyString } = require("../src/utils/dates");

function createTempDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-test-"));
  return {
    dir: tempDir,
    dbPath: path.join(tempDir, "crm.sqlite"),
  };
}

function createClient(server) {
  let cookieHeader = "";

  return {
    async request(options = {}) {
      const payload = options.json
        ? JSON.stringify(options.json)
        : options.form
          ? new URLSearchParams(options.form).toString()
          : null;

      const headers = {
        ...(options.headers || {}),
      };

      if (cookieHeader) {
        headers.Cookie = cookieHeader;
      }

      if (options.json) {
        headers["Content-Type"] = "application/json";
      }

      if (options.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }

      if (payload) {
        headers["Content-Length"] = Buffer.byteLength(payload);
      }

      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: server.address().port,
            method: options.method || "GET",
            path: options.path || "/",
            headers,
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => {
              const setCookie = res.headers["set-cookie"];
              if (setCookie && setCookie.length > 0) {
                cookieHeader = setCookie.map((value) => value.split(";")[0]).join("; ");
              }

              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body,
              });
            });
          }
        );

        req.on("error", reject);
        if (payload) {
          req.write(payload);
        }
        req.end();
      });
    },
  };
}

async function withServer(run) {
  const temp = createTempDbPath();
  const app = await createApp({ dbPath: temp.dbPath });
  const server = app.listen(0);

  try {
    await run({ app, server });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
}

async function login(client, email, password) {
  const response = await client.request({
    method: "POST",
    path: "/login",
    form: { email, password },
  });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/");
}

test("health endpoint remains public", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    const response = await client.request({ path: "/health" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "OK");
  });
});

test("root redirects to login until the user authenticates", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    const beforeLogin = await client.request({ path: "/" });
    assert.equal(beforeLogin.statusCode, 302);
    assert.equal(beforeLogin.headers.location, "/login");

    await login(client, "manager@crm.local", "manager123");
    const dashboard = await client.request({ path: "/" });
    assert.equal(dashboard.statusCode, 200);
    assert.match(dashboard.body, /Manager dashboard/);
  });
});

test("admin can access user management and create a new salesperson", async () => {
  await withServer(async ({ app, server }) => {
    const client = createClient(server);
    await login(client, "admin@crm.local", "admin123");

    const usersPage = await client.request({ path: "/users" });
    assert.equal(usersPage.statusCode, 200);
    assert.match(usersPage.body, /CRM Sales/);

    const createResponse = await client.request({
      method: "POST",
      path: "/users",
      form: {
        name: "Second Seller",
        email: "seller2@crm.local",
        password: "seller234",
        role: "sales",
      },
    });

    assert.equal(createResponse.statusCode, 302);
    assert.equal(createResponse.headers.location, "/users");
    assert.ok(app.locals.db.getUserByEmail("seller2@crm.local"));
  });
});

test("sales users only see leads assigned to them", async () => {
  await withServer(async ({ app, server }) => {
    const secondSalesHash = await bcrypt.hash("seller234", 10);
    const secondSales = app.locals.db.createUser({
      name: "Second Seller",
      email: "seller2@crm.local",
      password_hash: secondSalesHash,
      role: "sales",
    });

    const firstContact = app.locals.db.createContact({
      first_name: "Alice",
      last_name: "Buyer",
      email: "alice@example.com",
      phone: null,
      company: null,
      job_title: null,
    });
    const secondContact = app.locals.db.createContact({
      first_name: "Bob",
      last_name: "Buyer",
      email: "bob@example.com",
      phone: null,
      company: null,
      job_title: null,
    });

    const firstLead = app.locals.db.createLead({
      contact_id: firstContact.id,
      assigned_to: app.locals.db.getUserByEmail("sales@crm.local").id,
      source: "manual",
      status: "new",
      priority: null,
      follow_up_date: null,
      next_action: "Call Alice",
    });
    const secondLead = app.locals.db.createLead({
      contact_id: secondContact.id,
      assigned_to: secondSales.id,
      source: "manual",
      status: "appointment",
      priority: null,
      follow_up_date: null,
      next_action: "Call Bob",
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const leadsPage = await client.request({ path: "/leads" });
    assert.equal(leadsPage.statusCode, 200);
    assert.match(leadsPage.body, /Alice Buyer/);
    assert.doesNotMatch(leadsPage.body, /Bob Buyer/);

    const forbiddenLead = await client.request({ path: `/leads/${secondLead.id}` });
    assert.equal(forbiddenLead.statusCode, 404);

    const allowedLead = await client.request({ path: `/leads/${firstLead.id}` });
    assert.equal(allowedLead.statusCode, 200);
    assert.doesNotMatch(allowedLead.body, /Assign lead/);

    const forbiddenAssign = await client.request({
      method: "POST",
      path: `/leads/${firstLead.id}/assign`,
      form: { salesperson_id: String(secondSales.id) },
    });
    assert.equal(forbiddenAssign.statusCode, 403);
  });
});

test("manager can reassign a lead from the detail page", async () => {
  await withServer(async ({ app, server }) => {
    const secondSalesHash = await bcrypt.hash("seller234", 10);
    const secondSales = app.locals.db.createUser({
      name: "Second Seller",
      email: "seller2@crm.local",
      password_hash: secondSalesHash,
      role: "sales",
    });

    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const contact = app.locals.db.createContact({
      first_name: "Reassign",
      last_name: "Lead",
      email: "reassign@example.com",
      phone: null,
      company: null,
      job_title: null,
    });

    const lead = app.locals.db.createLead({
      contact_id: contact.id,
      assigned_to: salesUser.id,
      source: "manual",
      status: "new",
      priority: null,
      follow_up_date: null,
      next_action: "Initial outreach",
    });

    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const detailBefore = await client.request({ path: `/leads/${lead.id}` });
    assert.equal(detailBefore.statusCode, 200);
    assert.match(detailBefore.body, /Assign lead/);
    assert.match(detailBefore.body, /CRM Sales/);
    assert.match(detailBefore.body, /Second Seller/);

    const reassignResponse = await client.request({
      method: "POST",
      path: `/leads/${lead.id}/assign`,
      form: { salesperson_id: String(secondSales.id) },
    });

    assert.equal(reassignResponse.statusCode, 302);
    assert.equal(reassignResponse.headers.location, `/leads/${lead.id}`);

    const updatedLead = app.locals.db.getLead(lead.id);
    assert.equal(Number(updatedLead.assigned_to), Number(secondSales.id));
    assert.equal(updatedLead.assigned_user_name, "Second Seller");
  });
});

test("sending SMS through the CRM logs activity and updates new leads to contacted", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const contact = app.locals.db.createContact({
      first_name: "SMS",
      last_name: "Lead",
      email: "sms@example.com",
      phone: "555-0101",
      company: null,
      job_title: null,
    });

    const lead = app.locals.db.createLead({
      contact_id: contact.id,
      assigned_to: salesUser.id,
      source: "manual",
      status: "new",
      priority: null,
      follow_up_date: null,
      next_action: "Send text",
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const smsResponse = await client.request({
      method: "POST",
      path: `/leads/${lead.id}/sms`,
      form: { message: "Checking in about your interest." },
    });

    assert.equal(smsResponse.statusCode, 302);
    assert.equal(smsResponse.headers.location, `/leads/${lead.id}`);

    const updatedLead = app.locals.db.getLead(lead.id);
    assert.equal(updatedLead.status, "contacted");

    const activities = app.locals.db.listLeadActivities(lead.id);
    assert.equal(activities[0].type, "sms");
    assert.match(activities[0].content, /Checking in about your interest/);
  });
});

test("website API creates and auto-assigns a website lead", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    const response = await client.request({
      method: "POST",
      path: "/api/leads",
      json: {
        name: "Web Shopper",
        phone: "555-0100",
        email: "web@example.com",
        vehicle: "2024 Sedan",
        source: "website",
      },
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body);
    assert.equal(body.source, "website");
    assert.equal(body.status, "new");
    assert.equal(body.assigned_user_name, "CRM Sales");
  });
});

test("RingCentral webhook logs phone activity and auto-updates lead status", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const contact = app.locals.db.createContact({
      first_name: "Webhook",
      last_name: "Lead",
      email: "webhook@example.com",
      phone: "(555) 0102",
      company: null,
      job_title: null,
    });

    const lead = app.locals.db.createLead({
      contact_id: contact.id,
      assigned_to: salesUser.id,
      source: "manual",
      status: "new",
      priority: null,
      follow_up_date: null,
      next_action: "Wait for webhook",
    });

    const client = createClient(server);
    const webhookResponse = await client.request({
      method: "POST",
      path: "/api/ringcentral/webhook",
      json: {
        type: "sms",
        fromPhoneNumber: "5550102",
        content: "Inbound SMS from RingCentral",
      },
    });

    assert.equal(webhookResponse.statusCode, 200);
    const body = JSON.parse(webhookResponse.body);
    assert.equal(body.matched, true);
    assert.equal(body.lead_id, lead.id);
    assert.equal(body.status, "contacted");

    const activities = app.locals.db.listLeadActivities(lead.id);
    assert.equal(activities[0].type, "sms");
    assert.match(activities[0].content, /Inbound SMS from RingCentral/);
  });
});

test("manager dashboard shows aggregate metrics and leads per salesperson", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const contact = app.locals.db.createContact({
      first_name: "Metric",
      last_name: "Lead",
      email: "metric@example.com",
      phone: null,
      company: null,
      job_title: null,
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const lead = app.locals.db.createLead({
      contact_id: contact.id,
      assigned_to: salesUser.id,
      source: "manual",
      status: "new",
      priority: "High",
      follow_up_date: toDateOnlyString(yesterday),
      next_action: "Follow up",
    });
    app.locals.db.recordLeadActivity({
      lead_id: lead.id,
      user_id: salesUser.id,
      type: "call",
      content: "Call completed (30s)",
    });

    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const dashboard = await client.request({ path: "/" });
    assert.equal(dashboard.statusCode, 200);
    assert.match(dashboard.body, /Total leads/);
    assert.match(dashboard.body, /Leads per salesperson/);
    assert.match(dashboard.body, /CRM Sales/);
    assert.match(dashboard.body, /Overdue follow-ups/);
    assert.match(dashboard.body, /Recent activities/);
  });
});
