const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createHeuristicSmsSuggestion,
  generateLeadSmsSuggestion,
  runAutomaticTexting,
} = require("../services/leadTextingAutomation");

test("heuristic SMS suggestion includes vehicle context", () => {
  const suggestion = createHeuristicSmsSuggestion(
    {
      customer_name: "Ali Ibrahim",
      vehicle_interest: "2021 Ford Mustang Mach-E",
    },
    { goal: "follow_up" }
  );

  assert.equal(suggestion.goal, "follow_up");
  assert.equal(typeof suggestion.message, "string");
  assert.match(suggestion.message, /Mustang Mach-E/);
});

test("AI SMS suggestion falls back to heuristic when OpenAI is unavailable", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";

  const suggestion = await generateLeadSmsSuggestion({
    lead: {
      customer_name: "Test Lead",
      vehicle_interest: "2022 Tesla Model 3",
      source: "website",
      status: "new",
    },
    goal: "appointment",
  });

  assert.equal(suggestion.source, "heuristic");
  assert.match(suggestion.message, /Model 3/);

  process.env.OPENAI_API_KEY = originalKey;
});

test("AI SMS suggestion parses structured output from the Responses API output array", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_TEXTING_MODEL;
  const originalFetch = global.fetch;

  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_TEXTING_MODEL = "gpt-5.4-mini";
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  message: "Hi Ali, the Mustang Mach-E is still available if you'd like to book a visit.",
                  confidence: 0.91,
                  reasoning: "Customer asked about availability, so a concise appointment-focused reply is appropriate.",
                  tone: "friendly",
                  objective: "appointment",
                }),
              },
            ],
          },
        ],
      };
    },
  });

  const suggestion = await generateLeadSmsSuggestion({
    lead: {
      customer_name: "Ali Ibrahim",
      vehicle_interest: "2021 Ford Mustang Mach-E",
      source: "website",
      status: "new",
      message: "Is this still available?",
    },
    goal: "appointment",
  });

  assert.equal(suggestion.source, "openai");
  assert.equal(suggestion.objective, "appointment");
  assert.match(suggestion.message, /Mustang Mach-E/);

  process.env.OPENAI_API_KEY = originalKey;
  process.env.OPENAI_TEXTING_MODEL = originalModel;
  global.fetch = originalFetch;
});

test("automatic texting sends and records a first follow-up", async () => {
  const sentMessages = [];
  const automationRuns = [];
  const notifications = [];
  const activities = [];

  const result = await runAutomaticTexting({
    db: {
      async getExecutionSettings() {
        return {
          auto_sms_enabled: 1,
          auto_sms_delay_minutes: 10,
        };
      },
      async listLeadsEligibleForAutoText() {
        return [
          {
            id: 101,
            dealership_id: 1,
            assigned_to: 9,
            phone: "+14165550101",
            customer_name: "Sam",
            vehicle_interest: "2024 Ford F-150",
            source: "autotrader",
            status: "new",
            message: "Is it still available?",
          },
        ];
      },
      async recordLeadActivity(payload) {
        activities.push(payload);
      },
      async createLeadAutoTextRun(payload) {
        automationRuns.push(payload);
        return { id: automationRuns.length, ...payload };
      },
      async createNotification(payload) {
        notifications.push(payload);
      },
    },
    ringcentral: {
      config: {
        staticAccessToken: "token",
      },
      store: {
        async listLeadMessages() {
          return [];
        },
        async upsertLeadMessage(payload) {
          sentMessages.push(payload);
          return { created: true, record: payload };
        },
      },
      async getActiveConnectionForUser(userId) {
        return {
          user_id: userId,
          ringcentral_extension_id: "200",
        };
      },
      async sendSMS(phone, message) {
        return {
          id: "sms_1",
          to: { phoneNumber: phone },
          messageStatus: "Queued",
          creationTime: "2026-03-31T14:15:00.000Z",
        };
      },
    },
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(sentMessages.length, 1);
  assert.equal(automationRuns[0].status, "sent");
  assert.equal(notifications.length, 1);
  assert.equal(activities.length, 1);
});

test("automatic texting skips leads when no RingCentral connection is available", async () => {
  const automationRuns = [];

  const result = await runAutomaticTexting({
    db: {
      async getExecutionSettings() {
        return {
          auto_sms_enabled: 1,
          auto_sms_delay_minutes: 10,
        };
      },
      async listLeadsEligibleForAutoText() {
        return [
          {
            id: 202,
            dealership_id: 1,
            assigned_to: 7,
            phone: "+14165550102",
            customer_name: "Jordan",
            vehicle_interest: "2023 Tesla Model Y",
            source: "website",
            status: "new",
          },
        ];
      },
      async createLeadAutoTextRun(payload) {
        automationRuns.push(payload);
        return { id: automationRuns.length, ...payload };
      },
    },
    ringcentral: {
      config: {
        staticAccessToken: "",
      },
      store: {
        async listLeadMessages() {
          return [];
        },
      },
      async getActiveConnectionForUser() {
        return null;
      },
    },
  });

  assert.equal(result.skipped, 1);
  assert.equal(automationRuns[0].status, "skipped_no_connection");
});
