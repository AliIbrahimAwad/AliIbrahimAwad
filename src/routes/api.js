const { canAssignLeads, canManageUsers } = require("../models/user");
const { requireAuth } = require("../middleware/auth");
const { ValidationError } = require("../data/database");
const { normalizePhone } = require("../utils/phones");
const { toDateOnlyString } = require("../utils/dates");
const { asyncHandler } = require("./helpers");

function toPagination(query = {}) {
  return {
    limit: Math.max(1, Math.min(200, Number(query.limit) || 100)),
    offset: Math.max(0, Number(query.offset) || 0),
    search: String(query.search || "").trim(),
    status: String(query.status || "").trim().toLowerCase(),
  };
}

function normalizeLeadPayload(body = {}) {
  const customerName = String(body.customer_name || body.customerName || body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const vehicleInterest = String(body.vehicle_interest || body.vehicleInterest || body.vehicle || "").trim();
  const source = String(body.source || "website").trim().toLowerCase();

  if (!customerName && !email && !phone) {
    throw new ValidationError("At least one contact field is required.");
  }

  return {
    source,
    customer_name: customerName || null,
    phone: phone || null,
    email: email || null,
    vehicle_interest: vehicleInterest || null,
    vehicle_id: body.vehicle_id || body.vehicleId || null,
    stock_number: body.stock_number || body.stockNumber || null,
    vehicle_year: body.vehicle_year || body.vehicleYear || null,
    vehicle_make: body.vehicle_make || body.vehicleMake || null,
    vehicle_model: body.vehicle_model || body.vehicleModel || null,
    vehicle_trim: body.vehicle_trim || body.vehicleTrim || null,
    vehicle_condition: body.vehicle_condition || body.vehicleCondition || null,
    vehicle_price: body.vehicle_price || body.vehiclePrice || null,
    lead_type: body.lead_type || body.leadType || null,
    listing_url: body.listing_url || body.listingUrl || null,
    message: String(body.message || "").trim() || null,
    status: String(body.status || "new").trim().toLowerCase(),
  };
}

function registerApiRoutes(app) {
  app.get(
    "/api/leads",
    requireAuth,
    asyncHandler(async (req, res) => {
      const page = await req.app.locals.db.listApiLeads(toPagination(req.query), req.currentUser);
      res.json({
        items: page.items,
        pagination: {
          total: page.total,
          limit: page.limit,
          offset: page.offset,
          has_more: page.offset + page.limit < page.total,
        },
      });
    })
  );

  app.get(
    "/api/leads/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await req.app.locals.db.getApiLeadWithActivities(Number(req.params.id), req.currentUser);
      res.json(payload);
    })
  );

  app.post(
    "/api/leads",
    asyncHandler(async (req, res) => {
      const payload = normalizeLeadPayload(req.body);
      const lead = await req.app.locals.db.createApiLead(payload);

      res.status(201).json(lead);
    })
  );

  app.patch(
    "/api/leads/:id/status",
    requireAuth,
    asyncHandler(async (req, res) => {
      const status = String(req.body.status || "").trim().toLowerCase();
      if (!status) {
        throw new ValidationError("A lead status is required.");
      }

      await req.app.locals.db.updateApiLeadStatus(Number(req.params.id), status, req.currentUser);
      res.json(await req.app.locals.db.getApiLeadWithActivities(Number(req.params.id), req.currentUser));
    })
  );

  app.patch(
    "/api/leads/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const lead = await req.app.locals.db.updateApiLead(Number(req.params.id), normalizeLeadPayload(req.body));
      res.json(lead);
    })
  );

  app.patch(
    "/api/leads/:id/assign",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const assignedTo = Number(req.body.assigned_to || req.body.assignedTo || req.body.salesperson_id);
      if (!Number.isInteger(assignedTo) || assignedTo <= 0) {
        throw new ValidationError("A valid salesperson is required.");
      }

      const assignees = await req.app.locals.db.listSalesUsers();
      if (!assignees.some((user) => Number(user.id) === assignedTo)) {
        throw new ValidationError("A valid salesperson is required.");
      }

      await req.app.locals.db.getApiLead(Number(req.params.id), req.currentUser);
      await req.app.locals.db.assignLead(Number(req.params.id), assignedTo);

      res.json(await req.app.locals.db.getApiLeadWithActivities(Number(req.params.id), req.currentUser));
    })
  );

  app.get(
    "/api/dashboard/metrics",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await req.app.locals.db.getDashboardApiMetrics(req.currentUser));
    })
  );

  app.get(
    "/api/dashboard/worklist",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await req.app.locals.db.getExecutionDashboard(req.currentUser));
    })
  );

  app.get(
    "/api/notifications",
    requireAuth,
    asyncHandler(async (req, res) => {
      const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
      res.json({
        items: await req.app.locals.db.listNotificationsForApi(Number(req.currentUser.id), limit),
      });
    })
  );

  app.get(
    "/api/conversations",
    requireAuth,
    asyncHandler(async (req, res) => {
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
      res.json({
        items: await req.app.locals.db.listConversationFeedForApi(req.currentUser, limit),
      });
    })
  );

  app.post(
    "/api/leads/:id/sms",
    requireAuth,
    asyncHandler(async (req, res) => {
      const leadId = Number(req.params.id);
      const body = String(req.body.message || "").trim();
      if (!body) {
        throw new ValidationError("A message is required.");
      }

      const lead = await req.app.locals.db.getApiLead(leadId, req.currentUser);
      const phone = lead.phone || null;
      if (!phone) {
        throw new ValidationError("This lead does not have a phone number.");
      }

      const connection = await req.app.locals.ringcentral.getActiveConnectionForUser(req.currentUser.id);
      if (!connection && !req.app.locals.ringcentral.config?.staticAccessToken) {
        throw new ValidationError("Connect RingCentral before sending SMS from the CRM.");
      }

      const response = await req.app.locals.ringcentral.sendSMS(phone, body, {
        crmUserId: req.currentUser.id,
      });

      if (req.app.locals.ringcentral.store) {
        await req.app.locals.ringcentral.store.upsertLeadMessage({
          lead_id: leadId,
          provider: "ringcentral",
          provider_message_id: String(response?.id || `manual-${Date.now()}`),
          thread_id: response?.conversation?.id || response?.conversationId || null,
          direction: "outbound",
          from_number: response?.from?.phoneNumber || null,
          to_number: phone,
          external_number: normalizePhone(phone),
          body_text: body,
          message_status: response?.messageStatus || "Queued",
          sent_at: response?.creationTime || new Date().toISOString(),
          crm_user_id: Number(req.currentUser.id),
          provider_extension_id: connection?.ringcentral_extension_id || null,
          raw: response || {},
        });
      }

      await req.app.locals.db.recordLeadActivity({
        lead_id: leadId,
        user_id: req.currentUser.id,
        type: "sms",
        content: body,
      });

      res.json(await req.app.locals.db.getApiLeadWithActivities(leadId, req.currentUser));
    })
  );

  app.post(
    "/api/leads/:id/call",
    requireAuth,
    asyncHandler(async (req, res) => {
      const leadId = Number(req.params.id);
      const lead = await req.app.locals.db.getApiLead(leadId, req.currentUser);
      const phone = lead.phone || null;
      if (!phone) {
        throw new ValidationError("This lead does not have a phone number.");
      }

      const connection = await req.app.locals.ringcentral.getActiveConnectionForUser(req.currentUser.id);
      const call = req.app.locals.ringcentral.logCall(phone, 0);

      if (req.app.locals.ringcentral.store) {
        await req.app.locals.ringcentral.store.upsertLeadCall({
          lead_id: leadId,
          provider: "ringcentral",
          provider_call_id: String(call.id),
          session_id: null,
          telephony_session_id: null,
          direction: "outbound",
          from_number: null,
          to_number: phone,
          external_number: normalizePhone(phone),
          result: "Initiated",
          action: "CRM click-to-call",
          duration_seconds: 0,
          start_time: call.createdAt,
          end_time: null,
          crm_user_id: Number(req.currentUser.id),
          provider_extension_id: connection?.ringcentral_extension_id || null,
          recording_status: "none",
          transcript_status: "not_requested",
          raw: { source: "crm_action" },
        });
      }

      await req.app.locals.db.recordLeadActivity({
        lead_id: leadId,
        user_id: req.currentUser.id,
        type: "call",
        content: "Call initiated from CRM.",
      });

      res.json(await req.app.locals.db.getApiLeadWithActivities(leadId, req.currentUser));
    })
  );

  app.post(
    "/api/leads/:id/hold",
    requireAuth,
    asyncHandler(async (req, res) => {
      const leadId = Number(req.params.id);
      const lead = await req.app.locals.db.getApiLead(leadId, req.currentUser);
      const todayKey = toDateOnlyString(new Date());

      await req.app.locals.db.createOrRefreshTask({
        lead_id: leadId,
        user_id: lead.assigned_to || Number(req.currentUser.id),
        type: "hold_vehicle",
        title: lead.stock_number
          ? `Hold vehicle request for stock ${lead.stock_number}`
          : "Hold vehicle request",
        due_at: new Date().toISOString(),
        source: "manual",
        unique_key: `hold-request:${leadId}:${todayKey}`,
        metadata: {
          stock_number: lead.stock_number || null,
          vehicle_interest: lead.vehicle_interest || null,
          requested_by_user_id: Number(req.currentUser.id),
        },
      });

      // The detail API still exposes legacy `activities`, so write the hold note there
      // to keep the confirmation visible immediately after the action completes.
      await req.app.locals.db.createActivity({
        lead_id: leadId,
        type: "note",
        content: lead.stock_number
          ? `Vehicle hold requested for stock ${lead.stock_number}.`
          : "Vehicle hold requested.",
      });

      res.json(await req.app.locals.db.getApiLeadWithActivities(leadId, req.currentUser));
    })
  );

  app.patch(
    "/api/notifications/:id/read",
    requireAuth,
    asyncHandler(async (req, res) => {
      await req.app.locals.db.markNotificationRead(Number(req.params.id), Number(req.currentUser.id));
      res.status(204).end();
    })
  );

  app.patch(
    "/api/tasks/:id/complete",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        task: await req.app.locals.db.completeTask(Number(req.params.id), req.currentUser),
      });
    })
  );

  app.get(
    "/api/settings/execution",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await req.app.locals.db.getExecutionSettings());
    })
  );

  app.patch(
    "/api/settings/execution",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canManageUsers(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json(await req.app.locals.db.setExecutionSettings(req.body || {}));
    })
  );
}

module.exports = {
  registerApiRoutes,
};
