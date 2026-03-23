const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { createApp } = require("../app");
const { importInventoryCsv } = require("../services/inventoryImport");
const { createLeadInboxService } = require("../services/leadInbox");
const { toDateOnlyString } = require("../src/utils/dates");

function createTempDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-test-"));
  return {
    dir: tempDir,
    dbPath: path.join(tempDir, "crm.sqlite"),
  };
}

function loadJsonFixture(...segments) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, ...segments), "utf8"));
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
  const app = await createApp({ dbPath: temp.dbPath, uiMode: "legacy" });
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

test("login page does not expose demo credentials", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    const response = await client.request({ path: "/login" });
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body, /Seeded local users/i);
    assert.doesNotMatch(response.body, /admin123|manager123|sales123/);
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

test("admin can create and delete users through the API", async () => {
  await withServer(async ({ app, server }) => {
    const client = createClient(server);
    await login(client, "admin@crm.local", "admin123");

    const createResponse = await client.request({
      method: "POST",
      path: "/api/users",
      json: {
        name: "API Seller",
        email: "apiseller@crm.local",
        password: "seller234",
        role: "sales",
      },
    });

    assert.equal(createResponse.statusCode, 201);
    const createdUser = JSON.parse(createResponse.body);
    assert.equal(createdUser.email, "apiseller@crm.local");

    const usersResponse = await client.request({ path: "/api/users" });
    assert.equal(usersResponse.statusCode, 200);
    const usersBody = JSON.parse(usersResponse.body);
    assert.ok(usersBody.items.some((user) => user.email === "apiseller@crm.local"));

    const deleteResponse = await client.request({
      method: "DELETE",
      path: `/api/users/${createdUser.id}`,
    });

    assert.equal(deleteResponse.statusCode, 204);
    assert.equal(app.locals.db.getUserByEmail("apiseller@crm.local"), null);
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

test("manager can import inventory CSV with upsert behavior", async () => {
  await withServer(async ({ app, server }) => {
    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const firstImport = await client.request({
      method: "POST",
      path: "/api/inventory/import",
      json: {
        file_name: "inventory.csv",
        source_name: "dealer-feed",
        csv_text: [
          "stock_number,vin,year,make,model,trim,price,mileage,status",
          "A100,1HGCM82633A000001,2023,Honda,Civic,Touring,29995,12500,active",
          "A101,1HGCM82633A000002,2022,Toyota,RAV4,XLE,33995,19000,active",
        ].join("\n"),
      },
    });

    assert.equal(firstImport.statusCode, 201);
    const firstBody = JSON.parse(firstImport.body);
    assert.equal(firstBody.run.rows_inserted, 2);
    assert.equal(firstBody.run.rows_updated, 0);

    const secondImport = await client.request({
      method: "POST",
      path: "/api/inventory/import",
      json: {
        file_name: "inventory.csv",
        source_name: "dealer-feed",
        csv_text: [
          "stock_number,vin,year,make,model,trim,price,mileage,status",
          "A100,1HGCM82633A000001,2023,Honda,Civic,Sport,31995,14000,active",
        ].join("\n"),
      },
    });

    assert.equal(secondImport.statusCode, 201);
    const secondBody = JSON.parse(secondImport.body);
    assert.equal(secondBody.run.rows_inserted, 0);
    assert.equal(secondBody.run.rows_updated, 1);

    const inventoryRows = app.locals.db.listInventoryForApi({}, { dealership_id: 1, role: "manager" });
    assert.equal(inventoryRows.length, 2);
    assert.equal(inventoryRows.find((item) => item.stock_number === "A100").trim, "Sport");
  });
});

test("inventory list includes imported units regardless of extra CSV columns", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const importResponse = await client.request({
      method: "POST",
      path: "/api/inventory/import",
      json: {
        file_name: "inventory.csv",
        source_name: "dealer-feed",
        csv_text: [
          "stock_number,vin,year,make,model,verified,status",
          "V100,1HGCM82633A000011,2023,Honda,Civic,yes,active",
          "V101,1HGCM82633A000012,2022,Toyota,RAV4,no,active",
        ].join("\n"),
      },
    });

    assert.equal(importResponse.statusCode, 201);

    const listResponse = await client.request({
      method: "GET",
      path: "/api/inventory",
    });
    assert.equal(listResponse.statusCode, 200);
    const body = JSON.parse(listResponse.body);
    assert.equal(body.items.length, 2);
    assert.ok(body.items.some((item) => item.stock_number === "V100"));
    assert.ok(body.items.some((item) => item.stock_number === "V101"));
  });
});

test("inventory import records row-level errors without aborting the run", async () => {
  await withServer(async ({ app, server }) => {
    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const response = await client.request({
      method: "POST",
      path: "/api/inventory/import",
      json: {
        file_name: "broken.csv",
        source_name: "dealer-feed",
        csv_text: [
          "stock_number,vin,year,make,model",
          "B200,1HGCM82633A000003,2024,Ford,F-150",
          ",,,Honda,Civic",
        ].join("\n"),
      },
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body);
    assert.equal(body.run.rows_inserted, 1);
    assert.equal(body.run.rows_skipped, 1);

    const errors = app.locals.db.all("SELECT * FROM inventory_import_errors WHERE import_run_id = ?", [body.run.id]);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error_message, /stock number or VIN/i);
  });
});

test("manager can link a lead to an inventory unit", async () => {
  await withServer(async ({ app, server }) => {
    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const importResponse = await client.request({
      method: "POST",
      path: "/api/inventory/import",
      json: {
        file_name: "inventory.csv",
        source_name: "dealer-feed",
        csv_text: [
          "stock_number,vin,year,make,model,trim,price,mileage,status",
          "C300,1HGCM82633A000004,2021,Mazda,CX-5,GS,27995,32000,active",
        ].join("\n"),
      },
    });

    const imported = JSON.parse(importResponse.body);
    const inventoryRow = app.locals.db.listInventoryForApi({}, { dealership_id: 1, role: "manager" })[0];
    assert.equal(imported.run.rows_inserted, 1);

    const createLeadResponse = await client.request({
      method: "POST",
      path: "/api/leads",
      json: {
        customer_name: "Inventory Link Lead",
        phone: "6471112222",
        source: "website",
      },
    });

    assert.equal(createLeadResponse.statusCode, 201);
    const lead = JSON.parse(createLeadResponse.body);

    const linkResponse = await client.request({
      method: "POST",
      path: `/api/leads/${lead.id}/link-inventory`,
      json: {
        inventory_id: inventoryRow.id,
      },
    });

    assert.equal(linkResponse.statusCode, 200);
    const payload = JSON.parse(linkResponse.body);
    assert.equal(payload.lead.inventory_id, inventoryRow.id);
    assert.equal(payload.lead.inventory.stock_number, "C300");
  });
});

test("lead creation auto-links inventory by stock number", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const importResponse = await client.request({
      method: "POST",
      path: "/api/inventory/import",
      json: {
        file_name: "inventory.csv",
        source_name: "dealer-feed",
        csv_text: [
          "stock_number,vin,year,make,model,trim,verified,status",
          "AUTO77,1HGCM82633A000077,2024,Honda,Civic,Touring,yes,active",
        ].join("\n"),
      },
    });
    assert.equal(importResponse.statusCode, 201);

    const createLeadResponse = await client.request({
      method: "POST",
      path: "/api/leads",
      json: {
        customer_name: "Stock Match Lead",
        phone: "6472223333",
        source: "website",
        stock_number: "AUTO77",
      },
    });

    assert.equal(createLeadResponse.statusCode, 201);
    const lead = JSON.parse(createLeadResponse.body);
    assert.equal(lead.inventory_id != null, true);
    assert.equal(lead.inventory.stock_number, "AUTO77");
  });
});

test("inventory import rejects invalid dealership context before hitting the database", async () => {
  await withServer(async ({ app }) => {
    const user = app.locals.db.getUserByEmail("manager@crm.local");
    const originalCurrentDealershipId = app.locals.db.currentDealershipId.bind(app.locals.db);
    app.locals.db.currentDealershipId = () => Number.NaN;

    try {
      await assert.rejects(
        () =>
          importInventoryCsv({
            db: app.locals.db,
            user,
            fileName: "inventory.csv",
            sourceName: "dealer-feed",
            csvText: ["stock_number,vin,year,make,model", "B200,1HGCM82633A000003,2024,Ford,F-150"].join("\n"),
          }),
        /Unable to determine dealership for inventory import/i
      );
    } finally {
      app.locals.db.currentDealershipId = originalCurrentDealershipId;
    }
  });
});

test("lead creation ignores invalid numeric dealership input instead of passing NaN to storage", async () => {
  await withServer(async ({ app }) => {
    const manager = app.locals.db.getUserByEmail("manager@crm.local");
    const lead = await app.locals.db.createApiLead(
      {
        dealership_id: "NaN",
        customer_name: "Safe Dealership Lead",
        phone: "6473334444",
        source: "website",
        status: "new",
      },
      manager
    );

    assert.equal(lead.dealership_id, 1);
    assert.equal(lead.customer_name, "Safe Dealership Lead");
  });
});

test("database adapter sanitizes NaN SQL params before execution", async () => {
  await withServer(async ({ app }) => {
    const run = app.locals.db.createInventoryImportRun(
      {
        dealership_id: 1,
        source_type: "manual_upload",
        source_name: "dealer-feed",
        file_name: "inventory.csv",
        status: "running",
      },
      { dealership_id: 1 }
    );

    assert.doesNotThrow(() => {
      app.locals.db.execute(
        `
          INSERT INTO inventory_import_errors (
            import_run_id,
            row_number,
            stock_number,
            vin,
            error_message,
            raw_row_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [run.id, Number.NaN, "SAFE-1", null, "Test error", "{}", new Date().toISOString()]
      );
    });

    const row = app.locals.db.get(
      "SELECT row_number FROM inventory_import_errors WHERE import_run_id = ? AND stock_number = ?",
      [run.id, "SAFE-1"]
    );
    assert.equal(row.row_number, null);
  });
});

test("website API creates an unassigned website lead", async () => {
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
    assert.equal(body.assigned_user_name, "Unassigned");
    assert.equal(body.assigned_to, null);
  });
});

test("manager can assign an unassigned API lead", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    const createResponse = await client.request({
      method: "POST",
      path: "/api/leads",
      json: {
        name: "Fresh Shopper",
        phone: "555-0109",
        email: "fresh@example.com",
        vehicle: "2023 Audi Q5",
        source: "website",
      },
    });

    assert.equal(createResponse.statusCode, 201);
    const createdLead = JSON.parse(createResponse.body);
    assert.equal(createdLead.assigned_to, null);

    await login(client, "manager@crm.local", "manager123");

    const assigneesResponse = await client.request({ path: "/api/users/assignable" });
    assert.equal(assigneesResponse.statusCode, 200);
    const assigneesBody = JSON.parse(assigneesResponse.body);
    const salesUser = assigneesBody.items.find((user) => user.email === "sales@crm.local");

    assert.ok(salesUser);

    const assignResponse = await client.request({
      method: "PATCH",
      path: `/api/leads/${createdLead.id}/assign`,
      json: { assigned_to: salesUser.id },
    });

    assert.equal(assignResponse.statusCode, 200);
    const assignedBody = JSON.parse(assignResponse.body);
    assert.equal(assignedBody.lead.assigned_to, Number(salesUser.id));
    assert.equal(assignedBody.lead.assigned_user_name, "CRM Sales");
    assert.ok(
      assignedBody.activities.some((activity) => /Lead assigned to CRM Sales\./.test(activity.content))
    );
  });
});

test("manager can convert an 'Other' intake item into a lead through the API", async () => {
  await withServer(async ({ app, server }) => {
    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const item = app.locals.db.createEmailIntakeItem({
      external_id: "<other-1@example.com>",
      source: "website",
      subject: "Contact us about a used Camry",
      sender: "customer@example.com",
      message: "Can someone help me with the 2020 Toyota Camry on the lot?",
      received_at: "2026-03-22T15:00:00.000Z",
      classification: "other",
      status: "open",
      customer_name: "Jamie Driver",
      phone: "+16475550199",
      email: "customer@example.com",
      stock_number: "D9489",
      vehicle_display: "2020 Toyota Camry SE",
    });

    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const response = await client.request({
      method: "POST",
      path: `/api/intake-items/${item.id}/convert`,
      json: {
        assigned_to: salesUser.id,
      },
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.body);
    assert.equal(payload.item.status, "converted_to_lead");
    assert.equal(Number(payload.item.assigned_to), Number(salesUser.id));
    assert.equal(payload.lead.customer_name, "Jamie Driver");
    assert.equal(payload.lead.stock_number, "D9489");
    assert.equal(Number(payload.lead.assigned_to), Number(salesUser.id));
  });
});

test("manual lead status updates reject invalid jumps", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    const createResponse = await client.request({
      method: "POST",
      path: "/api/leads",
      json: {
        name: "Status Shopper",
        phone: "(647) 555-0199",
        email: "status@example.com",
        vehicle: "2022 Audi A4",
        source: "website",
      },
    });

    const createdLead = JSON.parse(createResponse.body);
    await login(client, "manager@crm.local", "manager123");

    const updateResponse = await client.request({
      method: "PATCH",
      path: `/api/leads/${createdLead.id}/status`,
      json: { status: "sold" },
    });

    assert.equal(updateResponse.statusCode, 400);
    assert.match(updateResponse.body, /Invalid status transition/i);
  });
});

test("sales users cannot manually update lead status through the API", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const lead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "Sales Status Lock",
      phone: "(647) 555-0144",
      email: "sales-lock@example.com",
      vehicle_interest: "2024 SUV",
      status: "contacted",
    });
    app.locals.db.assignLead(lead.id, salesUser.id);

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({
      method: "PATCH",
      path: `/api/leads/${lead.id}/status`,
      json: { status: "appointment" },
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.body, /Forbidden/);
  });
});

test("lead detail API returns unified timeline data", async () => {
  await withServer(async ({ app, server }) => {
    const lead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "Timeline Shopper",
      phone: "(647) 555-0100",
      email: "timeline@example.com",
      vehicle_interest: "2024 SUV",
      status: "new",
    });

    await app.locals.ringcentral.store.upsertLeadMessage({
      lead_id: Number(lead.id),
      provider: "ringcentral",
      provider_message_id: "msg-timeline-1",
      direction: "inbound",
      from_number: "(647) 555-0100",
      to_number: "+1 647-555-1212",
      external_number: "+16475550100",
      body_text: "Can I come in tomorrow?",
      message_status: "Received",
      received_at: "2026-03-16T15:00:00.000Z",
      crm_user_id: 2,
      provider_extension_id: "246552024",
      raw: {},
    });

    const call = await app.locals.ringcentral.store.upsertLeadCall({
      lead_id: Number(lead.id),
      provider: "ringcentral",
      provider_call_id: "call-timeline-1",
      direction: "outbound",
      from_number: "+16475551212",
      to_number: "(647) 555-0100",
      external_number: "+16475550100",
      result: "Accepted",
      action: "Phone Call",
      duration_seconds: 42,
      start_time: "2026-03-16T16:00:00.000Z",
      crm_user_id: 2,
      provider_extension_id: "246552024",
      recording_status: "available",
      transcript_status: "completed",
      raw: {},
    });

    await app.locals.ringcentral.store.upsertCallRecording({
      lead_call_id: call.record.id,
      provider: "ringcentral",
      provider_recording_id: "recording-timeline-1",
      content_uri: "https://platform.ringcentral.com/recordings/1",
      transcript_status: "completed",
      raw: {},
    });

    await app.locals.ringcentral.store.createCommunicationAnalysis({
      lead_id: Number(lead.id),
      source_type: "call",
      source_id: call.record.id,
      provider: "ringcentral",
      transcript_text: "Customer wants to book a visit.",
      summary: "Customer is ready to come in.",
      intent: "appointment",
      objections: "",
      appointment_intent: true,
      trade_in_mention: false,
      financing_mention: false,
      hot_lead_score: 88,
      suggested_status: "appointment",
      confidence: 0.91,
      reasoning_summary: "Customer asked to come tomorrow.",
      next_task: "Confirm appointment time.",
      escalation_flag: false,
      auto_status_applied: false,
      recommendation_only: true,
      previous_status: "contacted",
      new_status: "appointment",
      raw: {},
    });

    await app.locals.db.recordLeadStatusAudit({
      lead_id: Number(lead.id),
      user_id: 2,
      previous_status: "new",
      new_status: "contacted",
      confidence: 1,
      reasoning_summary: "Manager updated after first response.",
      source: "manual_status_update",
      auto_applied: false,
      recommendation_only: false,
      created_at: "2026-03-16T14:00:00.000Z",
    });

    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const response = await client.request({ path: `/api/leads/${lead.id}` });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body.timeline));
    assert.ok(body.timeline.some((item) => item.type === "sms"));
    assert.ok(body.timeline.some((item) => item.type === "call"));
    assert.ok(body.timeline.some((item) => item.type === "status_change"));
  });
});

test("conversations API returns recent calls and SMS items", async () => {
  await withServer(async ({ app, server }) => {
    const lead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "Conversation Shopper",
      phone: "(647) 555-0105",
      email: "conversation@example.com",
      vehicle_interest: "2021 Sedan",
      status: "contacted",
    });

    await app.locals.ringcentral.store.upsertLeadMessage({
      lead_id: Number(lead.id),
      provider: "ringcentral",
      provider_message_id: "msg-feed-1",
      direction: "inbound",
      from_number: "(647) 555-0105",
      to_number: "+1 647-555-1212",
      external_number: "+16475550105",
      body_text: "Is the car still available?",
      message_status: "Received",
      received_at: "2026-03-16T15:00:00.000Z",
      crm_user_id: 2,
      provider_extension_id: "246552024",
      raw: {},
    });

    await app.locals.ringcentral.store.upsertLeadCall({
      lead_id: Number(lead.id),
      provider: "ringcentral",
      provider_call_id: "call-feed-1",
      direction: "outbound",
      from_number: "+16475551212",
      to_number: "(647) 555-0105",
      external_number: "+16475550105",
      result: "Accepted",
      action: "Phone Call",
      duration_seconds: 31,
      start_time: "2026-03-16T16:00:00.000Z",
      crm_user_id: 2,
      provider_extension_id: "246552024",
      recording_status: "none",
      transcript_status: "not_requested",
      raw: {},
    });

    const client = createClient(server);
    await login(client, "manager@crm.local", "manager123");

    const response = await client.request({ path: "/api/conversations?limit=10" });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.items.some((item) => item.type === "sms"));
    assert.ok(body.items.some((item) => item.type === "call"));
  });
});

test("API SMS endpoint sends a CRM message and returns refreshed lead detail", async () => {
  const temp = createTempDbPath();
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("/phone-number")) {
      return new Response(
        JSON.stringify({
          records: [
            {
              phoneNumber: "+16475551212",
              usageType: "DirectNumber",
              features: ["SMS"],
              default: true,
              status: "Normal",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (String(url).includes("/sms")) {
      const payload = JSON.parse(options.body || "{}");
      assert.equal(payload.from?.phoneNumber, "+16475551212");
      return new Response(
        JSON.stringify({
          id: "msg-api-sms-1",
          messageStatus: "Queued",
          creationTime: "2026-03-16T15:00:00.000Z",
          from: { phoneNumber: "+16475551212" },
          conversationId: "thread-1",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const app = await createApp({
    dbPath: temp.dbPath,
    uiMode: "legacy",
    ringcentral: {
      fetchImpl,
    },
  });
  const server = app.listen(0);

  try {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const lead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "API SMS Lead",
      phone: "(647) 555-0111",
      email: "api-sms@example.com",
      vehicle_interest: "2023 SUV",
      status: "new",
    });
    app.locals.db.assignLead(lead.id, salesUser.id);

    await app.locals.ringcentral.store.upsertConnection({
      user_id: salesUser.id,
      ringcentral_account_id: "acct-1",
      ringcentral_extension_id: "ext-1",
      server_url: "https://platform.ringcentral.com",
      access_token: "token",
      refresh_token: "refresh",
      token_type: "Bearer",
      scope: "SMS",
      status: "active",
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({
      method: "POST",
      path: `/api/leads/${lead.id}/sms`,
      json: { message: "Still interested in the SUV?" },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.lead.status, "contacted");
    assert.ok(body.timeline.some((item) => item.type === "sms"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("API call endpoint initiates a RingCentral RingOut call without creating a fake completed call", async () => {
  const temp = createTempDbPath();
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("/forwarding-number")) {
      return new Response(
        JSON.stringify({
          records: [
            {
              phoneNumber: "+1 (647) 555-1999",
              default: true,
              status: "Enabled",
              features: ["RingOut"],
              type: "ForwardingNumber",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (String(url).includes("/ring-out")) {
      const payload = JSON.parse(String(options.body || "{}"));
      assert.equal(payload.from.phoneNumber, "+16475551999");
      assert.equal(payload.to.phoneNumber, "+16475550112");
      assert.equal(payload.playPrompt, false);

      return new Response(
        JSON.stringify({
          id: "ringout-1",
          creationTime: "2026-03-19T15:00:00.000Z",
          status: {
            callStatus: "InProgress",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const app = await createApp({
    dbPath: temp.dbPath,
    uiMode: "legacy",
    ringcentral: {
      fetchImpl,
    },
  });
  const server = app.listen(0);

  try {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const lead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "API Call Lead",
      phone: "(647) 555-0112",
      email: "api-call@example.com",
      vehicle_interest: "2024 Truck",
      status: "new",
    });
    app.locals.db.assignLead(lead.id, salesUser.id);

    await app.locals.ringcentral.store.upsertConnection({
      user_id: salesUser.id,
      ringcentral_account_id: "acct-1",
      ringcentral_extension_id: "ext-1",
      server_url: "https://platform.ringcentral.com",
      access_token: "token",
      refresh_token: "refresh",
      token_type: "Bearer",
      scope: "ReadCallLog RingOut",
      status: "active",
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({
      method: "POST",
      path: `/api/leads/${lead.id}/call`,
    });

    assert.equal(response.statusCode, 202);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.call_attempt.id, "ringout-1");
    assert.equal(body.call_attempt.status, "InProgress");
    assert.equal(body.call_attempt.from_number, "+16475551999");
    assert.equal(body.call_attempt.to_number, "+16475550112");

    const storedLead = await app.locals.db.getApiLead(Number(lead.id), salesUser);
    assert.equal(storedLead.status, "new");

    const callCount = app.locals.db.get("SELECT COUNT(*) AS count FROM lead_calls WHERE lead_id = ?", [lead.id]);
    assert.equal(Number(callCount.count), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("API hold endpoint creates a hold task and note for the lead", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const lead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "Hold Lead",
      phone: "(647) 555-0113",
      email: "hold@example.com",
      vehicle_interest: "2022 Coupe",
      stock_number: "D9977",
      status: "contacted",
    });
    app.locals.db.assignLead(lead.id, salesUser.id);

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({
      method: "POST",
      path: `/api/leads/${lead.id}/hold`,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.tasks.some((task) => task.type === "hold_vehicle"));
    assert.ok(body.activities.some((activity) => /Vehicle hold requested/i.test(activity.content)));
  });
});

test("API lists unmatched communications for the signed-in rep and lets them dismiss an item", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    await app.locals.ringcentral.store.upsertUnmatchedCommunication({
      dealership_id: Number(salesUser.dealership_id),
      type: "sms",
      direction: "inbound",
      from_number: "+16475550101",
      to_number: "+16475551212",
      normalized_from_number: "+16475550101",
      normalized_to_number: "+16475551212",
      body_text: "Is this still available?",
      received_at: "2026-03-19T16:00:00.000Z",
      provider: "ringcentral",
      provider_message_id: "unmatched-api-sms-1",
      crm_user_id: Number(salesUser.id),
      provider_extension_id: "ext-sales",
      raw: {},
    });
    await app.locals.ringcentral.store.upsertUnmatchedCommunication({
      dealership_id: Number(salesUser.dealership_id),
      type: "sms",
      direction: "inbound",
      from_number: "+16475550102",
      to_number: "+16475551212",
      normalized_from_number: "+16475550102",
      normalized_to_number: "+16475551212",
      body_text: "Other rep item",
      received_at: "2026-03-19T16:05:00.000Z",
      provider: "ringcentral",
      provider_message_id: "unmatched-api-sms-2",
      crm_user_id: 999,
      provider_extension_id: "ext-other",
      raw: {},
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const listResponse = await client.request({ path: "/api/unmatched?status=new" });
    assert.equal(listResponse.statusCode, 200);
    const listBody = JSON.parse(listResponse.body);
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].provider_message_id, "unmatched-api-sms-1");

    const dismissResponse = await client.request({
      method: "POST",
      path: `/api/unmatched/${listBody.items[0].id}/dismiss`,
    });
    assert.equal(dismissResponse.statusCode, 200);
    const dismissedBody = JSON.parse(dismissResponse.body);
    assert.equal(dismissedBody.item.status, "dismissed");
  });
});

test("API can create a lead from an unmatched SMS and attach it to the timeline", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const queued = await app.locals.ringcentral.store.upsertUnmatchedCommunication({
      dealership_id: Number(salesUser.dealership_id),
      type: "sms",
      direction: "inbound",
      from_number: "+16475550333",
      to_number: "+16475551212",
      normalized_from_number: "+16475550333",
      normalized_to_number: "+16475551212",
      body_text: "Can you text me the price?",
      received_at: "2026-03-19T17:00:00.000Z",
      provider: "ringcentral",
      provider_message_id: "unmatched-create-lead-1",
      crm_user_id: Number(salesUser.id),
      provider_extension_id: "ext-sales",
      raw: {},
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({
      method: "POST",
      path: `/api/unmatched/${queued.record.id}/create-lead`,
      json: {
        customer_name: "Queue Shopper",
      },
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body);
    assert.equal(body.item.status, "resolved");
    assert.equal(body.lead.customer_name, "Queue Shopper");
    assert.equal(body.lead.phone, "+16475550333");
    assert.ok(body.timeline.some((entry) => entry.type === "sms"));

    const message = await app.locals.db.get(
      "SELECT * FROM lead_messages WHERE provider_message_id = ?",
      ["unmatched-create-lead-1"]
    );
    assert.ok(message);
    assert.equal(Number(message.lead_id), Number(body.lead.id));
  });
});

test("API can assign an unmatched call to an existing lead", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const lead = await app.locals.db.createApiLead(
      {
        source: "website",
        customer_name: "Existing Match",
        phone: "+1 (647) 555-0444",
        email: "existing@example.com",
        vehicle_interest: "2024 SUV",
        status: "new",
        assigned_to: Number(salesUser.id),
        dealership_id: Number(salesUser.dealership_id),
      },
      salesUser
    );

    const queued = await app.locals.ringcentral.store.upsertUnmatchedCommunication({
      dealership_id: Number(salesUser.dealership_id),
      type: "call",
      direction: "inbound",
      from_number: "+16475550444",
      to_number: "+16475551212",
      normalized_from_number: "+16475550444",
      normalized_to_number: "+16475551212",
      call_duration: 31,
      received_at: "2026-03-19T17:10:00.000Z",
      provider: "ringcentral",
      provider_call_id: "unmatched-assign-call-1",
      crm_user_id: Number(salesUser.id),
      provider_extension_id: "ext-sales",
      raw: {
        id: "unmatched-assign-call-1",
        direction: "Inbound",
        result: "Accepted",
        action: "Phone Call",
        duration: 31,
        startTime: "2026-03-19T17:10:00.000Z",
      },
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({
      method: "POST",
      path: `/api/unmatched/${queued.record.id}/assign`,
      json: { lead_id: Number(lead.id) },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.item.status, "resolved");
    assert.equal(Number(body.item.resolved_lead_id), Number(lead.id));
    assert.ok(body.timeline.some((entry) => entry.type === "call"));

    const call = await app.locals.db.get(
      "SELECT * FROM lead_calls WHERE provider_call_id = ?",
      ["unmatched-assign-call-1"]
    );
    assert.ok(call);
    assert.equal(Number(call.lead_id), Number(lead.id));
  });
});

test("dashboard worklist separates attention leads from organized leads", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");

    const newLead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "Fresh Attention",
      phone: "(647) 555-0131",
      email: "fresh-attention@example.com",
      vehicle_interest: "2024 SUV",
      status: "new",
    });
    app.locals.db.assignLead(newLead.id, salesUser.id);

    const engagedLead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "Organized Contact",
      phone: "(647) 555-0132",
      email: "organized@example.com",
      vehicle_interest: "2023 Sedan",
      status: "contacted",
    });
    app.locals.db.assignLead(engagedLead.id, salesUser.id);
    app.locals.db.createActivity({
      lead_id: engagedLead.id,
      type: "sms",
      content: "Customer replied and is reviewing options.",
      created_at: new Date().toISOString(),
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({ path: "/api/dashboard/worklist" });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);

    assert.ok(body.attention_items.some((lead) => lead.customer_name === "Fresh Attention"));
    assert.ok(body.organized_groups.contacted.some((lead) => lead.customer_name === "Organized Contact"));
  });
});

test("sales user can complete an assigned task through the API", async () => {
  await withServer(async ({ app, server }) => {
    const salesUser = app.locals.db.getUserByEmail("sales@crm.local");
    const lead = app.locals.db.createApiLead({
      source: "website",
      customer_name: "Task Lead",
      phone: "(647) 555-0133",
      email: "task@example.com",
      vehicle_interest: "2022 Coupe",
      status: "contacted",
    });
    app.locals.db.assignLead(lead.id, salesUser.id);
    const task = app.locals.db.createOrRefreshTask({
      lead_id: Number(lead.id),
      user_id: Number(salesUser.id),
      type: "follow_up",
      title: "Call back the customer",
      due_at: new Date().toISOString(),
      source: "manual",
      unique_key: "test-follow-up-task",
      metadata: {},
    });

    const client = createClient(server);
    await login(client, "sales@crm.local", "sales123");

    const response = await client.request({
      method: "PATCH",
      path: `/api/tasks/${task.id}/complete`,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.task.status, "completed");

    const stored = app.locals.db.get("SELECT * FROM tasks WHERE id = ?", [task.id]);
    assert.equal(stored.status, "completed");
  });
});

test("RingCentral webhook logs phone activity and auto-updates lead status", async () => {
  const temp = createTempDbPath();
  const previousThreshold = process.env.RINGCENTRAL_AI_CONFIDENCE_THRESHOLD;
  const previousAuto = process.env.RINGCENTRAL_AUTO_STATUS_UPDATES;
  process.env.RINGCENTRAL_AI_CONFIDENCE_THRESHOLD = "0.6";
  process.env.RINGCENTRAL_AUTO_STATUS_UPDATES = "true";

  const fetchImpl = async (url) => {
    if (String(url).includes("/message-store/msg-1")) {
      return new Response(
        JSON.stringify({
          id: "msg-1",
          direction: "Inbound",
          from: { phoneNumber: "+1 (647) 555-0102" },
          to: [{ phoneNumber: "+1 (647) 555-1212" }],
          subject: "I want to book a test drive appointment tomorrow afternoon.",
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

  const app = await createApp({
    dbPath: temp.dbPath,
    uiMode: "legacy",
    ringcentral: {
      recordingsDir: path.join(temp.dir, "recordings"),
      fetchImpl,
    },
  });
  const server = app.listen(0);

  try {
    const lead = await app.locals.db.createApiLead({
      source: "website",
      customer_name: "Webhook Lead",
      phone: "(647) 555-0102",
      email: "webhook@example.com",
      vehicle_interest: "2024 SUV",
      status: "new",
    });

    await app.locals.ringcentral.store.upsertConnection({
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

    const fixture = loadJsonFixture("fixtures", "ringcentral", "instant-sms.json");
    const client = createClient(server);
    const webhookResponse = await client.request({
      method: "POST",
      path: "/api/ringcentral/webhooks",
      json: fixture,
    });

    assert.equal(webhookResponse.statusCode, 200);
    const body = JSON.parse(webhookResponse.body);
    assert.equal(body.accepted, true);

    await app.locals.ringcentral.processPendingJobs({ limit: 5 });

    const updatedLead = await app.locals.db.getApiLead(Number(lead.id));
    assert.equal(updatedLead.status, "appointment");

    const activities = await app.locals.db.all(
      "SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC",
      [lead.id]
    );
    assert.ok(activities.some((activity) => /test drive appointment/i.test(String(activity.content))));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env.RINGCENTRAL_AI_CONFIDENCE_THRESHOLD = previousThreshold;
    process.env.RINGCENTRAL_AUTO_STATUS_UPDATES = previousAuto;
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("RingCentral webhook validation handshake returns before event processing", async () => {
  await withServer(async ({ server }) => {
    const client = createClient(server);
    const response = await client.request({
      method: "POST",
      path: "/api/ringcentral/webhooks",
      headers: {
        "Validation-Token": "rc-validation-check",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["validation-token"], "rc-validation-check");
    assert.equal(response.body, "");
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
