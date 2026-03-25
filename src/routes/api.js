const { canAssignLeads, canManageUsers, canUpdateLeadStatus } = require("../models/user");
const { requireAuth } = require("../middleware/auth");
const { ValidationError } = require("../data/core");
const { normalizePhone } = require("../utils/phones");
const { toDateOnlyString } = require("../utils/dates");
const { asyncHandler } = require("./helpers");
const { importInventoryCsv } = require("../../services/inventoryImport");

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

function getFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function getObjectValue(object, path) {
  return path.split(".").reduce((current, segment) => (current == null ? undefined : current[segment]), object);
}

function getFirstNamedValue(object, paths = []) {
  for (const path of paths) {
    const value = getObjectValue(object, path);
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function normalizeWebhookSecret(value) {
  return String(value || "").trim();
}

function requireFluentFormsWebhookKey(req) {
  const configured = normalizeWebhookSecret(process.env.FLUENT_FORMS_WEBHOOK_KEY);
  if (!configured) {
    throw new ValidationError("Fluent Forms webhook key is not configured.");
  }

  const provided = normalizeWebhookSecret(
    req.get("X-CRM-Webhook-Key") || req.get("X-Webhook-Key") || req.query.key || req.body?.key
  );
  if (!provided || provided !== configured) {
    const error = new ValidationError("Invalid Fluent Forms webhook key.");
    error.statusCode = 401;
    throw error;
  }
}

function extractStockNumberFromListingUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/-([a-z]\d{3,8})(?:\/)?(?:\?.*)?$/i);
  return match ? match[1].toUpperCase() : null;
}

function humanizeListingSlug(slug = "") {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => (/^\d{4}$/.test(part) ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ")
    .trim();
}

function deriveVehicleFromListingUrl(value = "") {
  try {
    const pathname = new URL(String(value || "")).pathname;
    const slug = pathname.split("/").filter(Boolean).pop() || "";
    const withoutStock = slug.replace(/-([a-z]\d{3,8})$/i, "");
    return humanizeListingSlug(withoutStock) || null;
  } catch (_error) {
    return null;
  }
}

function deriveIntakeStatusFromLead(lead) {
  if (!lead) {
    return "unassigned";
  }

  if (lead.status === "contacted") {
    return "contacted";
  }

  return lead.assigned_to ? "assigned" : "unassigned";
}

function normalizeFluentFormsWebhookPayload(body = {}) {
  const submission = body.__submission || {};
  const userInputs = submission.user_inputs || {};
  const firstName = getFirstNonEmpty(
    getFirstNamedValue(body, ["first_name", "firstName", "names.first_name", "name.first_name", "name.firstName"]),
    getFirstNamedValue(userInputs, [
      "first_name",
      "firstName",
      "names.first_name",
      "name.first_name",
      "name.firstName",
      "names[first_name]",
      "name[first_name]",
    ])
  );
  const lastName = getFirstNonEmpty(
    getFirstNamedValue(body, ["last_name", "lastName", "names.last_name", "name.last_name", "name.lastName"]),
    getFirstNamedValue(userInputs, [
      "last_name",
      "lastName",
      "names.last_name",
      "name.last_name",
      "name.lastName",
      "names[last_name]",
      "name[last_name]",
    ])
  );
  const combinedName = getFirstNonEmpty([firstName, lastName].filter(Boolean).join(" "));
  const customerName = getFirstNonEmpty(
    combinedName,
    body.customer_name,
    body.customerName,
    body.name,
    body.input_text,
    userInputs.input_text
  );
  const email = getFirstNonEmpty(body.email, userInputs.email);
  const phone = getFirstNonEmpty(body.phone, userInputs.phone);
  const message = getFirstNonEmpty(body.message, body.description, userInputs.description);
  const preferredContact = getFirstNonEmpty(body.preferred_contact, body.dropdown, userInputs.dropdown);
  const listingUrl = getFirstNonEmpty(body.listing_url, body.listingUrl, submission.source_url);
  const stockNumber = getFirstNonEmpty(body.stock_number, body.stockNumber, extractStockNumberFromListingUrl(listingUrl));
  const vehicleInterest = getFirstNonEmpty(body.vehicle_interest, body.vehicleInterest, deriveVehicleFromListingUrl(listingUrl));
  const submissionId = getFirstNonEmpty(submission.id);
  const formId = getFirstNonEmpty(submission.form_id);
  const externalId = submissionId ? `fluent_forms:${formId || "unknown"}:${submissionId}` : "";

  if (!externalId) {
    throw new ValidationError("Fluent Forms submission id is required.");
  }

  return {
    external_id: externalId,
    source: "website",
    customer_name: customerName || null,
    email: email || null,
    phone: phone || null,
    vehicle_interest: vehicleInterest || null,
    stock_number: stockNumber || null,
    listing_url: listingUrl || null,
    message: preferredContact ? `${message || "Website form submission"}\nPreferred contact: ${preferredContact}` : message || null,
    lead_type: "website_form",
    received_at: getFirstNonEmpty(submission.created_at) || null,
    subject: `Website form submission${vehicleInterest ? ` - ${vehicleInterest}` : ""}`,
    sender: email || "website-form@loolooauto.ca",
    raw_payload_json: JSON.stringify(body),
  };
}

function normalizeUnmatchedLeadPayload(body = {}) {
  return {
    customer_name: String(body.customer_name || body.name || "").trim() || null,
  };
}

function formatUnmatchedCommunication(item) {
  return {
    id: item.id,
    dealership_id: Number(item.dealership_id),
    type: item.type,
    direction: item.direction,
    from_number: item.from_number || null,
    to_number: item.to_number || null,
    normalized_from_number: item.normalized_from_number || null,
    normalized_to_number: item.normalized_to_number || null,
    body_text: item.body_text || "",
    call_duration: item.call_duration == null ? null : Number(item.call_duration),
    received_at: item.received_at || null,
    provider: item.provider || "ringcentral",
    provider_message_id: item.provider_message_id || null,
    provider_call_id: item.provider_call_id || null,
    crm_user_id: item.crm_user_id == null ? null : Number(item.crm_user_id),
    provider_extension_id: item.provider_extension_id || null,
    status: item.status,
    resolved_lead_id: item.resolved_lead_id == null ? null : Number(item.resolved_lead_id),
    resolved_lead_name: item.resolved_lead_name || null,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function normalizeInventoryFilters(query = {}) {
  return {
    limit: Math.max(1, Math.min(500, Number(query.limit) || 250)),
    status: String(query.status || "").trim().toLowerCase(),
    make: String(query.make || "").trim(),
    model: String(query.model || "").trim(),
    stock_number: String(query.stock_number || query.stockNumber || "").trim(),
    vin: String(query.vin || "").trim(),
  };
}

function normalizeInventoryRunErrorFilters(query = {}) {
  return {
    run_id: query.run_id || query.runId || null,
    source_type: String(query.source_type || query.sourceType || "").trim(),
    limit: Math.max(1, Math.min(200, Number(query.limit) || 50)),
  };
}

function normalizeEmailIntakeFilters(query = {}) {
  return {
    limit: Math.max(1, Math.min(200, Number(query.limit) || 100)),
    offset: Math.max(0, Number(query.offset) || 0),
    classification: String(query.classification || "").trim().toLowerCase(),
    status: String(query.status || "").trim().toLowerCase(),
    search: String(query.search || "").trim(),
    pending_only: String(query.pending_only || query.pendingOnly || "true").trim().toLowerCase() !== "false",
  };
}

function normalizeEmailIntakeConversionPayload(body = {}) {
  return {
    customer_name: String(body.customer_name || body.customerName || "").trim() || null,
    message: String(body.message || "").trim() || null,
    assigned_to: body.assigned_to || body.assignedTo || null,
  };
}

function registerApiRoutes(app) {
  app.post(
    "/api/intake/fluent-forms",
    asyncHandler(async (req, res) => {
      requireFluentFormsWebhookKey(req);

      const payload = normalizeFluentFormsWebhookPayload(req.body);
      const existingItem = await req.app.locals.db.getEmailIntakeItemByExternalId(payload.external_id);
      if (existingItem) {
        const leadPayload = existingItem.lead_id
          ? await req.app.locals.db.getApiLeadWithActivities(existingItem.lead_id)
          : { lead: null, activities: [], timeline: [], tasks: [] };
        res.json({
          accepted: true,
          duplicate_submission: true,
          item: existingItem,
          ...leadPayload,
        });
        return;
      }

      const lead = await req.app.locals.db.createApiLead(
        {
          source: payload.source,
          customer_name: payload.customer_name,
          email: payload.email,
          phone: payload.phone,
          vehicle_interest: payload.vehicle_interest,
          stock_number: payload.stock_number,
          listing_url: payload.listing_url,
          message: payload.message,
          lead_type: payload.lead_type,
          status: "new",
        },
        null,
        { returnDedupeMeta: true }
      );

      const item = await req.app.locals.db.createEmailIntakeItem({
        external_id: payload.external_id,
        source: payload.source,
        subject: payload.subject,
        sender: payload.sender,
        message: payload.message,
        received_at: payload.received_at,
        classification: "direct_lead",
        status: deriveIntakeStatusFromLead(lead),
        assigned_to: lead.assigned_to || null,
        lead_id: lead.id,
        customer_name: lead.customer_name || payload.customer_name,
        phone: lead.phone || payload.phone,
        email: lead.email || payload.email,
        stock_number: lead.stock_number || payload.stock_number,
        inventory_id: lead.inventory_id || null,
        vehicle_display: lead.vehicle_interest || payload.vehicle_interest,
        raw_payload_json: payload.raw_payload_json,
      });

      res.status(201).json({
        accepted: true,
        duplicate_submission: false,
        merged_into_existing_lead: Boolean(lead._dedupe?.merged),
        merge_reason: lead._dedupe?.reason || null,
        item,
        ...(await req.app.locals.db.getApiLeadWithActivities(lead.id)),
      });
    })
  );

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
      if (!canUpdateLeadStatus(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

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
      const lead = await req.app.locals.db.updateApiLead(
        Number(req.params.id),
        normalizeLeadPayload(req.body),
        req.currentUser
      );
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

      const assignees = await req.app.locals.db.listSalesUsers(req.currentUser);
      if (!assignees.some((user) => Number(user.id) === assignedTo)) {
        throw new ValidationError("A valid salesperson is required.");
      }

      await req.app.locals.db.getApiLead(Number(req.params.id), req.currentUser);
      await req.app.locals.db.assignLead(Number(req.params.id), assignedTo, req.currentUser);

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
        items: await req.app.locals.db.listNotificationsForApi(Number(req.currentUser.id), limit, req.currentUser),
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

  app.get(
    "/api/intake-items",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const payload = await req.app.locals.db.listEmailIntakeItems(normalizeEmailIntakeFilters(req.query), req.currentUser);
      res.json(payload);
    })
  );

  app.get(
    "/api/intake-items/summary",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json(await req.app.locals.db.getEmailIntakeSummary(req.currentUser));
    })
  );

  app.post(
    "/api/intake-items/:id/assign",
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

      const assignees = await req.app.locals.db.listSalesUsers(req.currentUser);
      if (!assignees.some((user) => Number(user.id) === assignedTo)) {
        throw new ValidationError("A valid salesperson is required.");
      }

      const item = await req.app.locals.db.assignEmailIntakeItem(Number(req.params.id), assignedTo, req.currentUser);
      const lead = item.lead_id ? await req.app.locals.db.getApiLeadWithActivities(item.lead_id, req.currentUser) : null;
      res.json({ item, ...(lead || {}) });
    })
  );

  app.post(
    "/api/intake-items/:id/resolve",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json({
        item: await req.app.locals.db.resolveEmailIntakeItem(Number(req.params.id), req.currentUser),
      });
    })
  );

  app.post(
    "/api/intake-items/:id/convert",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const payload = await req.app.locals.db.convertEmailIntakeItemToLead(
        Number(req.params.id),
        normalizeEmailIntakeConversionPayload(req.body),
        req.currentUser
      );
      res.status(201).json({
        item: payload.item,
        ...(payload.lead || {}),
      });
    })
  );

  app.get(
    "/api/inventory",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        items: await req.app.locals.db.listInventoryForApi(normalizeInventoryFilters(req.query), req.currentUser),
      });
    })
  );

  app.get(
    "/api/inventory/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        item: await req.app.locals.db.getInventoryForApi(Number(req.params.id), req.currentUser),
      });
    })
  );

  app.post(
    "/api/inventory/import",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const csvText = String(req.body.csv_text || req.body.csvText || "");
      const fileName = String(req.body.file_name || req.body.fileName || "").trim() || null;
      const sourceName = String(req.body.source_name || req.body.sourceName || "").trim() || null;
      const markMissingInactive = Boolean(req.body.mark_missing_inactive ?? req.body.markMissingInactive);
      const result = await importInventoryCsv({
        db: req.app.locals.db,
        user: req.currentUser,
        csvText,
        fileName,
        sourceName,
        markMissingInactive,
      });

      res.status(201).json(result);
    })
  );

  app.get(
    "/api/inventory/import-runs",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        items: await req.app.locals.db.listInventoryImportRuns(req.currentUser, Number(req.query.limit) || 20),
      });
    })
  );

  app.get(
    "/api/inventory/import-errors",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json({
        items: await req.app.locals.db.listInventoryImportErrors(
          normalizeInventoryRunErrorFilters(req.query),
          req.currentUser
        ),
      });
    })
  );

  app.get(
    "/api/inventory/sync-status",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const schedulerSnapshot = req.app.locals.inventorySyncScheduler?.getSnapshot?.() || null;
      const status = req.app.locals.inventorySync
        ? await req.app.locals.inventorySync.getStatus(req.currentUser, schedulerSnapshot)
        : {
            enabled: false,
            configured: false,
            recent_runs: [],
            recent_errors: [],
          };

      res.json(status);
    })
  );

  app.post(
    "/api/inventory/sync-now",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      if (!req.app.locals.inventorySync) {
        throw new ValidationError("Inventory sync is not available.");
      }

      const result = await req.app.locals.inventorySync.runManualSync(req.currentUser);
      if (req.app.locals.inventorySyncScheduler?.scheduleNext) {
        await req.app.locals.inventorySyncScheduler.scheduleNext();
      }

      res.status(201).json(result);
    })
  );

  app.get(
    "/api/unmatched",
    requireAuth,
    asyncHandler(async (req, res) => {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
      const status = String(req.query.status || "").trim().toLowerCase();
      const items = await req.app.locals.ringcentral.listUnmatchedCommunications({ status, limit }, req.currentUser);
      res.json({
        items: items.map(formatUnmatchedCommunication),
      });
    })
  );

  app.post(
    "/api/unmatched/:id/assign",
    requireAuth,
    asyncHandler(async (req, res) => {
      const leadId = Number(req.body.lead_id || req.body.leadId);
      if (!Number.isInteger(leadId) || leadId <= 0) {
        throw new ValidationError("A valid lead is required.");
      }

      const result = await req.app.locals.ringcentral.assignUnmatchedCommunication(
        String(req.params.id),
        leadId,
        req.currentUser
      );
      const item = await req.app.locals.ringcentral.store.getUnmatchedCommunicationById(String(req.params.id), req.currentUser);
      res.json({
        item: formatUnmatchedCommunication(item),
        ...(await req.app.locals.db.getApiLeadWithActivities(result.lead_id, req.currentUser)),
      });
    })
  );

  app.post(
    "/api/unmatched/:id/create-lead",
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = await req.app.locals.ringcentral.createLeadFromUnmatched(
        String(req.params.id),
        normalizeUnmatchedLeadPayload(req.body),
        req.currentUser
      );
      const item = await req.app.locals.ringcentral.store.getUnmatchedCommunicationById(String(req.params.id), req.currentUser);
      res.status(201).json({
        item: formatUnmatchedCommunication(item),
        ...(await req.app.locals.db.getApiLeadWithActivities(result.lead_id, req.currentUser)),
      });
    })
  );

  app.post(
    "/api/unmatched/:id/dismiss",
    requireAuth,
    asyncHandler(async (req, res) => {
      await req.app.locals.ringcentral.dismissUnmatchedCommunication(String(req.params.id), req.currentUser);
      const item = await req.app.locals.ringcentral.store.getUnmatchedCommunicationById(String(req.params.id), req.currentUser);
      res.json({
        item: formatUnmatchedCommunication(item),
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
    "/api/leads/:id/link-inventory",
    requireAuth,
    asyncHandler(async (req, res) => {
      const inventoryId = Number(req.body.inventory_id || req.body.inventoryId);
      if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
        throw new ValidationError("A valid inventory unit is required.");
      }

      const payload = await req.app.locals.db.linkLeadInventory(Number(req.params.id), inventoryId, req.currentUser);
      res.json(payload);
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

      const callAttempt = await req.app.locals.ringcentral.initiateOutboundCall(phone, {
        crmUserId: Number(req.currentUser.id),
        dealership_id: Number(req.currentUser.dealership_id),
        lead_dealership_id: Number(lead.dealership_id),
        lead_id: leadId,
        user: req.currentUser,
      });

      res.status(202).json({
        ok: true,
        call_attempt: {
          id: callAttempt.id,
          status: callAttempt.status,
          from_number: callAttempt.from_number,
          to_number: callAttempt.to_number,
          initiated_at: callAttempt.initiated_at,
          provider_extension_id: callAttempt.provider_extension_id,
        },
      });
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
      await req.app.locals.db.markNotificationRead(Number(req.params.id), Number(req.currentUser.id), req.currentUser);
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
