const { requireAuth } = require("../middleware/auth");
const { ValidationError } = require("../data/database");
const { asyncHandler } = require("./helpers");

function extractWebhookEvent(body = {}) {
  const rawType = String(body.type || body.eventType || body.event || "").toLowerCase();
  const eventType = rawType.includes("sms") || rawType.includes("message") ? "sms" : "call";
  const phone =
    body.phone ||
    body.phoneNumber ||
    body.fromPhoneNumber ||
    body.toPhoneNumber ||
    body.from?.phoneNumber ||
    body.to?.phoneNumber ||
    "";

  const content =
    body.content ||
    body.message ||
    body.text ||
    (eventType === "call"
      ? `RingCentral call logged (${Number(body.duration || body.callDuration || 0)}s)`
      : "RingCentral SMS received");

  return {
    content: String(content || "").trim(),
    phone: String(phone || "").trim(),
    type: eventType,
    userId: body.user_id || body.userId || null,
  };
}

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
      const page = req.app.locals.db.listApiLeads(toPagination(req.query), req.currentUser);

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
      const payload = req.app.locals.db.getApiLeadWithActivities(Number(req.params.id), req.currentUser);
      res.json(payload);
    })
  );

  app.post(
    "/api/leads",
    asyncHandler(async (req, res) => {
      const payload = normalizeLeadPayload(req.body);
      const lead = req.app.locals.db.createApiLead(payload);

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

      const lead = req.app.locals.db.updateApiLeadStatus(Number(req.params.id), status);
      res.json(lead);
    })
  );

  app.patch(
    "/api/leads/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const lead = req.app.locals.db.updateApiLead(Number(req.params.id), normalizeLeadPayload(req.body));
      res.json(lead);
    })
  );

  app.get(
    "/api/dashboard/metrics",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(req.app.locals.db.getDashboardApiMetrics(req.currentUser));
    })
  );

  app.post(
    "/api/ringcentral/webhook",
    asyncHandler(async (req, res) => {
      if (!req.app.locals.ringcentral.isValidWebhookRequest(req.headers)) {
        res.status(401).json({ error: "Invalid webhook request." });
        return;
      }

      const event = extractWebhookEvent(req.body);
      if (!event.phone) {
        throw new ValidationError("Webhook payload did not include a phone number.");
      }

      const lead = req.app.locals.db.findLeadByPhone(event.phone);
      if (!lead) {
        res.status(202).json({ matched: false });
        return;
      }

      req.app.locals.db.recordLeadActivity({
        lead_id: lead.id,
        user_id: event.userId,
        type: event.type,
        content: event.content || (event.type === "sms" ? "RingCentral SMS logged" : "RingCentral call logged"),
      });

      const updatedLead = req.app.locals.db.getLead(lead.id);
      res.json({
        matched: true,
        lead_id: updatedLead.id,
        status: updatedLead.status,
      });
    })
  );
}

module.exports = {
  registerApiRoutes,
};
