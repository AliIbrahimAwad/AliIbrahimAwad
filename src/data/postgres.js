const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const { getDefaultDealershipId } = require("../config/dealership");
const { DEFAULT_EXECUTION_SETTINGS, normalizeExecutionSettings } = require("../config/executionSettings");
const { categorizeOrganizedLead, evaluateLeadAttention } = require("../models/attention");
const { canTransitionLeadStatus, CRM_LEAD_STATUSES } = require("../models/leadStatus");
const {
  BaseCrmDatabase,
  DEALER_PIPELINE_STATUSES,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  fromStoredStatus,
  titleCaseStatus,
  toStoredStatus,
} = require("./core");
const { canViewAllLeads } = require("../models/user");
const { LEAD_ACTIVITY_TYPES } = require("../types/models");
const { normalizePhone } = require("../utils/phones");
const { toDateOnlyString } = require("../utils/dates");
const { buildCustomerNameFromParts, normalizeLeadCustomerName, splitCustomerNameParts } = require("../utils/leadNames");
const {
  DEFAULT_REP_TIMEZONE,
  DEFAULT_WORKING_DAYS,
  DEFAULT_WORKING_HOURS_END,
  DEFAULT_WORKING_HOURS_START,
  evaluateRepAvailability,
  normalizeRepAvailabilityInput,
} = require("../utils/repAvailability");

function normalizeLeadPhoneForStorage(value) {
  return normalizePhone(value) || null;
}

function normalizeLeadEmailForStorage(value) {
  return stringOrNull(value)?.toLowerCase() || null;
}

function normalizeAssignmentMethod(value, fallback = "auto_round_robin") {
  return stringOrNull(value)?.toLowerCase() || fallback;
}

function buildContactFullName(firstName = "", lastName = "", fallback = "NN Lead") {
  return buildCustomerNameFromParts(firstName, lastName, fallback);
}

function parseJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function plusHours(dateString, hours) {
  const date = new Date(dateString || Date.now());
  date.setHours(date.getHours() + Number(hours || 0));
  return date.toISOString();
}

function stringOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeInventoryIdentity(value) {
  return stringOrNull(value)?.toUpperCase() || null;
}

function normalizeComparableText(value) {
  return String(value || "").trim().toLowerCase();
}

function isWeakLeadName(value) {
  const normalized = normalizeComparableText(value);
  return (
    !normalized ||
    normalized.startsWith("lead #") ||
    normalized.includes("@") ||
    normalizeLeadCustomerName(value || "", "NN Lead").toLowerCase() === "nn lead"
  );
}

function isWeakLeadEmail(value) {
  const normalized = normalizeLeadEmailForStorage(value);
  return !normalized || normalized.startsWith("no-reply@") || normalized.startsWith("noreply@");
}

function isWeakLeadVehicle(value) {
  const normalized = normalizeComparableText(value);
  return !normalized || normalized === "vehicle inquiry";
}

function isWeakLeadMessage(value) {
  const normalized = normalizeComparableText(value);
  return (
    !normalized ||
    normalized === "vehicle inquiry" ||
    normalized.includes("requested a carfax canada report")
  );
}

function preferLeadValue(existingValue, incomingValue, options = {}) {
  const existing = stringOrNull(existingValue);
  const incoming = stringOrNull(incomingValue);
  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  if (typeof options.isWeak === "function") {
    const existingWeak = options.isWeak(existing);
    const incomingWeak = options.isWeak(incoming);
    if (existingWeak && !incomingWeak) {
      return incoming;
    }
    if (!existingWeak && incomingWeak) {
      return existing;
    }
  }

  if (options.preferLonger && incoming.length > existing.length) {
    return incoming;
  }

  return existing;
}

function buildMergedLeadInput(existingLead, incomingInput = {}) {
  const existingStatus = toStoredStatus(existingLead.status || "new");
  const incomingStatus = incomingInput.status ? toStoredStatus(incomingInput.status) : null;

  return {
    source: existingLead.source || incomingInput.source || "website",
    status: existingStatus === "new" && incomingStatus && incomingStatus !== "new" ? incomingStatus : existingStatus,
    assigned_to: existingLead.assigned_to || incomingInput.assigned_to || null,
    customer_name: preferLeadValue(existingLead.customer_name, incomingInput.customer_name, { isWeak: isWeakLeadName }),
    phone: preferLeadValue(existingLead.phone, incomingInput.phone),
    email: preferLeadValue(existingLead.email, incomingInput.email, { isWeak: isWeakLeadEmail }),
    vehicle_interest: preferLeadValue(existingLead.vehicle_interest, incomingInput.vehicle_interest, {
      isWeak: isWeakLeadVehicle,
    }),
    vehicle_id: preferLeadValue(existingLead.vehicle_id, incomingInput.vehicle_id),
    stock_number: preferLeadValue(existingLead.stock_number, incomingInput.stock_number),
    vehicle_year: preferLeadValue(existingLead.vehicle_year, incomingInput.vehicle_year),
    vehicle_make: preferLeadValue(existingLead.vehicle_make, incomingInput.vehicle_make),
    vehicle_model: preferLeadValue(existingLead.vehicle_model, incomingInput.vehicle_model),
    vehicle_trim: preferLeadValue(existingLead.vehicle_trim, incomingInput.vehicle_trim),
    vehicle_condition: preferLeadValue(existingLead.vehicle_condition, incomingInput.vehicle_condition),
    vehicle_price: preferLeadValue(existingLead.vehicle_price, incomingInput.vehicle_price),
    lead_type: preferLeadValue(existingLead.lead_type, incomingInput.lead_type),
    listing_url: preferLeadValue(existingLead.listing_url, incomingInput.listing_url),
    message: preferLeadValue(existingLead.message, incomingInput.message, {
      isWeak: isWeakLeadMessage,
      preferLonger: true,
    }),
    inventory_id: existingLead.inventory_id || incomingInput.inventory_id || null,
  };
}

function logLeadDedupeDecision(payload = {}) {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event: payload.event || "lead_dedupe_decision",
      ...payload,
    })
  );
}

function attachLeadDedupeMeta(lead, meta = null, options = {}) {
  if (!options.returnDedupeMeta || !meta) {
    return lead;
  }

  return {
    ...lead,
    _dedupe: meta,
  };
}

function isLeadIdentityUniqueConstraintError(error) {
  const message = String(error?.message || "").toLowerCase();
  const constraint = String(error?.constraint || "").toLowerCase();
  if (error?.code !== "23505") {
    return false;
  }

  return (
    constraint.includes("idx_leads_dealership_normalized_phone_unique") ||
    constraint.includes("idx_leads_dealership_normalized_email_unique") ||
    message.includes("idx_leads_dealership_normalized_phone_unique") ||
    message.includes("idx_leads_dealership_normalized_email_unique")
  );
}

function parseIntegerField(value) {
  if (value == null || value === "") {
    return null;
  }

  const digits = String(value).replace(/[^0-9.-]/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeInventoryStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (!normalized) {
    return "active";
  }

  if (["active", "inactive", "sold", "removed"].includes(normalized)) {
    return normalized;
  }

  if (["available", "instock", "in_stock", "in-stock"].includes(normalized)) {
    return "active";
  }

  if (["deleted", "archived"].includes(normalized)) {
    return "removed";
  }

  return "inactive";
}

function buildVehicleDisplay(input = {}) {
  return stringOrNull(
    [input.year, input.make, input.model, input.trim]
      .map((value) => stringOrNull(value))
      .filter(Boolean)
      .join(" ")
  );
}

function normalizeEmailIntakeClassification(value) {
  return String(value || "").trim().toLowerCase() === "direct_lead" ? "direct_lead" : "other";
}

function normalizeEmailIntakeStatus(classification, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (classification === "direct_lead") {
    return ["unassigned", "assigned", "contacted"].includes(normalized) ? normalized : "unassigned";
  }

  return ["open", "resolved", "converted_to_lead"].includes(normalized) ? normalized : "open";
}

function sanitizeSqlParam(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSqlParam(item));
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && String(value).trim().toLowerCase() === "nan") {
    return null;
  }

  return value;
}

function withPgPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

class PostgresCrmDatabase extends BaseCrmDatabase {
  static async initialize({ connectionString, ssl = false }) {
    const pool = new Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
    });

    const instance = new PostgresCrmDatabase({ pool });
    await instance.applyMigrations();
    await instance.seedDefaultUsers();
    return instance;
  }

  constructor({ pool }) {
    super();
    this.pool = pool;
  }

  async ensureOptionalUniqueIndex(indexName, sql) {
    const existing = await this.get("SELECT to_regclass(?) AS index_name", [`public.${indexName}`]);
    if (existing?.index_name) {
      return;
    }

    try {
      await this.execute(sql);
    } catch (error) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          event: "lead_identity_unique_index_skipped",
          index: indexName,
          error: String(error?.message || error),
        })
      );
    }
  }

  async close() {
    await this.pool.end();
  }

  save() {}

  async execute(sql, params = []) {
    await this.pool.query(withPgPlaceholders(sql), sanitizeSqlParam(params));
  }

  async get(sql, params = []) {
    const result = await this.pool.query(withPgPlaceholders(sql), sanitizeSqlParam(params));
    return result.rows[0] || null;
  }

  async all(sql, params = []) {
    const result = await this.pool.query(withPgPlaceholders(sql), sanitizeSqlParam(params));
    return result.rows;
  }

  async applyMigrations() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        working_days_json TEXT NOT NULL DEFAULT '["mon","tue","wed","thu","fri"]',
        working_hours_start TEXT NOT NULL DEFAULT '09:00',
        working_hours_end TEXT NOT NULL DEFAULT '18:00',
        timezone TEXT NOT NULL DEFAULT 'America/Toronto',
        max_active_leads INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL DEFAULT 'NN Lead',
        email TEXT,
        normalized_email TEXT,
        phone TEXT,
        normalized_phone TEXT,
        assigned_rep_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        assignment_method TEXT NOT NULL DEFAULT 'auto_round_robin',
        assignment_locked BOOLEAN NOT NULL DEFAULT FALSE,
        needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
        company TEXT,
        job_title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leads (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        priority TEXT,
        follow_up_date TEXT,
        next_action TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        customer_name TEXT,
        phone TEXT,
        normalized_phone TEXT,
        email TEXT,
        normalized_email TEXT,
        vehicle_interest TEXT,
        vehicle_id TEXT,
        stock_number TEXT,
        vehicle_year TEXT,
        vehicle_make TEXT,
        vehicle_model TEXT,
        vehicle_trim TEXT,
        vehicle_condition TEXT,
        vehicle_price TEXT,
        lead_type TEXT,
        listing_url TEXT,
        message TEXT
      );

      CREATE TABLE IF NOT EXISTS notes (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lead_activities (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activities (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS imported_messages (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        external_id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        lead_id BIGINT REFERENCES leads(id) ON DELETE SET NULL,
        subject TEXT,
        sender TEXT,
        received_at TEXT,
        status TEXT NOT NULL,
        matched_reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_intake_items (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        external_id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        subject TEXT,
        sender TEXT,
        message TEXT,
        received_at TEXT,
        classification TEXT NOT NULL DEFAULT 'other',
        status TEXT NOT NULL,
        assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
        lead_id BIGINT REFERENCES leads(id) ON DELETE SET NULL,
        customer_name TEXT,
        phone TEXT,
        normalized_phone TEXT,
        email TEXT,
        stock_number TEXT,
        inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL,
        vehicle_display TEXT,
        raw_payload_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        stock_number TEXT,
        vin TEXT,
        year INTEGER,
        make TEXT,
        model TEXT,
        trim TEXT,
        price BIGINT,
        mileage BIGINT,
        condition TEXT,
        body_style TEXT,
        drivetrain TEXT,
        transmission TEXT,
        engine TEXT,
        fuel_type TEXT,
        exterior_color TEXT,
        interior_color TEXT,
        date_in_stock TEXT,
        photos_json TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        source TEXT,
        source_file TEXT,
        last_seen_at TEXT,
        first_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_import_runs (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        source_type TEXT NOT NULL,
        source_name TEXT,
        file_name TEXT,
        status TEXT NOT NULL,
        rows_total INTEGER NOT NULL DEFAULT 0,
        rows_processed INTEGER NOT NULL DEFAULT 0,
        rows_inserted INTEGER NOT NULL DEFAULT 0,
        rows_updated INTEGER NOT NULL DEFAULT 0,
        rows_skipped INTEGER NOT NULL DEFAULT 0,
        rows_deactivated INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        metadata_json TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_import_errors (
        id BIGSERIAL PRIMARY KEY,
        import_run_id BIGINT NOT NULL REFERENCES inventory_import_runs(id) ON DELETE CASCADE,
        row_number INTEGER,
        stock_number TEXT,
        vin TEXT,
        raw_identifier TEXT,
        error_message TEXT NOT NULL,
        raw_row_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        source TEXT NOT NULL DEFAULT 'manual',
        unique_key TEXT UNIQUE,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        dealership_id BIGINT NOT NULL DEFAULT 1,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lead_id BIGINT REFERENCES leads(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'unread',
        unique_key TEXT UNIQUE,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        read_at TEXT
      );

      CREATE TABLE IF NOT EXISTS crm_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS dealership_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dealership_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS dealership_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS dealership_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE lead_activities ADD COLUMN IF NOT EXISTS dealership_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS dealership_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE imported_messages ADD COLUMN IF NOT EXISTS dealership_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_name TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS normalized_phone TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS normalized_email TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_interest TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_id TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS stock_number TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_year TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_trim TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_condition TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_price TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_type TEXT;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS listing_url TEXT;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS message TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS normalized_phone TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT 'NN Lead';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS normalized_email TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_rep_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assignment_method TEXT NOT NULL DEFAULT 'auto_round_robin';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assignment_locked BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS working_days_json TEXT NOT NULL DEFAULT '["mon","tue","wed","thu","fri"]';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS working_hours_start TEXT NOT NULL DEFAULT '09:00';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS working_hours_end TEXT NOT NULL DEFAULT '18:00';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS max_active_leads INTEGER;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS drivetrain TEXT;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS transmission TEXT;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS engine TEXT;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS fuel_type TEXT;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS date_in_stock TEXT;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS photos_json TEXT;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE inventory ADD COLUMN IF NOT EXISTS first_seen_at TEXT;
      ALTER TABLE inventory_import_runs ADD COLUMN IF NOT EXISTS rows_processed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inventory_import_runs ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inventory_import_runs ADD COLUMN IF NOT EXISTS metadata_json TEXT;
      ALTER TABLE inventory_import_errors ADD COLUMN IF NOT EXISTS raw_identifier TEXT;

      CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone ON leads(normalized_phone);
      CREATE INDEX IF NOT EXISTS idx_leads_normalized_email ON leads(normalized_email);
      CREATE INDEX IF NOT EXISTS idx_leads_inventory_id ON leads(inventory_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_normalized_phone ON contacts(normalized_phone);
      CREATE INDEX IF NOT EXISTS idx_contacts_normalized_email ON contacts(normalized_email);
      CREATE INDEX IF NOT EXISTS idx_contacts_assigned_rep_id ON contacts(assigned_rep_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_sales_availability ON users(dealership_id, role, is_active, is_available);
      CREATE INDEX IF NOT EXISTS idx_activities_lead_id_created_at ON activities(lead_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_imported_messages_external_id ON imported_messages(external_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_dealership_id ON inventory(dealership_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_stock_number ON inventory(stock_number);
      CREATE INDEX IF NOT EXISTS idx_inventory_vin ON inventory(vin);
      CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_is_active ON inventory(dealership_id, is_active, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_make_model ON inventory(make, model);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_dealership_stock_number
        ON inventory(dealership_id, stock_number)
        WHERE stock_number IS NOT NULL AND BTRIM(stock_number) <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_dealership_vin
        ON inventory(dealership_id, vin)
        WHERE vin IS NOT NULL AND BTRIM(vin) <> '';
      CREATE INDEX IF NOT EXISTS idx_inventory_import_runs_dealership_started_at
        ON inventory_import_runs(dealership_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_import_errors_run_id
        ON inventory_import_errors(import_run_id, row_number);
      CREATE INDEX IF NOT EXISTS idx_email_intake_items_class_status_received
        ON email_intake_items(dealership_id, classification, status, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_email_intake_items_assigned_to
        ON email_intake_items(assigned_to, status, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_email_intake_items_lead_id
        ON email_intake_items(lead_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due_at ON tasks(user_id, status, due_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_lead_status_due_at ON tasks(lead_id, status, due_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created_at ON notifications(user_id, status, created_at DESC);
    `);

    const dealershipId = getDefaultDealershipId();
    await this.execute("UPDATE leads SET status = 'new' WHERE status IS NULL OR TRIM(status) = ''");
    await this.execute("UPDATE leads SET status = 'appointment' WHERE status = 'qualified'");
    await this.execute("UPDATE leads SET status = 'negotiation' WHERE status = 'proposal'");
    await this.execute("UPDATE leads SET status = 'won' WHERE status = 'sold'");
    await this.execute("UPDATE leads SET source = 'manual' WHERE source IS NULL OR TRIM(source) = ''");
    await this.execute("UPDATE users SET dealership_id = ? WHERE dealership_id IS NULL", [dealershipId]);
    await this.execute("UPDATE contacts SET dealership_id = ? WHERE dealership_id IS NULL", [dealershipId]);
    await this.execute("UPDATE leads SET dealership_id = ? WHERE dealership_id IS NULL", [dealershipId]);
    await this.execute("UPDATE notes SET dealership_id = ? WHERE dealership_id IS NULL", [dealershipId]);
    await this.execute("UPDATE lead_activities SET dealership_id = ? WHERE dealership_id IS NULL", [dealershipId]);
    await this.execute("UPDATE activities SET dealership_id = ? WHERE dealership_id IS NULL", [dealershipId]);
    await this.execute("UPDATE imported_messages SET dealership_id = ? WHERE dealership_id IS NULL", [dealershipId]);
    await this.execute("UPDATE users SET is_active = TRUE WHERE is_active IS NULL");
    await this.execute("UPDATE users SET is_available = TRUE WHERE is_available IS NULL");
    await this.execute("UPDATE users SET working_days_json = ? WHERE working_days_json IS NULL OR BTRIM(working_days_json) = ''", [
      JSON.stringify(DEFAULT_WORKING_DAYS),
    ]);
    await this.execute(
      "UPDATE users SET working_hours_start = ? WHERE working_hours_start IS NULL OR BTRIM(working_hours_start) = ''",
      [DEFAULT_WORKING_HOURS_START]
    );
    await this.execute(
      "UPDATE users SET working_hours_end = ? WHERE working_hours_end IS NULL OR BTRIM(working_hours_end) = ''",
      [DEFAULT_WORKING_HOURS_END]
    );
    await this.execute("UPDATE users SET timezone = ? WHERE timezone IS NULL OR BTRIM(timezone) = ''", [DEFAULT_REP_TIMEZONE]);
    await this.execute(
      "UPDATE inventory SET is_active = CASE WHEN status = 'active' THEN TRUE ELSE FALSE END WHERE is_active IS NULL",
      []
    );
    await this.execute("UPDATE inventory SET first_seen_at = created_at WHERE first_seen_at IS NULL", []);
    await this.execute(
      `
        INSERT INTO lead_activities (dealership_id, lead_id, user_id, type, content, created_at)
        SELECT activities.dealership_id, activities.lead_id, NULL, activities.type, activities.content, activities.created_at
        FROM activities
        LEFT JOIN lead_activities
          ON lead_activities.dealership_id = activities.dealership_id
         AND lead_activities.lead_id = activities.lead_id
         AND lead_activities.user_id IS NULL
         AND lead_activities.type = activities.type
         AND lead_activities.content = activities.content
         AND lead_activities.created_at = activities.created_at
        WHERE lead_activities.id IS NULL
      `
    );

    const leadPhones = await this.all("SELECT id, phone FROM leads WHERE phone IS NOT NULL AND TRIM(phone) <> ''");
    for (const lead of leadPhones) {
      await this.execute("UPDATE leads SET normalized_phone = ? WHERE id = ?", [
        normalizePhone(lead.phone) || null,
        lead.id,
      ]);
    }

    await this.execute("UPDATE leads SET normalized_email = ? WHERE email IS NULL OR BTRIM(email) = ''", [null]);
    const leadEmails = await this.all("SELECT id, email FROM leads WHERE email IS NOT NULL AND BTRIM(email) <> ''");
    for (const lead of leadEmails) {
      await this.execute("UPDATE leads SET normalized_email = ? WHERE id = ?", [
        normalizeLeadEmailForStorage(lead.email),
        lead.id,
      ]);
    }

    const contactPhones = await this.all(
      "SELECT id, phone FROM contacts WHERE phone IS NOT NULL AND TRIM(phone) <> ''"
    );
    for (const contact of contactPhones) {
      await this.execute("UPDATE contacts SET normalized_phone = ? WHERE id = ?", [
        normalizePhone(contact.phone) || null,
        contact.id,
      ]);
    }
    await this.execute("UPDATE contacts SET normalized_email = ? WHERE email IS NULL OR BTRIM(email) = ''", [null]);
    const contactEmails = await this.all(
      "SELECT id, email, first_name, last_name FROM contacts"
    );
    for (const contact of contactEmails) {
      await this.execute(
        "UPDATE contacts SET normalized_email = ?, full_name = ? WHERE id = ?",
        [
          normalizeLeadEmailForStorage(contact.email),
          buildContactFullName(contact.first_name, contact.last_name),
          contact.id,
        ]
      );
    }

    await this.execute("DROP INDEX IF EXISTS idx_leads_dealership_normalized_phone_unique");
    await this.execute("DROP INDEX IF EXISTS idx_leads_dealership_normalized_email_unique");
  }

  async seedDefaultUsers() {
    const dealershipId = getDefaultDealershipId();
    const row = await this.get("SELECT COUNT(*) AS count FROM users");
    if (Number(row.count) > 0) {
      return;
    }

    const defaults = [
      {
        name: "CRM Admin",
        email: "admin@crm.local",
        password: process.env.CRM_ADMIN_PASSWORD || "admin123",
        role: "admin",
      },
      {
        name: "CRM Manager",
        email: "manager@crm.local",
        password: process.env.CRM_MANAGER_PASSWORD || "manager123",
        role: "manager",
      },
      {
        name: "CRM Sales",
        email: "sales@crm.local",
        password: process.env.CRM_SALES_PASSWORD || "sales123",
        role: "sales",
      },
    ];

    for (const user of defaults) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      await this.execute(
        `
          INSERT INTO users (dealership_id, name, email, password_hash, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [dealershipId, user.name, user.email.toLowerCase(), passwordHash, user.role, new Date().toISOString()]
      );
    }
  }

  accessClauseForUser(user, alias = "leads") {
    const params = [this.currentDealershipId(user)];
    let clause = `${alias}.dealership_id = ?`;

    if (user && !canViewAllLeads(user)) {
      clause += ` AND ${alias}.assigned_to = ?`;
      params.push(user.id);
    }

    return { clause, params };
  }

  currentDealershipId(user = null) {
    return parsePositiveInteger(user?.dealership_id) || getDefaultDealershipId();
  }

  async getDealershipIdForLead(leadId) {
    if (!leadId) {
      return null;
    }

    const row = await this.get("SELECT dealership_id FROM leads WHERE id = ?", [leadId]);
    return row ? parsePositiveInteger(row.dealership_id) || getDefaultDealershipId() : null;
  }

  async getDealershipIdForUser(userId) {
    if (!userId) {
      return null;
    }

    const row = await this.get("SELECT dealership_id FROM users WHERE id = ?", [userId]);
    return row ? parsePositiveInteger(row.dealership_id) || getDefaultDealershipId() : null;
  }

  async resolveDealershipIdContext({ dealership_id = null, lead_id = null, user_id = null, user = null } = {}) {
    return (
      parsePositiveInteger(dealership_id) ||
      parsePositiveInteger(user?.dealership_id) ||
      (await this.getDealershipIdForLead(lead_id)) ||
      (await this.getDealershipIdForUser(user_id)) ||
      getDefaultDealershipId()
    );
  }

  contactOrderSql() {
    return `
      ORDER BY
        CASE WHEN TRIM(first_name || ' ' || last_name) = '' THEN 1 ELSE 0 END,
        LOWER(TRIM(first_name || ' ' || last_name)) ASC,
        id DESC
    `;
  }

  leadSelectSql() {
    return `
      SELECT
        leads.id,
        leads.dealership_id,
        leads.contact_id,
        leads.assigned_to,
        leads.source,
        leads.status,
        leads.priority,
        leads.follow_up_date,
        leads.next_action,
        leads.created_at,
        leads.updated_at,
        contacts.phone AS contact_phone,
        CASE
          WHEN TRIM(contacts.first_name || ' ' || contacts.last_name) <> '' THEN TRIM(contacts.first_name || ' ' || contacts.last_name)
          WHEN contacts.company IS NOT NULL AND TRIM(contacts.company) <> '' THEN contacts.company
          WHEN contacts.email IS NOT NULL AND TRIM(contacts.email) <> '' THEN contacts.email
          WHEN contacts.phone IS NOT NULL AND TRIM(contacts.phone) <> '' THEN contacts.phone
          ELSE 'Lead #' || leads.id
        END AS display_name,
        sales_user.name AS assigned_user_name
      FROM leads
      LEFT JOIN contacts
        ON contacts.id = leads.contact_id
       AND contacts.dealership_id = leads.dealership_id
      LEFT JOIN users AS sales_user
        ON sales_user.id = leads.assigned_to
       AND sales_user.dealership_id = leads.dealership_id
    `;
  }

  activitySelectSql() {
    return `
      SELECT
        lead_activities.id,
        lead_activities.lead_id,
        lead_activities.user_id,
        lead_activities.type,
        lead_activities.content,
        lead_activities.created_at,
        users.name AS actor_name,
        CASE
          WHEN TRIM(contacts.first_name || ' ' || contacts.last_name) <> '' THEN TRIM(contacts.first_name || ' ' || contacts.last_name)
          WHEN contacts.company IS NOT NULL AND TRIM(contacts.company) <> '' THEN contacts.company
          WHEN contacts.email IS NOT NULL AND TRIM(contacts.email) <> '' THEN contacts.email
          WHEN contacts.phone IS NOT NULL AND TRIM(contacts.phone) <> '' THEN contacts.phone
          ELSE 'Lead #' || leads.id
        END AS lead_name
      FROM lead_activities
      INNER JOIN leads
        ON leads.id = lead_activities.lead_id
       AND leads.dealership_id = lead_activities.dealership_id
      LEFT JOIN contacts
        ON contacts.id = leads.contact_id
       AND contacts.dealership_id = leads.dealership_id
      LEFT JOIN users
        ON users.id = lead_activities.user_id
       AND users.dealership_id = lead_activities.dealership_id
    `;
  }

  apiLeadSelectSql() {
    return `
      SELECT
        leads.id,
        leads.dealership_id,
        leads.source,
        leads.status,
        leads.created_at,
        leads.updated_at,
        leads.customer_name,
        leads.phone,
        leads.normalized_phone,
        leads.email,
        leads.vehicle_interest,
        leads.vehicle_id,
        leads.stock_number,
        leads.vehicle_year,
        leads.vehicle_make,
        leads.vehicle_model,
        leads.vehicle_trim,
        leads.vehicle_condition,
        leads.vehicle_price,
        leads.lead_type,
        leads.listing_url,
        leads.message,
        leads.next_action,
        leads.contact_id,
        leads.assigned_to,
        leads.inventory_id,
        contacts.first_name AS contact_first_name,
        contacts.last_name AS contact_last_name,
        contacts.full_name AS contact_full_name,
        contacts.phone AS contact_phone,
        contacts.normalized_phone AS contact_normalized_phone,
        contacts.email AS contact_email,
        contacts.normalized_email AS contact_normalized_email,
        contacts.assigned_rep_id AS contact_assigned_rep_id,
        contact_rep.name AS contact_assigned_rep_name,
        contacts.assignment_method AS contact_assignment_method,
        contacts.assignment_locked AS contact_assignment_locked,
        contacts.needs_manual_review AS contact_needs_manual_review,
        inventory.stock_number AS inventory_stock_number,
        inventory.vin AS inventory_vin,
        inventory.year AS inventory_year,
        inventory.make AS inventory_make,
        inventory.model AS inventory_model,
        inventory.trim AS inventory_trim,
        inventory.price AS inventory_price,
        inventory.status AS inventory_status,
        CASE
          WHEN leads.customer_name IS NOT NULL AND TRIM(leads.customer_name) <> '' THEN TRIM(leads.customer_name)
          WHEN TRIM(contacts.first_name || ' ' || contacts.last_name) <> '' THEN TRIM(contacts.first_name || ' ' || contacts.last_name)
          WHEN contacts.company IS NOT NULL AND TRIM(contacts.company) <> '' THEN contacts.company
          WHEN leads.email IS NOT NULL AND TRIM(leads.email) <> '' THEN leads.email
          WHEN contacts.email IS NOT NULL AND TRIM(contacts.email) <> '' THEN contacts.email
          WHEN leads.phone IS NOT NULL AND TRIM(leads.phone) <> '' THEN leads.phone
          WHEN contacts.phone IS NOT NULL AND TRIM(contacts.phone) <> '' THEN contacts.phone
          ELSE 'Lead #' || leads.id
        END AS display_name,
        sales_user.name AS assigned_user_name,
        (
          SELECT content
          FROM lead_activities
          WHERE lead_activities.lead_id = leads.id
            AND lead_activities.dealership_id = leads.dealership_id
          ORDER BY lead_activities.created_at DESC, lead_activities.id DESC
          LIMIT 1
        ) AS latest_activity_content,
        (
          SELECT created_at
          FROM lead_activities
          WHERE lead_activities.lead_id = leads.id
            AND lead_activities.dealership_id = leads.dealership_id
          ORDER BY lead_activities.created_at DESC, lead_activities.id DESC
          LIMIT 1
        ) AS latest_activity_at
      FROM leads
      LEFT JOIN contacts
        ON contacts.id = leads.contact_id
       AND contacts.dealership_id = leads.dealership_id
      LEFT JOIN users AS contact_rep
        ON contact_rep.id = contacts.assigned_rep_id
       AND contact_rep.dealership_id = leads.dealership_id
      LEFT JOIN inventory ON inventory.id = leads.inventory_id AND inventory.dealership_id = leads.dealership_id
      LEFT JOIN users AS sales_user ON sales_user.id = leads.assigned_to
    `;
  }

  formatApiLead(row) {
    const status = fromStoredStatus(row.status);
    const customerName = row.customer_name || row.display_name || `Lead #${row.id}`;
    const phone = row.phone || row.contact_phone || null;
    const email = row.email || row.contact_email || null;
    const message = row.message || row.latest_activity_content || "";

    return {
      id: Number(row.id),
      dealership_id: Number(row.dealership_id || getDefaultDealershipId()),
      source: row.source || "manual",
      customer_name: customerName,
      contact_id: row.contact_id == null ? null : Number(row.contact_id),
      assigned_to: row.assigned_to == null ? null : Number(row.assigned_to),
      inventory_id: row.inventory_id == null ? null : Number(row.inventory_id),
      phone,
      normalized_phone: row.normalized_phone || row.contact_normalized_phone || null,
      email,
      normalized_email: row.normalized_email || row.contact_normalized_email || null,
      vehicle_interest: row.vehicle_interest || row.next_action || "Vehicle inquiry",
      vehicle_id: row.vehicle_id || null,
      stock_number: row.stock_number || null,
      vehicle_year: row.vehicle_year || null,
      vehicle_make: row.vehicle_make || null,
      vehicle_model: row.vehicle_model || null,
      vehicle_trim: row.vehicle_trim || null,
      vehicle_condition: row.vehicle_condition || null,
      vehicle_price: row.vehicle_price || null,
      lead_type: row.lead_type || null,
      listing_url: row.listing_url || null,
      message,
      message_preview: message ? String(message).slice(0, 140) : "",
      status,
      status_label: titleCaseStatus(status === "new" ? "new lead" : status),
      assigned_user_name: row.assigned_user_name || "Unassigned",
      created_at: row.created_at,
      updated_at: row.updated_at,
      latest_activity_at: row.latest_activity_at || row.updated_at,
      contact:
        row.contact_id == null
          ? null
          : {
              id: Number(row.contact_id),
              first_name: row.contact_first_name || "",
              last_name: row.contact_last_name || "",
              full_name: row.contact_full_name || buildContactFullName(row.contact_first_name, row.contact_last_name),
              phone: row.contact_phone || null,
              normalized_phone: row.contact_normalized_phone || null,
              email: row.contact_email || null,
              normalized_email: row.contact_normalized_email || null,
              assigned_rep_id: row.contact_assigned_rep_id == null ? null : Number(row.contact_assigned_rep_id),
              assigned_rep_name: row.contact_assigned_rep_name || "Unassigned",
              assignment_method: row.contact_assignment_method || null,
              assignment_locked:
                row.contact_assignment_locked === true ||
                row.contact_assignment_locked === "t" ||
                row.contact_assignment_locked === 1,
              needs_manual_review:
                row.contact_needs_manual_review === true ||
                row.contact_needs_manual_review === "t" ||
                row.contact_needs_manual_review === 1,
            },
      inventory:
        row.inventory_id == null
          ? null
          : {
              id: Number(row.inventory_id),
              stock_number: row.inventory_stock_number || null,
              vin: row.inventory_vin || null,
              year: row.inventory_year == null ? null : Number(row.inventory_year),
              make: row.inventory_make || null,
              model: row.inventory_model || null,
              trim: row.inventory_trim || null,
              price: row.inventory_price == null ? null : Number(row.inventory_price),
              status: row.inventory_status || null,
            },
    };
  }

  formatInventoryRow(row) {
    return {
      id: Number(row.id),
      dealership_id: Number(row.dealership_id),
      stock_number: row.stock_number || null,
      vin: row.vin || null,
      year: row.year == null ? null : Number(row.year),
      make: row.make || null,
      model: row.model || null,
      trim: row.trim || null,
      price: row.price == null ? null : Number(row.price),
      mileage: row.mileage == null ? null : Number(row.mileage),
      condition: row.condition || null,
      body_style: row.body_style || null,
      drivetrain: row.drivetrain || null,
      transmission: row.transmission || null,
      engine: row.engine || null,
      fuel_type: row.fuel_type || null,
      exterior_color: row.exterior_color || null,
      interior_color: row.interior_color || null,
      date_in_stock: row.date_in_stock || null,
      photos_json: row.photos_json || null,
      status: row.status || "active",
      is_active: row.is_active !== false && row.is_active !== "f" && row.is_active !== 0,
      source: row.source || null,
      source_file: row.source_file || null,
      last_seen_at: row.last_seen_at || null,
      first_seen_at: row.first_seen_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  formatUserRow(row) {
    if (!row) {
      return null;
    }

    const availability = normalizeRepAvailabilityInput({
      is_active: row.is_active,
      is_available: row.is_available,
      working_days: row.working_days_json,
      working_hours_start: row.working_hours_start,
      working_hours_end: row.working_hours_end,
      timezone: row.timezone,
      max_active_leads: row.max_active_leads,
    });

    return {
      id: Number(row.id),
      dealership_id: Number(row.dealership_id || getDefaultDealershipId()),
      name: row.name,
      email: row.email,
      password_hash: row.password_hash,
      role: row.role,
      is_active: availability.is_active,
      is_available: availability.is_available,
      working_days: availability.working_days,
      working_hours_start: availability.working_hours_start,
      working_hours_end: availability.working_hours_end,
      timezone: availability.timezone,
      max_active_leads: availability.max_active_leads,
      created_at: row.created_at,
    };
  }

  async listUsers(user = null) {
    const rows = await this.all(
      `
        SELECT
          id,
          dealership_id,
          name,
          email,
          role,
          is_active,
          is_available,
          working_days_json,
          working_hours_start,
          working_hours_end,
          timezone,
          max_active_leads,
          created_at
        FROM users
        WHERE dealership_id = ?
        ORDER BY
          CASE role
            WHEN 'admin' THEN 1
            WHEN 'manager' THEN 2
            ELSE 3
          END,
          LOWER(name) ASC
      `,
      [this.currentDealershipId(user)]
    );
    return rows.map((row) => this.formatUserRow(row));
  }

  async getUser(id) {
    const row = await this.get(
      `
        SELECT
          id,
          dealership_id,
          name,
          email,
          password_hash,
          role,
          is_active,
          is_available,
          working_days_json,
          working_hours_start,
          working_hours_end,
          timezone,
          max_active_leads,
          created_at
        FROM users
        WHERE id = ?
      `,
      [id]
    );

    if (!row) {
      throw new NotFoundError("User not found");
    }

    return this.formatUserRow(row);
  }

  async getUserByEmail(email) {
    const row = await this.get(
      `
        SELECT
          id,
          dealership_id,
          name,
          email,
          password_hash,
          role,
          is_active,
          is_available,
          working_days_json,
          working_hours_start,
          working_hours_end,
          timezone,
          max_active_leads,
          created_at
        FROM users
        WHERE LOWER(email) = LOWER(?)
      `,
      [email]
    );
    return this.formatUserRow(row);
  }

  async authenticateUser(email, password) {
    const user = await this.getUserByEmail(email);
    if (!user) {
      throw new UnauthorizedError("Invalid email or password.");
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      throw new UnauthorizedError("Invalid email or password.");
    }

    return user;
  }

  async listApiLeads({ limit = 100, offset = 0, status = "", search = "" } = {}, user = null) {
    const access = this.accessClauseForUser(user);
    const filters = [access.clause];
    const params = [...access.params];

    const storedStatus = toStoredStatus(status);
    if (storedStatus && DEALER_PIPELINE_STATUSES.includes(fromStoredStatus(storedStatus))) {
      filters.push("leads.status = ?");
      params.push(storedStatus);
    }

    if (String(search || "").trim()) {
      const term = `%${String(search).trim().toLowerCase()}%`;
      filters.push(`
        (
          LOWER(COALESCE(leads.customer_name, '')) LIKE ?
          OR LOWER(COALESCE(leads.phone, '')) LIKE ?
          OR LOWER(COALESCE(leads.email, '')) LIKE ?
          OR LOWER(COALESCE(leads.vehicle_interest, '')) LIKE ?
          OR LOWER(COALESCE(leads.message, '')) LIKE ?
        )
      `);
      params.push(term, term, term, term, term);
    }

    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const countRow = await this.get(
      `
        SELECT COUNT(*) AS count
        FROM leads
        LEFT JOIN contacts ON contacts.id = leads.contact_id
        WHERE ${filters.join(" AND ")}
      `,
      params
    );

    const rows = await this.all(
      `
        ${this.apiLeadSelectSql()}
        WHERE ${filters.join(" AND ")}
        ORDER BY leads.created_at DESC, leads.id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, safeLimit, safeOffset]
    );

    return {
      items: rows.map((row) => this.formatApiLead(row)),
      total: Number(countRow.count),
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  async getApiLead(id, user = null) {
    const access = this.accessClauseForUser(user);
    const row = await this.get(
      `
        ${this.apiLeadSelectSql()}
        WHERE leads.id = ? AND ${access.clause}
      `,
      [id, ...access.params]
    );

    if (!row) {
      throw new NotFoundError("Lead not found");
    }

    return this.formatApiLead(row);
  }

  async listLeadActivitiesForApi(leadId) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      return [];
    }

    const rows = await this.all(
      `
        SELECT
          lead_activities.id,
          lead_activities.lead_id,
          lead_activities.user_id,
          lead_activities.type,
          lead_activities.content,
          lead_activities.created_at,
          users.name AS actor_name
        FROM lead_activities
        LEFT JOIN users
          ON users.id = lead_activities.user_id
         AND users.dealership_id = lead_activities.dealership_id
        WHERE lead_activities.lead_id = ?
          AND lead_activities.dealership_id = ?
        ORDER BY lead_activities.created_at DESC, lead_activities.id DESC
      `,
      [leadId, dealershipId]
    );

    return rows.map((row) => ({
      id: Number(row.id),
      lead_id: Number(row.lead_id),
      user_id: row.user_id == null ? null : Number(row.user_id),
      actor_name: row.actor_name || null,
      type: row.type,
      content: row.content,
      created_at: row.created_at,
    }));
  }

  async recordLeadStatusAudit({
    lead_id,
    user_id = null,
    previous_status = null,
    new_status,
    confidence = null,
    reasoning_summary = null,
    source = "manual_status_update",
    auto_applied = false,
    recommendation_only = false,
    created_at = null,
  }) {
    const timestamp = created_at || new Date().toISOString();
    const dealershipId = await this.resolveDealershipIdContext({ lead_id, user_id });

    await this.execute(
      `
        INSERT INTO lead_status_audits (
          id,
          dealership_id,
          lead_id,
          user_id,
          previous_status,
          new_status,
          confidence,
          reasoning_summary,
          source,
          auto_applied,
          recommendation_only,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `statusaudit_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
        dealershipId,
        lead_id,
        user_id,
        previous_status,
        new_status,
        confidence,
        reasoning_summary,
        source,
        auto_applied ? 1 : 0,
        recommendation_only ? 1 : 0,
        timestamp,
      ]
    );
  }

  async listLeadStatusAuditsForApi(leadId) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      return [];
    }

    const rows = await this.all(
      `
        SELECT
          audits.id,
          audits.lead_id,
          audits.user_id,
          audits.previous_status,
          audits.new_status,
          audits.confidence,
          audits.reasoning_summary,
          audits.source,
          audits.auto_applied,
          audits.recommendation_only,
          audits.created_at,
          users.name AS actor_name
        FROM lead_status_audits AS audits
        LEFT JOIN users ON users.id = audits.user_id AND users.dealership_id = audits.dealership_id
        WHERE audits.lead_id = ?
          AND audits.dealership_id = ?
        ORDER BY audits.created_at DESC, audits.id DESC
      `,
      [leadId, dealershipId]
    );

    return rows.map((row) => ({
      id: String(row.id),
      lead_id: Number(row.lead_id),
      user_id: row.user_id == null ? null : Number(row.user_id),
      actor_name: row.actor_name || null,
      previous_status: row.previous_status || null,
      new_status: row.new_status || null,
      confidence: row.confidence == null ? null : Number(row.confidence),
      reasoning_summary: row.reasoning_summary || null,
      source: row.source,
      auto_applied: Boolean(row.auto_applied),
      recommendation_only: Boolean(row.recommendation_only),
      created_at: row.created_at,
    }));
  }

  async listLeadMessagesForApi(leadId) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      return [];
    }

    const rows = await this.all(
      `
        SELECT
          lead_messages.id,
          lead_messages.lead_id,
          lead_messages.direction,
          lead_messages.from_number,
          lead_messages.to_number,
          lead_messages.external_number,
          lead_messages.body_text,
          lead_messages.message_status,
          lead_messages.sent_at,
          lead_messages.received_at,
          lead_messages.crm_user_id,
          lead_messages.provider_extension_id,
          users.name AS actor_name
        FROM lead_messages
        LEFT JOIN users ON users.id = lead_messages.crm_user_id AND users.dealership_id = lead_messages.dealership_id
        WHERE lead_messages.lead_id = ?
          AND lead_messages.dealership_id = ?
        ORDER BY COALESCE(lead_messages.received_at, lead_messages.sent_at, lead_messages.created_at) DESC, lead_messages.id DESC
      `,
      [leadId, dealershipId]
    );

    return rows.map((row) => ({
      id: String(row.id),
      lead_id: Number(row.lead_id),
      direction: row.direction || "unknown",
      from_number: row.from_number || null,
      to_number: row.to_number || null,
      external_number: row.external_number || null,
      body_text: row.body_text || "",
      message_status: row.message_status || null,
      crm_user_id: row.crm_user_id == null ? null : Number(row.crm_user_id),
      provider_extension_id: row.provider_extension_id || null,
      actor_name: row.actor_name || null,
      happened_at: row.received_at || row.sent_at || null,
    }));
  }

  async listLeadCallsForApi(leadId) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      return [];
    }

    const rows = await this.all(
      `
        SELECT
          lead_calls.id,
          lead_calls.lead_id,
          lead_calls.direction,
          lead_calls.from_number,
          lead_calls.to_number,
          lead_calls.external_number,
          lead_calls.result,
          lead_calls.action,
          lead_calls.duration_seconds,
          lead_calls.start_time,
          lead_calls.end_time,
          lead_calls.crm_user_id,
          lead_calls.provider_extension_id,
          lead_calls.recording_status,
          lead_calls.transcript_status,
          call_recordings.provider_recording_id,
          call_recordings.content_uri,
          analyses.summary AS ai_summary,
          analyses.intent AS ai_intent,
          analyses.objections AS ai_objections,
          analyses.next_task AS ai_next_task,
          analyses.confidence AS ai_confidence,
          analyses.reasoning_summary AS ai_reasoning_summary,
          users.name AS actor_name
        FROM lead_calls
        LEFT JOIN call_recordings
          ON call_recordings.lead_call_id = lead_calls.id
         AND call_recordings.dealership_id = lead_calls.dealership_id
        LEFT JOIN communication_ai_analyses AS analyses
          ON analyses.source_type = 'call'
         AND analyses.source_id = lead_calls.id
         AND analyses.dealership_id = lead_calls.dealership_id
        LEFT JOIN users ON users.id = lead_calls.crm_user_id AND users.dealership_id = lead_calls.dealership_id
        WHERE lead_calls.lead_id = ?
          AND lead_calls.dealership_id = ?
        ORDER BY lead_calls.start_time DESC, lead_calls.id DESC
      `,
      [leadId, dealershipId]
    );

    const seen = new Set();
    return rows
      .filter((row) => {
        if (seen.has(String(row.id))) {
          return false;
        }
        seen.add(String(row.id));
        return true;
      })
      .map((row) => ({
        id: String(row.id),
        lead_id: Number(row.lead_id),
        direction: row.direction || "unknown",
        from_number: row.from_number || null,
        to_number: row.to_number || null,
        external_number: row.external_number || null,
        result: row.result || null,
        action: row.action || null,
        duration_seconds: Number(row.duration_seconds || 0),
        start_time: row.start_time || null,
        end_time: row.end_time || null,
        crm_user_id: row.crm_user_id == null ? null : Number(row.crm_user_id),
        provider_extension_id: row.provider_extension_id || null,
        actor_name: row.actor_name || null,
        recording_available: Boolean(row.provider_recording_id || row.content_uri),
        transcript_status: row.transcript_status || null,
        ai_insights:
          row.ai_summary || row.ai_reasoning_summary || row.ai_next_task
            ? {
                summary: row.ai_summary || "",
                intent: row.ai_intent || "",
                objections: row.ai_objections || "",
                next_action: row.ai_next_task || "",
                confidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
                reasoning_summary: row.ai_reasoning_summary || "",
              }
            : null,
        happened_at: row.start_time || row.end_time || null,
      }));
  }

  async listLeadTimelineForApi(leadId) {
    const [calls, messages, audits] = await Promise.all([
      this.listLeadCallsForApi(leadId),
      this.listLeadMessagesForApi(leadId),
      this.listLeadStatusAuditsForApi(leadId),
    ]);

    return [
      ...calls.map((call) => ({
        id: `call:${call.id}`,
        type: "call",
        timestamp: call.happened_at,
        user_name: call.actor_name,
        payload: call,
      })),
      ...messages.map((message) => ({
        id: `sms:${message.id}`,
        type: "sms",
        timestamp: message.happened_at,
        user_name: message.actor_name,
        payload: message,
      })),
      ...audits.map((audit) => ({
        id: `status:${audit.id}`,
        type: "status_change",
        timestamp: audit.created_at,
        user_name: audit.actor_name,
        payload: audit,
      })),
    ].sort((left, right) => {
      const leftTime = new Date(left.timestamp || 0).getTime();
      const rightTime = new Date(right.timestamp || 0).getTime();
      return rightTime - leftTime;
    });
  }

  async listConversationFeedForApi(user = null, limit = 50) {
    const access = this.accessClauseForUser(user);
    const displayNameSql = `
      CASE
        WHEN leads.customer_name IS NOT NULL AND TRIM(leads.customer_name) <> '' THEN TRIM(leads.customer_name)
        WHEN TRIM(contacts.first_name || ' ' || contacts.last_name) <> '' THEN TRIM(contacts.first_name || ' ' || contacts.last_name)
        WHEN contacts.company IS NOT NULL AND TRIM(contacts.company) <> '' THEN contacts.company
        WHEN leads.email IS NOT NULL AND TRIM(leads.email) <> '' THEN leads.email
        WHEN contacts.email IS NOT NULL AND TRIM(contacts.email) <> '' THEN contacts.email
        WHEN leads.phone IS NOT NULL AND TRIM(leads.phone) <> '' THEN leads.phone
        WHEN contacts.phone IS NOT NULL AND TRIM(contacts.phone) <> '' THEN contacts.phone
        ELSE 'Lead #' || leads.id
      END
    `;
    const [messageRows, callRows] = await Promise.all([
      this.all(
        `
          SELECT
            lead_messages.id,
            lead_messages.lead_id,
            lead_messages.direction,
            lead_messages.external_number,
            lead_messages.body_text,
            lead_messages.message_status,
            lead_messages.provider_extension_id,
            lead_messages.crm_user_id,
            COALESCE(lead_messages.received_at, lead_messages.sent_at, lead_messages.created_at) AS happened_at,
            users.name AS actor_name,
            sales_user.name AS assigned_user_name,
            leads.status AS lead_status,
            leads.vehicle_interest,
            leads.stock_number,
            ${displayNameSql} AS lead_name
          FROM lead_messages
          INNER JOIN leads ON leads.id = lead_messages.lead_id
          LEFT JOIN contacts ON contacts.id = leads.contact_id
          LEFT JOIN users ON users.id = lead_messages.crm_user_id AND users.dealership_id = lead_messages.dealership_id
          LEFT JOIN users AS sales_user ON sales_user.id = leads.assigned_to AND sales_user.dealership_id = leads.dealership_id
          WHERE ${access.clause}
          ORDER BY happened_at DESC, lead_messages.id DESC
          LIMIT ?
        `,
        [...access.params, limit]
      ),
      this.all(
        `
          SELECT
            lead_calls.id,
            lead_calls.lead_id,
            lead_calls.direction,
            lead_calls.external_number,
            lead_calls.result,
            lead_calls.duration_seconds,
            lead_calls.provider_extension_id,
            lead_calls.crm_user_id,
            COALESCE(lead_calls.start_time, lead_calls.end_time, lead_calls.created_at) AS happened_at,
            users.name AS actor_name,
            sales_user.name AS assigned_user_name,
            leads.status AS lead_status,
            leads.vehicle_interest,
            leads.stock_number,
            call_recordings.provider_recording_id,
            call_recordings.content_uri,
            analyses.summary AS ai_summary,
            ${displayNameSql} AS lead_name
          FROM lead_calls
          INNER JOIN leads ON leads.id = lead_calls.lead_id
          LEFT JOIN contacts ON contacts.id = leads.contact_id
          LEFT JOIN users ON users.id = lead_calls.crm_user_id AND users.dealership_id = lead_calls.dealership_id
          LEFT JOIN users AS sales_user ON sales_user.id = leads.assigned_to AND sales_user.dealership_id = leads.dealership_id
          LEFT JOIN call_recordings ON call_recordings.lead_call_id = lead_calls.id AND call_recordings.dealership_id = lead_calls.dealership_id
          LEFT JOIN communication_ai_analyses AS analyses
            ON analyses.source_type = 'call' AND analyses.source_id = lead_calls.id AND analyses.dealership_id = lead_calls.dealership_id
          WHERE ${access.clause}
          ORDER BY happened_at DESC, lead_calls.id DESC
          LIMIT ?
        `,
        [...access.params, limit]
      ),
    ]);

    const messages = messageRows.map((row) => ({
      id: `sms:${row.id}`,
      type: "sms",
      lead_id: Number(row.lead_id),
      lead_name: row.lead_name,
      lead_status: fromStoredStatus(row.lead_status || "new"),
      vehicle_interest: row.vehicle_interest || "Vehicle inquiry",
      stock_number: row.stock_number || null,
      assigned_user_name: row.assigned_user_name || "Unassigned",
      actor_name: row.actor_name || null,
      direction: row.direction || "unknown",
      external_number: row.external_number || null,
      preview: row.body_text || "No message text.",
      message_status: row.message_status || null,
      provider_extension_id: row.provider_extension_id || null,
      happened_at: row.happened_at || null,
    }));

    const seenCalls = new Set();
    const calls = callRows
      .filter((row) => {
        if (seenCalls.has(String(row.id))) {
          return false;
        }
        seenCalls.add(String(row.id));
        return true;
      })
      .map((row) => ({
        id: `call:${row.id}`,
        type: "call",
        lead_id: Number(row.lead_id),
        lead_name: row.lead_name,
        lead_status: fromStoredStatus(row.lead_status || "new"),
        vehicle_interest: row.vehicle_interest || "Vehicle inquiry",
        stock_number: row.stock_number || null,
        assigned_user_name: row.assigned_user_name || "Unassigned",
        actor_name: row.actor_name || null,
        direction: row.direction || "unknown",
        external_number: row.external_number || null,
        preview: row.ai_summary || row.result || "Call synced",
        result: row.result || null,
        duration_seconds: Number(row.duration_seconds || 0),
        provider_extension_id: row.provider_extension_id || null,
        recording_available: Boolean(row.provider_recording_id || row.content_uri),
        happened_at: row.happened_at || null,
      }));

    return [...calls, ...messages]
      .sort((left, right) => new Date(right.happened_at || 0).getTime() - new Date(left.happened_at || 0).getTime())
      .slice(0, limit);
  }

  async getExecutionSettings() {
    const rows = await this.all("SELECT key, value FROM crm_settings");
    const stored = Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));
    return normalizeExecutionSettings({
      ...DEFAULT_EXECUTION_SETTINGS,
      ...stored,
    });
  }

  async setExecutionSettings(input = {}) {
    const settings = normalizeExecutionSettings({
      ...(await this.getExecutionSettings()),
      ...input,
    });
    const timestamp = new Date().toISOString();

    for (const [key, value] of Object.entries(settings)) {
      await this.execute(
        `
          INSERT INTO crm_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `,
        [key, String(value), timestamp]
      );
    }

    return settings;
  }

  formatTaskForApi(row) {
    return {
      id: Number(row.id),
      lead_id: Number(row.lead_id),
      user_id: row.user_id == null ? null : Number(row.user_id),
      type: row.type,
      title: row.title,
      due_at: row.due_at || null,
      status: row.status,
      source: row.source,
      unique_key: row.unique_key || null,
      metadata: parseJson(row.metadata_json, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at || null,
      assigned_user_name: row.assigned_user_name || null,
    };
  }

  async listLeadTasksForApi(leadId) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      return [];
    }

    const rows = await this.all(
      `
        SELECT tasks.*, users.name AS assigned_user_name
        FROM tasks
        LEFT JOIN users ON users.id = tasks.user_id AND users.dealership_id = tasks.dealership_id
        WHERE tasks.lead_id = ?
          AND tasks.dealership_id = ?
        ORDER BY
          CASE tasks.status
            WHEN 'overdue' THEN 1
            WHEN 'pending' THEN 2
            ELSE 3
          END,
          tasks.due_at ASC,
          tasks.created_at DESC
      `,
      [leadId, dealershipId]
    );
    return rows.map((row) => this.formatTaskForApi(row));
  }

  async listNotificationsForApi(userId, limit = 20, user = null) {
    const dealershipId = this.currentDealershipId(user);
    const rows = await this.all(
      `
        SELECT notifications.*, leads.customer_name
        FROM notifications
        LEFT JOIN leads ON leads.id = notifications.lead_id AND leads.dealership_id = notifications.dealership_id
        WHERE notifications.user_id = ?
          AND notifications.dealership_id = ?
        ORDER BY notifications.created_at DESC
        LIMIT ?
      `,
      [userId, dealershipId, limit]
    );

    return rows.map((row) => ({
      id: Number(row.id),
      lead_id: row.lead_id == null ? null : Number(row.lead_id),
      type: row.type,
      title: row.title,
      body: row.body || "",
      status: row.status,
      metadata: parseJson(row.metadata_json, {}),
      created_at: row.created_at,
      read_at: row.read_at || null,
      lead_name: row.customer_name || null,
    }));
  }

  async createNotification({
    user_id,
    lead_id = null,
    type,
    title,
    body = "",
    unique_key = null,
    metadata = {},
  }) {
    if (!user_id || !type || !title) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const dealershipId = await this.resolveDealershipIdContext({ lead_id, user_id });
    const metadataJson = JSON.stringify(metadata || {});

    if (unique_key) {
      const row = await this.get(
        `
          INSERT INTO notifications (
            dealership_id, user_id, lead_id, type, title, body, status, unique_key, metadata_json, created_at, read_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (unique_key) DO UPDATE
          SET
            user_id = EXCLUDED.user_id,
            lead_id = EXCLUDED.lead_id,
            type = EXCLUDED.type,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            metadata_json = EXCLUDED.metadata_json
          RETURNING *
        `,
        [
          dealershipId,
          user_id,
          lead_id,
          type,
          title,
          body || null,
          "unread",
          unique_key,
          metadataJson,
          timestamp,
          null,
        ]
      );
      return row;
    }

    return this.get(
      `
        INSERT INTO notifications (
          dealership_id, user_id, lead_id, type, title, body, status, unique_key, metadata_json, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `,
      [
        dealershipId,
        user_id,
        lead_id,
        type,
        title,
        body || null,
        "unread",
        null,
        metadataJson,
        timestamp,
        null,
      ]
    );
  }

  async markNotificationRead(id, userId, user = null) {
    const notification = await this.get(
      "SELECT * FROM notifications WHERE id = ? AND user_id = ? AND dealership_id = ?",
      [id, userId, this.currentDealershipId(user)]
    );
    if (!notification) {
      throw new NotFoundError("Notification not found");
    }

    await this.execute("UPDATE notifications SET status = ?, read_at = ? WHERE id = ? AND dealership_id = ?", [
      "read",
      new Date().toISOString(),
      id,
      this.currentDealershipId(user),
    ]);
  }

  async createOrRefreshTask({
    lead_id,
    user_id = null,
    type,
    title,
    due_at = null,
    source = "manual",
    unique_key = null,
    metadata = {},
  }) {
    const timestamp = new Date().toISOString();
    const dealershipId = await this.resolveDealershipIdContext({ lead_id, user_id });
    const status = due_at && new Date(due_at).getTime() <= Date.now() ? "overdue" : "pending";
    const metadataJson = JSON.stringify(metadata || {});
    let inserted = null;

    if (unique_key) {
      inserted = await this.get(
        `
          INSERT INTO tasks (
            dealership_id, lead_id, user_id, type, title, due_at, status, source, unique_key, metadata_json, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (unique_key) DO UPDATE
          SET
            lead_id = EXCLUDED.lead_id,
            user_id = EXCLUDED.user_id,
            type = EXCLUDED.type,
            title = EXCLUDED.title,
            due_at = EXCLUDED.due_at,
            status = EXCLUDED.status,
            source = EXCLUDED.source,
            metadata_json = EXCLUDED.metadata_json,
            updated_at = EXCLUDED.updated_at,
            completed_at = CASE
              WHEN tasks.status = 'completed' AND EXCLUDED.status IN ('pending', 'overdue') THEN NULL
              ELSE tasks.completed_at
            END
          RETURNING id, (xmax = 0) AS inserted
        `,
        [
          dealershipId,
          lead_id,
          user_id,
          type,
          title,
          due_at,
          status,
          source,
          unique_key,
          metadataJson,
          timestamp,
          timestamp,
          null,
        ]
      );
    } else {
      inserted = await this.get(
        `
          INSERT INTO tasks (
            dealership_id, lead_id, user_id, type, title, due_at, status, source, unique_key, metadata_json, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id, TRUE AS inserted
        `,
        [
          dealershipId,
          lead_id,
          user_id,
          type,
          title,
          due_at,
          status,
          source,
          null,
          metadataJson,
          timestamp,
          timestamp,
          null,
        ]
      );
    }

    await this.createNotification({
      user_id,
      lead_id,
      type: "task_created",
      title: "New task assigned",
      body: title,
      unique_key: unique_key ? `notification:${unique_key}` : `notification:task:${inserted.id}`,
      metadata: {
        task_id: Number(inserted.id),
        task_type: type,
      },
    });
    const task = await this.get(
      "SELECT tasks.*, users.name AS assigned_user_name FROM tasks LEFT JOIN users ON users.id = tasks.user_id AND users.dealership_id = tasks.dealership_id WHERE tasks.id = ? AND tasks.dealership_id = ?",
      [inserted.id, dealershipId]
    );
    return this.formatTaskForApi(task);
  }

  async completeTask(id, actor) {
    const dealershipId = this.currentDealershipId(actor);
    const task = await this.get("SELECT * FROM tasks WHERE id = ? AND dealership_id = ?", [id, dealershipId]);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (actor && !canViewAllLeads(actor) && Number(task.user_id) !== Number(actor.id)) {
      throw new UnauthorizedError("You cannot complete this task.");
    }

    await this.execute(
      "UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND dealership_id = ?",
      ["completed", new Date().toISOString(), new Date().toISOString(), id, dealershipId]
    );
    await this.createLeadActivity({
      lead_id: Number(task.lead_id),
      user_id: actor?.id || null,
      type: "note",
      content: `Task completed: ${task.title}`,
    });
    const updated = await this.get(
      "SELECT tasks.*, users.name AS assigned_user_name FROM tasks LEFT JOIN users ON users.id = tasks.user_id AND users.dealership_id = tasks.dealership_id WHERE tasks.id = ? AND tasks.dealership_id = ?",
      [id, dealershipId]
    );
    return this.formatTaskForApi(updated);
  }

  async refreshTaskStatuses() {
    const now = new Date().toISOString();
    const dealershipId = this.currentDealershipId();
    const overdueTasks = await this.all(
      "SELECT * FROM tasks WHERE dealership_id = ? AND status = 'pending' AND due_at IS NOT NULL AND due_at <> '' AND due_at <= ?",
      [dealershipId, now]
    );

    for (const task of overdueTasks) {
      await this.execute("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", ["overdue", now, task.id]);
      await this.createNotification({
        user_id: task.user_id,
        lead_id: task.lead_id,
        type: "task_overdue",
        title: "Task overdue",
        body: task.title,
        unique_key: `task-overdue:${task.id}`,
        metadata: { task_id: Number(task.id) },
      });
    }

    return overdueTasks.length;
  }

  async getLatestAnalysisMap(leadIds = [], dealershipId = this.currentDealershipId()) {
    if (!leadIds.length) {
      return new Map();
    }

    const rows = await this.all(
      `
        SELECT *
        FROM communication_ai_analyses
        WHERE lead_id = ANY(?)
          AND dealership_id = ?
        ORDER BY created_at DESC
      `,
      [leadIds, dealershipId]
    );
    const map = new Map();
    rows.forEach((row) => {
      const key = Number(row.lead_id);
      if (!map.has(key)) {
        map.set(key, row);
      }
    });
    return map;
  }

  async getOpenTaskMap(leadIds = [], dealershipId = this.currentDealershipId()) {
    if (!leadIds.length) {
      return new Map();
    }

    const rows = await this.all(
      `
        SELECT tasks.*, users.name AS assigned_user_name
        FROM tasks
        LEFT JOIN users ON users.id = tasks.user_id AND users.dealership_id = tasks.dealership_id
        WHERE tasks.lead_id = ANY(?)
          AND tasks.dealership_id = ?
          AND tasks.status IN ('pending', 'overdue')
        ORDER BY tasks.due_at ASC, tasks.created_at DESC
      `,
      [leadIds, dealershipId]
    );

    const map = new Map();
    rows.forEach((row) => {
      const key = Number(row.lead_id);
      const list = map.get(key) || [];
      list.push(this.formatTaskForApi(row));
      map.set(key, list);
    });
    return map;
  }

  async getMissedCallMap(leadIds = [], dealershipId = this.currentDealershipId()) {
    if (!leadIds.length) {
      return new Map();
    }

    const rows = await this.all(
      `
        SELECT *
        FROM lead_calls
        WHERE lead_id = ANY(?)
          AND dealership_id = ?
        ORDER BY start_time DESC, created_at DESC
      `,
      [leadIds, dealershipId]
    );

    const map = new Map();
    rows.forEach((row) => {
      const key = Number(row.lead_id);
      const resultText = String(row.result || "").toLowerCase();
      const isMissed =
        String(row.direction || "").toLowerCase() === "inbound" &&
        /missed|no answer|received|voicemail/.test(resultText);
      const existing = map.get(key) || { lastMissedCallAt: null, lastFollowUpAt: null };

      if (isMissed && !existing.lastMissedCallAt) {
        existing.lastMissedCallAt = row.start_time || row.created_at;
      }

      if (!existing.lastFollowUpAt && String(row.direction || "").toLowerCase() === "outbound") {
        existing.lastFollowUpAt = row.start_time || row.created_at;
      }

      map.set(key, existing);
    });

    const messageRows = await this.all(
      `
        SELECT lead_id, direction, COALESCE(received_at, sent_at, created_at) AS happened_at
        FROM lead_messages
        WHERE lead_id = ANY(?)
          AND dealership_id = ?
        ORDER BY happened_at DESC
      `,
      [leadIds, dealershipId]
    );

    messageRows.forEach((row) => {
      const key = Number(row.lead_id);
      const existing = map.get(key) || { lastMissedCallAt: null, lastFollowUpAt: null };
      if (!existing.lastFollowUpAt && String(row.direction || "").toLowerCase() === "outbound") {
        existing.lastFollowUpAt = row.happened_at;
      }
      map.set(key, existing);
    });

    return map;
  }

  async enforceFollowUpTasks() {
    await this.refreshTaskStatuses();
    const settings = await this.getExecutionSettings();
    const dealershipId = this.currentDealershipId();
    const rows = await this.all(
      `${this.apiLeadSelectSql()} WHERE leads.dealership_id = ? ORDER BY leads.updated_at DESC`,
      [dealershipId]
    );
    const leads = rows.map((row) => this.formatApiLead(row));
    const taskMap = await this.getOpenTaskMap(
      leads.map((lead) => Number(lead.id)),
      dealershipId
    );
    const now = new Date();

    for (const lead of leads) {
      if (!["contacted", "appointment", "negotiation"].includes(String(lead.status))) {
        continue;
      }

      const lastActivityAt = lead.latest_activity_at ? new Date(lead.latest_activity_at) : null;
      if (!lastActivityAt) {
        continue;
      }

      const idleHours = (now.getTime() - lastActivityAt.getTime()) / 3600000;
      if (idleHours < settings.inactivity_threshold_hours) {
        continue;
      }

      const existing = (taskMap.get(Number(lead.id)) || []).some((task) => task.type === "follow_up");
      if (existing) {
        continue;
      }

      await this.createOrRefreshTask({
        lead_id: Number(lead.id),
        user_id: lead.assigned_to,
        type: "follow_up",
        title: "Follow up with inactive lead",
        due_at: plusHours(now.toISOString(), 0),
        source: "system",
        unique_key: `follow-up:${lead.id}:${toDateOnlyString(now)}`,
        metadata: {
          reason: "no_recent_activity",
        },
      });
    }

    return settings;
  }

  async getExecutionDashboard(user = null) {
    await this.enforceFollowUpTasks();
    const settings = await this.getExecutionSettings();
    const access = this.accessClauseForUser(user);
    const rows = await this.all(
      `
        ${this.apiLeadSelectSql()}
        WHERE ${access.clause}
        ORDER BY leads.updated_at DESC, leads.id DESC
      `,
      access.params
    );
    const leads = rows.map((row) => this.formatApiLead(row));
    const leadIds = leads.map((lead) => Number(lead.id));
    const [taskMap, analysisMap, missedCallMap, notifications] = await Promise.all([
      this.getOpenTaskMap(leadIds, this.currentDealershipId(user)),
      this.getLatestAnalysisMap(leadIds, this.currentDealershipId(user)),
      this.getMissedCallMap(leadIds, this.currentDealershipId(user)),
      user ? this.listNotificationsForApi(Number(user.id), 25, user) : [],
    ]);
    const now = new Date();

    const attention = [];
    const organized = {
      contacted: [],
      appointment: [],
      negotiation: [],
      sold: [],
      lost: [],
    };

    leads.forEach((lead) => {
      const latestAnalysis = analysisMap.get(Number(lead.id)) || null;
      const missedCallState = missedCallMap.get(Number(lead.id)) || {};
      const openTasks = taskMap.get(Number(lead.id)) || [];
      const evaluation = evaluateLeadAttention({
        lead,
        tasks: openTasks,
        latestAnalysis,
        latestActivityAt: lead.latest_activity_at ? new Date(lead.latest_activity_at) : null,
        lastMissedCallAt: missedCallState.lastMissedCallAt ? new Date(missedCallState.lastMissedCallAt) : null,
        lastFollowUpAt: missedCallState.lastFollowUpAt ? new Date(missedCallState.lastFollowUpAt) : null,
        settings,
        now,
      });

      const payload = {
        ...lead,
        attention_reason: evaluation.primary_reason?.label || "",
        attention_reason_code: evaluation.primary_reason?.code || "",
        attention_reasons: evaluation.reasons,
        urgency_score: evaluation.urgency_score,
        ai_summary:
          latestAnalysis?.summary ||
          latestAnalysis?.reasoning_summary ||
          latestAnalysis?.next_task ||
          lead.message_preview,
        open_tasks: openTasks,
      };

      if (evaluation.needs_attention) {
        attention.push(payload);
        return;
      }

      const category = categorizeOrganizedLead(
        lead,
        latestAnalysis,
        lead.latest_activity_at ? new Date(lead.latest_activity_at) : null,
        settings,
        now
      );
      const targetCategory = Object.prototype.hasOwnProperty.call(organized, category) ? category : "contacted";
      organized[targetCategory].push(payload);
    });

    attention.sort((left, right) => {
      if (right.urgency_score !== left.urgency_score) {
        return right.urgency_score - left.urgency_score;
      }

      const leftTime = new Date(left.latest_activity_at || left.updated_at || 0).getTime();
      const rightTime = new Date(right.latest_activity_at || right.updated_at || 0).getTime();
      return leftTime - rightTime;
    });

    return {
      settings,
      summary: {
        needs_attention_count: attention.length,
        overdue_task_count: attention.filter((lead) => lead.attention_reason_code === "overdue_task").length,
        unread_notification_count: notifications.filter((item) => item.status === "unread").length,
      },
      attention_items: attention,
      organized_groups: organized,
      notifications,
    };
  }

  async createActivity({ lead_id, type, content, created_at = null }) {
    await this.createLeadActivity({
      lead_id,
      user_id: null,
      type,
      content,
      created_at,
    });
  }

  async createApiLead(input, user = null, options = {}) {
    const now = new Date().toISOString();
    const storedStatus = toStoredStatus(input.status || "new");
    const dealershipId =
      parsePositiveInteger(input.dealership_id) || (user ? this.currentDealershipId(user) : getDefaultDealershipId());
    const requestedAssignedTo = input.assigned_to == null ? null : parsePositiveInteger(input.assigned_to);
    const inventoryId = await this.resolveLeadInventoryId(input, dealershipId);
    const inventory = inventoryId
      ? await this.get("SELECT * FROM inventory WHERE id = ? AND dealership_id = ?", [inventoryId, dealershipId])
      : null;
    const leadPayload = this.normalizeLeadPayloadForStorage(input, inventory);
    const normalizedPhone = normalizeLeadPhoneForStorage(leadPayload.phone);
    const normalizedEmail = normalizeLeadEmailForStorage(leadPayload.email);
    const contactResolution = await this.findOrCreateContactFromLead(
      {
        dealership_id: dealershipId,
        customer_name: leadPayload.customer_name,
        phone: leadPayload.phone,
        email: leadPayload.email,
      },
      user,
      { dealership_id: dealershipId, now }
    );
    let contact = contactResolution.contact;

    if (requestedAssignedTo && contact && (contactResolution.created || contact.assigned_rep_id == null)) {
      contact = await this.assignContact(contact.id, requestedAssignedTo, user, {
        assignment_method: "manual_override",
        needs_manual_review: contact.needs_manual_review,
      });
    }

    const assignedTo = contact?.assigned_rep_id == null ? null : Number(contact.assigned_rep_id);
    const row = await this.get(
      `
        INSERT INTO leads (
          dealership_id,
          contact_id,
          source,
          status,
          assigned_to,
          customer_name,
          phone,
          normalized_phone,
          email,
          normalized_email,
          vehicle_interest,
          vehicle_id,
          stock_number,
          vehicle_year,
          vehicle_make,
          vehicle_model,
          vehicle_trim,
          vehicle_condition,
          vehicle_price,
          lead_type,
          listing_url,
          message,
          inventory_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `,
      [
        dealershipId,
        contact ? Number(contact.id) : null,
        input.source || "website",
        storedStatus || "new",
        assignedTo,
        leadPayload.customer_name,
        leadPayload.phone,
        normalizedPhone,
        leadPayload.email,
        normalizedEmail,
        leadPayload.vehicle_interest,
        leadPayload.vehicle_id,
        leadPayload.stock_number,
        leadPayload.vehicle_year,
        leadPayload.vehicle_make,
        leadPayload.vehicle_model,
        leadPayload.vehicle_trim,
        leadPayload.vehicle_condition,
        leadPayload.vehicle_price,
        input.lead_type || null,
        input.listing_url || null,
        input.message || null,
        inventoryId,
        now,
        now,
      ]
    );

    await this.createActivity({
      lead_id: row.id,
      type: "lead_created",
      content: `Lead created from ${input.source || "website"}`,
      created_at: now,
    });
    logLeadDedupeDecision({
      action: contactResolution.created ? "created_new_contact_and_lead" : "created_lead_for_existing_contact",
      reason: contactResolution.reason || "contact_resolution",
      lead_id: Number(row.id),
      contact_id: contact ? Number(contact.id) : null,
      dealership_id: dealershipId,
      source: input.source || "website",
      normalized_phone: normalizedPhone,
      normalized_email: normalizedEmail,
      assigned_rep_id: assignedTo,
    });

    return attachLeadDedupeMeta(
      await this.getApiLead(row.id, user),
      {
        merged: false,
        created: true,
        reason: contactResolution.reason || null,
        lead_id: Number(row.id),
        contact_id: contact ? Number(contact.id) : null,
      },
      options
    );
  }

  async updateApiLead(id, input, actor = null) {
    const existingLead = await this.getApiLead(id, actor);
    const now = new Date().toISOString();
    const storedStatus = input.status ? toStoredStatus(input.status) : null;
    const assignedTo = input.assigned_to == null ? null : parsePositiveInteger(input.assigned_to);
    const inventoryId = await this.resolveLeadInventoryId(input, Number(existingLead.dealership_id), existingLead.inventory_id);
    const inventory = inventoryId
      ? await this.get("SELECT * FROM inventory WHERE id = ? AND dealership_id = ?", [inventoryId, existingLead.dealership_id])
      : null;
    const leadPayload = this.normalizeLeadPayloadForStorage(input, inventory);
    const normalizedPhone = normalizeLeadPhoneForStorage(leadPayload.phone);
    const normalizedEmail = normalizeLeadEmailForStorage(leadPayload.email);

    await this.execute(
      `
        UPDATE leads
        SET
          source = ?,
          status = COALESCE(?, status),
          assigned_to = COALESCE(?, assigned_to),
          customer_name = ?,
          phone = ?,
          normalized_phone = ?,
          email = ?,
          normalized_email = ?,
          vehicle_interest = ?,
          vehicle_id = ?,
          stock_number = ?,
          vehicle_year = ?,
          vehicle_make = ?,
          vehicle_model = ?,
          vehicle_trim = ?,
          vehicle_condition = ?,
          vehicle_price = ?,
          lead_type = ?,
          listing_url = ?,
          message = ?,
          inventory_id = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [
        input.source || existingLead.source || "website",
        storedStatus,
        assignedTo,
        leadPayload.customer_name,
        leadPayload.phone,
        normalizedPhone,
        leadPayload.email,
        normalizedEmail,
        leadPayload.vehicle_interest,
        leadPayload.vehicle_id,
        leadPayload.stock_number,
        leadPayload.vehicle_year,
        leadPayload.vehicle_make,
        leadPayload.vehicle_model,
        leadPayload.vehicle_trim,
        leadPayload.vehicle_condition,
        leadPayload.vehicle_price,
        input.lead_type || null,
        input.listing_url || null,
        input.message || null,
        inventoryId,
        now,
        id,
        existingLead.dealership_id,
      ]
    );

    return this.getApiLead(id, actor);
  }

  async updateApiLeadStatus(id, status, actor = null, options = {}) {
    const existingLead = await this.getApiLead(id, actor);
    const storedStatus = toStoredStatus(status);
    const nextStatus = fromStoredStatus(storedStatus);

    if (!DEALER_PIPELINE_STATUSES.includes(fromStoredStatus(storedStatus))) {
      throw new ValidationError("Invalid lead status.");
    }

    if (!canTransitionLeadStatus(existingLead.status, nextStatus)) {
      throw new ValidationError(`Invalid status transition: ${existingLead.status} -> ${nextStatus}.`);
    }

    await this.execute(
      `
        UPDATE leads
        SET status = ?, updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [storedStatus, new Date().toISOString(), id, existingLead.dealership_id]
    );

    await this.createActivity({
      lead_id: id,
      type: "status_changed",
      content: `${existingLead.status_label} -> ${titleCaseStatus(nextStatus)}`,
    });
    await this.recordLeadStatusAudit({
      lead_id: id,
      user_id: actor?.id || null,
      previous_status: existingLead.status,
      new_status: nextStatus,
      confidence: options.confidence == null ? 1 : Number(options.confidence),
      reasoning_summary: options.reasoning_summary || "Manual CRM status update.",
      source: options.source || "manual_status_update",
      auto_applied: Boolean(options.auto_applied),
      recommendation_only: Boolean(options.recommendation_only),
    });
    await this.refreshEmailIntakeStateForLead(id);

    return this.getApiLead(id, actor);
  }

  async getApiLeadWithActivities(id, user = null) {
    const lead = await this.getApiLead(id, user);

    return {
      lead,
      activities: await this.listLeadActivitiesForApi(id),
      timeline: await this.listLeadTimelineForApi(id),
      tasks: await this.listLeadTasksForApi(id),
    };
  }

  async listInventoryForApi(filters = {}, user = null) {
      const dealershipId = this.currentDealershipId(user);
      const clauses = ["inventory.dealership_id = ?"];
      const params = [dealershipId];

      if (stringOrNull(filters.status)) {
      clauses.push("LOWER(inventory.status) = ?");
      params.push(String(filters.status).trim().toLowerCase());
    }

    if (stringOrNull(filters.make)) {
      clauses.push("LOWER(COALESCE(inventory.make, '')) LIKE ?");
      params.push(`%${String(filters.make).trim().toLowerCase()}%`);
    }

    if (stringOrNull(filters.model)) {
      clauses.push("LOWER(COALESCE(inventory.model, '')) LIKE ?");
      params.push(`%${String(filters.model).trim().toLowerCase()}%`);
    }

    if (stringOrNull(filters.stock_number)) {
      clauses.push("LOWER(COALESCE(inventory.stock_number, '')) LIKE ?");
      params.push(`%${String(filters.stock_number).trim().toLowerCase()}%`);
    }

    if (stringOrNull(filters.vin)) {
      clauses.push("LOWER(COALESCE(inventory.vin, '')) LIKE ?");
      params.push(`%${String(filters.vin).trim().toLowerCase()}%`);
    }

    const limit = Math.max(1, Math.min(500, Number(filters.limit) || 250));
    const rows = await this.all(
      `
        SELECT inventory.*
        FROM inventory
        WHERE ${clauses.join(" AND ")}
        ORDER BY
          CASE inventory.status
            WHEN 'active' THEN 1
            WHEN 'inactive' THEN 2
            WHEN 'sold' THEN 3
            ELSE 4
          END,
          LOWER(COALESCE(inventory.make, '')) ASC,
          LOWER(COALESCE(inventory.model, '')) ASC,
          LOWER(COALESCE(inventory.stock_number, '')) ASC,
          inventory.updated_at DESC
        LIMIT ?
      `,
      [...params, limit]
    );

    return rows.map((row) => this.formatInventoryRow(row));
  }

  async getInventoryForApi(id, user = null) {
    const row = await this.get(
      `
        SELECT *
        FROM inventory
        WHERE id = ? AND dealership_id = ?
      `,
      [id, this.currentDealershipId(user)]
    );

    if (!row) {
      throw new NotFoundError("Inventory unit not found");
    }

    return this.formatInventoryRow(row);
  }

  async createInventoryImportRun(input, user = null) {
    const now = new Date().toISOString();
    const dealershipId = parsePositiveInteger(input.dealership_id) || this.currentDealershipId(user);
    const row = await this.get(
      `
        INSERT INTO inventory_import_runs (
          dealership_id,
          source_type,
          source_name,
          file_name,
          status,
          rows_total,
          rows_processed,
          rows_inserted,
          rows_updated,
          rows_skipped,
          rows_deactivated,
          failed_count,
          error_message,
          metadata_json,
          started_at,
          completed_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
        `,
        [
          dealershipId,
          input.source_type || "manual_upload",
          input.source_name || null,
          input.file_name || null,
          input.status || "running",
          Number(input.rows_total || 0),
          Number(input.rows_processed || 0),
          Number(input.rows_inserted || 0),
          Number(input.rows_updated || 0),
          Number(input.rows_skipped || 0),
          Number(input.rows_deactivated || 0),
          Number(input.failed_count || 0),
          input.error_message || null,
          input.metadata_json == null ? null : JSON.stringify(input.metadata_json),
          input.started_at || now,
          input.completed_at || null,
          now,
          now,
        ]
    );

    return {
      ...row,
      id: Number(row.id),
    };
  }

  async updateInventoryImportRun(id, input, user = null) {
    const runId = parsePositiveInteger(id);
    const dealershipId = parsePositiveInteger(input.dealership_id) || this.currentDealershipId(user);
    if (!runId) {
      throw new ValidationError("Inventory import run ID is invalid.");
    }
    const existing = await this.get(
      `
        SELECT *
        FROM inventory_import_runs
        WHERE id = ? AND dealership_id = ?
      `,
        [runId, dealershipId]
    );

    if (!existing) {
      throw new NotFoundError("Inventory import run not found");
    }

    const row = await this.get(
      `
        UPDATE inventory_import_runs
        SET
          status = COALESCE(?, status),
          rows_total = COALESCE(?, rows_total),
          rows_processed = COALESCE(?, rows_processed),
          rows_inserted = COALESCE(?, rows_inserted),
          rows_updated = COALESCE(?, rows_updated),
          rows_skipped = COALESCE(?, rows_skipped),
          rows_deactivated = COALESCE(?, rows_deactivated),
          failed_count = COALESCE(?, failed_count),
          error_message = COALESCE(?, error_message),
          metadata_json = COALESCE(?, metadata_json),
          completed_at = COALESCE(?, completed_at),
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
        RETURNING *
      `,
      [
        input.status || null,
        input.rows_total == null ? null : Number(input.rows_total),
        input.rows_processed == null ? null : Number(input.rows_processed),
        input.rows_inserted == null ? null : Number(input.rows_inserted),
        input.rows_updated == null ? null : Number(input.rows_updated),
        input.rows_skipped == null ? null : Number(input.rows_skipped),
        input.rows_deactivated == null ? null : Number(input.rows_deactivated),
        input.failed_count == null ? null : Number(input.failed_count),
        input.error_message || null,
        input.metadata_json == null ? null : JSON.stringify(input.metadata_json),
        input.completed_at || null,
        new Date().toISOString(),
          runId,
          dealershipId,
      ]
    );

    return {
      ...row,
      id: Number(row.id),
    };
  }

  async createInventoryImportError(input, user = null) {
    const importRunId = parsePositiveInteger(input.import_run_id);
    const dealershipId = parsePositiveInteger(input.dealership_id) || this.currentDealershipId(user);
    if (!importRunId) {
      throw new ValidationError("Inventory import run ID is invalid.");
    }

    const run = await this.get(
      `
        SELECT id
        FROM inventory_import_runs
        WHERE id = ? AND dealership_id = ?
      `,
        [importRunId, dealershipId]
    );

    if (!run) {
      throw new NotFoundError("Inventory import run not found");
    }

    const row = await this.get(
      `
        INSERT INTO inventory_import_errors (
          import_run_id,
          row_number,
          stock_number,
          vin,
          raw_identifier,
          error_message,
          raw_row_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `,
        [
          importRunId,
          input.row_number == null ? null : parsePositiveInteger(input.row_number),
          input.stock_number || null,
          input.vin || null,
          input.raw_identifier || null,
          input.error_message,
          input.raw_row_json || null,
          new Date().toISOString(),
        ]
    );

    return {
      ...row,
      id: Number(row.id),
    };
  }

  async listInventoryImportRuns(user = null, limit = 20) {
    const rows = await this.all(
      `
        SELECT
          inventory_import_runs.*,
          (
            SELECT COUNT(*)
            FROM inventory_import_errors
            WHERE inventory_import_errors.import_run_id = inventory_import_runs.id
          ) AS error_count
        FROM inventory_import_runs
        WHERE dealership_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT ?
      `,
      [this.currentDealershipId(user), Math.max(1, Math.min(100, Number(limit) || 20))]
    );

    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      dealership_id: Number(row.dealership_id),
      rows_total: Number(row.rows_total || 0),
      rows_processed: Number(row.rows_processed || 0),
      rows_inserted: Number(row.rows_inserted || 0),
      rows_updated: Number(row.rows_updated || 0),
      rows_skipped: Number(row.rows_skipped || 0),
      rows_deactivated: Number(row.rows_deactivated || 0),
      failed_count: Number(row.failed_count || 0),
      error_count: Number(row.error_count || 0),
      metadata_json: parseJson(row.metadata_json, null),
    }));
  }

  async listInventoryImportErrors(filters = {}, user = null) {
    const { run_id = null, source_type = "", limit = 50 } = filters;
    const clauses = ["inventory_import_runs.dealership_id = ?"];
    const params = [this.currentDealershipId(user)];

    if (parsePositiveInteger(run_id)) {
      clauses.push("inventory_import_errors.import_run_id = ?");
      params.push(parsePositiveInteger(run_id));
    }

    if (stringOrNull(source_type)) {
      clauses.push("inventory_import_runs.source_type = ?");
      params.push(String(source_type).trim());
    }

    const rows = await this.all(
      `
        SELECT inventory_import_errors.*, inventory_import_runs.source_type, inventory_import_runs.file_name
        FROM inventory_import_errors
        JOIN inventory_import_runs ON inventory_import_runs.id = inventory_import_errors.import_run_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY inventory_import_errors.created_at DESC, inventory_import_errors.id DESC
        LIMIT ?
      `,
      [...params, Math.max(1, Math.min(200, Number(limit) || 50))]
    );

    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      import_run_id: Number(row.import_run_id),
      row_number: row.row_number == null ? null : Number(row.row_number),
    }));
  }

  async failStaleInventoryImportRuns({ source_type = "ftp_sync", older_than_iso } = {}) {
    const rows = await this.all(
      `
        UPDATE inventory_import_runs
        SET status = 'failed',
            error_message = COALESCE(error_message, 'Inventory sync was interrupted before completion.'),
            completed_at = COALESCE(completed_at, ?),
            updated_at = ?
        WHERE status = 'running'
          AND source_type = ?
          AND started_at < ?
        RETURNING id
      `,
      [new Date().toISOString(), new Date().toISOString(), source_type, older_than_iso || new Date().toISOString()]
    );

    return rows.length;
  }

  async findInventoryByIdentity({ dealership_id, stock_number = null, vin = null }) {
    const normalizedStockNumber = normalizeInventoryIdentity(stock_number);
    const normalizedVin = normalizeInventoryIdentity(vin);
    if (!normalizedStockNumber && !normalizedVin) {
      return null;
    }

    let stockMatch = null;
    let vinMatch = null;

    if (normalizedStockNumber) {
      stockMatch = await this.get(
        `
          SELECT *
          FROM inventory
          WHERE dealership_id = ? AND UPPER(stock_number) = ?
          LIMIT 1
        `,
        [dealership_id, normalizedStockNumber]
      );
    }

    if (normalizedVin) {
      vinMatch = await this.get(
        `
          SELECT *
          FROM inventory
          WHERE dealership_id = ? AND UPPER(vin) = ?
          LIMIT 1
        `,
        [dealership_id, normalizedVin]
      );
    }

    if (stockMatch && vinMatch && Number(stockMatch.id) !== Number(vinMatch.id)) {
      throw new ValidationError("Stock number and VIN resolve to different inventory units.");
    }

    return stockMatch || vinMatch || null;
  }

  async resolveLeadInventoryId(input, dealershipId, fallbackInventoryId = null) {
    const inventory = await this.findInventoryByIdentity({
      dealership_id: dealershipId,
      stock_number: input.stock_number,
      vin: input.vehicle_id,
    });

    if (inventory) {
      return Number(inventory.id);
    }

    if (stringOrNull(input.stock_number) || stringOrNull(input.vehicle_id)) {
      return null;
    }

    return fallbackInventoryId == null ? null : Number(fallbackInventoryId);
  }

  normalizeLeadPayloadForStorage(input = {}, inventory = null) {
    if (!inventory) {
      return {
        customer_name: normalizeLeadCustomerName(input.customer_name || "", "NN Lead"),
        phone: input.phone || null,
        email: input.email || null,
        vehicle_interest: input.vehicle_interest || null,
        vehicle_id: input.vehicle_id || null,
        stock_number: input.stock_number || null,
        vehicle_year: input.vehicle_year || null,
        vehicle_make: input.vehicle_make || null,
        vehicle_model: input.vehicle_model || null,
        vehicle_trim: input.vehicle_trim || null,
        vehicle_condition: input.vehicle_condition || null,
        vehicle_price: input.vehicle_price || null,
      };
    }

    return {
      customer_name: normalizeLeadCustomerName(input.customer_name || "", "NN Lead"),
      phone: input.phone || null,
      email: input.email || null,
      vehicle_interest: buildVehicleDisplay(inventory) || input.vehicle_interest || null,
      vehicle_id: inventory.vin || input.vehicle_id || null,
      stock_number: inventory.stock_number || input.stock_number || null,
      vehicle_year: inventory.year == null ? input.vehicle_year || null : String(inventory.year),
      vehicle_make: inventory.make || input.vehicle_make || null,
      vehicle_model: inventory.model || input.vehicle_model || null,
      vehicle_trim: inventory.trim || input.vehicle_trim || null,
      vehicle_condition: inventory.condition || input.vehicle_condition || null,
      vehicle_price: inventory.price == null ? input.vehicle_price || null : String(inventory.price),
    };
  }

  async upsertInventoryRecord(input) {
    const now = input.updated_at || new Date().toISOString();
    const dealershipId = parsePositiveInteger(input.dealership_id);
    if (!dealershipId) {
      throw new ValidationError("Inventory record is missing a valid dealership ID.");
    }
    const stockNumber = normalizeInventoryIdentity(input.stock_number);
    const vin = normalizeInventoryIdentity(input.vin);
    const existing = await this.findInventoryByIdentity({
      dealership_id: dealershipId,
      stock_number: stockNumber,
      vin,
    });

    const payload = [
      stockNumber,
      vin,
      parseIntegerField(input.year),
      stringOrNull(input.make),
      stringOrNull(input.model),
      stringOrNull(input.trim),
      parseIntegerField(input.price),
      parseIntegerField(input.mileage),
      stringOrNull(input.condition),
      stringOrNull(input.body_style),
      stringOrNull(input.drivetrain),
      stringOrNull(input.transmission),
      stringOrNull(input.engine),
      stringOrNull(input.fuel_type),
      stringOrNull(input.exterior_color),
      stringOrNull(input.interior_color),
      normalizeInventoryStatus(input.status),
      normalizeInventoryStatus(input.status) === "active",
      stringOrNull(input.source),
      stringOrNull(input.source_file),
      stringOrNull(input.date_in_stock),
      stringOrNull(input.photos_json),
      input.last_seen_at || now,
      input.first_seen_at || now,
    ];

    if (existing) {
      const row = await this.get(
        `
          UPDATE inventory
          SET
            stock_number = ?,
            vin = ?,
            year = ?,
            make = ?,
            model = ?,
            trim = ?,
            price = ?,
            mileage = ?,
            condition = ?,
            body_style = ?,
            drivetrain = ?,
            transmission = ?,
            engine = ?,
            fuel_type = ?,
            exterior_color = ?,
            interior_color = ?,
            status = ?,
            is_active = ?,
            source = ?,
            source_file = ?,
            date_in_stock = ?,
            photos_json = ?,
            last_seen_at = ?,
            first_seen_at = COALESCE(first_seen_at, ?),
            updated_at = ?
          WHERE id = ? AND dealership_id = ?
          RETURNING *
        `,
        [...payload, now, existing.id, dealershipId]
      );

      return {
        action: "updated",
        inventory: this.formatInventoryRow(row),
      };
    }

    const row = await this.get(
      `
        INSERT INTO inventory (
          dealership_id,
          stock_number,
          vin,
          year,
          make,
          model,
          trim,
          price,
          mileage,
          condition,
          body_style,
          drivetrain,
          transmission,
          engine,
          fuel_type,
          exterior_color,
          interior_color,
          status,
          is_active,
          source,
          source_file,
          date_in_stock,
          photos_json,
          last_seen_at,
          first_seen_at,
          created_at,
          updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *
        `,
        [dealershipId, ...payload, now, now]
      );

    return {
      action: "inserted",
      inventory: this.formatInventoryRow(row),
    };
  }

  async markInventoryMissingFromImport({
    dealership_id,
    source = null,
    seen_inventory_ids = [],
    next_status = "inactive",
  }) {
    const dealershipId = parsePositiveInteger(dealership_id);
    const seenInventoryIds = seen_inventory_ids.map((value) => parsePositiveInteger(value)).filter(Boolean);
    if (!dealershipId || !stringOrNull(source) || !seenInventoryIds.length) {
      return 0;
    }

    const rows = await this.all(
      `
        UPDATE inventory
        SET
          status = ?,
          is_active = FALSE,
          updated_at = ?
        WHERE dealership_id = ?
          AND source = ?
          AND status = 'active'
          AND id <> ALL(?)
        RETURNING id
      `,
        [normalizeInventoryStatus(next_status), new Date().toISOString(), dealershipId, source, seenInventoryIds]
      );

    return rows.length;
  }

  async linkLeadInventory(leadId, inventoryId, user = null) {
    const lead = await this.getApiLead(leadId, user);
    const inventory = await this.getInventoryForApi(inventoryId, user);

    if (Number(lead.dealership_id) !== Number(inventory.dealership_id)) {
      throw new ValidationError("Inventory unit does not belong to this dealership.");
    }

    await this.execute(
      `
        UPDATE leads
        SET inventory_id = ?, updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [inventory.id, new Date().toISOString(), leadId, lead.dealership_id]
    );

    await this.createLeadActivity({
      lead_id: Number(leadId),
      user_id: user?.id || null,
      type: "note",
      content: `Linked inventory unit ${inventory.stock_number || inventory.vin || inventory.id}.`,
    });

    return this.getApiLeadWithActivities(leadId, user);
  }

  async linkLeadsToInventoryByIdentity({ dealership_id, inventory_id, stock_number = null, vin = null } = {}) {
    const dealershipId = parsePositiveInteger(dealership_id);
    const inventoryId = parsePositiveInteger(inventory_id);
    const stockNumber = normalizeInventoryIdentity(stock_number);
    const normalizedVin = normalizeInventoryIdentity(vin);

    if (!dealershipId || !inventoryId || (!stockNumber && !normalizedVin)) {
      return 0;
    }

    const inventory = await this.get(
      `
        SELECT *
        FROM inventory
        WHERE id = ? AND dealership_id = ?
      `,
      [inventoryId, dealershipId]
    );
    if (!inventory) {
      return 0;
    }

    const clauses = [];
    const params = [];
    const now = new Date().toISOString();
    if (stockNumber) {
      clauses.push("UPPER(BTRIM(COALESCE(stock_number, ''))) = ?");
      params.push(stockNumber);
    }
    if (normalizedVin) {
      clauses.push("UPPER(BTRIM(COALESCE(vehicle_id, ''))) = ?");
      params.push(normalizedVin);
    }

    const rows = await this.all(
      `
        UPDATE leads
        SET
          inventory_id = ?,
          stock_number = COALESCE(?, stock_number),
          vehicle_id = COALESCE(?, vehicle_id),
          vehicle_year = COALESCE(?, vehicle_year),
          vehicle_make = COALESCE(?, vehicle_make),
          vehicle_model = COALESCE(?, vehicle_model),
          vehicle_trim = COALESCE(?, vehicle_trim),
          vehicle_condition = COALESCE(?, vehicle_condition),
          vehicle_price = COALESCE(?, vehicle_price),
          vehicle_interest = COALESCE(?, vehicle_interest),
          updated_at = ?
        WHERE dealership_id = ?
          AND (
            COALESCE(inventory_id, 0) = ?
            OR ${clauses.join(" OR ")}
          )
        RETURNING id
      `,
      [
        inventoryId,
        inventory.stock_number || null,
        inventory.vin || null,
        inventory.year == null ? null : String(inventory.year),
        inventory.make || null,
        inventory.model || null,
        inventory.trim || null,
        inventory.condition || null,
        inventory.price == null ? null : String(inventory.price),
        buildVehicleDisplay(inventory) || null,
        now,
        dealershipId,
        inventoryId,
        ...params,
      ]
    );

    return rows.length;
  }

  async getDashboardApiMetrics(user = null) {
    const access = this.accessClauseForUser(user);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);

    const todayIso = today.toISOString();
    const weekStartIso = weekStart.toISOString();

    const newLeadsToday = Number(
      (
        await this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE created_at >= ? AND ${access.clause}
          `,
          [todayIso, ...access.params]
        )
      ).count
    );

    const leadsThisWeek = Number(
      (
        await this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE created_at >= ? AND ${access.clause}
          `,
          [weekStartIso, ...access.params]
        )
      ).count
    );

    const appointmentsScheduled = Number(
      (
        await this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE status = 'appointment' AND ${access.clause}
          `,
          access.params
        )
      ).count
    );

      const vehiclesSold = Number(
        (
          await this.get(
            `
              SELECT COUNT(*) AS count
              FROM leads
              WHERE status = ? AND ${access.clause}
            `,
            [toStoredStatus("sold"), ...access.params]
          )
        ).count
      );

    const totalLeads = Number(
      (
        await this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE ${access.clause}
          `,
          access.params
        )
      ).count
    );

    return {
      new_leads_today: newLeadsToday,
      leads_this_week: leadsThisWeek,
      appointments_scheduled: appointmentsScheduled,
      vehicles_sold: vehiclesSold,
      conversion_rate: totalLeads > 0 ? Number(((vehiclesSold / totalLeads) * 100).toFixed(1)) : 0,
    };
  }

  async createUser(input, actor = null) {
    const dealershipId = this.currentDealershipId(actor);
    const availability = normalizeRepAvailabilityInput(input);
    const row = await this.get(
      `
        INSERT INTO users (
          dealership_id,
          name,
          email,
          password_hash,
          role,
          is_active,
          is_available,
          working_days_json,
          working_hours_start,
          working_hours_end,
          timezone,
          max_active_leads,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `,
      [
        dealershipId,
        input.name,
        input.email.toLowerCase(),
        input.password_hash,
        input.role,
        availability.is_active,
        availability.is_available,
        JSON.stringify(availability.working_days),
        availability.working_hours_start,
        availability.working_hours_end,
        availability.timezone,
        availability.max_active_leads,
        new Date().toISOString(),
      ]
    );

    return this.getUser(row.id);
  }

  async updateUser(id, input, actor = null) {
    const existing = await this.getUser(id);
    if (Number(existing.dealership_id || getDefaultDealershipId()) !== this.currentDealershipId(actor)) {
      throw new NotFoundError("User not found");
    }
    const availability = normalizeRepAvailabilityInput(input, existing);
    const fields = [
      "name = ?",
      "email = ?",
      "role = ?",
      "is_active = ?",
      "is_available = ?",
      "working_days_json = ?",
      "working_hours_start = ?",
      "working_hours_end = ?",
      "timezone = ?",
      "max_active_leads = ?",
    ];
    const params = [
      input.name,
      input.email.toLowerCase(),
      input.role,
      availability.is_active,
      availability.is_available,
      JSON.stringify(availability.working_days),
      availability.working_hours_start,
      availability.working_hours_end,
      availability.timezone,
      availability.max_active_leads,
    ];

    if (input.password_hash) {
      fields.push("password_hash = ?");
      params.push(input.password_hash);
    }

    params.push(id, this.currentDealershipId(actor));
    await this.execute(
      `
        UPDATE users
        SET ${fields.join(", ")}
        WHERE id = ? AND dealership_id = ?
      `,
      params
    );

    return this.getUser(id);
  }

  async updateUserAvailability(id, input = {}, actor = null) {
    const existing = await this.getUser(id);
    if (Number(existing.dealership_id || getDefaultDealershipId()) !== this.currentDealershipId(actor)) {
      throw new NotFoundError("User not found");
    }

    const availability = normalizeRepAvailabilityInput(input, existing);
    await this.execute(
      `
        UPDATE users
        SET
          is_active = ?,
          is_available = ?,
          working_days_json = ?,
          working_hours_start = ?,
          working_hours_end = ?,
          timezone = ?,
          max_active_leads = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [
        availability.is_active,
        availability.is_available,
        JSON.stringify(availability.working_days),
        availability.working_hours_start,
        availability.working_hours_end,
        availability.timezone,
        availability.max_active_leads,
        id,
        this.currentDealershipId(actor),
      ]
    );

    return this.getUser(id);
  }

  async deleteUser(id, actor = null) {
    const user = await this.getUser(id);
    if (Number(user.dealership_id || getDefaultDealershipId()) !== this.currentDealershipId(actor)) {
      throw new NotFoundError("User not found");
    }

    if (user.role === "admin") {
      const adminCount = Number(
        (
          await this.get(
          `
              SELECT COUNT(*) AS count
              FROM users
              WHERE role = 'admin'
                AND dealership_id = ?
            `
          ,
          [this.currentDealershipId(actor)]
          )
        ).count
      );

      if (adminCount <= 1) {
        throw new ValidationError("You must keep at least one admin user.");
      }
    }

    await this.execute("DELETE FROM users WHERE id = ? AND dealership_id = ?", [id, this.currentDealershipId(actor)]);
  }

  async listSalesUsers(user = null) {
    const rows = await this.all(
      `
        SELECT
          id,
          dealership_id,
          name,
          email,
          role,
          is_active,
          is_available,
          working_days_json,
          working_hours_start,
          working_hours_end,
          timezone,
          max_active_leads,
          created_at
        FROM users
        WHERE role = 'sales'
          AND dealership_id = ?
        ORDER BY LOWER(name) ASC, id ASC
      `,
      [this.currentDealershipId(user)]
    );
    return rows.map((row) => this.formatUserRow(row));
  }

  async listEligibleSalesUsers(context = {}) {
    const dealershipId =
      parsePositiveInteger(context.dealership_id) ||
      (context.user ? this.currentDealershipId(context.user) : getDefaultDealershipId());
    const evaluatedAt = context.now ? new Date(context.now) : new Date();
    const reps = await this.listSalesUsers({ dealership_id: dealershipId });
    return reps.filter((rep) => evaluateRepAvailability(rep, evaluatedAt).eligible);
  }

  contactAssignmentCursorKey(dealershipId) {
    return `contact_assignment_cursor:${Number(dealershipId || getDefaultDealershipId())}`;
  }

  async getSettingValue(key) {
    const row = await this.get("SELECT value FROM crm_settings WHERE key = ?", [key]);
    return row ? row.value : null;
  }

  async setSettingValue(key, value) {
    await this.execute(
      `
        INSERT INTO crm_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
      `,
      [key, value, new Date().toISOString()]
    );
  }

  async getAssignableSalesUser(user = null, options = {}) {
    const dealershipId =
      parsePositiveInteger(options.dealership_id) || (user ? this.currentDealershipId(user) : getDefaultDealershipId());
    const eligible = await this.listEligibleSalesUsers({ dealership_id: dealershipId, now: options.now, user });
    if (!eligible.length) {
      return null;
    }

    const cursorKey = this.contactAssignmentCursorKey(dealershipId);
    const previousAssignedId = parsePositiveInteger(await this.getSettingValue(cursorKey));
    const currentIndex = previousAssignedId
      ? eligible.findIndex((rep) => Number(rep.id) === Number(previousAssignedId))
      : -1;
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % eligible.length;
    const chosen = eligible[nextIndex];
    if (options.advanceCursor !== false) {
      await this.setSettingValue(cursorKey, String(chosen.id));
    }
    return chosen;
  }

  async assignRepToNewContact({ dealership_id = null, user = null, now = null } = {}) {
    const dealershipId = parsePositiveInteger(dealership_id) || this.currentDealershipId(user);
    const rep = await this.getAssignableSalesUser(user, { dealership_id: dealershipId, now });
    if (!rep) {
      return {
        assigned_rep_id: null,
        assignment_method: "unassigned_no_available_rep",
        needs_manual_review: true,
      };
    }

    return {
      assigned_rep_id: Number(rep.id),
      assignment_method: "auto_round_robin",
      needs_manual_review: false,
    };
  }

  async getLegacyLeadForContactResolution({ dealership_id, normalized_phone = null, normalized_email = null } = {}) {
    if (!normalized_phone && !normalized_email) {
      return null;
    }

    const clauses = [];
    const params = [dealership_id];
    if (normalized_phone) {
      clauses.push("(leads.normalized_phone = ? OR contacts.normalized_phone = ?)");
      params.push(normalized_phone, normalized_phone);
    }
    if (normalized_email) {
      clauses.push("(leads.normalized_email = ? OR contacts.normalized_email = ?)");
      params.push(normalized_email, normalized_email);
    }

    const row = await this.get(
      `
        ${this.apiLeadSelectSql()}
        WHERE leads.dealership_id = ?
          AND (${clauses.join(" OR ")})
        ORDER BY leads.updated_at DESC, leads.id DESC
        LIMIT 1
      `,
      params
    );
    return row ? this.formatApiLead(row) : null;
  }

  contactSelectSql() {
    return `
      SELECT
        contacts.id,
        contacts.dealership_id,
        contacts.first_name,
        contacts.last_name,
        contacts.full_name,
        contacts.email,
        contacts.normalized_email,
        contacts.phone,
        contacts.normalized_phone,
        contacts.assigned_rep_id,
        contacts.assignment_method,
        contacts.assignment_locked,
        contacts.needs_manual_review,
        contacts.company,
        contacts.job_title,
        contacts.created_at,
        contacts.updated_at,
        assigned_rep.name AS assigned_rep_name
      FROM contacts
      LEFT JOIN users AS assigned_rep
        ON assigned_rep.id = contacts.assigned_rep_id
       AND assigned_rep.dealership_id = contacts.dealership_id
    `;
  }

  formatContactRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      dealership_id: Number(row.dealership_id || getDefaultDealershipId()),
      first_name: row.first_name || "",
      last_name: row.last_name || "",
      full_name: row.full_name || buildContactFullName(row.first_name, row.last_name),
      email: row.email || null,
      normalized_email: row.normalized_email || null,
      phone: row.phone || null,
      normalized_phone: row.normalized_phone || null,
      assigned_rep_id: row.assigned_rep_id == null ? null : Number(row.assigned_rep_id),
      assigned_rep_name: row.assigned_rep_name || "Unassigned",
      assignment_method: normalizeAssignmentMethod(row.assignment_method, "auto_round_robin"),
      assignment_locked: row.assignment_locked === true || row.assignment_locked === "t" || row.assignment_locked === 1,
      needs_manual_review:
        row.needs_manual_review === true || row.needs_manual_review === "t" || row.needs_manual_review === 1,
      company: row.company || null,
      job_title: row.job_title || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async findContactByNormalizedPhone(normalizedPhone, dealershipId) {
    if (!normalizedPhone) {
      return null;
    }

    const row = await this.get(
      `
        ${this.contactSelectSql()}
        WHERE contacts.dealership_id = ?
          AND contacts.normalized_phone = ?
        ORDER BY contacts.updated_at DESC, contacts.id DESC
        LIMIT 1
      `,
      [dealershipId, normalizedPhone]
    );
    return this.formatContactRow(row);
  }

  async findContactByNormalizedEmail(normalizedEmail, dealershipId) {
    if (!normalizedEmail) {
      return null;
    }

    const row = await this.get(
      `
        ${this.contactSelectSql()}
        WHERE contacts.dealership_id = ?
          AND contacts.normalized_email = ?
        ORDER BY contacts.updated_at DESC, contacts.id DESC
        LIMIT 1
      `,
      [dealershipId, normalizedEmail]
    );
    return this.formatContactRow(row);
  }

  async linkLeadToContact(leadId, contactId, dealershipId, assignedTo = null) {
    await this.execute(
      `
        UPDATE leads
        SET
          contact_id = ?,
          assigned_to = COALESCE(assigned_to, ?),
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [contactId, assignedTo, new Date().toISOString(), leadId, dealershipId]
    );
  }

  async assignContact(id, assignedRepId, actor = null, options = {}) {
    const contact = await this.getContact(id, actor);
    let assignee = null;
    if (assignedRepId != null) {
      assignee = await this.getUser(assignedRepId);
      if (Number(assignee.dealership_id || getDefaultDealershipId()) !== Number(contact.dealership_id || getDefaultDealershipId())) {
        throw new ValidationError("Choose a valid salesperson.");
      }
      if (assignee.role !== "sales") {
        throw new ValidationError("Choose a valid salesperson.");
      }
    }

    await this.execute(
      `
        UPDATE contacts
        SET
          assigned_rep_id = ?,
          assignment_method = ?,
          needs_manual_review = COALESCE(?, needs_manual_review),
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [
        assignedRepId || null,
        options.assignment_method || (assignedRepId ? "manual_override" : "manual_unassigned"),
        options.needs_manual_review == null ? null : Boolean(options.needs_manual_review),
        new Date().toISOString(),
        id,
        contact.dealership_id,
      ]
    );

    return this.getContact(id, actor);
  }

  async findOrCreateContactFromLead(input = {}, user = null, options = {}) {
    const dealershipId =
      parsePositiveInteger(input.dealership_id) ||
      parsePositiveInteger(options.dealership_id) ||
      (user ? this.currentDealershipId(user) : getDefaultDealershipId());
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    const normalizedEmail = normalizeLeadEmailForStorage(input.email);
    const parsedName = splitCustomerNameParts(normalizeLeadCustomerName(input.customer_name || "", "NN Lead"));
    const now = options.now || new Date().toISOString();

    const phoneMatch = normalizedPhone ? await this.findContactByNormalizedPhone(normalizedPhone, dealershipId) : null;
    const emailMatch = normalizedEmail ? await this.findContactByNormalizedEmail(normalizedEmail, dealershipId) : null;

    if (phoneMatch && emailMatch && Number(phoneMatch.id) !== Number(emailMatch.id)) {
      const assignment = await this.assignRepToNewContact({ dealership_id: dealershipId, user, now });
      const conflictContact = await this.createContact(
        {
          first_name: parsedName.firstName,
          last_name: parsedName.lastName,
          email: input.email || null,
          phone: input.phone || null,
          company: null,
          job_title: null,
          assigned_rep_id: assignment.assigned_rep_id,
          assignment_method: "conflict_review",
          needs_manual_review: true,
        },
        user,
        { dealership_id: dealershipId, now }
      );

      return {
        contact: conflictContact,
        created: true,
        reason: "conflicting_identity_match",
        needs_manual_review: true,
      };
    }

    const matchedContact = phoneMatch || emailMatch;
    if (matchedContact) {
      const mergedFirstName = matchedContact.first_name || parsedName.firstName || "";
      const mergedLastName = matchedContact.last_name || parsedName.lastName || "";
      const nextEmail = matchedContact.email || input.email || null;
      const nextPhone = matchedContact.phone || input.phone || null;
      const requiresUpdate =
        mergedFirstName !== matchedContact.first_name ||
        mergedLastName !== matchedContact.last_name ||
        nextEmail !== matchedContact.email ||
        nextPhone !== matchedContact.phone;

      const contact = requiresUpdate
        ? await this.updateContact(
            matchedContact.id,
            {
              first_name: mergedFirstName,
              last_name: mergedLastName,
              email: nextEmail,
              phone: nextPhone,
              company: matchedContact.company,
              job_title: matchedContact.job_title,
              assigned_rep_id: matchedContact.assigned_rep_id,
              assignment_method: matchedContact.assignment_method,
              needs_manual_review: matchedContact.needs_manual_review,
              assignment_locked: matchedContact.assignment_locked,
            },
            user
          )
        : matchedContact;

      return {
        contact,
        created: false,
        reason: phoneMatch ? "normalized_phone" : "normalized_email",
        needs_manual_review: contact.needs_manual_review,
      };
    }

    const legacyLead = await this.getLegacyLeadForContactResolution({
      dealership_id: dealershipId,
      normalized_phone: normalizedPhone,
      normalized_email: normalizedEmail,
    });
    if (legacyLead?.contact_id) {
      const legacyContact = await this.getContact(Number(legacyLead.contact_id), { dealership_id: dealershipId });
      return {
        contact: legacyContact,
        created: false,
        reason: "legacy_contact_link",
        needs_manual_review: legacyContact.needs_manual_review,
      };
    }

    if (legacyLead && !legacyLead.contact_id) {
      const legacyName = splitCustomerNameParts(normalizeLeadCustomerName(legacyLead.customer_name || "", "NN Lead"));
      const assignment =
        legacyLead.assigned_to != null
          ? {
              assigned_rep_id: Number(legacyLead.assigned_to),
              assignment_method: "legacy_lead_owner",
              needs_manual_review: false,
            }
          : await this.assignRepToNewContact({ dealership_id: dealershipId, user, now });
      const legacyContact = await this.createContact(
        {
          first_name: parsedName.firstName || legacyName.firstName,
          last_name: parsedName.lastName || legacyName.lastName,
          email: input.email || legacyLead.email || null,
          phone: input.phone || legacyLead.phone || null,
          company: null,
          job_title: null,
          assigned_rep_id: assignment.assigned_rep_id,
          assignment_method: assignment.assignment_method,
          needs_manual_review: assignment.needs_manual_review || !(normalizedPhone || normalizedEmail),
        },
        user,
        { dealership_id: dealershipId, now }
      );
      await this.linkLeadToContact(legacyLead.id, legacyContact.id, dealershipId, legacyContact.assigned_rep_id);
      return {
        contact: legacyContact,
        created: true,
        reason: "legacy_lead_promoted_to_contact",
        needs_manual_review: legacyContact.needs_manual_review,
      };
    }

    const assignment = await this.assignRepToNewContact({ dealership_id: dealershipId, user, now });
    const contact = await this.createContact(
      {
        first_name: parsedName.firstName,
        last_name: parsedName.lastName,
        email: input.email || null,
        phone: input.phone || null,
        company: null,
        job_title: null,
        assigned_rep_id: assignment.assigned_rep_id,
        assignment_method: assignment.assignment_method,
        needs_manual_review: assignment.needs_manual_review || !(normalizedPhone || normalizedEmail),
      },
      user,
      { dealership_id: dealershipId, now }
    );

    return {
      contact,
      created: true,
      reason: normalizedPhone || normalizedEmail ? "new_contact" : "missing_identity",
      needs_manual_review: contact.needs_manual_review,
    };
  }

  async listContacts(user = null) {
    const rows = await this.all(
      `
        ${this.contactSelectSql()}
        WHERE contacts.dealership_id = ?
        ${this.contactOrderSql()}
      `,
      [this.currentDealershipId(user)]
    );
    return rows.map((row) => this.formatContactRow(row));
  }

  async listContactsForSelect(user = null) {
    const contacts = await this.listContacts(user);
    return contacts.map((contact) => ({
      ...contact,
      display_name: this.displayContactName(contact),
    }));
  }

  async getContact(id, user = null) {
    const dealershipId =
      parsePositiveInteger(user?.dealership_id) ||
      parsePositiveInteger(user?.dealershipId) ||
      this.currentDealershipId(user);
    const row = await this.get(
      `
        ${this.contactSelectSql()}
        WHERE id = ?
          AND contacts.dealership_id = ?
      `,
      [id, dealershipId]
    );

    if (!row) {
      throw new NotFoundError("Contact not found");
    }

    return this.formatContactRow(row);
  }

  async getContactLeads(contactId, user) {
    const access = this.accessClauseForUser(user);
    return this.all(
      `
        ${this.leadSelectSql()}
        WHERE leads.contact_id = ? AND ${access.clause}
        ORDER BY leads.updated_at DESC
      `,
      [contactId, ...access.params]
    );
  }

  async createContact(input, user = null, options = {}) {
    const now = options.now || new Date().toISOString();
    const dealershipId = parsePositiveInteger(options.dealership_id) || this.currentDealershipId(user);
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    const normalizedEmail = normalizeLeadEmailForStorage(input.email);
    const firstName = String(input.first_name || "").trim();
    const lastName = String(input.last_name || "").trim();
    const fullName = buildContactFullName(firstName, lastName);
    const row = await this.get(
      `
        INSERT INTO contacts (
          dealership_id,
          first_name,
          last_name,
          full_name,
          email,
          normalized_email,
          phone,
          normalized_phone,
          assigned_rep_id,
          assignment_method,
          assignment_locked,
          needs_manual_review,
          company,
          job_title,
          created_at,
          updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `,
        [
          dealershipId,
          firstName,
          lastName,
          fullName,
          input.email,
          normalizedEmail,
          input.phone,
          normalizedPhone,
          parsePositiveInteger(input.assigned_rep_id),
          normalizeAssignmentMethod(input.assignment_method, "auto_round_robin"),
          Boolean(input.assignment_locked),
          Boolean(input.needs_manual_review),
          input.company,
          input.job_title,
          now,
          now,
      ]
    );

    return this.getContact(row.id, { dealership_id: dealershipId });
  }

  async updateContact(id, input, user = null) {
    const existing = await this.getContact(id, user);
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    const normalizedEmail = normalizeLeadEmailForStorage(input.email);
    const firstName = String(input.first_name || "").trim();
    const lastName = String(input.last_name || "").trim();
    await this.execute(
      `
        UPDATE contacts
        SET
          first_name = ?,
          last_name = ?,
          full_name = ?,
          email = ?,
          normalized_email = ?,
          phone = ?,
          normalized_phone = ?,
          assigned_rep_id = COALESCE(?, assigned_rep_id),
          assignment_method = COALESCE(?, assignment_method),
          assignment_locked = COALESCE(?, assignment_locked),
          needs_manual_review = COALESCE(?, needs_manual_review),
          company = ?,
          job_title = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [
        firstName,
        lastName,
        buildContactFullName(firstName, lastName),
        input.email,
        normalizedEmail,
        input.phone,
        normalizedPhone,
        parsePositiveInteger(input.assigned_rep_id),
        stringOrNull(input.assignment_method),
        input.assignment_locked == null ? null : Boolean(input.assignment_locked),
        input.needs_manual_review == null ? null : Boolean(input.needs_manual_review),
        input.company,
        input.job_title,
        new Date().toISOString(),
        id,
        existing.dealership_id,
      ]
    );

    return this.getContact(id, { dealership_id: existing.dealership_id });
  }

  async deleteContact(id, user = null) {
    await this.getContact(id, user);
    await this.execute("DELETE FROM contacts WHERE id = ? AND dealership_id = ?", [id, this.currentDealershipId(user)]);
  }

  async listLeads(user) {
    const access = this.accessClauseForUser(user);
    return this.all(
      `
        ${this.leadSelectSql()}
        WHERE ${access.clause}
        ORDER BY
          CASE WHEN leads.follow_up_date IS NULL OR leads.follow_up_date = '' THEN 1 ELSE 0 END,
          leads.follow_up_date ASC,
          leads.updated_at DESC
      `,
      access.params
    );
  }

  async getLead(id, user) {
    const access = this.accessClauseForUser(user);
    const lead = await this.get(
      `
        ${this.leadSelectSql()}
        WHERE leads.id = ? AND ${access.clause}
      `,
      [id, ...access.params]
    );

    if (!lead) {
      throw new NotFoundError("Lead not found");
    }

    return lead;
  }

  async createLead(input, user = null) {
    const assigneeId = input.assigned_to || null;
    const now = new Date().toISOString();
    const dealershipId = this.currentDealershipId(user);

    const row = await this.get(
      `
        INSERT INTO leads (
          dealership_id,
          contact_id,
          assigned_to,
          source,
          status,
          priority,
          follow_up_date,
          next_action,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `,
      [
        dealershipId,
        input.contact_id,
        assigneeId,
        input.source || "manual",
        input.status,
        input.priority,
        input.follow_up_date,
        input.next_action,
        now,
        now,
      ]
    );

    return this.getLead(row.id, user);
  }

  async updateLead(id, input, user = null) {
    const existing = await this.getLead(id, user);
    await this.execute(
      `
        UPDATE leads
        SET
          contact_id = ?,
          assigned_to = ?,
          source = ?,
          status = ?,
          priority = ?,
          follow_up_date = ?,
          next_action = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [
        input.contact_id,
        input.assigned_to,
        input.source,
        input.status,
        input.priority,
        input.follow_up_date,
        input.next_action,
        new Date().toISOString(),
        id,
        existing.dealership_id,
      ]
    );

    return this.getLead(id, user);
  }

  async assignLead(id, assignedTo, actor = null) {
    const lead = await this.getLead(id, actor);
    const assignee = await this.getUser(assignedTo);
    if (Number(assignee.dealership_id || getDefaultDealershipId()) !== Number(lead.dealership_id || getDefaultDealershipId())) {
      throw new ValidationError("Choose a valid salesperson.");
    }
    await this.execute(
      `
        UPDATE leads
        SET
          assigned_to = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [assignedTo, new Date().toISOString(), id, lead.dealership_id]
    );
    await this.createActivity({
      lead_id: id,
      type: "note_added",
      content: `Lead assigned to ${assignee.name}.`,
    });
    await this.createNotification({
      user_id: assignedTo,
      lead_id: id,
      type: "lead_assigned",
      title: "New lead assigned",
      body: `You were assigned lead #${id}.`,
      unique_key: `lead-assigned:${id}:${assignedTo}`,
      metadata: { lead_id: Number(id) },
    });
    await this.refreshEmailIntakeStateForLead(id);

    return this.getLead(id, actor);
  }

  async updateLeadStatusIfNew(id, status = "contacted", user = null) {
    const lead = user
      ? await this.getLead(id, user)
      : await this.get("SELECT id, dealership_id, status FROM leads WHERE id = ?", [id]);
    if (!lead) {
      throw new NotFoundError("Lead not found");
    }
    if (lead.status !== "new") {
      return lead;
    }

    await this.execute(
      `
        UPDATE leads
        SET
          status = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [status, new Date().toISOString(), id, lead.dealership_id]
    );
    await this.refreshEmailIntakeStateForLead(id);

    return user
      ? this.getLead(id, user)
      : this.get("SELECT id, dealership_id, assigned_to, status FROM leads WHERE id = ?", [id]);
  }

  async deleteLead(id, user = null) {
    const lead = await this.getLead(id, user);
    await this.execute("DELETE FROM leads WHERE id = ? AND dealership_id = ?", [id, lead.dealership_id]);
  }

  async listLeadNotes(leadId) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      return [];
    }

    return this.all(
      `
        SELECT id, lead_id, body, created_at
        FROM notes
        WHERE lead_id = ?
          AND dealership_id = ?
        ORDER BY created_at DESC, id DESC
      `,
      [leadId, dealershipId]
    );
  }

  async addLeadNote(leadId, body, userId = null) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      throw new NotFoundError("Lead not found");
    }
    await this.execute(
      `
        INSERT INTO notes (dealership_id, lead_id, body, created_at)
        VALUES (?, ?, ?, ?)
      `,
      [dealershipId, leadId, body, new Date().toISOString()]
    );
    await this.createLeadActivity({
      lead_id: leadId,
      user_id: userId,
      type: "note",
      content: body,
    });

    return this.listLeadNotes(leadId);
  }

  async createLeadActivity(input) {
    const type = String(input.type || "").trim().toLowerCase();
    const dealershipId = await this.resolveDealershipIdContext(input);
    if (!LEAD_ACTIVITY_TYPES.includes(type)) {
      throw new ValidationError("Invalid lead activity type.");
    }

    await this.execute(
      `
        INSERT INTO lead_activities (dealership_id, lead_id, user_id, type, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        dealershipId,
        input.lead_id,
        input.user_id || null,
        type,
        input.content,
        input.created_at || new Date().toISOString(),
      ]
    );
  }

  async recordLeadActivity({ lead_id, user_id = null, type, content, created_at = null }) {
    const dealershipId = await this.getDealershipIdForLead(lead_id);
    if (!dealershipId) {
      throw new NotFoundError("Lead not found");
    }
    await this.createLeadActivity({
      lead_id,
      user_id,
      type,
      content,
      created_at,
    });

    if (type === "sms" || type === "call") {
      await this.updateLeadStatusIfNew(lead_id, "contacted");
    }

    return this.listLeadActivities(lead_id);
  }

  async listLeadActivities(leadId) {
    const dealershipId = await this.getDealershipIdForLead(leadId);
    if (!dealershipId) {
      return [];
    }

    return this.all(
      `
        ${this.activitySelectSql()}
        WHERE lead_activities.lead_id = ?
          AND lead_activities.dealership_id = ?
        ORDER BY lead_activities.created_at DESC, lead_activities.id DESC
      `,
      [leadId, dealershipId]
    );
  }

  async listRecentActivities(user, limit = 8) {
    const access = this.accessClauseForUser(user);
    return this.all(
      `
        ${this.activitySelectSql()}
        WHERE ${access.clause}
        ORDER BY lead_activities.created_at DESC, lead_activities.id DESC
        LIMIT ?
      `,
      [...access.params, limit]
    );
  }

  async findLeadByPhone(phone, context = {}) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return null;
    }
    const dealershipId = Number(context.dealership_id || context.user?.dealership_id || getDefaultDealershipId());

    const matched = await this.get(
      `
        ${this.apiLeadSelectSql()}
        WHERE leads.dealership_id = ?
          AND (leads.normalized_phone = ? OR contacts.normalized_phone = ?)
        ORDER BY leads.updated_at DESC, leads.id DESC
      `,
      [dealershipId, normalizedPhone, normalizedPhone]
    );

    return matched ? this.formatApiLead(matched) : null;
  }

  async getDashboardMetrics(user) {
    const access = this.accessClauseForUser(user);
    const today = toDateOnlyString();

    const totalLeads = Number(
      (
        await this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE ${access.clause}
          `,
          access.params
        )
      ).count
    );

    const statusCounts = await Promise.all(
      CRM_LEAD_STATUSES.map(async (status) => ({
        status,
        count: Number(
          (
            await this.get(
              `
                SELECT COUNT(*) AS count
                FROM leads
                WHERE status = ? AND ${access.clause}
              `,
              [toStoredStatus(status), ...access.params]
            )
          ).count
        ),
      }))
    );

    const followUps = {
      overdue: Number(
        (
          await this.get(
            `
              SELECT COUNT(*) AS count
              FROM leads
              WHERE follow_up_date IS NOT NULL
                AND follow_up_date <> ''
                AND follow_up_date < ?
                AND ${access.clause}
            `,
            [today, ...access.params]
          )
        ).count
      ),
      today: Number(
        (
          await this.get(
            `
              SELECT COUNT(*) AS count
              FROM leads
              WHERE follow_up_date IS NOT NULL
                AND follow_up_date <> ''
                AND follow_up_date = ?
                AND ${access.clause}
            `,
            [today, ...access.params]
          )
        ).count
      ),
      upcoming: Number(
        (
          await this.get(
            `
              SELECT COUNT(*) AS count
              FROM leads
              WHERE follow_up_date IS NOT NULL
                AND follow_up_date <> ''
                AND follow_up_date > ?
                AND ${access.clause}
            `,
            [today, ...access.params]
          )
        ).count
      ),
    };

    const upcomingLeads = await this.all(
      `
        ${this.leadSelectSql()}
        WHERE leads.follow_up_date IS NOT NULL
          AND leads.follow_up_date <> ''
          AND ${access.clause}
        ORDER BY leads.follow_up_date ASC, leads.updated_at DESC
        LIMIT 5
      `,
      access.params
    );

    const leadsPerSalesperson = canViewAllLeads(user)
      ? (
          await this.all(
            `
              SELECT
                users.id,
                users.dealership_id,
                users.name,
                COUNT(leads.id) AS count
              FROM users
              LEFT JOIN leads ON leads.assigned_to = users.id AND leads.dealership_id = users.dealership_id
              WHERE users.role = 'sales'
                AND users.dealership_id = ?
              GROUP BY users.id, users.dealership_id, users.name
              ORDER BY LOWER(users.name) ASC
            `,
            [this.currentDealershipId(user)]
          )
        ).map((row) => ({
          ...row,
          count: Number(row.count),
        }))
      : [];

    const recentActivities = await this.listRecentActivities(user);

    return {
      followUps,
      leadsPerSalesperson,
      recentActivities,
      statusCounts,
      totalLeads,
      upcomingLeads,
    };
  }

  async getDefaultAssigneeId() {
    const user = await this.getAssignableSalesUser(null, { advanceCursor: false });
    return user ? Number(user.id) : null;
  }

  async getImportedMessageByExternalId(externalId, dealershipId = getDefaultDealershipId()) {
    return this.get(
      `
        SELECT id, external_id, source, lead_id, subject, sender, received_at, status, matched_reason, created_at
        FROM imported_messages
        WHERE external_id = ?
          AND dealership_id = ?
      `,
      [externalId, dealershipId]
    );
  }

  emailIntakeSelectSql() {
    return `
      SELECT
        email_intake_items.id,
        email_intake_items.dealership_id,
        email_intake_items.external_id,
        email_intake_items.source,
        email_intake_items.subject,
        email_intake_items.sender,
        email_intake_items.message,
        email_intake_items.received_at,
        email_intake_items.classification,
        email_intake_items.status,
        email_intake_items.assigned_to,
        email_intake_items.lead_id,
        email_intake_items.customer_name,
        email_intake_items.phone,
        email_intake_items.normalized_phone,
        email_intake_items.email,
        email_intake_items.stock_number,
        email_intake_items.inventory_id,
        email_intake_items.vehicle_display,
        email_intake_items.raw_payload_json,
        email_intake_items.created_at,
        email_intake_items.updated_at,
        users.name AS assigned_user_name,
        leads.status AS lead_status,
        inventory.vin AS inventory_vin,
        inventory.year AS inventory_year,
        inventory.make AS inventory_make,
        inventory.model AS inventory_model,
        inventory.trim AS inventory_trim
      FROM email_intake_items
      LEFT JOIN users ON users.id = email_intake_items.assigned_to
      LEFT JOIN leads ON leads.id = email_intake_items.lead_id
      LEFT JOIN inventory ON inventory.id = email_intake_items.inventory_id
    `;
  }

  formatEmailIntakeItem(row) {
    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      dealership_id: Number(row.dealership_id),
      external_id: row.external_id,
      source: row.source,
      subject: row.subject || "",
      sender: row.sender || "",
      message: row.message || "",
      received_at: row.received_at || null,
      classification: row.classification,
      status: row.status,
      assigned_to: row.assigned_to == null ? null : Number(row.assigned_to),
      assigned_user_name: row.assigned_user_name || null,
      lead_id: row.lead_id == null ? null : Number(row.lead_id),
      lead_status: row.lead_status || null,
      customer_name: row.customer_name || null,
      phone: row.phone || null,
      normalized_phone: row.normalized_phone || null,
      email: row.email || null,
      stock_number: row.stock_number || null,
      inventory_id: row.inventory_id == null ? null : Number(row.inventory_id),
      vehicle_display:
        row.vehicle_display ||
        buildVehicleDisplay({
          year: row.inventory_year,
          make: row.inventory_make,
          model: row.inventory_model,
          trim: row.inventory_trim,
        }) ||
        null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async getEmailIntakeItemByExternalId(externalId, dealershipId = getDefaultDealershipId()) {
    return this.formatEmailIntakeItem(
      await this.get(
        `
          ${this.emailIntakeSelectSql()}
          WHERE email_intake_items.external_id = ?
            AND email_intake_items.dealership_id = ?
        `,
        [externalId, dealershipId]
      )
    );
  }

  async getEmailIntakeItem(id, user = null) {
    const dealershipId = this.currentDealershipId(user);
    const row = await this.get(
      `
        ${this.emailIntakeSelectSql()}
        WHERE email_intake_items.id = ?
          AND email_intake_items.dealership_id = ?
      `,
      [id, dealershipId]
    );

    if (!row) {
      throw new NotFoundError("Email intake item not found");
    }

    return this.formatEmailIntakeItem(row);
  }

  async getEmailIntakeSummary(user = null) {
    const dealershipId = this.currentDealershipId(user);
    const rows = await this.all(
      `
        SELECT classification, status, COUNT(*) AS count
        FROM email_intake_items
        WHERE dealership_id = ?
        GROUP BY classification, status
      `,
      [dealershipId]
    );
    const summary = { direct_leads_pending: 0, others_pending: 0 };

    rows.forEach((row) => {
      if (row.classification === "direct_lead" && row.status === "unassigned") {
        summary.direct_leads_pending = Number(row.count || 0);
      }
      if (row.classification === "other" && row.status === "open") {
        summary.others_pending = Number(row.count || 0);
      }
    });

    return summary;
  }

  async listEmailIntakeItems(filters = {}, user = null) {
    const dealershipId = this.currentDealershipId(user);
    const clauses = ["email_intake_items.dealership_id = ?"];
    const params = [dealershipId];
    const limit = Math.max(1, Math.min(200, Number(filters.limit) || 100));
    const offset = Math.max(0, Number(filters.offset) || 0);
    const classification = filters.classification ? normalizeEmailIntakeClassification(filters.classification) : "";

    if (classification) {
      clauses.push("email_intake_items.classification = ?");
      params.push(classification);
    }

    const pendingOnly = filters.pending_only !== false;
    if (pendingOnly && classification) {
      clauses.push(classification === "direct_lead" ? "email_intake_items.status = 'unassigned'" : "email_intake_items.status = 'open'");
    } else if (filters.status) {
      clauses.push("email_intake_items.status = ?");
      params.push(normalizeEmailIntakeStatus(classification || "other", filters.status));
    }

    if (String(filters.search || "").trim()) {
      const term = `%${String(filters.search).trim().toLowerCase()}%`;
      clauses.push(`
        (
          LOWER(COALESCE(email_intake_items.customer_name, '')) LIKE ?
          OR LOWER(COALESCE(email_intake_items.phone, '')) LIKE ?
          OR LOWER(COALESCE(email_intake_items.email, '')) LIKE ?
          OR LOWER(COALESCE(email_intake_items.subject, '')) LIKE ?
          OR LOWER(COALESCE(email_intake_items.message, '')) LIKE ?
          OR LOWER(COALESCE(email_intake_items.vehicle_display, '')) LIKE ?
          OR LOWER(COALESCE(email_intake_items.stock_number, '')) LIKE ?
        )
      `);
      params.push(term, term, term, term, term, term, term);
    }

    const countRow = await this.get(
      `SELECT COUNT(*) AS count FROM email_intake_items WHERE ${clauses.join(" AND ")}`,
      params
    );
    const rows = await this.all(
      `
        ${this.emailIntakeSelectSql()}
        WHERE ${clauses.join(" AND ")}
        ORDER BY COALESCE(email_intake_items.received_at, email_intake_items.created_at) DESC, email_intake_items.id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return {
      items: rows.map((row) => this.formatEmailIntakeItem(row)),
      total: Number(countRow?.count || 0),
      summary: await this.getEmailIntakeSummary(user),
    };
  }

  async createEmailIntakeItem(input = {}, user = null) {
    const now = new Date().toISOString();
    const dealershipId =
      parsePositiveInteger(input.dealership_id) || (user ? this.currentDealershipId(user) : getDefaultDealershipId());
    const classification = normalizeEmailIntakeClassification(input.classification);
    const status = normalizeEmailIntakeStatus(classification, input.status);
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    const inventoryId =
      parsePositiveInteger(input.inventory_id) ||
      (await this.resolveLeadInventoryId(
        {
          stock_number: input.stock_number,
          vehicle_id: input.vehicle_id || input.vin,
        },
        dealershipId
      ));
    const inventory = inventoryId
      ? await this.get("SELECT * FROM inventory WHERE id = ? AND dealership_id = ?", [inventoryId, dealershipId])
      : null;

    await this.execute(
      `
        INSERT INTO email_intake_items (
          dealership_id,
          external_id,
          source,
          subject,
          sender,
          message,
          received_at,
          classification,
          status,
          assigned_to,
          lead_id,
          customer_name,
          phone,
          normalized_phone,
          email,
          stock_number,
          inventory_id,
          vehicle_display,
          raw_payload_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        dealershipId,
        input.external_id,
        input.source || "email",
        input.subject || null,
        input.sender || null,
        input.message || null,
        input.received_at || now,
        classification,
        status,
        parsePositiveInteger(input.assigned_to),
        parsePositiveInteger(input.lead_id),
        input.customer_name || null,
        input.phone || null,
        normalizedPhone,
        input.email || null,
        inventory?.stock_number || input.stock_number || null,
        inventoryId,
        buildVehicleDisplay(inventory || {}) || input.vehicle_display || null,
        input.raw_payload_json || null,
        now,
        now,
      ]
    );

    return this.getEmailIntakeItemByExternalId(input.external_id, dealershipId);
  }

  async refreshEmailIntakeStateForLead(leadId) {
    const lead = await this.getApiLead(leadId);
    const intakeStatus = lead.status === "new" ? (lead.assigned_to ? "assigned" : "unassigned") : "contacted";
    await this.execute(
      `
        UPDATE email_intake_items
        SET assigned_to = ?, status = ?, updated_at = ?
        WHERE lead_id = ?
          AND dealership_id = ?
          AND classification = 'direct_lead'
      `,
      [lead.assigned_to || null, intakeStatus, new Date().toISOString(), leadId, lead.dealership_id]
    );
  }

  async assignEmailIntakeItem(id, assignedTo, user = null) {
    const item = await this.getEmailIntakeItem(id, user);
    if (item.classification !== "direct_lead") {
      throw new ValidationError("Only direct leads can be assigned.");
    }

    let leadId = item.lead_id;
    if (!leadId) {
      const lead = await this.createApiLead(
        {
          source: item.source,
          customer_name: item.customer_name,
          phone: item.phone,
          email: item.email,
          stock_number: item.stock_number,
          vehicle_interest: item.vehicle_display,
          message: item.message,
          inventory_id: item.inventory_id,
        },
        user
      );
      leadId = Number(lead.id);
    }

    await this.assignLead(leadId, assignedTo, user);
    await this.execute(
      `
        UPDATE email_intake_items
        SET assigned_to = ?, lead_id = ?, status = 'assigned', updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [assignedTo, leadId, new Date().toISOString(), id, item.dealership_id]
    );
    await this.refreshEmailIntakeStateForLead(leadId);

    return this.getEmailIntakeItem(id, user);
  }

  async resolveEmailIntakeItem(id, user = null) {
    const item = await this.getEmailIntakeItem(id, user);
    if (item.classification !== "other") {
      throw new ValidationError("Only 'Others' items can be resolved.");
    }

    await this.execute(
      `
        UPDATE email_intake_items
        SET status = 'resolved', updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [new Date().toISOString(), id, item.dealership_id]
    );

    return this.getEmailIntakeItem(id, user);
  }

  async convertEmailIntakeItemToLead(id, input = {}, user = null) {
    const item = await this.getEmailIntakeItem(id, user);
    if (item.classification !== "other") {
      throw new ValidationError("Only 'Others' items can be converted into leads.");
    }

    let leadId = item.lead_id;
    if (!leadId) {
      const lead = await this.createApiLead(
        {
          source: item.source,
          customer_name: input.customer_name || item.customer_name,
          phone: item.phone,
          email: item.email,
          stock_number: item.stock_number,
          vehicle_interest: item.vehicle_display,
          message: input.message || item.message,
          inventory_id: item.inventory_id,
          assigned_to: input.assigned_to || null,
          status: "new",
        },
        user
      );
      leadId = Number(lead.id);
    }

    const normalizedAssignedTo = parsePositiveInteger(input.assigned_to);
    if (normalizedAssignedTo) {
      await this.assignLead(leadId, normalizedAssignedTo, user);
    }

    const lead = await this.getApiLead(leadId, user);
    await this.execute(
      `
        UPDATE email_intake_items
        SET lead_id = ?, assigned_to = ?, status = 'converted_to_lead', updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [leadId, lead.assigned_to || null, new Date().toISOString(), id, item.dealership_id]
    );

    return {
      item: await this.getEmailIntakeItem(id, user),
      lead: await this.getApiLeadWithActivities(leadId, user),
    };
  }

  async recordImportedMessage(input) {
    const dealershipId = getDefaultDealershipId();
    await this.execute(
      `
        INSERT INTO imported_messages (
          dealership_id,
          external_id,
          source,
          lead_id,
          subject,
          sender,
          received_at,
          status,
          matched_reason,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        dealershipId,
        input.external_id,
        input.source,
        input.lead_id || null,
        input.subject || null,
        input.sender || null,
        input.received_at || null,
        input.status || "imported",
        input.matched_reason || null,
        input.created_at || new Date().toISOString(),
      ]
    );

    return this.getImportedMessageByExternalId(input.external_id, dealershipId);
  }

  async findLeadDuplicate(input = {}, context = {}) {
    const phone = normalizeLeadPhoneForStorage(input.phone);
    const email = normalizeLeadEmailForStorage(input.email);
    const customerName = normalizeComparableText(input.customer_name);
    const stockNumber = normalizeInventoryIdentity(input.stock_number);
    const vin = normalizeInventoryIdentity(input.vehicle_id || input.vin);
    const dealershipId = Number(context.dealership_id || context.user?.dealership_id || getDefaultDealershipId());
    const excludeLeadId = parsePositiveInteger(context.exclude_lead_id);
    const buildMatch = async (whereClause, params, reason) => {
      const row = await this.get(
        `
          ${this.apiLeadSelectSql()}
          WHERE leads.dealership_id = ?
            AND ${whereClause}
            ${excludeLeadId ? "AND leads.id <> ?" : ""}
          ORDER BY leads.updated_at DESC, leads.id DESC
          LIMIT 1
        `,
        excludeLeadId ? [dealershipId, ...params, excludeLeadId] : [dealershipId, ...params]
      );

      return row ? { lead: this.formatApiLead(row), reason } : null;
    };

    if (phone) {
      const phoneMatch = await buildMatch("leads.normalized_phone = ?", [phone], "normalized_phone");
      if (phoneMatch) {
        return phoneMatch;
      }
    }

    if (email) {
      const emailMatch = await buildMatch("leads.normalized_email = ?", [email], "normalized_email");
      if (emailMatch) {
        return emailMatch;
      }
    }

    if (customerName && stockNumber) {
      const nameStockMatch = await buildMatch(
        "LOWER(BTRIM(COALESCE(leads.customer_name, ''))) = ? AND UPPER(BTRIM(COALESCE(leads.stock_number, inventory.stock_number, ''))) = ?",
        [customerName, stockNumber],
        "name_stock"
      );
      if (nameStockMatch) {
        return nameStockMatch;
      }
    }

    if (customerName && vin) {
      const nameVinMatch = await buildMatch(
        "LOWER(BTRIM(COALESCE(leads.customer_name, ''))) = ? AND UPPER(BTRIM(COALESCE(leads.vehicle_id, inventory.vin, ''))) = ?",
        [customerName, vin],
        "name_vin"
      );
      if (nameVinMatch) {
        return nameVinMatch;
      }
    }

    return null;
  }
}

module.exports = {
  PostgresCrmDatabase,
};
