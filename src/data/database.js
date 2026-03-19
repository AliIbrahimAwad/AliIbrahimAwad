const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const { getDefaultDealershipId } = require("../config/dealership");
const { DEFAULT_EXECUTION_SETTINGS, normalizeExecutionSettings } = require("../config/executionSettings");
const { categorizeOrganizedLead, evaluateLeadAttention } = require("../models/attention");
const { canTransitionLeadStatus, CRM_LEAD_STATUSES } = require("../models/leadStatus");
const { canViewAllLeads } = require("../models/user");
const { LEAD_ACTIVITY_TYPES } = require("../types/models");
const { toDateOnlyString } = require("../utils/dates");
const { normalizePhone } = require("../utils/phones");
const {
  BaseCrmDatabase,
  DEALER_PIPELINE_STATUSES,
  fromStoredStatus,
  HttpError,
  NotFoundError,
  titleCaseStatus,
  toStoredStatus,
  UnauthorizedError,
  ValidationError,
} = require("./core");

function ensureNumber(value) {
  return value == null || value === "" ? null : Number(value);
}

function normalizeLeadPhoneForStorage(value) {
  return normalizePhone(value) || null;
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

function plusMinutes(dateString, minutes) {
  const date = new Date(dateString || Date.now());
  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return date.toISOString();
}

function stringOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeInventoryIdentity(value) {
  return stringOrNull(value)?.toUpperCase() || null;
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

function normalizeInventoryVerified(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (!normalized) {
    return "yes";
  }

  if (["yes", "true", "verified", "1"].includes(normalized)) {
    return "yes";
  }

  if (["no", "false", "unverified", "0"].includes(normalized)) {
    return "no";
  }

  return "yes";
}

function isTruthyFilter(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

const SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT,
    phone TEXT,
    normalized_phone TEXT,
    company TEXT,
    job_title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    contact_id INTEGER,
    source TEXT NOT NULL DEFAULT 'manual',
    assigned_to INTEGER,
    status TEXT NOT NULL,
    priority TEXT,
    follow_up_date TEXT,
    next_action TEXT,
    inventory_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    normalized_phone TEXT,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    lead_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lead_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    lead_id INTEGER NOT NULL,
    user_id INTEGER,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    lead_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS imported_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    external_id TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    lead_id INTEGER,
    subject TEXT,
    sender TEXT,
    received_at TEXT,
    status TEXT NOT NULL,
    matched_reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    stock_number TEXT,
    vin TEXT,
    year INTEGER,
    make TEXT,
    model TEXT,
    trim TEXT,
    price INTEGER,
    mileage INTEGER,
    condition TEXT,
    body_style TEXT,
    exterior_color TEXT,
    interior_color TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    verified TEXT NOT NULL DEFAULT 'yes',
    source TEXT,
    source_file TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    source_type TEXT NOT NULL,
    source_name TEXT,
    file_name TEXT,
    status TEXT NOT NULL,
    rows_total INTEGER NOT NULL DEFAULT 0,
    rows_inserted INTEGER NOT NULL DEFAULT 0,
    rows_updated INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    rows_deactivated INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_import_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_run_id INTEGER NOT NULL,
    row_number INTEGER,
    stock_number TEXT,
    vin TEXT,
    error_message TEXT NOT NULL,
    raw_row_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (import_run_id) REFERENCES inventory_import_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    lead_id INTEGER NOT NULL,
    user_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'manual',
    unique_key TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER NOT NULL,
    lead_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'unread',
    unique_key TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crm_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone ON leads(normalized_phone);
  CREATE INDEX IF NOT EXISTS idx_contacts_normalized_phone ON contacts(normalized_phone);
  CREATE INDEX IF NOT EXISTS idx_leads_inventory_id ON leads(inventory_id);
  CREATE INDEX IF NOT EXISTS idx_activities_lead_id_created_at ON activities(lead_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_imported_messages_external_id ON imported_messages(external_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_dealership_id ON inventory(dealership_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inventory_stock_number ON inventory(stock_number);
  CREATE INDEX IF NOT EXISTS idx_inventory_vin ON inventory(vin);
  CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inventory_make_model ON inventory(make, model);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_dealership_stock_number
    ON inventory(dealership_id, stock_number)
    WHERE stock_number IS NOT NULL AND TRIM(stock_number) <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_dealership_vin
    ON inventory(dealership_id, vin)
    WHERE vin IS NOT NULL AND TRIM(vin) <> '';
  CREATE INDEX IF NOT EXISTS idx_inventory_import_runs_dealership_started_at
    ON inventory_import_runs(dealership_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inventory_import_errors_run_id
    ON inventory_import_errors(import_run_id, row_number);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_key ON tasks(unique_key) WHERE unique_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due_at ON tasks(user_id, status, due_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_lead_status_due_at ON tasks(lead_id, status, due_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_key ON notifications(unique_key) WHERE unique_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created_at ON notifications(user_id, status, created_at DESC);
`;

class CrmDatabase extends BaseCrmDatabase {
  static async initialize({ dbPath, allowSqlite = false }) {
    if (!allowSqlite && process.env.NODE_ENV !== "test") {
      throw new Error("SQLite is disabled for CRM runtime. Use PostgreSQL for application execution.");
    }

    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
    const db = existing ? new SQL.Database(new Uint8Array(existing)) : new SQL.Database();
    const instance = new CrmDatabase({ db, dbPath });

    instance.runScript(SCHEMA_SQL);
    instance.applyMigrations();
    await instance.seedDefaultUsers();
    instance.save();

    return instance;
  }

  constructor({ db, dbPath }) {
    super();
    this.db = db;
    this.dbPath = dbPath;
  }

  runScript(sql) {
    this.db.run(sql);
  }

  save() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  execute(sql, params = []) {
    this.db.run(sql, params);
  }

  get(sql, params = []) {
    const statement = this.db.prepare(sql, params);
    try {
      if (!statement.step()) {
        return null;
      }

      return statement.getAsObject();
    } finally {
      statement.free();
    }
  }

  all(sql, params = []) {
    const statement = this.db.prepare(sql, params);
    const rows = [];

    try {
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }

    return rows;
  }

  nextId() {
    const row = this.get("SELECT last_insert_rowid() AS id");
    return Number(row.id);
  }

  applyMigrations() {
    const dealershipId = getDefaultDealershipId();
    this.ensureColumn("users", "dealership_id", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("contacts", "dealership_id", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("leads", "dealership_id", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("notes", "dealership_id", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("lead_activities", "dealership_id", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("activities", "dealership_id", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("imported_messages", "dealership_id", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("leads", "status", "TEXT DEFAULT 'new'");
    this.ensureColumn("leads", "source", "TEXT NOT NULL DEFAULT 'manual'");
    this.ensureColumn("leads", "assigned_to", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
    this.ensureColumn("leads", "customer_name", "TEXT");
    this.ensureColumn("leads", "phone", "TEXT");
    this.ensureColumn("leads", "normalized_phone", "TEXT");
    this.ensureColumn("leads", "email", "TEXT");
    this.ensureColumn("leads", "vehicle_interest", "TEXT");
    this.ensureColumn("leads", "vehicle_id", "TEXT");
    this.ensureColumn("leads", "stock_number", "TEXT");
    this.ensureColumn("leads", "vehicle_year", "TEXT");
    this.ensureColumn("leads", "vehicle_make", "TEXT");
    this.ensureColumn("leads", "vehicle_model", "TEXT");
    this.ensureColumn("leads", "vehicle_trim", "TEXT");
    this.ensureColumn("leads", "vehicle_condition", "TEXT");
    this.ensureColumn("leads", "vehicle_price", "TEXT");
    this.ensureColumn("leads", "lead_type", "TEXT");
    this.ensureColumn("leads", "listing_url", "TEXT");
    this.ensureColumn("leads", "message", "TEXT");
    this.ensureColumn("leads", "inventory_id", "INTEGER");
    this.ensureColumn("inventory", "verified", "TEXT NOT NULL DEFAULT 'yes'");
    this.ensureColumn("contacts", "normalized_phone", "TEXT");
    this.execute("UPDATE leads SET status = 'new' WHERE status IS NULL OR TRIM(status) = ''");
    this.execute("UPDATE leads SET status = 'appointment' WHERE status = 'qualified'");
    this.execute("UPDATE leads SET status = 'negotiation' WHERE status = 'proposal'");
    this.execute("UPDATE leads SET status = 'won' WHERE status = 'sold'");
    this.execute("UPDATE leads SET source = 'manual' WHERE source IS NULL OR TRIM(source) = ''");
    this.execute("UPDATE users SET dealership_id = ? WHERE dealership_id IS NULL OR dealership_id = ''", [dealershipId]);
    this.execute("UPDATE contacts SET dealership_id = ? WHERE dealership_id IS NULL OR dealership_id = ''", [dealershipId]);
    this.execute("UPDATE leads SET dealership_id = ? WHERE dealership_id IS NULL OR dealership_id = ''", [dealershipId]);
    this.execute("UPDATE notes SET dealership_id = ? WHERE dealership_id IS NULL OR dealership_id = ''", [dealershipId]);
    this.execute("UPDATE lead_activities SET dealership_id = ? WHERE dealership_id IS NULL OR dealership_id = ''", [dealershipId]);
    this.execute("UPDATE activities SET dealership_id = ? WHERE dealership_id IS NULL OR dealership_id = ''", [dealershipId]);
    this.execute(
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
    this.execute(
      "UPDATE imported_messages SET dealership_id = ? WHERE dealership_id IS NULL OR dealership_id = ''",
      [dealershipId]
    );
    this.execute("UPDATE inventory SET verified = 'yes' WHERE verified IS NULL OR TRIM(verified) = ''");
    this.execute("UPDATE leads SET normalized_phone = ? WHERE phone IS NULL OR TRIM(phone) = ''", [null]);
    this.execute("UPDATE contacts SET normalized_phone = ? WHERE phone IS NULL OR TRIM(phone) = ''", [null]);

    const leadPhones = this.all("SELECT id, phone FROM leads WHERE phone IS NOT NULL AND TRIM(phone) <> ''");
    for (const lead of leadPhones) {
      this.execute("UPDATE leads SET normalized_phone = ? WHERE id = ?", [normalizePhone(lead.phone) || null, lead.id]);
    }

    const contactPhones = this.all("SELECT id, phone FROM contacts WHERE phone IS NOT NULL AND TRIM(phone) <> ''");
    for (const contact of contactPhones) {
      this.execute("UPDATE contacts SET normalized_phone = ? WHERE id = ?", [
        normalizePhone(contact.phone) || null,
        contact.id,
      ]);
    }
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.all(`PRAGMA table_info(${tableName})`);
    if (!columns.some((column) => column.name === columnName)) {
      this.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  async seedDefaultUsers() {
    const dealershipId = getDefaultDealershipId();
    const row = this.get("SELECT COUNT(*) AS count FROM users");
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
      this.execute(
        `
          INSERT INTO users (dealership_id, name, email, password_hash, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [dealershipId, user.name, user.email.toLowerCase(), passwordHash, user.role, new Date().toISOString()]
      );
    }
  }

  accessClauseForUser(user, alias = "leads") {
    const params = [Number(user?.dealership_id || getDefaultDealershipId())];
    let clause = `${alias}.dealership_id = ?`;

    if (user && !canViewAllLeads(user)) {
      clause += ` AND ${alias}.assigned_to = ?`;
      params.push(user.id);
    }

    return { clause, params };
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
      LEFT JOIN contacts ON contacts.id = leads.contact_id
      LEFT JOIN users AS sales_user ON sales_user.id = leads.assigned_to
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
      INNER JOIN leads ON leads.id = lead_activities.lead_id
      LEFT JOIN contacts ON contacts.id = leads.contact_id
      LEFT JOIN users ON users.id = lead_activities.user_id
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
        contacts.phone AS contact_phone,
        contacts.normalized_phone AS contact_normalized_phone,
        contacts.email AS contact_email,
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
      LEFT JOIN contacts ON contacts.id = leads.contact_id
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
      assigned_to: row.assigned_to == null ? null : Number(row.assigned_to),
      inventory_id: row.inventory_id == null ? null : Number(row.inventory_id),
      phone,
      normalized_phone: row.normalized_phone || row.contact_normalized_phone || null,
      email,
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
      exterior_color: row.exterior_color || null,
      interior_color: row.interior_color || null,
      status: row.status || "active",
      verified: row.verified || "yes",
      source: row.source || null,
      source_file: row.source_file || null,
      last_seen_at: row.last_seen_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listUsers() {
    return this.all(
      `
        SELECT id, dealership_id, name, email, role, created_at
        FROM users
        ORDER BY
          CASE role
            WHEN 'admin' THEN 1
            WHEN 'manager' THEN 2
            ELSE 3
          END,
          LOWER(name) ASC
      `
    );
  }

  getUser(id) {
    const user = this.get(
      `
        SELECT id, dealership_id, name, email, password_hash, role, created_at
        FROM users
        WHERE id = ?
      `,
      [id]
    );

    if (!user) {
      throw new NotFoundError("User not found");
    }

    return user;
  }

  getUserByEmail(email) {
    return this.get(
      `
        SELECT id, dealership_id, name, email, password_hash, role, created_at
        FROM users
        WHERE LOWER(email) = LOWER(?)
      `,
      [email]
    );
  }

  async authenticateUser(email, password) {
    const user = this.getUserByEmail(email);
    if (!user) {
      throw new UnauthorizedError("Invalid email or password.");
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      throw new UnauthorizedError("Invalid email or password.");
    }

    return user;
  }

  listApiLeads({ limit = 100, offset = 0, status = "", search = "" } = {}, user = null) {
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

    const countRow = this.get(
      `
        SELECT COUNT(*) AS count
        FROM leads
        LEFT JOIN contacts ON contacts.id = leads.contact_id
        WHERE ${filters.join(" AND ")}
      `,
      params
    );

    const rows = this.all(
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

  getApiLead(id, user = null) {
    const access = this.accessClauseForUser(user);
    const row = this.get(
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

  listLeadActivitiesForApi(leadId) {
    const lead = this.get("SELECT dealership_id FROM leads WHERE id = ?", [leadId]);
    if (!lead) {
      return [];
    }

    return this.all(
      `
        SELECT lead_activities.id, lead_activities.lead_id, lead_activities.user_id, lead_activities.type, lead_activities.content, lead_activities.created_at, users.name AS actor_name
        FROM lead_activities
        LEFT JOIN users ON users.id = lead_activities.user_id AND users.dealership_id = lead_activities.dealership_id
        WHERE lead_activities.lead_id = ?
          AND lead_activities.dealership_id = ?
        ORDER BY lead_activities.created_at DESC, lead_activities.id DESC
      `,
      [leadId, lead.dealership_id]
    ).map((row) => ({
      id: Number(row.id),
      lead_id: Number(row.lead_id),
      user_id: row.user_id == null ? null : Number(row.user_id),
      actor_name: row.actor_name || null,
      type: row.type,
      content: row.content,
      created_at: row.created_at,
    }));
  }

  recordLeadStatusAudit({
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
    const dealershipId = getDefaultDealershipId();

    this.execute(
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

  listLeadStatusAuditsForApi(leadId) {
    return this.all(
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
        LEFT JOIN users ON users.id = audits.user_id
        WHERE audits.lead_id = ?
        ORDER BY audits.created_at DESC, audits.id DESC
      `,
      [leadId]
    ).map((row) => ({
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

  listLeadMessagesForApi(leadId) {
    return this.all(
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
        LEFT JOIN users ON users.id = lead_messages.crm_user_id
        WHERE lead_messages.lead_id = ?
        ORDER BY COALESCE(lead_messages.received_at, lead_messages.sent_at, lead_messages.created_at) DESC, lead_messages.id DESC
      `,
      [leadId]
    ).map((row) => ({
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

  listLeadCallsForApi(leadId) {
    const rows = this.all(
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
        LEFT JOIN call_recordings ON call_recordings.lead_call_id = lead_calls.id
        LEFT JOIN communication_ai_analyses AS analyses
          ON analyses.source_type = 'call' AND analyses.source_id = lead_calls.id
        LEFT JOIN users ON users.id = lead_calls.crm_user_id
        WHERE lead_calls.lead_id = ?
        ORDER BY lead_calls.start_time DESC, lead_calls.id DESC
      `,
      [leadId]
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

  listLeadTimelineForApi(leadId) {
    const callEvents = this.listLeadCallsForApi(leadId).map((call) => ({
      id: `call:${call.id}`,
      type: "call",
      timestamp: call.happened_at,
      user_name: call.actor_name,
      payload: call,
    }));

    const smsEvents = this.listLeadMessagesForApi(leadId).map((message) => ({
      id: `sms:${message.id}`,
      type: "sms",
      timestamp: message.happened_at,
      user_name: message.actor_name,
      payload: message,
    }));

    const statusEvents = this.listLeadStatusAuditsForApi(leadId).map((audit) => ({
      id: `status:${audit.id}`,
      type: "status_change",
      timestamp: audit.created_at,
      user_name: audit.actor_name,
      payload: audit,
    }));

    return [...callEvents, ...smsEvents, ...statusEvents].sort((left, right) => {
      const leftTime = new Date(left.timestamp || 0).getTime();
      const rightTime = new Date(right.timestamp || 0).getTime();
      return rightTime - leftTime;
    });
  }

  listConversationFeedForApi(user = null, limit = 50) {
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
    const messageRows = this.all(
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
        LEFT JOIN users ON users.id = lead_messages.crm_user_id
        LEFT JOIN users AS sales_user ON sales_user.id = leads.assigned_to
        WHERE ${access.clause}
        ORDER BY happened_at DESC, lead_messages.id DESC
        LIMIT ?
      `,
      [...access.params, limit]
    ).map((row) => ({
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

    const callRows = this.all(
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
        LEFT JOIN users ON users.id = lead_calls.crm_user_id
        LEFT JOIN users AS sales_user ON sales_user.id = leads.assigned_to
        LEFT JOIN call_recordings ON call_recordings.lead_call_id = lead_calls.id
        LEFT JOIN communication_ai_analyses AS analyses
          ON analyses.source_type = 'call' AND analyses.source_id = lead_calls.id
        WHERE ${access.clause}
        ORDER BY happened_at DESC, lead_calls.id DESC
        LIMIT ?
      `,
      [...access.params, limit]
    )
      .filter((row, index, rows) => rows.findIndex((candidate) => String(candidate.id) === String(row.id)) === index)
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

    return [...callRows, ...messageRows]
      .sort((left, right) => new Date(right.happened_at || 0).getTime() - new Date(left.happened_at || 0).getTime())
      .slice(0, limit);
  }

  getExecutionSettings() {
    const rows = this.all("SELECT key, value FROM crm_settings");
    const stored = Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));
    return normalizeExecutionSettings({
      ...DEFAULT_EXECUTION_SETTINGS,
      ...stored,
    });
  }

  setExecutionSettings(input = {}) {
    const settings = normalizeExecutionSettings({
      ...this.getExecutionSettings(),
      ...input,
    });
    const timestamp = new Date().toISOString();

    Object.entries(settings).forEach(([key, value]) => {
      const existing = this.get("SELECT key FROM crm_settings WHERE key = ?", [key]);
      if (existing) {
        this.execute("UPDATE crm_settings SET value = ?, updated_at = ? WHERE key = ?", [
          String(value),
          timestamp,
          key,
        ]);
      } else {
        this.execute("INSERT INTO crm_settings (key, value, updated_at) VALUES (?, ?, ?)", [
          key,
          String(value),
          timestamp,
        ]);
      }
    });

    this.save();
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

  listLeadTasksForApi(leadId) {
    return this.all(
      `
        SELECT tasks.*, users.name AS assigned_user_name
        FROM tasks
        LEFT JOIN users ON users.id = tasks.user_id
        WHERE tasks.lead_id = ?
        ORDER BY
          CASE tasks.status
            WHEN 'overdue' THEN 1
            WHEN 'pending' THEN 2
            ELSE 3
          END,
          tasks.due_at ASC,
          tasks.created_at DESC
      `,
      [leadId]
    ).map((row) => this.formatTaskForApi(row));
  }

  listNotificationsForApi(userId, limit = 20) {
    return this.all(
      `
        SELECT notifications.*, leads.customer_name
        FROM notifications
        LEFT JOIN leads ON leads.id = notifications.lead_id
        WHERE notifications.user_id = ?
        ORDER BY notifications.created_at DESC
        LIMIT ?
      `,
      [userId, limit]
    ).map((row) => ({
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

  createNotification({
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

    const existing = unique_key
      ? this.get("SELECT * FROM notifications WHERE unique_key = ?", [unique_key])
      : null;

    if (existing) {
      return existing;
    }

    const timestamp = new Date().toISOString();
    const dealershipId = getDefaultDealershipId();
    this.execute(
      `
        INSERT INTO notifications (
          dealership_id, user_id, lead_id, type, title, body, status, unique_key, metadata_json, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(metadata || {}),
        timestamp,
        null,
      ]
    );
    const id = this.nextId();
    this.save();
    return this.get("SELECT * FROM notifications WHERE id = ?", [id]);
  }

  markNotificationRead(id, userId) {
    const notification = this.get("SELECT * FROM notifications WHERE id = ? AND user_id = ?", [id, userId]);
    if (!notification) {
      throw new NotFoundError("Notification not found");
    }

    this.execute("UPDATE notifications SET status = ?, read_at = ? WHERE id = ?", [
      "read",
      new Date().toISOString(),
      id,
    ]);
    this.save();
  }

  createOrRefreshTask({
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
    const dealershipId = getDefaultDealershipId();
    const status = due_at && new Date(due_at).getTime() <= Date.now() ? "overdue" : "pending";
    const existing = unique_key ? this.get("SELECT * FROM tasks WHERE unique_key = ?", [unique_key]) : null;

    if (existing && existing.status !== "completed") {
      this.execute(
        `
          UPDATE tasks
          SET user_id = ?, type = ?, title = ?, due_at = ?, status = ?, source = ?, metadata_json = ?, updated_at = ?
          WHERE id = ?
        `,
        [
          user_id,
          type,
          title,
          due_at,
          status,
          source,
          JSON.stringify(metadata || {}),
          timestamp,
          existing.id,
        ]
      );
      this.save();
      return this.formatTaskForApi(this.get("SELECT tasks.*, users.name AS assigned_user_name FROM tasks LEFT JOIN users ON users.id = tasks.user_id WHERE tasks.id = ?", [existing.id]));
    }

    this.execute(
      `
        INSERT INTO tasks (
          dealership_id, lead_id, user_id, type, title, due_at, status, source, unique_key, metadata_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(metadata || {}),
        timestamp,
        timestamp,
        null,
      ]
    );
    const id = this.nextId();
    const task = this.get(
      "SELECT tasks.*, users.name AS assigned_user_name FROM tasks LEFT JOIN users ON users.id = tasks.user_id WHERE tasks.id = ?",
      [id]
    );
    this.createNotification({
      user_id,
      lead_id,
      type: "task_created",
      title: "New task assigned",
      body: title,
      unique_key: unique_key ? `notification:${unique_key}` : `notification:task:${id}`,
      metadata: {
        task_id: id,
        task_type: type,
      },
    });
    this.save();
    return this.formatTaskForApi(task);
  }

  completeTask(id, actor) {
    const task = this.get("SELECT * FROM tasks WHERE id = ?", [id]);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (actor && !canViewAllLeads(actor) && Number(task.user_id) !== Number(actor.id)) {
      throw new UnauthorizedError("You cannot complete this task.");
    }

    this.execute(
      "UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
      ["completed", new Date().toISOString(), new Date().toISOString(), id]
    );
    this.createLeadActivity({
      lead_id: Number(task.lead_id),
      user_id: actor?.id || null,
      type: "note",
      content: `Task completed: ${task.title}`,
    });
    this.save();
    return this.formatTaskForApi(
      this.get(
        "SELECT tasks.*, users.name AS assigned_user_name FROM tasks LEFT JOIN users ON users.id = tasks.user_id WHERE tasks.id = ?",
        [id]
      )
    );
  }

  refreshTaskStatuses() {
    const now = new Date().toISOString();
    const overdueTasks = this.all(
      "SELECT * FROM tasks WHERE status = 'pending' AND due_at IS NOT NULL AND due_at <> '' AND due_at <= ?",
      [now]
    );

    overdueTasks.forEach((task) => {
      this.execute("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", ["overdue", now, task.id]);
      this.createNotification({
        user_id: task.user_id,
        lead_id: task.lead_id,
        type: "task_overdue",
        title: "Task overdue",
        body: task.title,
        unique_key: `task-overdue:${task.id}`,
        metadata: { task_id: Number(task.id) },
      });
    });

    if (overdueTasks.length > 0) {
      this.save();
    }

    return overdueTasks.length;
  }

  getLatestAnalysisMap(leadIds = []) {
    if (!leadIds.length) {
      return new Map();
    }

    const placeholders = leadIds.map(() => "?").join(", ");
    const rows = this.all(
      `
        SELECT *
        FROM communication_ai_analyses
        WHERE lead_id IN (${placeholders})
        ORDER BY created_at DESC
      `,
      leadIds
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

  getOpenTaskMap(leadIds = []) {
    if (!leadIds.length) {
      return new Map();
    }

    const placeholders = leadIds.map(() => "?").join(", ");
    const rows = this.all(
      `
        SELECT tasks.*, users.name AS assigned_user_name
        FROM tasks
        LEFT JOIN users ON users.id = tasks.user_id
        WHERE tasks.lead_id IN (${placeholders})
          AND tasks.status IN ('pending', 'overdue')
        ORDER BY tasks.due_at ASC, tasks.created_at DESC
      `,
      leadIds
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

  getMissedCallMap(leadIds = []) {
    if (!leadIds.length) {
      return new Map();
    }

    const placeholders = leadIds.map(() => "?").join(", ");
    const rows = this.all(
      `
        SELECT *
        FROM lead_calls
        WHERE lead_id IN (${placeholders})
        ORDER BY start_time DESC, created_at DESC
      `,
      leadIds
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

      if (!existing.lastFollowUpAt) {
        const isFollowUp =
          String(row.direction || "").toLowerCase() === "outbound" &&
          (row.start_time || row.created_at);
        if (isFollowUp) {
          existing.lastFollowUpAt = row.start_time || row.created_at;
        }
      }

      map.set(key, existing);
    });

    const messageRows = this.all(
      `
        SELECT lead_id, direction, COALESCE(received_at, sent_at, created_at) AS happened_at
        FROM lead_messages
        WHERE lead_id IN (${placeholders})
        ORDER BY happened_at DESC
      `,
      leadIds
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

  enforceFollowUpTasks() {
    this.refreshTaskStatuses();
    const settings = this.getExecutionSettings();
    const now = new Date();
    const rows = this.all(`${this.apiLeadSelectSql()} ORDER BY leads.updated_at DESC`);
    const leads = rows.map((row) => this.formatApiLead(row));
    const leadIds = leads.map((lead) => Number(lead.id));
    const taskMap = this.getOpenTaskMap(leadIds);

    leads.forEach((lead) => {
      if (!["contacted", "appointment", "negotiation"].includes(String(lead.status))) {
        return;
      }

      const lastActivityAt = lead.latest_activity_at ? new Date(lead.latest_activity_at) : null;
      if (!lastActivityAt) {
        return;
      }

      const idleHours = (now.getTime() - lastActivityAt.getTime()) / 3600000;
      if (idleHours < settings.inactivity_threshold_hours) {
        return;
      }

      const existing = (taskMap.get(Number(lead.id)) || []).some((task) => task.type === "follow_up");
      if (existing) {
        return;
      }

      this.createOrRefreshTask({
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
    });

    return settings;
  }

  getExecutionDashboard(user = null) {
    this.enforceFollowUpTasks();
    const settings = this.getExecutionSettings();
    const access = this.accessClauseForUser(user);
    const rows = this.all(
      `
        ${this.apiLeadSelectSql()}
        WHERE ${access.clause}
        ORDER BY leads.updated_at DESC, leads.id DESC
      `,
      access.params
    );
    const leads = rows.map((row) => this.formatApiLead(row));
    const leadIds = leads.map((lead) => Number(lead.id));
    const taskMap = this.getOpenTaskMap(leadIds);
    const analysisMap = this.getLatestAnalysisMap(leadIds);
    const missedCallMap = this.getMissedCallMap(leadIds);
    const notifications = user ? this.listNotificationsForApi(Number(user.id), 25) : [];
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
      organized[category].push(payload);
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

  createActivity({ lead_id, type, content, created_at = null }) {
    this.createLeadActivity({
      lead_id,
      user_id: null,
      type,
      content,
      created_at,
    });
  }

  createApiLead(input, user = null) {
    const now = new Date().toISOString();
    const storedStatus = toStoredStatus(input.status || "new");
    const dealershipId =
      parsePositiveInteger(input.dealership_id) || (user ? this.currentDealershipId(user) : getDefaultDealershipId());
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    const assignedTo = input.assigned_to == null ? null : parsePositiveInteger(input.assigned_to);
    const inventoryId = this.resolveLeadInventoryId(input, dealershipId);

    this.execute(
      `
        INSERT INTO leads (
          dealership_id,
          source,
          status,
          assigned_to,
          customer_name,
          phone,
          normalized_phone,
          email,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          dealershipId,
          input.source || "website",
          storedStatus || "new",
          assignedTo,
          input.customer_name || null,
          input.phone || null,
          normalizedPhone,
          input.email || null,
          input.vehicle_interest || null,
          input.vehicle_id || null,
          input.stock_number || null,
          input.vehicle_year || null,
          input.vehicle_make || null,
          input.vehicle_model || null,
          input.vehicle_trim || null,
          input.vehicle_condition || null,
          input.vehicle_price || null,
          input.lead_type || null,
          input.listing_url || null,
          input.message || null,
          inventoryId,
          now,
          now,
        ]
    );

    const id = this.nextId();
    this.createActivity({
      lead_id: id,
      type: "lead_created",
      content: `Lead created from ${input.source || "website"}`,
      created_at: now,
    });
    this.save();

    return this.getApiLead(id, user);
  }

  updateApiLead(id, input) {
    const existingLead = this.getApiLead(id);
    const now = new Date().toISOString();
    const storedStatus = input.status ? toStoredStatus(input.status) : null;
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    const inventoryId = this.resolveLeadInventoryId(input, Number(existingLead.dealership_id), existingLead.inventory_id);

    this.execute(
      `
        UPDATE leads
        SET
          source = ?,
          status = COALESCE(?, status),
          customer_name = ?,
          phone = ?,
          normalized_phone = ?,
          email = ?,
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
        WHERE id = ?
      `,
      [
        input.source || "website",
        storedStatus,
        input.customer_name || null,
        input.phone || null,
        normalizedPhone,
        input.email || null,
        input.vehicle_interest || null,
        input.vehicle_id || null,
        input.stock_number || null,
        input.vehicle_year || null,
        input.vehicle_make || null,
        input.vehicle_model || null,
        input.vehicle_trim || null,
        input.vehicle_condition || null,
        input.vehicle_price || null,
        input.lead_type || null,
        input.listing_url || null,
        input.message || null,
        inventoryId,
        now,
        id,
      ]
    );

    this.save();
    return this.getApiLead(id);
  }

  updateApiLeadStatus(id, status, actor = null, options = {}) {
    const existingLead = this.getApiLead(id);
    const storedStatus = toStoredStatus(status);
    const nextStatus = fromStoredStatus(storedStatus);

    if (!DEALER_PIPELINE_STATUSES.includes(fromStoredStatus(storedStatus))) {
      throw new ValidationError("Invalid lead status.");
    }

    if (!canTransitionLeadStatus(existingLead.status, nextStatus)) {
      throw new ValidationError(`Invalid status transition: ${existingLead.status} -> ${nextStatus}.`);
    }

    this.execute(
      `
        UPDATE leads
        SET status = ?, updated_at = ?
        WHERE id = ?
      `,
      [storedStatus, new Date().toISOString(), id]
    );

    this.createActivity({
      lead_id: id,
      type: "status_changed",
      content: `${existingLead.status_label} -> ${titleCaseStatus(nextStatus)}`,
    });
    this.recordLeadStatusAudit({
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
    this.save();

    return this.getApiLead(id);
  }

  getApiLeadWithActivities(id, user = null) {
    const lead = this.getApiLead(id, user);

    return {
      lead,
      activities: this.listLeadActivitiesForApi(id),
      timeline: this.listLeadTimelineForApi(id),
      tasks: this.listLeadTasksForApi(id),
    };
  }

  listInventoryForApi(filters = {}, user = null) {
    const clauses = ["inventory.dealership_id = ?"];
    const params = [this.currentDealershipId(user)];

    if (!isTruthyFilter(filters.include_unverified ?? filters.includeUnverified)) {
      clauses.push("COALESCE(LOWER(inventory.verified), 'yes') = 'yes'");
    }

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

    const rows = this.all(
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
      [...params, Math.max(1, Math.min(500, Number(filters.limit) || 250))]
    );

    return rows.map((row) => this.formatInventoryRow(row));
  }

  getInventoryForApi(id, user = null) {
    const row = this.get(
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

  createInventoryImportRun(input, user = null) {
    const now = new Date().toISOString();
    const dealershipId = parsePositiveInteger(input.dealership_id) || this.currentDealershipId(user);
    this.execute(
      `
        INSERT INTO inventory_import_runs (
          dealership_id,
          source_type,
          source_name,
          file_name,
          status,
          rows_total,
          rows_inserted,
          rows_updated,
          rows_skipped,
          rows_deactivated,
          error_message,
          started_at,
          completed_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        dealershipId,
        input.source_type || "manual_upload",
        input.source_name || null,
        input.file_name || null,
        input.status || "running",
        Number(input.rows_total || 0),
        Number(input.rows_inserted || 0),
        Number(input.rows_updated || 0),
        Number(input.rows_skipped || 0),
        Number(input.rows_deactivated || 0),
        input.error_message || null,
        input.started_at || now,
        input.completed_at || null,
        now,
        now,
      ]
    );

    const id = this.nextId();
    this.save();
    return this.get("SELECT * FROM inventory_import_runs WHERE id = ?", [id]);
  }

  updateInventoryImportRun(id, input, user = null) {
    const runId = parsePositiveInteger(id);
    const dealershipId = parsePositiveInteger(input.dealership_id) || this.currentDealershipId(user);
    if (!runId) {
      throw new ValidationError("Inventory import run ID is invalid.");
    }

    const existing = this.get(
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

    this.execute(
      `
        UPDATE inventory_import_runs
        SET
          status = COALESCE(?, status),
          rows_total = COALESCE(?, rows_total),
          rows_inserted = COALESCE(?, rows_inserted),
          rows_updated = COALESCE(?, rows_updated),
          rows_skipped = COALESCE(?, rows_skipped),
          rows_deactivated = COALESCE(?, rows_deactivated),
          error_message = COALESCE(?, error_message),
          completed_at = COALESCE(?, completed_at),
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [
        input.status || null,
        input.rows_total == null ? null : Number(input.rows_total),
        input.rows_inserted == null ? null : Number(input.rows_inserted),
        input.rows_updated == null ? null : Number(input.rows_updated),
        input.rows_skipped == null ? null : Number(input.rows_skipped),
        input.rows_deactivated == null ? null : Number(input.rows_deactivated),
        input.error_message || null,
        input.completed_at || null,
        new Date().toISOString(),
        runId,
        existing.dealership_id,
      ]
    );

    this.save();
    return this.get("SELECT * FROM inventory_import_runs WHERE id = ?", [runId]);
  }

  createInventoryImportError(input, user = null) {
    const importRunId = parsePositiveInteger(input.import_run_id);
    const dealershipId = parsePositiveInteger(input.dealership_id) || this.currentDealershipId(user);
    if (!importRunId) {
      throw new ValidationError("Inventory import run ID is invalid.");
    }

    const run = this.get(
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

    this.execute(
      `
        INSERT INTO inventory_import_errors (
          import_run_id,
          row_number,
          stock_number,
          vin,
          error_message,
          raw_row_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        importRunId,
        input.row_number == null ? null : parsePositiveInteger(input.row_number),
        input.stock_number || null,
        input.vin || null,
        input.error_message,
        input.raw_row_json || null,
        new Date().toISOString(),
      ]
    );

    const id = this.nextId();
    this.save();
    return this.get("SELECT * FROM inventory_import_errors WHERE id = ?", [id]);
  }

  listInventoryImportRuns(user = null, limit = 20) {
    return this.all(
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
    ).map((row) => ({
      ...row,
      id: Number(row.id),
      dealership_id: Number(row.dealership_id),
      rows_total: Number(row.rows_total || 0),
      rows_inserted: Number(row.rows_inserted || 0),
      rows_updated: Number(row.rows_updated || 0),
      rows_skipped: Number(row.rows_skipped || 0),
      rows_deactivated: Number(row.rows_deactivated || 0),
      error_count: Number(row.error_count || 0),
    }));
  }

  findInventoryByIdentity({ dealership_id, stock_number = null, vin = null }) {
    const normalizedStockNumber = normalizeInventoryIdentity(stock_number);
    const normalizedVin = normalizeInventoryIdentity(vin);
    if (!normalizedStockNumber && !normalizedVin) {
      return null;
    }

    let stockMatch = null;
    let vinMatch = null;

    if (normalizedStockNumber) {
      stockMatch = this.get(
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
      vinMatch = this.get(
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

  resolveLeadInventoryId(input, dealershipId, fallbackInventoryId = null) {
    const inventory = this.findInventoryByIdentity({
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

  upsertInventoryRecord(input) {
    const now = input.updated_at || new Date().toISOString();
    const dealershipId = parsePositiveInteger(input.dealership_id);
    if (!dealershipId) {
      throw new ValidationError("Inventory record is missing a valid dealership ID.");
    }
    const stockNumber = normalizeInventoryIdentity(input.stock_number);
    const vin = normalizeInventoryIdentity(input.vin);
    const existing = this.findInventoryByIdentity({
      dealership_id: dealershipId,
      stock_number: stockNumber,
      vin,
    });

    const params = [
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
      stringOrNull(input.exterior_color),
      stringOrNull(input.interior_color),
      normalizeInventoryStatus(input.status),
      normalizeInventoryVerified(input.verified),
      stringOrNull(input.source),
      stringOrNull(input.source_file),
      input.last_seen_at || now,
    ];

    if (existing) {
      this.execute(
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
            exterior_color = ?,
            interior_color = ?,
            status = ?,
            verified = ?,
            source = ?,
            source_file = ?,
            last_seen_at = ?,
            updated_at = ?
          WHERE id = ? AND dealership_id = ?
        `,
        [...params, now, existing.id, dealershipId]
      );

      this.save();
      return {
        action: "updated",
        inventory: this.getInventoryForApi(existing.id, { dealership_id: dealershipId }),
      };
    }

    this.execute(
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
          exterior_color,
          interior_color,
          status,
          verified,
          source,
          source_file,
          last_seen_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [dealershipId, ...params, now, now]
    );

    const id = this.nextId();
    this.save();
    return {
      action: "inserted",
      inventory: this.getInventoryForApi(id, { dealership_id: dealershipId }),
    };
  }

  markInventoryMissingFromImport({
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

    const placeholders = seenInventoryIds.map(() => "?").join(", ");
    const params = [normalizeInventoryStatus(next_status), new Date().toISOString(), dealershipId, source, ...seenInventoryIds];
    const row = this.get(
      `
        SELECT COUNT(*) AS count
        FROM inventory
        WHERE dealership_id = ?
          AND source = ?
          AND status = 'active'
          AND id NOT IN (${placeholders})
      `,
      [dealershipId, source, ...seenInventoryIds]
    );

    this.execute(
      `
        UPDATE inventory
        SET status = ?, updated_at = ?
        WHERE dealership_id = ?
          AND source = ?
          AND status = 'active'
          AND id NOT IN (${placeholders})
      `,
      params
    );

    this.save();
    return Number(row?.count || 0);
  }

  linkLeadInventory(leadId, inventoryId, user = null) {
    const lead = this.getApiLead(leadId, user);
    const inventory = this.getInventoryForApi(inventoryId, user);

    if (Number(lead.dealership_id) !== Number(inventory.dealership_id)) {
      throw new ValidationError("Inventory unit does not belong to this dealership.");
    }

    this.execute(
      `
        UPDATE leads
        SET inventory_id = ?, updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [inventory.id, new Date().toISOString(), leadId, lead.dealership_id]
    );

    this.createLeadActivity({
      lead_id: Number(leadId),
      user_id: user?.id || null,
      type: "note",
      content: `Linked inventory unit ${inventory.stock_number || inventory.vin || inventory.id}.`,
    });

    this.save();
    return this.getApiLeadWithActivities(leadId, user);
  }

  getDashboardApiMetrics(user = null) {
    const access = this.accessClauseForUser(user);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);

    const todayIso = today.toISOString();
    const weekStartIso = weekStart.toISOString();

    const newLeadsToday = Number(
      this.get(
        `
          SELECT COUNT(*) AS count
          FROM leads
          WHERE created_at >= ? AND ${access.clause}
        `,
        [todayIso, ...access.params]
      ).count
    );

    const leadsThisWeek = Number(
      this.get(
        `
          SELECT COUNT(*) AS count
          FROM leads
          WHERE created_at >= ? AND ${access.clause}
        `,
        [weekStartIso, ...access.params]
      ).count
    );

    const appointmentsScheduled = Number(
      this.get(
        `
          SELECT COUNT(*) AS count
          FROM leads
          WHERE status = 'appointment' AND ${access.clause}
        `,
        access.params
      ).count
    );

    const vehiclesSold = Number(
      this.get(
        `
          SELECT COUNT(*) AS count
          FROM leads
          WHERE status = ? AND ${access.clause}
        `,
        [toStoredStatus("sold"), ...access.params]
      ).count
    );

    const totalLeads = Number(
      this.get(
        `
          SELECT COUNT(*) AS count
          FROM leads
          WHERE ${access.clause}
        `,
        access.params
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

  createUser(input) {
    const dealershipId = getDefaultDealershipId();
    this.execute(
      `
        INSERT INTO users (dealership_id, name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [dealershipId, input.name, input.email.toLowerCase(), input.password_hash, input.role, new Date().toISOString()]
    );
    const id = this.nextId();
    this.save();
    return this.getUser(id);
  }

  updateUser(id, input) {
    this.getUser(id);
    const fields = ["name = ?", "email = ?", "role = ?"];
    const params = [input.name, input.email.toLowerCase(), input.role];

    if (input.password_hash) {
      fields.push("password_hash = ?");
      params.push(input.password_hash);
    }

    params.push(id);
    this.execute(
      `
        UPDATE users
        SET ${fields.join(", ")}
        WHERE id = ?
      `,
      params
    );
    this.save();
    return this.getUser(id);
  }

  deleteUser(id) {
    const user = this.getUser(id);

    if (user.role === "admin") {
      const adminCount = Number(
        this.get(
          `
            SELECT COUNT(*) AS count
            FROM users
            WHERE role = 'admin'
          `
        ).count
      );

      if (adminCount <= 1) {
        throw new ValidationError("You must keep at least one admin user.");
      }
    }

    this.execute("DELETE FROM users WHERE id = ?", [id]);
    this.save();
  }

  listSalesUsers() {
    return this.all(
      `
        SELECT id, name, email, role, created_at
        FROM users
        WHERE role = 'sales'
        ORDER BY LOWER(name) ASC, id ASC
      `
    );
  }

  getAssignableSalesUser() {
    return this.get(
      `
        SELECT id, name, email, role, created_at
        FROM users
        WHERE role = 'sales'
        ORDER BY LOWER(name) ASC, id ASC
        LIMIT 1
      `
    );
  }

  listContacts() {
    return this.all(
      `
        SELECT
          id,
          first_name,
          last_name,
          email,
          phone,
          company,
          job_title,
          created_at,
          updated_at
        FROM contacts
        ${this.contactOrderSql()}
      `
    );
  }

  listContactsForSelect() {
    return this.listContacts().map((contact) => ({
      ...contact,
      display_name: this.displayContactName(contact),
    }));
  }

  getContact(id) {
    const contact = this.get(
      `
        SELECT
          id,
          first_name,
          last_name,
          email,
          phone,
          company,
          job_title,
          created_at,
          updated_at
        FROM contacts
        WHERE id = ?
      `,
      [id]
    );

    if (!contact) {
      throw new NotFoundError("Contact not found");
    }

    return contact;
  }

  getContactLeads(contactId, user) {
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

  createContact(input, user = null) {
    const now = new Date().toISOString();
    const dealershipId = this.currentDealershipId(user);
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    this.execute(
      `
        INSERT INTO contacts (
          dealership_id,
          first_name,
          last_name,
          email,
          phone,
          normalized_phone,
          company,
          job_title,
          created_at,
          updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          dealershipId,
          input.first_name,
          input.last_name,
          input.email,
          input.phone,
          normalizedPhone,
          input.company,
          input.job_title,
          now,
        now,
      ]
    );
    const id = this.nextId();
    this.save();
    return this.getContact(id, user);
  }

  updateContact(id, input, user = null) {
    this.getContact(id, user);
    const normalizedPhone = normalizeLeadPhoneForStorage(input.phone);
    this.execute(
      `
        UPDATE contacts
        SET
          first_name = ?,
          last_name = ?,
          email = ?,
          phone = ?,
          normalized_phone = ?,
          company = ?,
          job_title = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [
        input.first_name,
        input.last_name,
        input.email,
        input.phone,
        normalizedPhone,
        input.company,
        input.job_title,
        new Date().toISOString(),
        id,
        this.currentDealershipId(user),
      ]
    );
    this.save();
    return this.getContact(id, user);
  }

  deleteContact(id, user = null) {
    this.getContact(id, user);
    this.execute("DELETE FROM contacts WHERE id = ? AND dealership_id = ?", [id, this.currentDealershipId(user)]);
    this.save();
  }

  listLeads(user) {
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

  getLead(id, user) {
    const access = this.accessClauseForUser(user);
    const lead = this.get(
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

  createLead(input, user = null) {
    const assigneeId = input.assigned_to || null;
    const now = new Date().toISOString();
    const dealershipId = this.currentDealershipId(user);

    this.execute(
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
    const id = this.nextId();
    this.save();
    return this.getLead(id, user);
  }

  updateLead(id, input, user = null) {
    this.getLead(id, user);
    this.execute(
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
        this.currentDealershipId(user),
      ]
    );
    this.save();
    return this.getLead(id, user);
  }

  assignLead(id, assignedTo, actor = null) {
    const lead = this.getLead(id, actor);
    const assignee = this.getUser(assignedTo);
    if (Number(assignee.dealership_id || getDefaultDealershipId()) !== Number(lead.dealership_id || getDefaultDealershipId())) {
      throw new ValidationError("Choose a valid salesperson.");
    }

    this.execute(
      `
        UPDATE leads
        SET
          assigned_to = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [assignedTo, new Date().toISOString(), id, lead.dealership_id]
    );
    this.createActivity({
      lead_id: id,
      type: "note_added",
      content: `Lead assigned to ${assignee.name}.`,
    });
    this.createNotification({
      user_id: assignedTo,
      lead_id: id,
      type: "lead_assigned",
      title: "New lead assigned",
      body: `You were assigned lead #${id}.`,
      unique_key: `lead-assigned:${id}:${assignedTo}`,
      metadata: { lead_id: Number(id) },
    });
    this.save();
    return this.getLead(id, actor);
  }

  updateLeadStatusIfNew(id, status = "contacted", user = null) {
    const lead = user
      ? this.getLead(id, user)
      : this.get("SELECT id, dealership_id, status FROM leads WHERE id = ?", [id]);
    if (!lead) {
      throw new NotFoundError("Lead not found");
    }
    if (lead.status !== "new") {
      return lead;
    }

    this.execute(
      `
        UPDATE leads
        SET
          status = ?,
          updated_at = ?
        WHERE id = ? AND dealership_id = ?
      `,
      [status, new Date().toISOString(), id, lead.dealership_id]
    );
    this.save();
    return user
      ? this.getLead(id, user)
      : this.get("SELECT id, dealership_id, assigned_to, status FROM leads WHERE id = ?", [id]);
  }

  deleteLead(id, user = null) {
    this.getLead(id, user);
    this.execute("DELETE FROM leads WHERE id = ? AND dealership_id = ?", [id, this.currentDealershipId(user)]);
    this.save();
  }

  listLeadNotes(leadId) {
    return this.all(
      `
        SELECT id, lead_id, body, created_at
        FROM notes
        WHERE lead_id = ?
        ORDER BY created_at DESC, id DESC
      `,
      [leadId]
    );
  }

  addLeadNote(leadId, body, userId = null) {
    const lead = this.get("SELECT id, dealership_id FROM leads WHERE id = ?", [leadId]);
    if (!lead) {
      throw new NotFoundError("Lead not found");
    }
    const dealershipId = Number(lead.dealership_id || getDefaultDealershipId());
    this.execute(
      `
        INSERT INTO notes (dealership_id, lead_id, body, created_at)
        VALUES (?, ?, ?, ?)
      `,
      [dealershipId, leadId, body, new Date().toISOString()]
    );
    this.createLeadActivity({
      lead_id: leadId,
      user_id: userId,
      type: "note",
      content: body,
    });
    this.save();
    return this.listLeadNotes(leadId);
  }

  createLeadActivity(input) {
    const type = String(input.type || "").trim().toLowerCase();
    const dealershipId = getDefaultDealershipId();
    if (!LEAD_ACTIVITY_TYPES.includes(type)) {
      throw new ValidationError("Invalid lead activity type.");
    }

    this.execute(
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

  recordLeadActivity({ lead_id, user_id = null, type, content, created_at = null }) {
    const lead = this.get("SELECT id, dealership_id FROM leads WHERE id = ?", [lead_id]);
    if (!lead) {
      throw new NotFoundError("Lead not found");
    }
    this.createLeadActivity({
      lead_id,
      user_id,
      type,
      content,
      created_at,
    });

    if (type === "sms" || type === "call") {
      this.updateLeadStatusIfNew(lead_id, "contacted");
    }

    this.save();
    return this.listLeadActivities(lead_id);
  }

  listLeadActivities(leadId) {
    return this.all(
      `
        ${this.activitySelectSql()}
        WHERE lead_activities.lead_id = ?
        ORDER BY lead_activities.created_at DESC, lead_activities.id DESC
      `,
      [leadId]
    );
  }

  listRecentActivities(user, limit = 8) {
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

  findLeadByPhone(phone, context = {}) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return null;
    }
    const dealershipId = Number(context.dealership_id || context.user?.dealership_id || getDefaultDealershipId());

    const matched = this.get(
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

  getDashboardMetrics(user) {
    const access = this.accessClauseForUser(user);
    const today = toDateOnlyString();

    const totalLeads = Number(
      this.get(
        `
          SELECT COUNT(*) AS count
          FROM leads
          WHERE ${access.clause}
        `,
        access.params
      ).count
    );

    const statusCounts = CRM_LEAD_STATUSES.map((status) => ({
      status,
      count: Number(
        this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE status = ? AND ${access.clause}
          `,
          [toStoredStatus(status), ...access.params]
        ).count
      ),
    }));

    const followUps = {
      overdue: Number(
        this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE follow_up_date IS NOT NULL
              AND follow_up_date <> ''
              AND follow_up_date < ?
              AND ${access.clause}
          `,
          [today, ...access.params]
        ).count
      ),
      today: Number(
        this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE follow_up_date IS NOT NULL
              AND follow_up_date <> ''
              AND follow_up_date = ?
              AND ${access.clause}
          `,
          [today, ...access.params]
        ).count
      ),
      upcoming: Number(
        this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE follow_up_date IS NOT NULL
              AND follow_up_date <> ''
              AND follow_up_date > ?
              AND ${access.clause}
          `,
          [today, ...access.params]
        ).count
      ),
    };

    const upcomingLeads = this.all(
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
      ? this.all(
          `
            SELECT
              users.id,
              users.name,
              COUNT(leads.id) AS count
            FROM users
            LEFT JOIN leads ON leads.assigned_to = users.id
            WHERE users.role = 'sales'
            GROUP BY users.id, users.name
            ORDER BY LOWER(users.name) ASC
          `
        ).map((row) => ({
          ...row,
          count: Number(row.count),
        }))
      : [];

    const recentActivities = this.listRecentActivities(user);

    return {
      followUps,
      leadsPerSalesperson,
      recentActivities,
      statusCounts,
      totalLeads,
      upcomingLeads,
    };
  }

  getImportedMessageByExternalId(externalId, dealershipId = getDefaultDealershipId()) {
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

  recordImportedMessage(input) {
    const dealershipId = getDefaultDealershipId();
    this.execute(
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
    this.save();
    return this.getImportedMessageByExternalId(input.external_id, dealershipId);
  }

  findLeadDuplicate(input = {}, context = {}) {
    const email = String(input.email || "").trim().toLowerCase();
    const phone = normalizePhone(input.phone);
    const customerName = String(input.customer_name || "").trim().toLowerCase();
    const vehicleInterest = String(input.vehicle_interest || "").trim().toLowerCase();
    const dealershipId = Number(context.dealership_id || context.user?.dealership_id || getDefaultDealershipId());

    const rows = this.all(
      `
        ${this.apiLeadSelectSql()}
        WHERE leads.dealership_id = ?
        ORDER BY leads.updated_at DESC, leads.id DESC
      `,
      [dealershipId]
    );
    const leads = rows.map((row) => this.formatApiLead(row));

    if (email) {
      const emailMatch = leads.find((lead) => String(lead.email || "").trim().toLowerCase() === email);
      if (emailMatch) {
        return { lead: emailMatch, reason: "email" };
      }
    }

    if (phone) {
      const phoneMatch = leads.find((lead) => normalizePhone(lead.phone) === phone);
      if (phoneMatch) {
        return { lead: phoneMatch, reason: "phone" };
      }
    }

    if (customerName && vehicleInterest) {
      const nameVehicleMatch = leads.find((lead) => {
        const leadName = String(lead.customer_name || "").trim().toLowerCase();
        const leadVehicle = String(lead.vehicle_interest || "").trim().toLowerCase();
        return leadName === customerName && leadVehicle === vehicleInterest;
      });

      if (nameVehicleMatch) {
        return { lead: nameVehicleMatch, reason: "name_vehicle" };
      }
    }

    return null;
  }

  getDefaultAssigneeId() {
    const user = this.getAssignableSalesUser();
    return user ? Number(user.id) : null;
  }

}

module.exports = {
  CrmDatabase,
  DEALER_PIPELINE_STATUSES,
  fromStoredStatus,
  HttpError,
  NotFoundError,
  titleCaseStatus,
  toStoredStatus,
  UnauthorizedError,
  ValidationError,
};
