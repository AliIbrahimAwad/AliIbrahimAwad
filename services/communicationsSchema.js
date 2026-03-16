const COMMUNICATION_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS ringcentral_connections (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      ringcentral_account_id TEXT,
      ringcentral_extension_id TEXT,
      server_url TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT,
      scope TEXT,
      expires_at TEXT,
      refresh_expires_at TEXT,
      webhook_address TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ringcentral_connections_user_id
    ON ringcentral_connections(user_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS ringcentral_subscriptions (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      event_filters TEXT NOT NULL,
      delivery_mode TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ringcentral_subscriptions_subscription_id
    ON ringcentral_subscriptions(subscription_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS ringcentral_webhook_events (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL,
      subscription_id TEXT,
      event_type TEXT,
      owner_id TEXT,
      payload_json TEXT NOT NULL,
      process_status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ringcentral_webhook_events_event_key
    ON ringcentral_webhook_events(event_key)
  `,
  `
    CREATE TABLE IF NOT EXISTS lead_messages (
      id TEXT PRIMARY KEY,
      lead_id BIGINT,
      provider TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      thread_id TEXT,
      direction TEXT NOT NULL,
      from_number TEXT,
      to_number TEXT,
      external_number TEXT,
      subject TEXT,
      body_text TEXT,
      message_status TEXT,
      sent_at TEXT,
      received_at TEXT,
      crm_user_id BIGINT,
      provider_extension_id TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_messages_provider_message_id
    ON lead_messages(provider, provider_message_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_lead_messages_lead_id_created_at
    ON lead_messages(lead_id, created_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS lead_calls (
      id TEXT PRIMARY KEY,
      lead_id BIGINT,
      provider TEXT NOT NULL,
      provider_call_id TEXT NOT NULL,
      session_id TEXT,
      telephony_session_id TEXT,
      direction TEXT,
      from_number TEXT,
      to_number TEXT,
      external_number TEXT,
      result TEXT,
      action TEXT,
      duration_seconds INTEGER,
      start_time TEXT,
      end_time TEXT,
      crm_user_id BIGINT,
      provider_extension_id TEXT,
      recording_id TEXT,
      recording_status TEXT,
      transcript_status TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_calls_provider_call_id
    ON lead_calls(provider, provider_call_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_lead_calls_session_id
    ON lead_calls(session_id, telephony_session_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS call_recordings (
      id TEXT PRIMARY KEY,
      lead_call_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_recording_id TEXT,
      content_uri TEXT,
      local_path TEXT,
      mime_type TEXT,
      fetched_at TEXT,
      transcript_status TEXT NOT NULL,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_call_recordings_provider_recording_id
    ON call_recordings(provider, provider_recording_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS communication_ai_analyses (
      id TEXT PRIMARY KEY,
      lead_id BIGINT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      transcript_text TEXT,
      summary TEXT,
      intent TEXT,
      objections TEXT,
      appointment_intent INTEGER NOT NULL DEFAULT 0,
      trade_in_mention INTEGER NOT NULL DEFAULT 0,
      financing_mention INTEGER NOT NULL DEFAULT 0,
      hot_lead_score INTEGER,
      suggested_status TEXT,
      confidence REAL,
      reasoning_summary TEXT,
      next_task TEXT,
      escalation_flag INTEGER NOT NULL DEFAULT 0,
      auto_status_applied INTEGER NOT NULL DEFAULT 0,
      recommendation_only INTEGER NOT NULL DEFAULT 0,
      previous_status TEXT,
      new_status TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_communication_ai_analyses_lead_id_created_at
    ON communication_ai_analyses(lead_id, created_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS lead_status_audits (
      id TEXT PRIMARY KEY,
      lead_id BIGINT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      confidence REAL,
      reasoning_summary TEXT,
      source TEXT NOT NULL,
      auto_applied INTEGER NOT NULL DEFAULT 0,
      recommendation_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_lead_status_audits_lead_id_created_at
    ON lead_status_audits(lead_id, created_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      unique_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      run_after TEXT,
      locked_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_jobs_unique_key
    ON processing_jobs(unique_key)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_run_after
    ON processing_jobs(status, run_after, created_at)
  `,
];

async function ensureCommunicationsSchema(db) {
  for (const statement of COMMUNICATION_SCHEMA_STATEMENTS) {
    await db.execute(statement);
  }
}

module.exports = {
  ensureCommunicationsSchema,
};
