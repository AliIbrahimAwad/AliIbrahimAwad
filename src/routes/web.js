const { canViewAllLeads } = require("../models/user");
const {
  renderContactDetailPage,
  renderContactForm,
  renderContactsListPage,
} = require("../views/contacts");
const { renderDashboardPage } = require("../views/dashboard");
const {
  renderLeadDetailPage,
  renderLeadForm,
  renderLeadsListPage,
} = require("../views/leads");
const { requireAuth } = require("../middleware/auth");
const { LEAD_SOURCES, LEAD_STATUSES } = require("../types/models");
const { asyncHandler } = require("./helpers");

function sanitizeText(value) {
  const trimmed = String(value || "").trim();
  return trimmed === "" ? null : trimmed;
}

function sanitizeContactPayload(body) {
  return {
    first_name: String(body.first_name || "").trim(),
    last_name: String(body.last_name || "").trim(),
    email: sanitizeText(body.email),
    phone: sanitizeText(body.phone),
    company: sanitizeText(body.company),
    job_title: sanitizeText(body.job_title),
  };
}

function sanitizeLeadPayload(body) {
  return {
    contact_id: body.contact_id ? Number(body.contact_id) : null,
    assigned_to: body.assigned_to ? Number(body.assigned_to) : null,
    source: String(body.source || "manual").trim().toLowerCase(),
    status: String(body.status || "new").trim().toLowerCase(),
    priority: sanitizeText(body.priority),
    follow_up_date: sanitizeText(body.follow_up_date),
    next_action: sanitizeText(body.next_action),
  };
}

function sanitizeCommunicationPayload(body) {
  return {
    duration: Number(body.duration || 0),
    message: String(body.message || "").trim(),
  };
}

function validateContact(payload) {
  const errors = {};
  const hasFullName = Boolean(payload.first_name && payload.last_name);

  if (!hasFullName && !payload.email && !payload.phone) {
    errors.contact = "Provide a full name, email, or phone number so this contact can be identified.";
  }

  return errors;
}

function validateLead(payload, contacts = [], assignees = []) {
  const errors = {};

  if (!payload.status || !LEAD_STATUSES.includes(payload.status)) {
    errors.status = "Choose a valid lead status.";
  }

  if (!payload.source || !LEAD_SOURCES.includes(payload.source)) {
    errors.source = "Choose a valid lead source.";
  }

  if (payload.contact_id !== null && (!Number.isInteger(payload.contact_id) || payload.contact_id <= 0)) {
    errors.contact_id = "Choose a valid contact.";
  }

  if (
    payload.contact_id !== null &&
    Number.isInteger(payload.contact_id) &&
    payload.contact_id > 0 &&
    !contacts.some((contact) => Number(contact.id) === payload.contact_id)
  ) {
    errors.contact_id = "Choose a valid contact.";
  }

  if (payload.assigned_to !== null && (!Number.isInteger(payload.assigned_to) || payload.assigned_to <= 0)) {
    errors.assigned_to = "Choose a valid salesperson.";
  }

  if (
    payload.assigned_to !== null &&
    Number.isInteger(payload.assigned_to) &&
    payload.assigned_to > 0 &&
    !assignees.some((user) => Number(user.id) === payload.assigned_to)
  ) {
    errors.assigned_to = "Choose a valid salesperson.";
  }

  if (payload.follow_up_date && !/^\d{4}-\d{2}-\d{2}$/.test(payload.follow_up_date)) {
    errors.follow_up_date = "Use a valid follow-up date.";
  }

  return errors;
}

async function getLeadFormContext(req, formData = {}) {
  const contacts = await req.app.locals.db.listContactsForSelect(req.currentUser);
  const assignees = await req.app.locals.db.listSalesUsers();
  const defaultAssignee =
    req.currentUser.role === "sales" ? req.currentUser.id : await req.app.locals.db.getDefaultAssigneeId();

  return {
    contacts,
    assignees,
    formData: {
      contact_id: "",
      assigned_to: defaultAssignee || "",
      source: "manual",
      status: "new",
      priority: "",
      follow_up_date: "",
      next_action: "",
      ...formData,
    },
    allowAssignment: canViewAllLeads(req.currentUser),
  };
}

async function normalizeLeadAssignment(req, payload, existingLead = null) {
  if (req.currentUser.role === "sales") {
    return req.currentUser.id;
  }

  if (payload.assigned_to) {
    return payload.assigned_to;
  }

  if (existingLead && existingLead.assigned_to) {
    return Number(existingLead.assigned_to);
  }

  return await req.app.locals.db.getDefaultAssigneeId();
}

function validateAssignment(assignedTo, assignees = []) {
  if (!Number.isInteger(assignedTo) || assignedTo <= 0) {
    return "Choose a valid salesperson.";
  }

  if (!assignees.some((user) => Number(user.id) === assignedTo)) {
    return "Choose a valid salesperson.";
  }

  return "";
}

async function renderLeadDetailResponse(req, res, lead, options = {}) {
  const contacts = await req.app.locals.db.listContactsForSelect(req.currentUser);
  const notes = await req.app.locals.db.listLeadNotes(lead.id);
  const assignees = canViewAllLeads(req.currentUser) ? await req.app.locals.db.listSalesUsers() : [];
  const activities = await req.app.locals.db.listLeadActivities(lead.id);

  res.status(options.statusCode || 200).send(
    renderLeadDetailPage({
      lead,
      contacts,
      notes,
      assignees,
      activities,
      activePath: "/leads",
      currentUser: req.currentUser,
      canAssign: canViewAllLeads(req.currentUser),
      assignmentError: options.assignmentError || "",
      communicationError: options.communicationError || "",
      smsDraft: options.smsDraft || "",
      callDuration: options.callDuration || "",
    })
  );
}

function registerWebRoutes(app) {
  app.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const metrics = await req.app.locals.db.getDashboardMetrics(req.currentUser);
      res.send(renderDashboardPage({ metrics, activePath: req.path, currentUser: req.currentUser }));
    })
  );

  app.get(
    "/contacts",
    requireAuth,
    asyncHandler(async (req, res) => {
      const contacts = await req.app.locals.db.listContacts(req.currentUser);
      res.send(renderContactsListPage({ contacts, activePath: req.path, currentUser: req.currentUser }));
    })
  );

  app.get("/contacts/new", requireAuth, (req, res) => {
    res.send(
      renderContactForm({
        title: "New contact",
        action: "/contacts",
        formData: {
          first_name: "",
          last_name: "",
          email: "",
          phone: "",
          company: "",
          job_title: "",
        },
        activePath: "/contacts",
        submitLabel: "Create contact",
        currentUser: req.currentUser,
      })
    );
  });

  app.post(
    "/contacts",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = sanitizeContactPayload(req.body);
      const errors = validateContact(payload);

      if (Object.keys(errors).length > 0) {
        res.status(422).send(
          renderContactForm({
            title: "New contact",
            action: "/contacts",
            formData: payload,
            errors,
            activePath: "/contacts",
            submitLabel: "Create contact",
            currentUser: req.currentUser,
          })
        );
        return;
      }

      const contact = await req.app.locals.db.createContact(payload);
      res.redirect(`/contacts/${contact.id}`);
    })
  );

  app.get(
    "/contacts/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const contact = await req.app.locals.db.getContact(Number(req.params.id), req.currentUser);
      const leads = await req.app.locals.db.getContactLeads(Number(req.params.id), req.currentUser);
      res.send(
        renderContactDetailPage({
          contact,
          leads,
          activePath: "/contacts",
          currentUser: req.currentUser,
        })
      );
    })
  );

  app.get(
    "/contacts/:id/edit",
    requireAuth,
    asyncHandler(async (req, res) => {
      const contact = await req.app.locals.db.getContact(Number(req.params.id), req.currentUser);
      res.send(
        renderContactForm({
          title: "Edit contact",
          action: `/contacts/${contact.id}`,
          formData: {
            first_name: contact.first_name || "",
            last_name: contact.last_name || "",
            email: contact.email || "",
            phone: contact.phone || "",
            company: contact.company || "",
            job_title: contact.job_title || "",
          },
          activePath: "/contacts",
          submitLabel: "Save changes",
          currentUser: req.currentUser,
        })
      );
    })
  );

  app.post(
    "/contacts/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      await req.app.locals.db.getContact(id, req.currentUser);
      const payload = sanitizeContactPayload(req.body);
      const errors = validateContact(payload);

      if (Object.keys(errors).length > 0) {
        res.status(422).send(
          renderContactForm({
            title: "Edit contact",
            action: `/contacts/${id}`,
            formData: payload,
            errors,
            activePath: "/contacts",
            submitLabel: "Save changes",
            currentUser: req.currentUser,
          })
        );
        return;
      }

      await req.app.locals.db.updateContact(id, payload);
      res.redirect(`/contacts/${id}`);
    })
  );

  app.post(
    "/contacts/:id/delete",
    requireAuth,
    asyncHandler(async (req, res) => {
      await req.app.locals.db.getContact(Number(req.params.id), req.currentUser);
      await req.app.locals.db.deleteContact(Number(req.params.id));
      res.redirect("/contacts");
    })
  );

  app.get(
    "/leads",
    requireAuth,
    asyncHandler(async (req, res) => {
      const leads = await req.app.locals.db.listLeads(req.currentUser);
      res.send(renderLeadsListPage({ leads, activePath: req.path, currentUser: req.currentUser }));
    })
  );

  app.get(
    "/leads/new",
    requireAuth,
    asyncHandler(async (req, res) => {
      const context = await getLeadFormContext(req);
      res.send(
        renderLeadForm({
          title: "New lead",
          action: "/leads",
          statuses: LEAD_STATUSES,
          activePath: "/leads",
          submitLabel: "Create lead",
          currentUser: req.currentUser,
          ...context,
        })
      );
    })
  );

  app.post(
    "/leads",
    requireAuth,
    asyncHandler(async (req, res) => {
      const context = await getLeadFormContext(req, sanitizeLeadPayload(req.body));
      const payload = {
        ...context.formData,
        assigned_to: await normalizeLeadAssignment(req, context.formData),
      };
      const errors = validateLead(payload, context.contacts, context.assignees);

      if (Object.keys(errors).length > 0) {
        res.status(422).send(
          renderLeadForm({
            title: "New lead",
            action: "/leads",
            statuses: LEAD_STATUSES,
            errors,
            activePath: "/leads",
            submitLabel: "Create lead",
            currentUser: req.currentUser,
            ...context,
            formData: payload,
          })
        );
        return;
      }

      const lead = await req.app.locals.db.createLead(payload);
      res.redirect(`/leads/${lead.id}`);
    })
  );

  app.get(
    "/leads/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lead = await req.app.locals.db.getLead(id, req.currentUser);
      await renderLeadDetailResponse(req, res, lead);
    })
  );

  app.get(
    "/leads/:id/edit",
    requireAuth,
    asyncHandler(async (req, res) => {
      const lead = await req.app.locals.db.getLead(Number(req.params.id), req.currentUser);
      const context = await getLeadFormContext(req, {
        contact_id: lead.contact_id || "",
        assigned_to: lead.assigned_to || "",
        source: lead.source || "manual",
        status: lead.status,
        priority: lead.priority || "",
        follow_up_date: lead.follow_up_date || "",
        next_action: lead.next_action || "",
      });

      res.send(
        renderLeadForm({
          title: "Edit lead",
          action: `/leads/${lead.id}`,
          statuses: LEAD_STATUSES,
          activePath: "/leads",
          submitLabel: "Save changes",
          currentUser: req.currentUser,
          ...context,
        })
      );
    })
  );

  app.post(
    "/leads/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const existingLead = await req.app.locals.db.getLead(id, req.currentUser);
      const context = await getLeadFormContext(req, sanitizeLeadPayload(req.body));
      const payload = {
        ...context.formData,
        assigned_to: await normalizeLeadAssignment(req, context.formData, existingLead),
      };
      const errors = validateLead(payload, context.contacts, context.assignees);

      if (Object.keys(errors).length > 0) {
        res.status(422).send(
          renderLeadForm({
            title: "Edit lead",
            action: `/leads/${id}`,
            statuses: LEAD_STATUSES,
            errors,
            activePath: "/leads",
            submitLabel: "Save changes",
            currentUser: req.currentUser,
            ...context,
            formData: payload,
          })
        );
        return;
      }

      await req.app.locals.db.updateLead(id, payload);
      res.redirect(`/leads/${id}`);
    })
  );

  app.post(
    "/leads/:id/assign",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lead = await req.app.locals.db.getLead(id, req.currentUser);

      if (!canViewAllLeads(req.currentUser)) {
        res.status(403).send("Forbidden");
        return;
      }

      const assignedTo = Number(req.body.salesperson_id || req.body.assigned_to);
      const assignees = await req.app.locals.db.listSalesUsers();
      const assignmentError = validateAssignment(assignedTo, assignees);

      if (assignmentError) {
        await renderLeadDetailResponse(req, res, lead, {
          assignmentError,
          statusCode: 422,
        });
        return;
      }

      await req.app.locals.db.assignLead(id, assignedTo);
      res.redirect(`/leads/${id}`);
    })
  );

  app.post(
    "/leads/:id/sms",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lead = await req.app.locals.db.getLead(id, req.currentUser);
      const payload = sanitizeCommunicationPayload(req.body);

      if (!payload.message) {
        await renderLeadDetailResponse(req, res, lead, {
          communicationError: "Message text is required to send an SMS.",
          smsDraft: payload.message,
          statusCode: 422,
        });
        return;
      }

      if (!lead.contact_phone) {
        await renderLeadDetailResponse(req, res, lead, {
          communicationError: "This lead does not have a phone number for SMS delivery.",
          smsDraft: payload.message,
          statusCode: 422,
        });
        return;
      }

      await req.app.locals.ringcentral.sendSMS(lead.contact_phone, payload.message);
      await req.app.locals.db.recordLeadActivity({
        lead_id: id,
        user_id: req.currentUser.id,
        type: "sms",
        content: payload.message,
      });
      res.redirect(`/leads/${id}`);
    })
  );

  app.post(
    "/leads/:id/calls",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lead = await req.app.locals.db.getLead(id, req.currentUser);
      const payload = sanitizeCommunicationPayload(req.body);

      if (!lead.contact_phone) {
        await renderLeadDetailResponse(req, res, lead, {
          communicationError: "This lead does not have a phone number for call logging.",
          callDuration: payload.duration ? String(payload.duration) : "",
          statusCode: 422,
        });
        return;
      }

      const call = req.app.locals.ringcentral.logCall(lead.contact_phone, payload.duration);
      await req.app.locals.db.recordLeadActivity({
        lead_id: id,
        user_id: req.currentUser.id,
        type: "call",
        content: `Call completed (${call.duration}s)`,
      });
      res.redirect(`/leads/${id}`);
    })
  );

  app.post(
    "/leads/:id/delete",
    requireAuth,
    asyncHandler(async (req, res) => {
      await req.app.locals.db.getLead(Number(req.params.id), req.currentUser);
      await req.app.locals.db.deleteLead(Number(req.params.id));
      res.redirect("/leads");
    })
  );

  app.post(
    "/leads/:id/notes",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      await req.app.locals.db.getLead(id, req.currentUser);
      const body = String(req.body.body || "").trim();

      if (!body) {
        res.redirect(`/leads/${id}`);
        return;
      }

      await req.app.locals.db.addLeadNote(id, body, req.currentUser.id);
      res.redirect(`/leads/${id}`);
    })
  );
}

module.exports = {
  registerWebRoutes,
};
