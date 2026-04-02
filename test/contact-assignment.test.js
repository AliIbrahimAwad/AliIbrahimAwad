const test = require("node:test");
const assert = require("node:assert/strict");

const { PostgresCrmDatabase } = require("../src/data/postgres");
const { evaluateRepAvailability } = require("../src/utils/repAvailability");

test("rep availability respects active, manual availability, and working days", () => {
  const anyTime = new Date("2026-03-30T14:00:00.000Z");

  assert.equal(
    evaluateRepAvailability(
      {
        is_active: true,
        is_available: true,
        working_days: ["mon", "tue"],
        working_hours_start: "09:00",
        working_hours_end: "17:00",
        timezone: "America/Toronto",
      },
      anyTime
    ).eligible,
    true
  );

  assert.equal(
    evaluateRepAvailability(
      {
        is_active: true,
        is_available: false,
        working_days: ["mon", "tue"],
        working_hours_start: "09:00",
        working_hours_end: "17:00",
        timezone: "America/Toronto",
      },
      anyTime
    ).reason,
    "manual_off"
  );

  assert.equal(
    evaluateRepAvailability(
      {
        is_active: true,
        is_available: true,
        working_days: ["tue"],
        working_hours_start: "09:00",
        working_hours_end: "17:00",
        timezone: "America/Toronto",
      },
      anyTime
    ).reason,
    "outside_working_day"
  );

  assert.equal(
    evaluateRepAvailability(
      {
        is_active: false,
        is_available: true,
        working_days: ["mon", "tue"],
        working_hours_start: "09:00",
        working_hours_end: "17:00",
        timezone: "America/Toronto",
      },
      anyTime
    ).reason,
    "inactive"
  );
});

test("eligible reps are assigned in round-robin order without advancing on peek", async () => {
  const saved = [];
  const fakeDb = {
    async listEligibleSalesUsers() {
      return [
        { id: 11, name: "Rep One" },
        { id: 22, name: "Rep Two" },
      ];
    },
    contactAssignmentCursorKey() {
      return "contact_assignment_cursor:1";
    },
    async getSettingValue() {
      return saved.length ? saved[saved.length - 1] : null;
    },
    async setSettingValue(_key, value) {
      saved.push(value);
    },
  };

  const first = await PostgresCrmDatabase.prototype.getAssignableSalesUser.call(fakeDb, null, { dealership_id: 1 });
  assert.equal(first.id, 11);
  assert.deepEqual(saved, ["11"]);

  const second = await PostgresCrmDatabase.prototype.getAssignableSalesUser.call(fakeDb, null, { dealership_id: 1 });
  assert.equal(second.id, 22);
  assert.deepEqual(saved, ["11", "22"]);

  const peek = await PostgresCrmDatabase.prototype.getAssignableSalesUser.call(fakeDb, null, {
    dealership_id: 1,
    advanceCursor: false,
  });
  assert.equal(peek.id, 11);
  assert.deepEqual(saved, ["11", "22"]);
});

test("new contact assignment falls back to manual review when no reps are available", async () => {
  const assignment = await PostgresCrmDatabase.prototype.assignRepToNewContact.call(
    {
      currentDealershipId() {
        return 1;
      },
      async getAssignableSalesUser() {
        return null;
      },
    },
    { dealership_id: 1 }
  );

  assert.deepEqual(assignment, {
    assigned_rep_id: null,
    assignment_method: "unassigned_no_available_rep",
    needs_manual_review: true,
  });
});

test("conflicting phone and email matches create a manual-review contact instead of merging", async () => {
  let createdPayload = null;
  const result = await PostgresCrmDatabase.prototype.findOrCreateContactFromLead.call(
    {
      currentDealershipId() {
        return 1;
      },
      async findContactByNormalizedPhone() {
        return { id: 10 };
      },
      async findContactByNormalizedEmail() {
        return { id: 20 };
      },
      async assignRepToNewContact() {
        return { assigned_rep_id: 7, assignment_method: "auto_round_robin", needs_manual_review: false };
      },
      async createContact(input) {
        createdPayload = input;
        return { id: 99, ...input };
      },
    },
    {
      customer_name: "Alex Stone",
      phone: "+1 (416) 555-0101",
      email: "alex@example.com",
    },
    { dealership_id: 1 },
    { dealership_id: 1, now: "2026-03-30T14:00:00.000Z" }
  );

  assert.equal(result.created, true);
  assert.equal(result.reason, "conflicting_identity_match");
  assert.equal(result.needs_manual_review, true);
  assert.equal(createdPayload.assignment_method, "conflict_review");
  assert.equal(createdPayload.needs_manual_review, true);
});

test("missing phone and email create a low-confidence contact for manual review", async () => {
  let createdPayload = null;
  const result = await PostgresCrmDatabase.prototype.findOrCreateContactFromLead.call(
    {
      currentDealershipId() {
        return 1;
      },
      async findContactByNormalizedPhone() {
        return null;
      },
      async findContactByNormalizedEmail() {
        return null;
      },
      async getLegacyLeadForContactResolution() {
        return null;
      },
      async assignRepToNewContact() {
        return { assigned_rep_id: 3, assignment_method: "auto_round_robin", needs_manual_review: false };
      },
      async createContact(input) {
        createdPayload = input;
        return { id: 41, ...input };
      },
    },
    {
      customer_name: "",
      phone: "",
      email: "",
    },
    { dealership_id: 1 },
    { dealership_id: 1, now: "2026-03-30T14:00:00.000Z" }
  );

  assert.equal(result.created, true);
  assert.equal(result.reason, "missing_identity");
  assert.equal(result.needs_manual_review, true);
  assert.equal(createdPayload.needs_manual_review, true);
});

test("returning contact keeps the same assigned rep for new lead events", async () => {
  let insertParams = null;
  let assignContactCalled = false;
  const fakeDb = {
    currentDealershipId() {
      return 1;
    },
    async resolveLeadInventoryId() {
      return null;
    },
    normalizeLeadPayloadForStorage(input) {
      return input;
    },
    async findOrCreateContactFromLead() {
      return {
        created: false,
        reason: "normalized_phone",
        contact: {
          id: 8,
          assigned_rep_id: 12,
          needs_manual_review: false,
        },
      };
    },
    async assignContact() {
      assignContactCalled = true;
      return null;
    },
    async get(_sql, params) {
      insertParams = params;
      return { id: 501 };
    },
    async createActivity() {},
    async getApiLead(id) {
      return { id, contact_id: 8, assigned_to: 12 };
    },
  };

  const lead = await PostgresCrmDatabase.prototype.createApiLead.call(
    fakeDb,
    {
      source: "autotrader",
      customer_name: "Repeat Shopper",
      phone: "4165550101",
      email: "repeat@example.com",
      assigned_to: 99,
    },
    null,
    { returnDedupeMeta: true }
  );

  assert.equal(assignContactCalled, false);
  assert.equal(insertParams[1], 8);
  assert.equal(insertParams[4], 12);
  assert.equal(lead._dedupe.reason, "normalized_phone");
});

test("legacy matched contact without an owner gets auto-assigned on the next lead", async () => {
  let updatedPayload = null;
  const result = await PostgresCrmDatabase.prototype.findOrCreateContactFromLead.call(
    {
      currentDealershipId() {
        return 1;
      },
      async findContactByNormalizedPhone() {
        return {
          id: 31,
          first_name: "Taylor",
          last_name: "",
          email: null,
          phone: "4165550101",
          company: null,
          job_title: null,
          assigned_rep_id: null,
          assignment_method: "manual_unassigned",
          needs_manual_review: false,
          assignment_locked: false,
        };
      },
      async findContactByNormalizedEmail() {
        return null;
      },
      async assignRepToNewContact() {
        return {
          assigned_rep_id: 17,
          assignment_method: "auto_round_robin",
          needs_manual_review: false,
        };
      },
      async updateContact(id, payload) {
        updatedPayload = { id, payload };
        return {
          id,
          ...payload,
          assigned_rep_name: "Rep 17",
        };
      },
    },
    {
      customer_name: "Taylor",
      phone: "4165550101",
      email: "",
    },
    { dealership_id: 1 },
    { dealership_id: 1, now: "2026-03-30T14:00:00.000Z" }
  );

  assert.equal(updatedPayload.id, 31);
  assert.equal(updatedPayload.payload.assigned_rep_id, 17);
  assert.equal(updatedPayload.payload.assignment_method, "auto_round_robin");
  assert.equal(result.created, false);
  assert.equal(result.contact.assigned_rep_id, 17);
});

test("new contacts can be manually overridden at creation time and future ownership lives on the contact", async () => {
  let insertParams = null;
  let assignContactArgs = null;
  const fakeDb = {
    currentDealershipId() {
      return 1;
    },
    async resolveLeadInventoryId() {
      return null;
    },
    normalizeLeadPayloadForStorage(input) {
      return input;
    },
    async findOrCreateContactFromLead() {
      return {
        created: true,
        reason: "new_contact",
        contact: {
          id: 15,
          assigned_rep_id: 4,
          needs_manual_review: false,
        },
      };
    },
    async assignContact(contactId, assignedRepId, _user, options) {
      assignContactArgs = { contactId, assignedRepId, options };
      return {
        id: contactId,
        assigned_rep_id: assignedRepId,
        needs_manual_review: false,
      };
    },
    async get(_sql, params) {
      insertParams = params;
      return { id: 777 };
    },
    async createActivity() {},
    async getApiLead(id) {
      return { id, contact_id: 15, assigned_to: 33 };
    },
  };

  await PostgresCrmDatabase.prototype.createApiLead.call(
    fakeDb,
    {
      source: "website",
      customer_name: "Fresh Shopper",
      phone: "6475550101",
      assigned_to: 33,
    },
    { id: 2, dealership_id: 1 },
    { returnDedupeMeta: true }
  );

  assert.deepEqual(assignContactArgs, {
    contactId: 15,
    assignedRepId: 33,
    options: {
      assignment_method: "manual_override",
      needs_manual_review: false,
    },
  });
  assert.equal(insertParams[1], 15);
  assert.equal(insertParams[4], 33);
});

test("manager reassignment updates contact ownership metadata", async () => {
  const executeCalls = [];
  const result = await PostgresCrmDatabase.prototype.assignContact.call(
    {
      async getContact() {
        return { id: 44, dealership_id: 1 };
      },
      async getUser(id) {
        return { id, dealership_id: 1, role: "sales", name: "Reassigned Rep" };
      },
      async execute(_sql, params) {
        executeCalls.push(params);
      },
    },
    44,
    9,
    { dealership_id: 1 },
    { assignment_method: "manual_override", needs_manual_review: false }
  );

  assert.equal(executeCalls[0][0], 9);
  assert.equal(executeCalls[0][1], "manual_override");
  assert.equal(executeCalls[0][2], false);
  assert.equal(executeCalls[1][0], 9);
  assert.equal(executeCalls[1][2], 44);
  assert.deepEqual(result, { id: 44, dealership_id: 1 });
});

test("api lead formatting falls back to contact owner when the lead snapshot is empty", () => {
  const formatted = PostgresCrmDatabase.prototype.formatApiLead.call(
    {},
    {
      id: 12,
      dealership_id: 1,
      source: "website",
      status: "new",
      created_at: "2026-03-30T10:00:00.000Z",
      updated_at: "2026-03-30T10:00:00.000Z",
      customer_name: "Fallback Owner",
      phone: null,
      normalized_phone: null,
      email: null,
      normalized_email: null,
      vehicle_interest: null,
      vehicle_id: null,
      stock_number: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      vehicle_trim: null,
      vehicle_condition: null,
      vehicle_price: null,
      lead_type: null,
      listing_url: null,
      message: null,
      next_action: null,
      contact_id: 5,
      assigned_to: null,
      inventory_id: null,
      contact_first_name: "Fallback",
      contact_last_name: "Owner",
      contact_full_name: "Fallback Owner",
      contact_phone: null,
      contact_normalized_phone: null,
      contact_email: null,
      contact_normalized_email: null,
      contact_assigned_rep_id: 77,
      contact_assigned_rep_name: "Rep Fallback",
      contact_assignment_method: "auto_round_robin",
      contact_assignment_locked: false,
      contact_needs_manual_review: false,
      assigned_user_name: null,
      latest_activity_content: null,
      latest_activity_at: null,
    }
  );

  assert.equal(formatted.assigned_to, 77);
  assert.equal(formatted.assigned_user_name, "Rep Fallback");
});

test("backfillUnassignedContactOwners assigns legacy unowned contacts and syncs lead snapshots", async () => {
  const assignments = [];
  const result = await PostgresCrmDatabase.prototype.backfillUnassignedContactOwners.call(
    {
      currentDealershipId() {
        return 1;
      },
      contactSelectSql() {
        return "SELECT * FROM contacts";
      },
      async all() {
        return [
          {
            id: 101,
            dealership_id: 1,
            first_name: "Legacy",
            last_name: "Shopper",
            full_name: "Legacy Shopper",
            assigned_rep_id: null,
            assignment_method: "manual_unassigned",
            assignment_locked: false,
            needs_manual_review: false,
          },
        ];
      },
      formatContactRow(row) {
        return row;
      },
      async assignRepToNewContact() {
        return {
          assigned_rep_id: 45,
          assignment_method: "auto_round_robin",
          needs_manual_review: false,
        };
      },
      async assignContact(contactId, assignedRepId, _user, options) {
        assignments.push({ contactId, assignedRepId, options });
      },
      async get() {
        return { count: 3 };
      },
      async execute() {},
    },
    { dealership_id: 1 }
  );

  assert.deepEqual(assignments, [
    {
      contactId: 101,
      assignedRepId: 45,
      options: {
        assignment_method: "auto_round_robin",
        needs_manual_review: false,
      },
    },
  ]);
  assert.deepEqual(result, {
    contacts_assigned: 1,
    leads_updated: 3,
  });
});

test("bulk auto-assign links unassigned leads through contact ownership", async () => {
  const callLog = [];
  const result = await PostgresCrmDatabase.prototype.autoAssignApiLeads.call(
    {
      async getApiLead(id) {
        return {
          id,
          dealership_id: 1,
          contact_id: null,
          assigned_to: null,
          customer_name: "Bulk Shopper",
          phone: "4165550101",
          email: "bulk@example.com",
        };
      },
      async findOrCreateContactFromLead() {
        return {
          contact: {
            id: 200,
            assigned_rep_id: 19,
          },
        };
      },
      async linkLeadToContact(leadId, contactId, dealershipId, assignedRepId) {
        callLog.push({ leadId, contactId, dealershipId, assignedRepId });
      },
    },
    [901]
  );

  assert.deepEqual(callLog, [
    {
      leadId: 901,
      contactId: 200,
      dealershipId: 1,
      assignedRepId: 19,
    },
  ]);
  assert.deepEqual(result, {
    items: [
      {
        lead_id: 901,
        contact_id: 200,
        assigned_rep_id: 19,
        status: "assigned",
      },
    ],
    assigned_count: 1,
    skipped_count: 0,
  });
});
