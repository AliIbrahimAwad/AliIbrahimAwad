const fs = require("fs");
const path = require("path");

const { ensureCommunicationsSchema } = require("./communicationsSchema");
const {
  analyzeWithOpenAi,
  applyAiLeadStatusDecision,
  getAiConfig,
  transcribeAudioFile,
} = require("./leadStatusAutomation");
const { RingCentralApiClient, DEFAULT_EVENT_FILTERS, DEFAULT_SERVER_URL, buildUrl } = require("./ringcentralClient");
const { createRingCentralRepository } = require("./ringcentralRepository");
const { logStructured } = require("./structuredLogger");
const { normalizePhone } = require("../src/utils/phones");

const DEFAULT_RECORDINGS_DIR = path.join(__dirname, "..", "data", "ringcentral", "recordings");

function decodeJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeHeaders(headers = {}) {
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);
  const normalized = {};
  for (const [key, value] of entries) {
    normalized[String(key).toLowerCase()] = value;
  }
  return normalized;
}

function extractEventKey(envelope = {}) {
  const body = envelope.body || {};
  return (
    envelope.uuid ||
    envelope.eventId ||
    body.uuid ||
    body.eventId ||
    body.id ||
    body.messageId ||
    body.sessionId ||
    body.telephonySessionId ||
    `${envelope.subscriptionId || "sub"}:${envelope.event || "event"}:${envelope.timestamp || nowIso()}`
  );
}

function parseEventType(event = "") {
  const normalized = String(event || "").toLowerCase();
  if (normalized.includes("message-store")) {
    return "sms";
  }
  if (normalized.includes("telephony/sessions")) {
    return "telephony_session";
  }
  if (normalized.includes("subscription")) {
    return "subscription";
  }
  return "unknown";
}

function extractPhone(endpoint) {
  if (!endpoint) {
    return "";
  }
  if (typeof endpoint === "string") {
    return endpoint;
  }
  if (Array.isArray(endpoint)) {
    return extractPhone(endpoint[0]);
  }
  return endpoint.phoneNumber || endpoint.extensionNumber || endpoint.address || "";
}

function parseDirection(value) {
  return String(value || "").trim().toLowerCase() || "unknown";
}

function getCounterpartyPhone({ direction, fromNumber, toNumber }) {
  return parseDirection(direction) === "outbound" ? toNumber || fromNumber || "" : fromNumber || toNumber || "";
}

function extractMessageBody(payload = {}) {
  return payload.subject || payload.text || payload.body || payload.bodyText || payload.messageStatus || "";
}

function formatCallActivity(record) {
  const direction = parseDirection(record.direction);
  const label = direction ? `${direction.charAt(0).toUpperCase()}${direction.slice(1)}` : "Call";
  const duration = Number(record.duration_seconds || 0);
  return `${label} call ${record.result || "synced"}${duration ? ` (${duration}s)` : ""}`;
}

function removeTemporaryRecordingFile(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    logStructured("error", "ringcentral_recording_cleanup_failed", {
      local_path: filePath,
      error: error.message,
    });
  }

  return false;
}

function sanitizeConnectionForStatus(connection) {
  if (!connection) {
    return null;
  }

  return {
    id: connection.id,
    user_id: connection.user_id,
    ringcentral_account_id: connection.ringcentral_account_id,
    ringcentral_extension_id: connection.ringcentral_extension_id,
    server_url: connection.server_url,
    token_type: connection.token_type,
    scope: connection.scope,
    expires_at: connection.expires_at,
    refresh_expires_at: connection.refresh_expires_at,
    webhook_address: connection.webhook_address,
    status: connection.status,
    created_at: connection.created_at,
    updated_at: connection.updated_at,
    dealership_id: connection.dealership_id,
    has_access_token: Boolean(connection.access_token),
    has_refresh_token: Boolean(connection.refresh_token),
  };
}

class RingCentralService {
  constructor({ db, config = {}, fetchImpl = fetch }) {
    this.db = db;
    this.client = new RingCentralApiClient({
      serverUrl: config.serverUrl || process.env.RINGCENTRAL_SERVER_URL || DEFAULT_SERVER_URL,
      clientId: config.clientId || process.env.RINGCENTRAL_CLIENT_ID || "",
      clientSecret: config.clientSecret || process.env.RINGCENTRAL_CLIENT_SECRET || "",
      redirectUri: config.redirectUri || process.env.RINGCENTRAL_REDIRECT_URI || "",
      webhookUrl: config.webhookUrl || process.env.RINGCENTRAL_WEBHOOK_URL || "",
      validationToken: config.webhookValidationToken || process.env.RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN || "",
      scopes: config.scopes || process.env.RINGCENTRAL_SCOPES || "",
      fetchImpl,
    });
    this.config = {
      fromPhoneNumber: config.fromPhoneNumber || process.env.RINGCENTRAL_FROM_NUMBER || "",
      staticAccessToken: config.accessToken || process.env.RINGCENTRAL_ACCESS_TOKEN || "",
      recordingsDir: config.recordingsDir || process.env.RINGCENTRAL_RECORDINGS_DIR || DEFAULT_RECORDINGS_DIR,
      autoCreateSubscription: config.autoCreateSubscription !== false,
    };
    this.aiConfig = getAiConfig();
    this.store = db ? createRingCentralRepository(db) : null;
  }

  async initialize() {
    if (!this.db) {
      return;
    }
    await ensureCommunicationsSchema(this.db);
    fs.mkdirSync(this.config.recordingsDir, { recursive: true });
  }

  getRequiredScopes() {
    return this.client.scopes.split(/\s+/).filter(Boolean);
  }

  buildAuthorizationUrl(state) {
    return this.client.buildAuthorizationUrl(state);
  }

  async completeOAuthConnection(userId, code) {
    const tokens = await this.client.exchangeCodeForTokens(code);
    const extension = await this.client.getExtensionInfo(tokens.access_token);

    const connection = await this.store.upsertConnection({
      user_id: userId,
      ringcentral_account_id: extension.account?.id || extension.accountId || null,
      ringcentral_extension_id: extension.id || extension.extensionNumber || null,
      server_url: this.client.serverUrl,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_type: tokens.token_type || "Bearer",
      scope: tokens.scope || this.client.scopes,
      expires_at: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : null,
      refresh_expires_at: tokens.refresh_token_expires_in
        ? new Date(Date.now() + Number(tokens.refresh_token_expires_in) * 1000).toISOString()
        : null,
      webhook_address: this.client.webhookUrl || null,
      status: "active",
    });

    if (this.config.autoCreateSubscription && this.client.webhookUrl) {
      await this.client.createSubscription(connection, this.store, DEFAULT_EVENT_FILTERS);
    }

    return connection;
  }

  async getConnectionStatusForUser(userId) {
    const connection = await this.store.getConnectionByUserId(userId);
    const subscription = connection ? await this.store.getSubscriptionByConnectionId(connection.id) : null;
    return {
      connected: Boolean(connection && connection.status === "active"),
      connection: sanitizeConnectionForStatus(connection),
      subscription: subscription
        ? {
            ...subscription,
            event_filters: decodeJson(subscription.event_filters, []),
          }
        : null,
      required_scopes: this.getRequiredScopes(),
    };
  }

  async disconnectUser(userId) {
    await this.store.deactivateConnection(userId);
  }

  async getActiveConnectionForUser(userId) {
    const connection = await this.store.getConnectionByUserId(userId);
    if (!connection || connection.status !== "active") {
      return null;
    }
    return connection;
  }

  async sendSMS(phone, message, options = {}) {
    if (!phone || !message) {
      throw new Error("Phone number and message are required.");
    }

    let connection = null;
    if (options.crmUserId && this.store) {
      connection = await this.getActiveConnectionForUser(options.crmUserId);
    }

    if (!connection && !this.config.staticAccessToken) {
      return {
        id: `mock-sms-${Date.now()}`,
        mock: true,
        phone,
        message,
        queuedAt: nowIso(),
      };
    }

    if (!connection) {
      const response = await fetch(`${this.client.serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.staticAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: { phoneNumber: this.config.fromPhoneNumber },
          to: [{ phoneNumber: phone }],
          text: message,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`RingCentral SMS failed: ${body || response.statusText}`);
      }
      return response.json();
    }

    return this.client.requestWithRefresh(connection, this.store, {
      url: buildUrl(this.client.serverUrl, "/restapi/v1.0/account/~/extension/~/sms"),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { extensionId: connection.ringcentral_extension_id || "~" },
        to: [{ phoneNumber: phone }],
        text: message,
      }),
    });
  }

  logCall(phone, duration = 0) {
    return {
      id: `call-${Date.now()}`,
      phone,
      duration: Number(duration) || 0,
      createdAt: nowIso(),
    };
  }

  isValidWebhookRequest(headers) {
    if (!this.client.validationToken) {
      return true;
    }
    const normalized = normalizeHeaders(headers);
    return (
      normalized["validation-token"] === this.client.validationToken ||
      normalized["x-ringcentral-validation-token"] === this.client.validationToken
    );
  }

  getValidationToken(headers) {
    const normalized = normalizeHeaders(headers);
    return normalized["validation-token"] || normalized["x-ringcentral-validation-token"] || "";
  }

  getEventEnvelope(body = {}) {
    const payload = body && typeof body === "object" ? body : {};
    return {
      uuid: payload.uuid || payload.eventId || null,
      event: payload.event || payload.eventType || "",
      timestamp: payload.timestamp || payload.createdAt || nowIso(),
      subscriptionId: payload.subscriptionId || payload.subscription?.id || null,
      ownerId: payload.ownerId || payload.owner?.id || null,
      body: payload.body || payload,
      raw: payload,
    };
  }

  async processSmsPayload(connection, payload) {
    const messageId = payload.id || payload.messageId;
    const message = messageId
      ? await this.client.getMessageById(connection, this.store, messageId)
      : payload;
    const direction = parseDirection(message.direction || payload.direction);
    const fromNumber = extractPhone(message.from || payload.from);
    const toNumber = extractPhone(Array.isArray(message.to) ? message.to[0] : message.to || payload.to);
    const externalNumber = normalizePhone(getCounterpartyPhone({ direction, fromNumber, toNumber }));
    const lead = externalNumber ? await this.db.findLeadByPhone(externalNumber) : null;

    if (!lead) {
      logStructured("info", "ringcentral_unmatched_sms_number", {
        external_number: externalNumber || null,
        provider_message_id: message.id || messageId || null,
      });
    }

    const { created, record } = await this.store.upsertLeadMessage({
      lead_id: lead ? Number(lead.id) : null,
      provider: "ringcentral",
      provider_message_id: String(message.id || messageId),
      thread_id: message.conversationId || message.conversation?.id || null,
      direction,
      from_number: fromNumber,
      to_number: toNumber,
      external_number: externalNumber || null,
      subject: message.subject || null,
      body_text: extractMessageBody(message),
      message_status: message.messageStatus || payload.messageStatus || null,
      sent_at: message.creationTime || payload.creationTime || null,
      received_at: message.lastModifiedTime || payload.lastModifiedTime || message.creationTime || null,
      crm_user_id: Number(connection.user_id),
      provider_extension_id: connection.ringcentral_extension_id || null,
      raw: message,
    });

    if (lead && created) {
      await this.db.createActivity({
        lead_id: Number(lead.id),
        type: "sms",
        content: record.body_text || "RingCentral SMS synced",
      });
      await this.store.enqueueJob({
        job_type: "analyze_sms_thread",
        unique_key: `analyze_sms:${record.id}`,
        payload: { lead_id: Number(lead.id), source_id: record.id },
      });
    }
  }

  matchesSession(record, payload) {
    const payloadSession = String(payload.sessionId || "").trim();
    const payloadTelephonySession = String(payload.telephonySessionId || "").trim();
    return (
      (payloadSession && String(record.sessionId || "").trim() === payloadSession) ||
      (payloadTelephonySession && String(record.telephonySessionId || "").trim() === payloadTelephonySession)
    );
  }

  async reconcileCallSession(connection, payload) {
    const eventTime = payload.eventTime || payload.startTime || nowIso();
    const start = new Date(eventTime);
    start.setHours(start.getHours() - 12);
    const end = new Date(eventTime);
    end.setHours(end.getHours() + 12);

    const response = await this.client.listCallLogs(connection, this.store, {
      dateFrom: start.toISOString(),
      dateTo: end.toISOString(),
      perPage: 100,
    });
    const records = Array.isArray(response.records) ? response.records : [];
    const matchedRecords = records.filter((record) => this.matchesSession(record, payload));

    if (matchedRecords.length === 0) {
      logStructured("info", "ringcentral_call_log_reconciliation_missed", {
        connection_id: connection.id,
        session_id: payload.sessionId || null,
        telephony_session_id: payload.telephonySessionId || null,
      });
      return [];
    }

    const synced = [];
    for (const record of matchedRecords) {
      const direction = parseDirection(record.direction);
      const fromNumber = extractPhone(record.from);
      const toNumber = extractPhone(Array.isArray(record.to) ? record.to[0] : record.to);
      const externalNumber = normalizePhone(getCounterpartyPhone({ direction, fromNumber, toNumber }));
      const lead = externalNumber ? await this.db.findLeadByPhone(externalNumber) : null;
      if (!lead) {
        logStructured("info", "ringcentral_unmatched_call_number", {
          external_number: externalNumber || null,
          provider_call_id: record.id || null,
        });
      }

      const recording = Array.isArray(record.recording) ? record.recording[0] : record.recording;
      const { created, record: savedCall } = await this.store.upsertLeadCall({
        lead_id: lead ? Number(lead.id) : null,
        provider: "ringcentral",
        provider_call_id: String(record.id),
        session_id: record.sessionId || payload.sessionId || null,
        telephony_session_id: record.telephonySessionId || payload.telephonySessionId || null,
        direction,
        from_number: fromNumber,
        to_number: toNumber,
        external_number: externalNumber || null,
        result: record.result || null,
        action: record.action || null,
        duration_seconds: Number(record.duration || 0),
        start_time: record.startTime || eventTime,
        end_time: record.lastModifiedTime || null,
        crm_user_id: Number(connection.user_id),
        provider_extension_id: connection.ringcentral_extension_id || null,
        recording_id: recording?.id || null,
        recording_status: recording ? "available" : "none",
        transcript_status: recording ? "pending" : "not_requested",
        raw: record,
      });

      if (lead && created) {
        await this.db.createActivity({
          lead_id: Number(lead.id),
          type: "call_logged",
          content: formatCallActivity(savedCall),
        });
      }

      if (recording?.id || recording?.contentUri) {
        const recordingEntry = await this.store.upsertCallRecording({
          lead_call_id: savedCall.id,
          provider: "ringcentral",
          provider_recording_id: recording?.id || null,
          content_uri: recording?.contentUri || null,
          transcript_status: "pending",
          raw: recording || {},
        });
        await this.store.enqueueJob({
          job_type: "fetch_call_recording",
          unique_key: `fetch_recording:${recordingEntry.record.id}`,
          payload: { connection_id: connection.id, recording_id: recordingEntry.record.id },
        });
      }

      synced.push(savedCall);
    }

    return synced;
  }

  async fetchRecording(connection, recordingRecord) {
    const raw = decodeJson(recordingRecord.raw_json, {});
    const providerRecordingId = recordingRecord.provider_recording_id || raw.id || "";
    const contentUri =
      recordingRecord.content_uri ||
      raw.contentUri ||
      (providerRecordingId
        ? buildUrl(this.client.serverUrl, `/restapi/v1.0/account/~/recording/${providerRecordingId}/content`)
        : "");
    if (!contentUri) {
      throw new Error("Recording content URI is missing.");
    }

    const response = await this.client.downloadRecording(connection, this.store, contentUri);
    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const extension = contentType.includes("wav") ? "wav" : "mp3";
    const filePath = path.join(this.config.recordingsDir, `${recordingRecord.id}.${extension}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return this.store.upsertCallRecording({
      lead_call_id: recordingRecord.lead_call_id,
      provider: "ringcentral",
      provider_recording_id: providerRecordingId || null,
      content_uri: contentUri,
      local_path: filePath,
      mime_type: contentType,
      fetched_at: nowIso(),
      transcript_status: "pending",
      raw,
    });
  }

  async analyzeCallRecording(recordingRecord) {
    const leadCall = await this.db.get("SELECT * FROM lead_calls WHERE id = ?", [recordingRecord.lead_call_id]);
    if (!leadCall || !leadCall.lead_id) {
      await this.store.upsertCallRecording({
        lead_call_id: recordingRecord.lead_call_id,
        provider: "ringcentral",
        provider_recording_id: recordingRecord.provider_recording_id,
        content_uri: recordingRecord.content_uri,
        local_path: null,
        mime_type: recordingRecord.mime_type,
        fetched_at: recordingRecord.fetched_at,
        transcript_status: "skipped",
        raw: decodeJson(recordingRecord.raw_json, {}),
      });
      removeTemporaryRecordingFile(recordingRecord.local_path);
      return null;
    }

    let transcript = "";
    if (recordingRecord.local_path && fs.existsSync(recordingRecord.local_path)) {
      transcript = (await transcribeAudioFile(recordingRecord.local_path, this.aiConfig)) || "";
    }

    const recommendation = await analyzeWithOpenAi("call", transcript || "No transcript available.", this.aiConfig);
    const lead = await this.db.getApiLead(Number(leadCall.lead_id));
    const audit = await applyAiLeadStatusDecision({
      db: this.db,
      lead,
      recommendation,
      source: "ai_call_analysis",
      store: this.store,
      config: this.aiConfig,
    });

    await this.store.createCommunicationAnalysis({
      lead_id: Number(lead.id),
      source_type: "call",
      source_id: leadCall.id,
      provider: "ringcentral",
      transcript_text: transcript || null,
      summary: recommendation.summary,
      intent: recommendation.intent,
      objections: recommendation.objections,
      appointment_intent: recommendation.appointment_intent,
      trade_in_mention: recommendation.trade_in_mention,
      financing_mention: recommendation.financing_mention,
      hot_lead_score: recommendation.hot_lead_score,
      suggested_status: recommendation.suggested_status,
      confidence: recommendation.confidence,
      reasoning_summary: recommendation.reasoning_summary,
      next_task: recommendation.next_task,
      escalation_flag: recommendation.escalation_flag,
      auto_status_applied: audit.auto_applied,
      recommendation_only: audit.recommendation_only,
      previous_status: audit.previous_status,
      new_status: audit.new_status,
      raw: recommendation.raw || {},
    });

    await this.store.upsertCallRecording({
      lead_call_id: recordingRecord.lead_call_id,
      provider: "ringcentral",
      provider_recording_id: recordingRecord.provider_recording_id,
      content_uri: recordingRecord.content_uri,
      local_path: null,
      mime_type: recordingRecord.mime_type,
      fetched_at: recordingRecord.fetched_at,
      transcript_status: transcript ? "completed" : "unavailable",
      raw: decodeJson(recordingRecord.raw_json, {}),
    });

    removeTemporaryRecordingFile(recordingRecord.local_path);

    return { transcript, recommendation, audit };
  }

  async analyzeSmsThread(leadId, sourceId) {
    const lead = await this.db.getApiLead(Number(leadId));
    const messages = await this.store.listLeadMessages(Number(leadId), 10);
    const ordered = [...messages].reverse();
    const threadText = ordered
      .map((message) => `${String(message.direction || "unknown").toUpperCase()}: ${message.body_text || ""}`)
      .join("\n");
    const recommendation = await analyzeWithOpenAi("sms", threadText || "No SMS content.", this.aiConfig);
    const audit = await applyAiLeadStatusDecision({
      db: this.db,
      lead,
      recommendation,
      source: "ai_message_analysis",
      store: this.store,
      config: this.aiConfig,
    });

    await this.store.createCommunicationAnalysis({
      lead_id: Number(lead.id),
      source_type: "sms",
      source_id: sourceId,
      provider: "ringcentral",
      summary: recommendation.summary,
      intent: recommendation.intent,
      objections: recommendation.objections,
      appointment_intent: recommendation.appointment_intent,
      trade_in_mention: recommendation.trade_in_mention,
      financing_mention: recommendation.financing_mention,
      hot_lead_score: recommendation.hot_lead_score,
      suggested_status: recommendation.suggested_status,
      confidence: recommendation.confidence,
      reasoning_summary: recommendation.reasoning_summary,
      next_task: recommendation.next_task,
      escalation_flag: recommendation.escalation_flag,
      auto_status_applied: audit.auto_applied,
      recommendation_only: audit.recommendation_only,
      previous_status: audit.previous_status,
      new_status: audit.new_status,
      raw: {
        messages: ordered.map((message) => ({
          id: message.id,
          direction: message.direction,
          body_text: message.body_text,
        })),
        model_output: recommendation.raw || null,
      },
    });
    return { recommendation, audit };
  }

  async processWebhookEnvelope(envelope) {
    const eventType = parseEventType(envelope.event);
    const eventKey = extractEventKey(envelope);
    const stored = await this.store.createWebhookEventIfNew({
      event_key: eventKey,
      subscription_id: envelope.subscriptionId,
      event_type: eventType,
      owner_id: envelope.ownerId,
      payload: envelope.raw,
    });

    if (!stored.created) {
      return { duplicate: true, event_key: eventKey };
    }

    try {
      const connections = await this.store.listActiveConnections();
      const connection =
        connections.find(
          (item) => String(item.ringcentral_extension_id || "") === String(envelope.ownerId || envelope.body?.extensionId || "")
        ) || connections[0];

      if (eventType === "sms" && connection) {
        await this.processSmsPayload(connection, envelope.body);
      } else if (eventType === "telephony_session" && connection) {
        await this.store.enqueueJob({
          job_type: "reconcile_call_session",
          unique_key: `reconcile_call_session:${envelope.body.telephonySessionId || envelope.body.sessionId || eventKey}`,
          payload: {
            connection_id: connection.id,
            telephonySessionId: envelope.body.telephonySessionId || null,
            sessionId: envelope.body.sessionId || null,
            eventTime: envelope.body.eventTime || envelope.timestamp,
          },
        });
      } else if (!connection) {
        throw new Error("No active RingCentral connection is available for the incoming webhook.");
      }

      await this.store.markWebhookEventProcessed(stored.event.id);
      return { accepted: true, event_key: eventKey };
    } catch (error) {
      await this.store.markWebhookEventFailed(stored.event.id, error);
      throw error;
    }
  }

  async processPendingJobs({ limit = 10 } = {}) {
    const jobs = await this.store.claimPendingJobs(limit);
    const results = [];

    for (const job of jobs) {
      const payload = decodeJson(job.payload_json, {});
      try {
        if (job.job_type === "reconcile_call_session") {
          const connection = await this.store.getConnectionById(payload.connection_id);
          const synced = connection ? await this.reconcileCallSession(connection, payload) : [];
          results.push({ job: job.id, type: job.job_type, synced: synced.length });
        } else if (job.job_type === "fetch_call_recording") {
          const connection = await this.store.getConnectionById(payload.connection_id);
          const recording = await this.db.get("SELECT * FROM call_recordings WHERE id = ?", [payload.recording_id]);
          if (!connection || !recording) {
            throw new Error("Recording fetch job is missing its connection or recording record.");
          }
          const saved = await this.fetchRecording(connection, recording);
          await this.store.enqueueJob({
            job_type: "analyze_call_recording",
            unique_key: `analyze_call_recording:${saved.record.id}`,
            payload: { recording_id: saved.record.id },
          });
          results.push({ job: job.id, type: job.job_type, recording_id: saved.record.id });
        } else if (job.job_type === "analyze_call_recording") {
          const recording = await this.db.get("SELECT * FROM call_recordings WHERE id = ?", [payload.recording_id]);
          const analysis = recording ? await this.analyzeCallRecording(recording) : null;
          results.push({ job: job.id, type: job.job_type, analyzed: Boolean(analysis) });
        } else if (job.job_type === "analyze_sms_thread") {
          const analysis = await this.analyzeSmsThread(payload.lead_id, payload.source_id);
          results.push({ job: job.id, type: job.job_type, analyzed: Boolean(analysis) });
        } else {
          logStructured("info", "ringcentral_unknown_job_type", { job_id: job.id, job_type: job.job_type });
        }

        await this.store.completeJob(job.id);
      } catch (error) {
        logStructured("error", "ringcentral_job_failed", {
          job_id: job.id,
          job_type: job.job_type,
          error: error.message,
        });
        await this.store.failJob(job.id, error, job.attempts);
        results.push({ job: job.id, type: job.job_type, error: error.message });
      }
    }

    return results;
  }

  async reconcileConnectedAccounts({ hoursBack = 24 } = {}) {
    const connections = await this.store.listActiveConnections();
    const start = new Date();
    start.setHours(start.getHours() - Number(hoursBack || 24));
    const end = new Date();
    const results = [];

    for (const connection of connections) {
      try {
        const response = await this.client.listCallLogs(connection, this.store, {
          dateFrom: start.toISOString(),
          dateTo: end.toISOString(),
          perPage: 100,
        });
        const records = Array.isArray(response.records) ? response.records : [];
        for (const record of records) {
          await this.store.enqueueJob({
            job_type: "reconcile_call_session",
            unique_key: `reconcile_call_record:${record.id}`,
            payload: {
              connection_id: connection.id,
              telephonySessionId: record.telephonySessionId || null,
              sessionId: record.sessionId || null,
              eventTime: record.startTime || record.lastModifiedTime || nowIso(),
            },
          });
        }
        results.push({ connection_id: connection.id, queued_call_records: records.length });
      } catch (error) {
        logStructured("error", "ringcentral_reconciliation_failed", {
          connection_id: connection.id,
          error: error.message,
        });
        results.push({ connection_id: connection.id, error: error.message });
      }
    }

    return results;
  }
}

async function createRingCentralService(config = {}, dependencies = {}) {
  const service = new RingCentralService({
    db: dependencies.db,
    config,
    fetchImpl: dependencies.fetchImpl || fetch,
  });
  if (dependencies.db) {
    await service.initialize();
  }
  return service;
}

module.exports = {
  DEFAULT_EVENT_FILTERS,
  RingCentralService,
  createRingCentralService,
  extractEventKey,
};
