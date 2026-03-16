# CRM

## RingCentral Ingestion Setup

This CRM now supports a webhook-first RingCentral ingestion pipeline for:

- SMS event ingestion
- telephony session webhook triggers
- call-log reconciliation
- recording retrieval
- transcription
- AI communication analysis
- automatic lead status updates with audit trail

### Required RingCentral scopes

The integration expects these scopes:

- `ReadAccounts`
- `ReadCallLog`
- `ReadMessages`
- `SMS`
- `RingOut`
- `WebhookSubscriptions`

### Environment

Copy `.env.example` to `.env` and fill in the RingCentral and OpenAI values you plan to use.

Important flags:

- `RINGCENTRAL_AUTO_STATUS_UPDATES=true|false`
- `RINGCENTRAL_AI_CONFIDENCE_THRESHOLD=0.78`
- `DEFAULT_DEALERSHIP_ID=1`

### Dealership ID foundation

The CRM now stamps new rows with a dealership ID. For now, keep:

- `DEFAULT_DEALERSHIP_ID=1`

This gives Looloo Auto Sales dealership ID `1` across the core CRM and communications tables while keeping the current single-dealership behavior unchanged.

If auto-updates are disabled or confidence is below threshold, the CRM stores only an AI recommendation and audit row without changing the lead status.

### OAuth flow

1. Create a RingCentral app.
2. Set the OAuth redirect URI to:
   - `/api/ringcentral/oauth/callback`
3. Set the webhook delivery URL to:
   - `/api/ringcentral/webhooks`
4. In the CRM, hit:
   - `GET /api/ringcentral/connect`
5. Open the returned URL in a browser while logged into the CRM.

### Webhook-first architecture

- RingCentral webhooks are the real-time trigger.
- SMS webhooks are processed immediately.
- Telephony session webhooks enqueue reconciliation jobs.
- Call logs remain the authoritative completed-call record.
- `session_id` / `telephony_session_id` are used to reconcile related call records.

### Background jobs

Run queued recording/transcription/AI jobs:

```bash
npm run process:ringcentral
```

Run reconciliation for recent call logs:

```bash
npm run reconcile:ringcentral
```

In production, schedule both with cron or a worker process.

### AI lead status behavior

- SMS and call content are analyzed when enough context exists.
- AI stores:
  - transcript
  - summary
  - intent
  - objections
  - appointment intent
  - trade-in mention
  - financing mention
  - hot lead score
  - suggested status
  - confidence
  - reasoning summary
  - next task
  - escalation flag
- Automatic status updates write:
  - the lead status itself
  - a lead activity entry
  - a `lead_status_audits` audit row

Current dealership CRM mapping:

- `new_lead -> new`
- `contacted -> contacted`
- `no_answer -> contacted`
- `engaged -> contacted`
- `appointment_set -> appointment`
- `follow_up_needed -> contacted`
- `negotiating -> negotiation`
- `sold -> won`
- `lost -> lost`
- `do_not_contact -> lost`
