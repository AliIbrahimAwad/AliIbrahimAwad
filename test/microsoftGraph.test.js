const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGraphService } = require("../services/microsoftGraph");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("Microsoft Graph service resolves nested Inbox subfolders", async () => {
  const requests = [];
  const graph = buildGraphService({
    tenantId: "tenant",
    clientId: "client",
    clientSecret: "secret",
    userId: "ali@loolooauto.ca",
    folderName: "Inbox/CRM LEADS",
    cutoff: "2026-03-24T00:00:00.000Z",
    fetchImpl: async (url) => {
      requests.push(String(url));

      if (String(url).includes("/oauth2/v2.0/token")) {
        return jsonResponse({
          access_token: "token",
          expires_in: 3600,
        });
      }

      if (String(url).includes("/mailFolders/inbox/childFolders")) {
        return jsonResponse({
          value: [{ id: "folder-crm-leads", displayName: "CRM LEADS" }],
        });
      }

      if (String(url).includes("/mailFolders/folder-crm-leads/messages")) {
        return jsonResponse({
          value: [
            {
              id: "message-1",
              subject: "Website lead",
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  });

  const messages = await graph.listMessages({ limit: 10 });

  assert.equal(messages.length, 1);
  assert.ok(requests.some((url) => url.includes("/mailFolders/inbox/childFolders")));
  assert.ok(requests.some((url) => url.includes("/mailFolders/folder-crm-leads/messages")));
});

test("Microsoft Graph service still supports top-level custom folders", async () => {
  const requests = [];
  const graph = buildGraphService({
    tenantId: "tenant",
    clientId: "client",
    clientSecret: "secret",
    userId: "ali@loolooauto.ca",
    folderName: "CRM LEADS",
    cutoff: "2026-03-24T00:00:00.000Z",
    fetchImpl: async (url) => {
      requests.push(String(url));

      if (String(url).includes("/oauth2/v2.0/token")) {
        return jsonResponse({
          access_token: "token",
          expires_in: 3600,
        });
      }

      if (String(url).includes("/mailFolders?$top=200")) {
        return jsonResponse({
          value: [{ id: "folder-crm-leads", displayName: "CRM LEADS" }],
        });
      }

      if (String(url).includes("/mailFolders/folder-crm-leads/messages")) {
        return jsonResponse({ value: [] });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  });

  const messages = await graph.listMessages({ limit: 10 });

  assert.deepEqual(messages, []);
  assert.ok(requests.some((url) => url.includes("/mailFolders?$top=200")));
});
