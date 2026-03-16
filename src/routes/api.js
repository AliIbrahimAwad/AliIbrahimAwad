const { canAssignLeads } = require("../models/user");
const { requireAuth } = require("../middleware/auth");
const { ValidationError } = require("../data/database");
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

      const lead = await req.app.locals.db.updateApiLeadStatus(Number(req.params.id), status);
      res.json(lead);
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
}

module.exports = {
  registerApiRoutes,
};
