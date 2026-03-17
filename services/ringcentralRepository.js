const crypto = require("crypto");

const { getDefaultDealershipId } = require("../src/config/dealership");

function nowIso() {
  return new Date().toISOString();
}

function uniqueId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function encodeJson(value) {
  return JSON.stringify(value ?? {});
}

function boolFlag(value) {
  return value ? 1 : 0;
}

function plusMinutes(dateString, minutes) {
  const next = new Date(dateString || Date.now());
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}

function createRingCentralRepository(db) {
  function dealershipId(input = {}) {
    return Number(input.dealership_id || getDefaultDealershipId());
  }

  async function getConnectionByUserId(userId) {
    return db.get("SELECT * FROM ringcentral_connections WHERE user_id = ?", [userId]);
  }

  async function getConnectionById(id) {
    return db.get("SELECT * FROM ringcentral_connections WHERE id = ?", [id]);
  }

  async function getConnectionByExtensionId(extensionId) {
    if (!extensionId) {
      return null;
    }

    return db.get(
      "SELECT * FROM ringcentral_connections WHERE ringcentral_extension_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
      [String(extensionId)]
    );
  }

  async function upsertConnection(input) {
    const existing = await getConnectionByUserId(input.user_id);
    const timestamp = nowIso();
    const record = {
      id: existing?.id || uniqueId("rcconn"),
      dealership_id: existing?.dealership_id || dealershipId(input),
      user_id: Number(input.user_id),
      ringcentral_account_id: input.ringcentral_account_id || null,
      ringcentral_extension_id: input.ringcentral_extension_id || null,
      server_url: input.server_url,
      access_token: input.access_token,
      refresh_token: input.refresh_token || null,
      token_type: input.token_type || "Bearer",
      scope: input.scope || "",
      expires_at: input.expires_at || null,
      refresh_expires_at: input.refresh_expires_at || null,
      webhook_address: input.webhook_address || null,
      status: input.status || "active",
      created_at: existing?.created_at || timestamp,
      updated_at: timestamp,
    };

    if (existing) {
      await db.execute(
        `
          UPDATE ringcentral_connections
          SET
            ringcentral_account_id = ?,
            ringcentral_extension_id = ?,
            server_url = ?,
            access_token = ?,
            refresh_token = ?,
            token_type = ?,
            scope = ?,
            expires_at = ?,
            refresh_expires_at = ?,
            webhook_address = ?,
            status = ?,
            updated_at = ?
          WHERE id = ?
        `,
        [
          record.ringcentral_account_id,
          record.ringcentral_extension_id,
          record.server_url,
          record.access_token,
          record.refresh_token,
          record.token_type,
          record.scope,
          record.expires_at,
          record.refresh_expires_at,
          record.webhook_address,
          record.status,
          record.updated_at,
          record.id,
        ]
      );
      return getConnectionById(record.id);
    }

    await db.execute(
      `
        INSERT INTO ringcentral_connections (
          id, dealership_id, user_id, ringcentral_account_id, ringcentral_extension_id, server_url,
          access_token, refresh_token, token_type, scope, expires_at, refresh_expires_at,
          webhook_address, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.user_id,
        record.ringcentral_account_id,
        record.ringcentral_extension_id,
        record.server_url,
        record.access_token,
        record.refresh_token,
        record.token_type,
        record.scope,
        record.expires_at,
        record.refresh_expires_at,
        record.webhook_address,
        record.status,
        record.created_at,
        record.updated_at,
      ]
    );
    return getConnectionById(record.id);
  }

  async function deactivateConnection(userId) {
    const connection = await getConnectionByUserId(userId);
    if (!connection) {
      return;
    }

    await db.execute(
      "UPDATE ringcentral_connections SET status = ?, updated_at = ? WHERE id = ?",
      ["disconnected", nowIso(), connection.id]
    );
  }

  async function listActiveConnections() {
    return db.all("SELECT * FROM ringcentral_connections WHERE status = 'active' ORDER BY updated_at DESC");
  }

  async function saveSubscription(input) {
    const existing = await db.get("SELECT * FROM ringcentral_subscriptions WHERE connection_id = ?", [
      input.connection_id,
    ]);
    const timestamp = nowIso();
    const record = {
      id: existing?.id || uniqueId("rcsub"),
      dealership_id: existing?.dealership_id || dealershipId(input),
      connection_id: input.connection_id,
      subscription_id: input.subscription_id,
      event_filters: encodeJson(input.event_filters || []),
      delivery_mode: input.delivery_mode || "WebHook",
      expires_at: input.expires_at || null,
      status: input.status || "active",
      created_at: existing?.created_at || timestamp,
      updated_at: timestamp,
    };

    if (existing) {
      await db.execute(
        `
          UPDATE ringcentral_subscriptions
          SET subscription_id = ?, event_filters = ?, delivery_mode = ?, expires_at = ?, status = ?, updated_at = ?
          WHERE id = ?
        `,
        [
          record.subscription_id,
          record.event_filters,
          record.delivery_mode,
          record.expires_at,
          record.status,
          record.updated_at,
          record.id,
        ]
      );
      return db.get("SELECT * FROM ringcentral_subscriptions WHERE id = ?", [record.id]);
    }

    await db.execute(
      `
        INSERT INTO ringcentral_subscriptions (
          id, dealership_id, connection_id, subscription_id, event_filters, delivery_mode, expires_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.connection_id,
        record.subscription_id,
        record.event_filters,
        record.delivery_mode,
        record.expires_at,
        record.status,
        record.created_at,
        record.updated_at,
      ]
    );
    return db.get("SELECT * FROM ringcentral_subscriptions WHERE id = ?", [record.id]);
  }

  async function getSubscriptionByConnectionId(connectionId) {
    return db.get("SELECT * FROM ringcentral_subscriptions WHERE connection_id = ?", [connectionId]);
  }

  async function createWebhookEventIfNew(input) {
    const existing = await db.get("SELECT * FROM ringcentral_webhook_events WHERE event_key = ?", [input.event_key]);
    if (existing) {
      return { created: false, event: existing };
    }

    const record = {
      id: uniqueId("rcevt"),
      dealership_id: dealershipId(input),
      event_key: input.event_key,
      subscription_id: input.subscription_id || null,
      event_type: input.event_type || null,
      owner_id: input.owner_id || null,
      payload_json: encodeJson(input.payload || {}),
      process_status: input.process_status || "received",
      retry_count: 0,
      error_message: null,
      created_at: nowIso(),
      processed_at: null,
      updated_at: nowIso(),
    };

    await db.execute(
      `
        INSERT INTO ringcentral_webhook_events (
          id, dealership_id, event_key, subscription_id, event_type, owner_id, payload_json,
          process_status, retry_count, error_message, created_at, processed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.event_key,
        record.subscription_id,
        record.event_type,
        record.owner_id,
        record.payload_json,
        record.process_status,
        record.retry_count,
        record.error_message,
        record.created_at,
        record.processed_at,
        record.updated_at,
      ]
    );
    return { created: true, event: await db.get("SELECT * FROM ringcentral_webhook_events WHERE id = ?", [record.id]) };
  }

  async function markWebhookEventProcessed(id) {
    await db.execute(
      "UPDATE ringcentral_webhook_events SET process_status = ?, processed_at = ?, updated_at = ?, error_message = NULL WHERE id = ?",
      ["processed", nowIso(), nowIso(), id]
    );
  }

  async function markWebhookEventFailed(id, error) {
    await db.execute(
      `
        UPDATE ringcentral_webhook_events
        SET process_status = ?, retry_count = retry_count + 1, error_message = ?, updated_at = ?
        WHERE id = ?
      `,
      ["failed", error.message || String(error), nowIso(), id]
    );
  }

  async function enqueueJob(input) {
    const existing = await db.get("SELECT * FROM processing_jobs WHERE unique_key = ?", [input.unique_key]);
    if (existing && existing.status !== "failed") {
      return existing;
    }

    const record = {
      id: existing?.id || uniqueId("job"),
      dealership_id: existing?.dealership_id || dealershipId(input),
      job_type: input.job_type,
      unique_key: input.unique_key,
      payload_json: encodeJson(input.payload || {}),
      status: "pending",
      attempts: existing ? Number(existing.attempts || 0) : 0,
      last_error: null,
      run_after: input.run_after || nowIso(),
      locked_at: null,
      completed_at: null,
      created_at: existing?.created_at || nowIso(),
      updated_at: nowIso(),
    };

    if (existing) {
      await db.execute(
        `
          UPDATE processing_jobs
          SET job_type = ?, payload_json = ?, status = ?, run_after = ?, locked_at = NULL,
              completed_at = NULL, last_error = NULL, updated_at = ?
          WHERE id = ?
        `,
        [record.job_type, record.payload_json, record.status, record.run_after, record.updated_at, record.id]
      );
      return db.get("SELECT * FROM processing_jobs WHERE id = ?", [record.id]);
    }

    await db.execute(
      `
        INSERT INTO processing_jobs (
          id, dealership_id, job_type, unique_key, payload_json, status, attempts, last_error,
          run_after, locked_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.job_type,
        record.unique_key,
        record.payload_json,
        record.status,
        record.attempts,
        record.last_error,
        record.run_after,
        record.locked_at,
        record.completed_at,
        record.created_at,
        record.updated_at,
      ]
    );
    return db.get("SELECT * FROM processing_jobs WHERE id = ?", [record.id]);
  }

  async function claimPendingJobs(limit = 10) {
    const rows = await db.all(
      `
        SELECT *
        FROM processing_jobs
        WHERE status IN ('pending', 'failed')
          AND (run_after IS NULL OR run_after <= ?)
          AND (locked_at IS NULL OR locked_at = '')
        ORDER BY created_at ASC
        LIMIT ?
      `,
      [nowIso(), limit]
    );

    const claimed = [];
    for (const row of rows) {
      await db.execute(
        "UPDATE processing_jobs SET status = ?, locked_at = ?, attempts = ?, updated_at = ? WHERE id = ?",
        ["processing", nowIso(), Number(row.attempts || 0) + 1, nowIso(), row.id]
      );
      claimed.push(await db.get("SELECT * FROM processing_jobs WHERE id = ?", [row.id]));
    }

    return claimed;
  }

  async function completeJob(id) {
    await db.execute(
      "UPDATE processing_jobs SET status = ?, completed_at = ?, locked_at = NULL, updated_at = ? WHERE id = ?",
      ["completed", nowIso(), nowIso(), id]
    );
  }

  async function failJob(id, error, attempts) {
    const retryMinutes = Math.min(30, Math.max(1, Number(attempts || 1) * 2));
    await db.execute(
      `
        UPDATE processing_jobs
        SET status = ?, last_error = ?, locked_at = NULL, run_after = ?, updated_at = ?
        WHERE id = ?
      `,
      ["failed", error.message || String(error), plusMinutes(nowIso(), retryMinutes), nowIso(), id]
    );
  }

  async function summarizeJobs() {
    return db.all(
      `
        SELECT job_type, status, COUNT(*) AS count, MAX(updated_at) AS last_updated_at
        FROM processing_jobs
        GROUP BY job_type, status
        ORDER BY job_type ASC, status ASC
      `
    );
  }

  async function getLeadMessageByProviderId(provider, providerMessageId) {
    return db.get("SELECT * FROM lead_messages WHERE provider = ? AND provider_message_id = ?", [
      provider,
      providerMessageId,
    ]);
  }

  async function upsertLeadMessage(input) {
    const existing = await getLeadMessageByProviderId(input.provider, input.provider_message_id);
    const record = {
      id: existing?.id || uniqueId("msg"),
      dealership_id: existing?.dealership_id || dealershipId(input),
      lead_id: input.lead_id ?? null,
      provider: input.provider,
      provider_message_id: input.provider_message_id,
      thread_id: input.thread_id || null,
      direction: input.direction || "unknown",
      from_number: input.from_number || null,
      to_number: input.to_number || null,
      external_number: input.external_number || null,
      subject: input.subject || null,
      body_text: input.body_text || null,
      message_status: input.message_status || null,
      sent_at: input.sent_at || null,
      received_at: input.received_at || null,
      crm_user_id: input.crm_user_id ?? null,
      provider_extension_id: input.provider_extension_id || null,
      raw_json: encodeJson(input.raw || {}),
      created_at: existing?.created_at || nowIso(),
      updated_at: nowIso(),
    };

    if (existing) {
      await db.execute(
        `
          UPDATE lead_messages
          SET lead_id = ?, thread_id = ?, direction = ?, from_number = ?, to_number = ?, external_number = ?,
              subject = ?, body_text = ?, message_status = ?, sent_at = ?, received_at = ?, crm_user_id = ?,
              provider_extension_id = ?, raw_json = ?, updated_at = ?
          WHERE id = ?
        `,
        [
          record.lead_id,
          record.thread_id,
          record.direction,
          record.from_number,
          record.to_number,
          record.external_number,
          record.subject,
          record.body_text,
          record.message_status,
          record.sent_at,
          record.received_at,
          record.crm_user_id,
          record.provider_extension_id,
          record.raw_json,
          record.updated_at,
          record.id,
        ]
      );
      return { created: false, record: await db.get("SELECT * FROM lead_messages WHERE id = ?", [record.id]) };
    }

    await db.execute(
      `
        INSERT INTO lead_messages (
          id, dealership_id, lead_id, provider, provider_message_id, thread_id, direction, from_number, to_number,
          external_number, subject, body_text, message_status, sent_at, received_at, crm_user_id,
          provider_extension_id, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.lead_id,
        record.provider,
        record.provider_message_id,
        record.thread_id,
        record.direction,
        record.from_number,
        record.to_number,
        record.external_number,
        record.subject,
        record.body_text,
        record.message_status,
        record.sent_at,
        record.received_at,
        record.crm_user_id,
        record.provider_extension_id,
        record.raw_json,
        record.created_at,
        record.updated_at,
      ]
    );
    return { created: true, record: await db.get("SELECT * FROM lead_messages WHERE id = ?", [record.id]) };
  }

  async function listLeadMessages(leadId, limit = 20) {
    return db.all(
      `
        SELECT *
        FROM lead_messages
        WHERE lead_id = ?
        ORDER BY COALESCE(received_at, sent_at, created_at) DESC
        LIMIT ?
      `,
      [leadId, limit]
    );
  }

  async function getLeadCallByProviderId(provider, providerCallId) {
    return db.get("SELECT * FROM lead_calls WHERE provider = ? AND provider_call_id = ?", [provider, providerCallId]);
  }

  async function upsertLeadCall(input) {
    const existing = await getLeadCallByProviderId(input.provider, input.provider_call_id);
    const record = {
      id: existing?.id || uniqueId("call"),
      dealership_id: existing?.dealership_id || dealershipId(input),
      lead_id: input.lead_id ?? null,
      provider: input.provider,
      provider_call_id: input.provider_call_id,
      session_id: input.session_id || null,
      telephony_session_id: input.telephony_session_id || null,
      direction: input.direction || null,
      from_number: input.from_number || null,
      to_number: input.to_number || null,
      external_number: input.external_number || null,
      result: input.result || null,
      action: input.action || null,
      duration_seconds: Number(input.duration_seconds || 0),
      start_time: input.start_time || null,
      end_time: input.end_time || null,
      crm_user_id: input.crm_user_id ?? null,
      provider_extension_id: input.provider_extension_id || null,
      recording_id: input.recording_id || null,
      recording_status: input.recording_status || null,
      transcript_status: input.transcript_status || null,
      raw_json: encodeJson(input.raw || {}),
      created_at: existing?.created_at || nowIso(),
      updated_at: nowIso(),
    };

    if (existing) {
      await db.execute(
        `
          UPDATE lead_calls
          SET lead_id = ?, session_id = ?, telephony_session_id = ?, direction = ?, from_number = ?, to_number = ?,
              external_number = ?, result = ?, action = ?, duration_seconds = ?, start_time = ?, end_time = ?,
              crm_user_id = ?, provider_extension_id = ?, recording_id = ?, recording_status = ?, transcript_status = ?,
              raw_json = ?, updated_at = ?
          WHERE id = ?
        `,
        [
          record.lead_id,
          record.session_id,
          record.telephony_session_id,
          record.direction,
          record.from_number,
          record.to_number,
          record.external_number,
          record.result,
          record.action,
          record.duration_seconds,
          record.start_time,
          record.end_time,
          record.crm_user_id,
          record.provider_extension_id,
          record.recording_id,
          record.recording_status,
          record.transcript_status,
          record.raw_json,
          record.updated_at,
          record.id,
        ]
      );
      return { created: false, record: await db.get("SELECT * FROM lead_calls WHERE id = ?", [record.id]) };
    }

    await db.execute(
      `
        INSERT INTO lead_calls (
          id, dealership_id, lead_id, provider, provider_call_id, session_id, telephony_session_id, direction, from_number,
          to_number, external_number, result, action, duration_seconds, start_time, end_time, crm_user_id,
          provider_extension_id, recording_id, recording_status, transcript_status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.lead_id,
        record.provider,
        record.provider_call_id,
        record.session_id,
        record.telephony_session_id,
        record.direction,
        record.from_number,
        record.to_number,
        record.external_number,
        record.result,
        record.action,
        record.duration_seconds,
        record.start_time,
        record.end_time,
        record.crm_user_id,
        record.provider_extension_id,
        record.recording_id,
        record.recording_status,
        record.transcript_status,
        record.raw_json,
        record.created_at,
        record.updated_at,
      ]
    );
    return { created: true, record: await db.get("SELECT * FROM lead_calls WHERE id = ?", [record.id]) };
  }

  async function getCallRecordingByProviderId(provider, providerRecordingId) {
    return db.get("SELECT * FROM call_recordings WHERE provider = ? AND provider_recording_id = ?", [
      provider,
      providerRecordingId,
    ]);
  }

  async function upsertCallRecording(input) {
    const existing = input.provider_recording_id
      ? await getCallRecordingByProviderId(input.provider, input.provider_recording_id)
      : await db.get("SELECT * FROM call_recordings WHERE lead_call_id = ?", [input.lead_call_id]);
    const record = {
      id: existing?.id || uniqueId("recording"),
      dealership_id: existing?.dealership_id || dealershipId(input),
      lead_call_id: input.lead_call_id,
      provider: input.provider,
      provider_recording_id: input.provider_recording_id || null,
      content_uri: input.content_uri || null,
      local_path: input.local_path || null,
      mime_type: input.mime_type || null,
      fetched_at: input.fetched_at || null,
      transcript_status: input.transcript_status || "pending",
      raw_json: encodeJson(input.raw || {}),
      created_at: existing?.created_at || nowIso(),
      updated_at: nowIso(),
    };

    if (existing) {
      await db.execute(
        `
          UPDATE call_recordings
          SET content_uri = ?, local_path = ?, mime_type = ?, fetched_at = ?, transcript_status = ?, raw_json = ?, updated_at = ?
          WHERE id = ?
        `,
        [
          record.content_uri,
          record.local_path,
          record.mime_type,
          record.fetched_at,
          record.transcript_status,
          record.raw_json,
          record.updated_at,
          record.id,
        ]
      );
      return { created: false, record: await db.get("SELECT * FROM call_recordings WHERE id = ?", [record.id]) };
    }

    await db.execute(
      `
        INSERT INTO call_recordings (
          id, dealership_id, lead_call_id, provider, provider_recording_id, content_uri, local_path,
          mime_type, fetched_at, transcript_status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.lead_call_id,
        record.provider,
        record.provider_recording_id,
        record.content_uri,
        record.local_path,
        record.mime_type,
        record.fetched_at,
        record.transcript_status,
        record.raw_json,
        record.created_at,
        record.updated_at,
      ]
    );
    return { created: true, record: await db.get("SELECT * FROM call_recordings WHERE id = ?", [record.id]) };
  }

  async function createCommunicationAnalysis(input) {
    const record = {
      id: uniqueId("analysis"),
      dealership_id: dealershipId(input),
      lead_id: Number(input.lead_id),
      source_type: input.source_type,
      source_id: input.source_id,
      provider: input.provider || "ringcentral",
      transcript_text: input.transcript_text || null,
      summary: input.summary || null,
      intent: input.intent || null,
      objections: input.objections || null,
      appointment_intent: boolFlag(input.appointment_intent),
      trade_in_mention: boolFlag(input.trade_in_mention),
      financing_mention: boolFlag(input.financing_mention),
      hot_lead_score: Number(input.hot_lead_score || 0),
      suggested_status: input.suggested_status || null,
      confidence: Number(input.confidence || 0),
      reasoning_summary: input.reasoning_summary || null,
      next_task: input.next_task || null,
      escalation_flag: boolFlag(input.escalation_flag),
      auto_status_applied: boolFlag(input.auto_status_applied),
      recommendation_only: boolFlag(input.recommendation_only),
      previous_status: input.previous_status || null,
      new_status: input.new_status || null,
      raw_json: encodeJson(input.raw || {}),
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await db.execute(
      `
        INSERT INTO communication_ai_analyses (
          id, dealership_id, lead_id, source_type, source_id, provider, transcript_text, summary, intent, objections,
          appointment_intent, trade_in_mention, financing_mention, hot_lead_score, suggested_status,
          confidence, reasoning_summary, next_task, escalation_flag, auto_status_applied,
          recommendation_only, previous_status, new_status, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.lead_id,
        record.source_type,
        record.source_id,
        record.provider,
        record.transcript_text,
        record.summary,
        record.intent,
        record.objections,
        record.appointment_intent,
        record.trade_in_mention,
        record.financing_mention,
        record.hot_lead_score,
        record.suggested_status,
        record.confidence,
        record.reasoning_summary,
        record.next_task,
        record.escalation_flag,
        record.auto_status_applied,
        record.recommendation_only,
        record.previous_status,
        record.new_status,
        record.raw_json,
        record.created_at,
        record.updated_at,
      ]
    );
    return record;
  }

  async function createLeadStatusAudit(input) {
    const record = {
      id: uniqueId("statusaudit"),
      dealership_id: dealershipId(input),
      lead_id: Number(input.lead_id),
      user_id: input.user_id == null ? null : Number(input.user_id),
      previous_status: input.previous_status || null,
      new_status: input.new_status || null,
      confidence: Number(input.confidence || 0),
      reasoning_summary: input.reasoning_summary || null,
      source: input.source,
      auto_applied: boolFlag(input.auto_applied),
      recommendation_only: boolFlag(input.recommendation_only),
      created_at: nowIso(),
    };

    await db.execute(
      `
        INSERT INTO lead_status_audits (
          id, dealership_id, lead_id, user_id, previous_status, new_status, confidence, reasoning_summary,
          source, auto_applied, recommendation_only, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.dealership_id,
        record.lead_id,
        record.user_id,
        record.previous_status,
        record.new_status,
        record.confidence,
        record.reasoning_summary,
        record.source,
        record.auto_applied,
        record.recommendation_only,
        record.created_at,
      ]
    );
    return record;
  }

  return {
    claimPendingJobs,
    completeJob,
    createCommunicationAnalysis,
    createLeadStatusAudit,
    createWebhookEventIfNew,
    deactivateConnection,
    enqueueJob,
    failJob,
    getCallRecordingByProviderId,
    getConnectionById,
    getConnectionByExtensionId,
    getConnectionByUserId,
    getLeadCallByProviderId,
    getLeadMessageByProviderId,
    getSubscriptionByConnectionId,
    listActiveConnections,
    listLeadMessages,
    markWebhookEventFailed,
    markWebhookEventProcessed,
    saveSubscription,
    summarizeJobs,
    upsertCallRecording,
    upsertConnection,
    upsertLeadCall,
    upsertLeadMessage,
  };
}

module.exports = {
  createRingCentralRepository,
};
