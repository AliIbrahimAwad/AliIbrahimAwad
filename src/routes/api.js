const { ValidationError } = require("../data/database");
const { asyncHandler } = require("./helpers");

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" "),
  };
}

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

function registerApiRoutes(app) {
  app.post(
    "/api/leads",
    asyncHandler(async (req, res) => {
      const name = String(req.body.name || "").trim();
      const email = String(req.body.email || "").trim();
      const phone = String(req.body.phone || "").trim();
      const vehicle = String(req.body.vehicle || "").trim();
      const source = String(req.body.source || "").trim().toLowerCase();

      if (!name && !email && !phone) {
        throw new ValidationError("At least one contact field is required.");
      }

      if (source !== "website") {
        throw new ValidationError("Website lead API only accepts source=website.");
      }

      const nameParts = splitName(name);
      const contact = req.app.locals.db.createContact({
        first_name: nameParts.first_name,
        last_name: nameParts.last_name,
        email: email || null,
        phone: phone || null,
        company: null,
        job_title: null,
      });

      const lead = req.app.locals.db.createLead({
        contact_id: contact.id,
        assigned_to: null,
        source: "website",
        status: "new",
        priority: null,
        follow_up_date: null,
        next_action: vehicle ? `Website inquiry for ${vehicle}` : "Review website inquiry",
      });

      if (vehicle) {
        req.app.locals.db.addLeadNote(lead.id, `Interested vehicle: ${vehicle}`);
      }

      const createdLead = req.app.locals.db.getLead(lead.id);
      res.status(201).json({
        id: createdLead.id,
        assigned_to: createdLead.assigned_to,
        assigned_user_name: createdLead.assigned_user_name,
        status: createdLead.status,
        source: createdLead.source,
      });
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
