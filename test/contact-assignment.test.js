const test = require("node:test");
const assert = require("node:assert/strict");

const { PostgresCrmDatabase } = require("../src/data/postgres");
const { evaluateRepAvailability } = require("../src/utils/repAvailability");

test("rep availability respects manual toggle and working hours", () => {
  const duringShift = new Date("2026-03-30T14:00:00.000Z");

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
      duringShift
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
      duringShift
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
      duringShift
    ).reason,
    "outside_working_day"
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
  let executeParams = null;
  const result = await PostgresCrmDatabase.prototype.assignContact.call(
    {
      async getContact() {
        return { id: 44, dealership_id: 1 };
      },
      async getUser(id) {
        return { id, dealership_id: 1, role: "sales", name: "Reassigned Rep" };
      },
      async execute(_sql, params) {
        executeParams = params;
      },
    },
    44,
    9,
    { dealership_id: 1 },
    { assignment_method: "manual_override", needs_manual_review: false }
  );

  assert.equal(executeParams[0], 9);
  assert.equal(executeParams[1], "manual_override");
  assert.equal(executeParams[2], false);
  assert.deepEqual(result, { id: 44, dealership_id: 1 });
});
