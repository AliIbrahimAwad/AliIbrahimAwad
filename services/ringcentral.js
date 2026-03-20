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
const { NotFoundError, ValidationError } = require("../src/data/core");
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

function plusHours(dateString, hours) {
  const date = new Date(dateString || Date.now());
  date.setHours(date.getHours() + Number(hours || 0));
  return date.toISOString();
}

function plusMinutes(dateString, minutes) {
  const date = new Date(dateString || Date.now());
  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return date.toISOString();
}

function normalizeHeaders(headers = {}) {
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);
  const normalized = {};
  for (const [key, value] of entries) {
    normalized[String(key).toLowerCase()] = value;
  }
  return normalized;
}

function normalizeBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return value === true || value === "true" || value === "1" || value === 1;
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

function scoreDevicePhoneCandidate(record = {}) {
  let score = 0;
  const usage = String(record.usageType || record.type || "").toLowerCase();
  const status = String(record.status || "").toLowerCase();
  const features = Array.isArray(record.features) ? record.features.map((feature) => String(feature).toLowerCase()) : [];

  if (record.default === true || record.isDefault === true) {
    score += 50;
  }
  if (status === "enabled" || status === "active" || status === "normal") {
    score += 15;
  }
  if (features.some((feature) => feature.includes("ringout"))) {
    score += 25;
  }
  if (usage.includes("forward")) {
    score += 20;
  }
  if (usage.includes("direct")) {
    score += 15;
  }
  if (usage.includes("main")) {
    score += 10;
  }
  if (record.flipNumber === false) {
    score += 5;
  }

  return score;
}

function scoreSmsPhoneCandidate(record = {}) {
  let score = 0;
  const usage = String(record.usageType || record.type || "").toLowerCase();
  const status = String(record.status || "").toLowerCase();
  const features = Array.isArray(record.features) ? record.features.map((feature) => String(feature).toLowerCase()) : [];
  const hasSmsFeature = features.some(
    (feature) => feature.includes("sms") || feature.includes("message") || feature.includes("text")
  );

  if (record.default === true || record.isDefault === true) {
    score += 50;
  }
  if (status === "enabled" || status === "active" || status === "normal") {
    score += 15;
  }
  if (hasSmsFeature) {
    score += 40;
  }
  if (usage.includes("direct")) {
    score += 20;
  }
  if (usage.includes("main")) {
    score += 10;
  }

  return score;
}

function pickBestDevicePhone(records = []) {
  return records
    .map((record) => {
      const phoneNumber = normalizePhone(record.phoneNumber || record.phone_number || extractPhone(record));
      if (!phoneNumber) {
        return null;
      }

      return {
        phoneNumber,
        source: record.source || null,
        score: scoreDevicePhoneCandidate(record),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)[0] || null;
}

function pickBestSmsPhone(records = []) {
  const normalized = records
    .map((record) => {
      const phoneNumber = normalizePhone(record.phoneNumber || record.phone_number || extractPhone(record));
      if (!phoneNumber) {
        return null;
      }

      return {
        phoneNumber,
        source: record.source || null,
        score: scoreSmsPhoneCandidate(record),
        smsCapable: Array.isArray(record.features)
          ? record.features.some((feature) => {
              const normalizedFeature = String(feature).toLowerCase();
              return (
                normalizedFeature.includes("sms") ||
                normalizedFeature.includes("message") ||
                normalizedFeature.includes("text")
              );
            })
          : false,
      };
    })
    .filter(Boolean);

  const smsCapable = normalized.filter((record) => record.smsCapable);
  const candidates = smsCapable.length ? smsCapable : normalized;
  return candidates.sort((left, right) => right.score - left.score)[0] || null;
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

function buildCallKeywordText(record = {}) {
  const raw = record && typeof record === "object" ? record : {};
  return [
    raw.action,
    raw.result,
    raw.reason,
    raw.direction,
    raw.transport,
    raw.telephonyStatus,
    raw.availability,
    raw.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function looksLikeMissedCall(record = {}) {
  const direction = String(record.direction || "").toLowerCase();
  const result = String(record.result || "").toLowerCase();
  const action = String(record.action || "").toLowerCase();
  return (
    direction === "inbound" &&
    /missed|no answer|received|voicemail/.test(`${result} ${action}`.trim())
  );
}

function collectExtensionIds(...values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function extractExtensionCandidatesFromEnvelope(envelope = {}) {
  const body = envelope.body || {};
  return collectExtensionIds(
    envelope.ownerId,
    body.ownerId,
    body.extensionId,
    body.owner?.id,
    body.extension?.id,
    body.from?.extensionId,
    body.to?.extensionId,
    (body.parties || []).map((party) => party?.extensionId || party?.extension?.id)
  );
}

function extractExtensionIdFromMessagePayload(payload = {}, connection = null) {
  return (
    collectExtensionIds(
      payload.ownerId,
      payload.extensionId,
      payload.from?.extensionId,
      (payload.to || []).map((entry) => entry?.extensionId)
    )[0] ||
    connection?.ringcentral_extension_id ||
    null
  );
}

function extractExtensionIdFromCallRecord(record = {}, connection = null) {
  return (
    collectExtensionIds(
      record.extension?.id,
      record.extensionId,
      record.from?.extensionId,
      (record.to || []).map((entry) => entry?.extensionId)
    )[0] ||
    connection?.ringcentral_extension_id ||
    null
  );
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
      minStoredCallSeconds: Number(
        config.minStoredCallSeconds ?? process.env.RINGCENTRAL_MIN_STORED_CALL_SECONDS ?? 10
      ),
      skipForwardedCalls: normalizeBooleanFlag(
        config.skipForwardedCalls ?? process.env.RINGCENTRAL_SKIP_FORWARDED_CALLS,
        true
      ),
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
    const user = await this.db.getUser(userId);

    const connection = await this.store.upsertConnection({
      dealership_id: user.dealership_id,
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

  async listUnmatchedCommunications({ status = "", limit = 100 } = {}, user) {
    return this.store.listUnmatchedCommunications({ status, limit }, user);
  }

  assertResolvableUnmatched(item) {
    if (!item) {
      throw new NotFoundError("Unmatched communication not found.");
    }

    if (["resolved", "dismissed"].includes(String(item.status || "").toLowerCase())) {
      throw new ValidationError("This communication has already been resolved.");
    }
  }

  async storeMatchedSmsForLead(item, lead) {
    const message = item.raw || decodeJson(item.raw_json, {}) || {};
    const { created, record } = await this.store.upsertLeadMessage({
      dealership_id: Number(item.dealership_id),
      lead_id: Number(lead.id),
      provider: item.provider || "ringcentral",
      provider_message_id: String(item.provider_message_id),
      thread_id: message.conversationId || message.conversation?.id || null,
      direction: item.direction || "inbound",
      from_number: item.from_number || null,
      to_number: item.to_number || null,
      external_number: item.normalized_from_number || normalizePhone(item.from_number) || null,
      subject: message.subject || null,
      body_text: item.body_text || extractMessageBody(message),
      message_status: message.messageStatus || null,
      sent_at: message.creationTime || item.received_at || null,
      received_at: item.received_at || message.lastModifiedTime || message.creationTime || null,
      crm_user_id: item.crm_user_id == null ? null : Number(item.crm_user_id),
      provider_extension_id: item.provider_extension_id || null,
      raw: message,
    });

    if (created) {
      await this.db.createActivity({
        lead_id: Number(lead.id),
        type: "sms",
        content: record.body_text || "RingCentral SMS synced",
      });
      await this.store.enqueueJob({
        dealership_id: Number(item.dealership_id),
        job_type: "analyze_sms_thread",
        unique_key: `analyze_sms:${record.id}`,
        payload: { lead_id: Number(lead.id), source_id: record.id },
      });
    }

    return record;
  }

  async storeMatchedCallForLead(item, lead) {
    const record = item.raw || decodeJson(item.raw_json, {}) || {};
    const recording = Array.isArray(record.recording) ? record.recording[0] : record.recording;
    const { created, record: savedCall } = await this.store.upsertLeadCall({
      dealership_id: Number(item.dealership_id),
      lead_id: Number(lead.id),
      provider: item.provider || "ringcentral",
      provider_call_id: String(item.provider_call_id),
      session_id: record.sessionId || item.provider_call_id || null,
      telephony_session_id: record.telephonySessionId || null,
      direction: item.direction || "inbound",
      from_number: item.from_number || null,
      to_number: item.to_number || null,
      external_number: item.normalized_from_number || normalizePhone(item.from_number) || null,
      result: record.result || null,
      action: record.action || null,
      duration_seconds: item.call_duration == null ? 0 : Number(item.call_duration),
      start_time: item.received_at || record.startTime || null,
      end_time: record.lastModifiedTime || null,
      crm_user_id: item.crm_user_id == null ? null : Number(item.crm_user_id),
      provider_extension_id: item.provider_extension_id || null,
      recording_id: recording?.id || null,
      recording_status: recording ? "available" : "none",
      transcript_status: recording ? "pending" : "not_requested",
      raw: record,
    });

    if (created) {
      await this.db.createActivity({
        lead_id: Number(lead.id),
        type: "call_logged",
        content: formatCallActivity(savedCall),
      });
    }

    if (recording?.id || recording?.contentUri) {
      const connection =
        (item.provider_extension_id
          ? await this.store.getConnectionByExtensionId(item.provider_extension_id, Number(item.dealership_id))
          : null) ||
        (item.crm_user_id == null ? null : await this.store.getConnectionByUserId(Number(item.crm_user_id)));
      const recordingEntry = await this.store.upsertCallRecording({
        dealership_id: Number(item.dealership_id),
        lead_call_id: savedCall.id,
        provider: item.provider || "ringcentral",
        provider_recording_id: recording?.id || null,
        content_uri: recording?.contentUri || null,
        transcript_status: "pending",
        raw: recording || {},
      });
      await this.store.enqueueJob({
        dealership_id: Number(item.dealership_id),
        job_type: "fetch_call_recording",
        unique_key: `fetch_recording:${recordingEntry.record.id}`,
        payload: { connection_id: connection?.id || null, recording_id: recordingEntry.record.id },
      });
    }

    if (looksLikeMissedCall(record)) {
      const settings = await this.db.getExecutionSettings();
      await this.db.createOrRefreshTask({
        lead_id: Number(lead.id),
        user_id: lead.assigned_to ? Number(lead.assigned_to) : item.crm_user_id == null ? null : Number(item.crm_user_id),
        type: "missed_call_callback",
        title: "Return missed call",
        due_at: plusMinutes(nowIso(), settings.missed_call_task_due_minutes),
        source: "system",
        unique_key: `missed-call:${savedCall.id}`,
        metadata: {
          provider_call_id: savedCall.provider_call_id,
          external_number: savedCall.external_number,
        },
      });
    }

    return savedCall;
  }

  async assignUnmatchedCommunication(id, leadId, user) {
    const item = await this.store.getUnmatchedCommunicationById(id, user);
    this.assertResolvableUnmatched(item);

    const lead = await this.db.getApiLead(Number(leadId), user);
    if (Number(lead.dealership_id) !== Number(item.dealership_id)) {
      throw new ValidationError("This communication does not belong to the selected dealership lead.");
    }

    if (item.type === "sms") {
      await this.storeMatchedSmsForLead(item, lead);
    } else if (item.type === "call") {
      await this.storeMatchedCallForLead(item, lead);
    } else {
      throw new ValidationError("Unsupported communication type.");
    }

    await this.store.updateUnmatchedCommunication(
      item.id,
      {
        status: "resolved",
        resolved_lead_id: Number(lead.id),
      },
      user
    );

    return { lead_id: Number(lead.id) };
  }

  async createLeadFromUnmatched(id, input = {}, user) {
    const item = await this.store.getUnmatchedCommunicationById(id, user);
    this.assertResolvableUnmatched(item);

    const lead = await this.db.createApiLead(
      {
        source: "ringcentral",
        customer_name: String(input.customer_name || input.name || "").trim() || null,
        phone: item.normalized_from_number || item.from_number || null,
        email: null,
        vehicle_interest: null,
        message: item.body_text || null,
        status: "new",
        assigned_to: Number(user.id),
        dealership_id: Number(user.dealership_id),
      },
      user
    );

    await this.assignUnmatchedCommunication(item.id, Number(lead.id), user);
    return { lead_id: Number(lead.id) };
  }

  async dismissUnmatchedCommunication(id, user) {
    const item = await this.store.getUnmatchedCommunicationById(id, user);
    this.assertResolvableUnmatched(item);
    await this.store.updateUnmatchedCommunication(
      item.id,
      {
        status: "dismissed",
        resolved_lead_id: null,
      },
      user
    );
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
        from: { phoneNumber: (await this.resolveSmsSender(connection)).phoneNumber },
        to: [{ phoneNumber: phone }],
        text: message,
      }),
    });
  }

  async resolveSmsSender(connection) {
    let extensionPhoneCandidate = null;
    try {
      const extensionPhoneNumbers = await this.client.listExtensionPhoneNumbers(connection, this.store);
      extensionPhoneCandidate = pickBestSmsPhone(
        Array.isArray(extensionPhoneNumbers?.records)
          ? extensionPhoneNumbers.records.map((record) => ({ ...record, source: "extension_phone_number" }))
          : []
      );
    } catch (error) {
      logStructured("info", "ringcentral_sms_phone_lookup_failed", {
        dealership_id: connection.dealership_id,
        crm_user_id: Number(connection.user_id),
        error: error.message,
      });
    }
    if (extensionPhoneCandidate) {
      return extensionPhoneCandidate;
    }

    let extensionContactCandidate = null;
    try {
      const extension = await this.client.getCurrentExtensionInfo(connection, this.store);
      extensionContactCandidate = pickBestSmsPhone([
        {
          phoneNumber:
            extension?.contact?.phoneNumber ||
            extension?.contact?.businessPhone ||
            extension?.contact?.mobilePhone ||
            "",
          default: true,
          source: "extension_contact",
        },
      ]);
    } catch (error) {
      logStructured("info", "ringcentral_sms_extension_lookup_failed", {
        dealership_id: connection.dealership_id,
        crm_user_id: Number(connection.user_id),
        error: error.message,
      });
    }
    if (extensionContactCandidate) {
      return extensionContactCandidate;
    }

    const configuredFromNumber = normalizePhone(this.config.fromPhoneNumber);
    if (configuredFromNumber) {
      return {
        phoneNumber: configuredFromNumber,
        source: "configured_from_number",
      };
    }

    throw new Error(
      "RingCentral could not find an SMS-capable number for this rep. Add a direct text-enabled number to the rep's RingCentral extension before sending CRM SMS."
    );
  }

  hasRingOutScope(connection) {
    const scopes = String(connection?.scope || this.client.scopes || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((scope) => scope.toLowerCase());
    return scopes.includes("ringout");
  }

  async resolveRingOutDevice(connection) {
    let forwardingCandidate = null;
    try {
      const forwardingNumbers = await this.client.listForwardingNumbers(connection, this.store);
      forwardingCandidate = pickBestDevicePhone(
        Array.isArray(forwardingNumbers?.records)
          ? forwardingNumbers.records.map((record) => ({ ...record, source: "forwarding_number" }))
          : []
      );
    } catch (error) {
      logStructured("info", "ringcentral_ringout_forwarding_lookup_failed", {
        dealership_id: connection.dealership_id,
        crm_user_id: Number(connection.user_id),
        error: error.message,
      });
    }
    if (forwardingCandidate) {
      return forwardingCandidate;
    }

    let extensionPhoneCandidate = null;
    try {
      const extensionPhoneNumbers = await this.client.listExtensionPhoneNumbers(connection, this.store);
      extensionPhoneCandidate = pickBestDevicePhone(
        Array.isArray(extensionPhoneNumbers?.records)
          ? extensionPhoneNumbers.records.map((record) => ({ ...record, source: "extension_phone_number" }))
          : []
      );
    } catch (error) {
      logStructured("info", "ringcentral_ringout_phone_lookup_failed", {
        dealership_id: connection.dealership_id,
        crm_user_id: Number(connection.user_id),
        error: error.message,
      });
    }
    if (extensionPhoneCandidate) {
      return extensionPhoneCandidate;
    }

    let extensionContactCandidate = null;
    try {
      const extension = await this.client.getCurrentExtensionInfo(connection, this.store);
      extensionContactCandidate = pickBestDevicePhone([
        {
          phoneNumber:
            extension?.contact?.phoneNumber ||
            extension?.contact?.businessPhone ||
            extension?.contact?.mobilePhone ||
            "",
          default: true,
          source: "extension_contact",
        },
      ]);
    } catch (error) {
      logStructured("info", "ringcentral_ringout_extension_lookup_failed", {
        dealership_id: connection.dealership_id,
        crm_user_id: Number(connection.user_id),
        error: error.message,
      });
    }
    if (extensionContactCandidate) {
      return extensionContactCandidate;
    }

    throw new Error(
      "RingCentral could not find a device number for this rep. Add a forwarding or direct phone number to the rep's RingCentral extension before using CRM click-to-call."
    );
  }

  async initiateOutboundCall(phone, options = {}) {
    const targetPhone = normalizePhone(phone);
    const crmUserId = Number(options.crmUserId || 0);
    const dealershipId = Number(options.dealership_id || options.user?.dealership_id || 0);

    if (!targetPhone) {
      throw new Error("A valid phone number is required before calling from the CRM.");
    }

    if (!crmUserId) {
      throw new Error("A signed-in CRM rep is required before calling from the CRM.");
    }

    const connection = await this.getActiveConnectionForUser(crmUserId);
    if (!connection) {
      throw new Error("Connect RingCentral before calling from the CRM.");
    }

    if (dealershipId && Number(connection.dealership_id) !== dealershipId) {
      throw new Error("The RingCentral connection for this rep does not match the current dealership.");
    }

    if (options.lead_dealership_id && Number(connection.dealership_id) !== Number(options.lead_dealership_id)) {
      throw new Error("The RingCentral connection for this rep cannot access this lead.");
    }

    if (!this.hasRingOutScope(connection)) {
      throw new Error(
        "RingCentral click-to-call requires the RingOut scope. Add RingOut to the app scopes and reconnect this rep."
      );
    }

    const device = await this.resolveRingOutDevice(connection);
    const ringOut = await this.client.createRingOut(connection, this.store, {
      fromPhoneNumber: device.phoneNumber,
      toPhoneNumber: targetPhone,
      playPrompt: false,
    });

    logStructured("info", "ringcentral_outbound_call_initiated", {
      dealership_id: connection.dealership_id,
      crm_user_id: Number(connection.user_id),
      provider_extension_id: connection.ringcentral_extension_id,
      to_number: targetPhone,
      from_number: device.phoneNumber,
      ringout_id: ringOut?.id || null,
      ringout_status: ringOut?.status?.callStatus || null,
    });

    return {
      id: ringOut?.id || null,
      status: ringOut?.status?.callStatus || "InProgress",
      from_number: device.phoneNumber,
      to_number: targetPhone,
      initiated_at: ringOut?.creationTime || nowIso(),
      provider_extension_id: connection.ringcentral_extension_id || null,
      raw: ringOut || {},
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
    const providerExtensionId = extractExtensionIdFromMessagePayload(message, connection);
    const lead = externalNumber
      ? await this.db.findLeadByPhone(externalNumber, { dealership_id: connection.dealership_id })
      : null;

    if (!lead) {
      logStructured("info", "ringcentral_unmatched_sms_number", {
        external_number: externalNumber || null,
        provider_message_id: message.id || messageId || null,
      });

      if (direction === "inbound") {
        await this.store.upsertUnmatchedCommunication({
          dealership_id: connection.dealership_id,
          type: "sms",
          direction: "inbound",
          from_number: fromNumber || null,
          to_number: toNumber || null,
          normalized_from_number: normalizePhone(fromNumber) || null,
          normalized_to_number: normalizePhone(toNumber) || null,
          body_text: extractMessageBody(message),
          received_at: message.lastModifiedTime || payload.lastModifiedTime || message.creationTime || nowIso(),
          provider: "ringcentral",
          provider_message_id: String(message.id || messageId),
          crm_user_id: Number(connection.user_id),
          provider_extension_id: providerExtensionId,
          raw: message,
        });
      }

      return null;
    }

    const { created, record } = await this.store.upsertLeadMessage({
      dealership_id: connection.dealership_id,
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
      provider_extension_id: providerExtensionId,
      raw: message,
    });

    if (lead && created) {
      await this.db.createActivity({
        lead_id: Number(lead.id),
        type: "sms",
        content: record.body_text || "RingCentral SMS synced",
      });
      await this.store.enqueueJob({
        dealership_id: connection.dealership_id,
        job_type: "analyze_sms_thread",
        unique_key: `analyze_sms:${record.id}`,
        payload: { lead_id: Number(lead.id), source_id: record.id },
      });
    }
  }

  async syncAiExecutionArtifacts({ lead, recommendation, sourceType, sourceId }) {
    if (!lead) {
      return;
    }

    const settings = await this.db.getExecutionSettings();
    const assignedUserId = lead.assigned_to ? Number(lead.assigned_to) : null;
    const now = nowIso();

    if (recommendation.next_task) {
      await this.db.createOrRefreshTask({
        lead_id: Number(lead.id),
        user_id: assignedUserId,
        type: "ai_follow_up",
        title: recommendation.next_task,
        due_at: plusHours(now, settings.ai_task_due_hours),
        source: "ai",
        unique_key: `ai-follow-up:${sourceType}:${sourceId}`,
        metadata: {
          source_type: sourceType,
          source_id: sourceId,
          intent: recommendation.intent || "",
        },
      });
    }

    if (recommendation.appointment_intent) {
      await this.db.createOrRefreshTask({
        lead_id: Number(lead.id),
        user_id: assignedUserId,
        type: "appointment_follow_up",
        title: "Confirm appointment details",
        due_at: plusHours(now, settings.appointment_task_due_hours),
        source: "ai",
        unique_key: `appointment-follow-up:${sourceType}:${sourceId}`,
        metadata: {
          source_type: sourceType,
          source_id: sourceId,
        },
      });
    }

    if (assignedUserId && (recommendation.escalation_flag || Number(recommendation.hot_lead_score || 0) >= 80)) {
      await this.db.createNotification({
        user_id: assignedUserId,
        lead_id: Number(lead.id),
        type: "ai_flagged_interaction",
        title: "AI flagged important interaction",
        body: recommendation.summary || recommendation.reasoning_summary || "A lead needs immediate review.",
        unique_key: `ai-flag:${sourceType}:${sourceId}`,
        metadata: {
          source_type: sourceType,
          source_id: sourceId,
          hot_lead_score: Number(recommendation.hot_lead_score || 0),
        },
      });
    }
  }

  shouldSkipCallRecord(record, lead) {
    const durationSeconds = Number(record.duration || 0);
    const keywordText = buildCallKeywordText(record);
    const looksForwarded =
      this.config.skipForwardedCalls &&
      /\b(forward|forwarded|findme|find-me|followme|follow-me)\b/.test(keywordText);

    if (looksForwarded) {
      return {
        skip: true,
        reason: "forwarded_call",
      };
    }

    if (!lead && durationSeconds < this.config.minStoredCallSeconds) {
      return {
        skip: true,
        reason: "short_unmatched_call",
      };
    }

    return { skip: false, reason: null };
  }

  async resolveConnectionForEnvelope(envelope) {
    const candidates = extractExtensionCandidatesFromEnvelope(envelope);

    for (const candidate of candidates) {
      const connection = await this.store.getConnectionByExtensionId(candidate);
      if (connection) {
        return connection;
      }
    }

    const connections = await this.store.listActiveConnections();
    return connections.length === 1 ? connections[0] : null;
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
      const lead = externalNumber
        ? await this.db.findLeadByPhone(externalNumber, { dealership_id: connection.dealership_id })
        : null;
      const providerExtensionId = extractExtensionIdFromCallRecord(record, connection);
      const skipDecision = this.shouldSkipCallRecord(record, lead);

      if (skipDecision.skip) {
        if (!lead && direction === "inbound") {
          await this.store.upsertUnmatchedCommunication({
            dealership_id: connection.dealership_id,
            type: "call",
            direction: "inbound",
            from_number: fromNumber || null,
            to_number: toNumber || null,
            normalized_from_number: normalizePhone(fromNumber) || null,
            normalized_to_number: normalizePhone(toNumber) || null,
            call_duration: Number(record.duration || 0),
            received_at: record.startTime || eventTime,
            provider: "ringcentral",
            provider_call_id: String(record.id || ""),
            crm_user_id: Number(connection.user_id),
            provider_extension_id: providerExtensionId,
            raw: record,
          });
        }

        logStructured("info", "ringcentral_call_skipped", {
          reason: skipDecision.reason,
          external_number: externalNumber || null,
          provider_call_id: record.id || null,
          duration_seconds: Number(record.duration || 0),
          action: record.action || null,
          result: record.result || null,
        });
        continue;
      }

      if (!lead) {
        logStructured("info", "ringcentral_unmatched_call_number", {
          external_number: externalNumber || null,
          provider_call_id: record.id || null,
        });

        if (direction === "inbound") {
          await this.store.upsertUnmatchedCommunication({
            dealership_id: connection.dealership_id,
            type: "call",
            direction: "inbound",
            from_number: fromNumber || null,
            to_number: toNumber || null,
            normalized_from_number: normalizePhone(fromNumber) || null,
            normalized_to_number: normalizePhone(toNumber) || null,
            call_duration: Number(record.duration || 0),
            received_at: record.startTime || eventTime,
            provider: "ringcentral",
            provider_call_id: String(record.id || ""),
            crm_user_id: Number(connection.user_id),
            provider_extension_id: providerExtensionId,
            raw: record,
          });
        }

        continue;
      }

      const recording = Array.isArray(record.recording) ? record.recording[0] : record.recording;
      const { created, record: savedCall } = await this.store.upsertLeadCall({
        dealership_id: connection.dealership_id,
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
        provider_extension_id: providerExtensionId,
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
          dealership_id: connection.dealership_id,
          lead_call_id: savedCall.id,
          provider: "ringcentral",
          provider_recording_id: recording?.id || null,
          content_uri: recording?.contentUri || null,
          transcript_status: "pending",
          raw: recording || {},
        });
        await this.store.enqueueJob({
          dealership_id: connection.dealership_id,
          job_type: "fetch_call_recording",
          unique_key: `fetch_recording:${recordingEntry.record.id}`,
          payload: { connection_id: connection.id, recording_id: recordingEntry.record.id },
        });
      }

      if (lead && looksLikeMissedCall(record)) {
        const settings = await this.db.getExecutionSettings();
        await this.db.createOrRefreshTask({
          lead_id: Number(lead.id),
          user_id: lead.assigned_to ? Number(lead.assigned_to) : Number(connection.user_id),
          type: "missed_call_callback",
          title: "Return missed call",
          due_at: plusMinutes(nowIso(), settings.missed_call_task_due_minutes),
          source: "system",
          unique_key: `missed-call:${savedCall.id}`,
          metadata: {
            provider_call_id: savedCall.provider_call_id,
            external_number: savedCall.external_number,
          },
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
      dealership_id: recordingRecord.dealership_id,
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
    const leadCall = await this.db.get("SELECT * FROM lead_calls WHERE id = ? AND dealership_id = ?", [
      recordingRecord.lead_call_id,
      recordingRecord.dealership_id,
    ]);
    if (!leadCall || !leadCall.lead_id) {
      await this.store.upsertCallRecording({
        dealership_id: recordingRecord.dealership_id,
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
      dealership_id: lead.dealership_id,
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

    await this.syncAiExecutionArtifacts({
      lead,
      recommendation,
      sourceType: "call",
      sourceId: leadCall.id,
    });

    await this.store.upsertCallRecording({
      dealership_id: recordingRecord.dealership_id,
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
      dealership_id: lead.dealership_id,
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
    await this.syncAiExecutionArtifacts({
      lead,
      recommendation,
      sourceType: "sms",
      sourceId,
    });
    return { recommendation, audit };
  }

  async processWebhookEnvelope(envelope) {
    const eventType = parseEventType(envelope.event);
    const eventKey = extractEventKey(envelope);
    const connection = await this.resolveConnectionForEnvelope(envelope);
    const stored = await this.store.createWebhookEventIfNew({
      dealership_id: connection?.dealership_id,
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
      if (eventType === "sms" && connection) {
        await this.processSmsPayload(connection, envelope.body);
      } else if (eventType === "telephony_session" && connection) {
        await this.store.enqueueJob({
          dealership_id: connection.dealership_id,
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
          const connection = await this.store.getConnectionById(payload.connection_id, job.dealership_id);
          const synced = connection ? await this.reconcileCallSession(connection, payload) : [];
          results.push({ job: job.id, type: job.job_type, synced: synced.length });
        } else if (job.job_type === "fetch_call_recording") {
          const connection = await this.store.getConnectionById(payload.connection_id, job.dealership_id);
          const recording = await this.db.get("SELECT * FROM call_recordings WHERE id = ? AND dealership_id = ?", [
            payload.recording_id,
            job.dealership_id,
          ]);
          if (!connection || !recording) {
            throw new Error("Recording fetch job is missing its connection or recording record.");
          }
          const saved = await this.fetchRecording(connection, recording);
          await this.store.enqueueJob({
            dealership_id: saved.record.dealership_id,
            job_type: "analyze_call_recording",
            unique_key: `analyze_call_recording:${saved.record.id}`,
            payload: { recording_id: saved.record.id },
          });
          results.push({ job: job.id, type: job.job_type, recording_id: saved.record.id });
        } else if (job.job_type === "analyze_call_recording") {
          const recording = await this.db.get("SELECT * FROM call_recordings WHERE id = ? AND dealership_id = ?", [
            payload.recording_id,
            job.dealership_id,
          ]);
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
            dealership_id: connection.dealership_id,
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
