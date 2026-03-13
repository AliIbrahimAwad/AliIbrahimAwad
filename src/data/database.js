const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const initSqlJs = require("sql.js");

const { canViewAllLeads } = require("../models/user");
const { LEAD_ACTIVITY_TYPES, LEAD_STATUSES } = require("../types/models");
const { toDateOnlyString } = require("../utils/dates");
const { normalizePhone } = require("../utils/phones");

const DEALER_PIPELINE_STATUSES = ["new", "contacted", "appointment", "negotiation", "sold", "lost"];

function toStoredStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  switch (normalized) {
    case "new_lead":
      return "new";
    case "sold":
      return "won";
    default:
      return normalized;
  }
}

function fromStoredStatus(status) {
  return status === "won" ? "sold" : String(status || "new").trim().toLowerCase();
}

function ensureNumber(value) {
  return value == null || value === "" ? null : Number(value);
}

function titleCaseStatus(status) {
  return String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT,
    phone TEXT,
    company TEXT,
    job_title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER,
    source TEXT NOT NULL DEFAULT 'manual',
    assigned_to INTEGER,
    status TEXT NOT NULL,
    priority TEXT,
    follow_up_date TEXT,
    next_action TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lead_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    lead_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activities_lead_id_created_at ON activities(lead_id, created_at DESC);
`;

class HttpError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

class NotFoundError extends HttpError {
  constructor(message) {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

class ValidationError extends HttpError {
  constructor(message) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

class CrmDatabase {
  static async initialize({ dbPath }) {
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
    this.ensureColumn("leads", "status", "TEXT DEFAULT 'new'");
    this.ensureColumn("leads", "source", "TEXT NOT NULL DEFAULT 'manual'");
    this.ensureColumn("leads", "assigned_to", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
    this.ensureColumn("leads", "customer_name", "TEXT");
    this.ensureColumn("leads", "phone", "TEXT");
    this.ensureColumn("leads", "email", "TEXT");
    this.ensureColumn("leads", "vehicle_interest", "TEXT");
    this.ensureColumn("leads", "vehicle_id", "TEXT");
    this.ensureColumn("leads", "listing_url", "TEXT");
    this.ensureColumn("leads", "message", "TEXT");
    this.execute("UPDATE leads SET status = 'new' WHERE status IS NULL OR TRIM(status) = ''");
    this.execute("UPDATE leads SET status = 'appointment' WHERE status = 'qualified'");
    this.execute("UPDATE leads SET status = 'negotiation' WHERE status = 'proposal'");
    this.execute("UPDATE leads SET status = 'won' WHERE status = 'sold'");
    this.execute("UPDATE leads SET source = 'manual' WHERE source IS NULL OR TRIM(source) = ''");
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.all(`PRAGMA table_info(${tableName})`);
    if (!columns.some((column) => column.name === columnName)) {
      this.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  async seedDefaultUsers() {
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
          INSERT INTO users (name, email, password_hash, role, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
        [user.name, user.email.toLowerCase(), passwordHash, user.role, new Date().toISOString()]
      );
    }
  }

  accessClauseForUser(user, alias = "leads") {
    if (!user || canViewAllLeads(user)) {
      return {
        clause: "1 = 1",
        params: [],
      };
    }

    return {
      clause: `${alias}.assigned_to = ?`,
      params: [user.id],
    };
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
        leads.source,
        leads.status,
        leads.created_at,
        leads.updated_at,
        leads.customer_name,
        leads.phone,
        leads.email,
        leads.vehicle_interest,
        leads.vehicle_id,
        leads.listing_url,
        leads.message,
        leads.next_action,
        leads.contact_id,
        leads.assigned_to,
        contacts.phone AS contact_phone,
        contacts.email AS contact_email,
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
          FROM activities
          WHERE activities.lead_id = leads.id
          ORDER BY activities.created_at DESC, activities.id DESC
          LIMIT 1
        ) AS latest_activity_content,
        (
          SELECT created_at
          FROM activities
          WHERE activities.lead_id = leads.id
          ORDER BY activities.created_at DESC, activities.id DESC
          LIMIT 1
        ) AS latest_activity_at
      FROM leads
      LEFT JOIN contacts ON contacts.id = leads.contact_id
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
      source: row.source || "manual",
      customer_name: customerName,
      phone,
      email,
      vehicle_interest: row.vehicle_interest || row.next_action || "Vehicle inquiry",
      vehicle_id: row.vehicle_id || null,
      listing_url: row.listing_url || null,
      message,
      message_preview: message ? String(message).slice(0, 140) : "",
      status,
      status_label: titleCaseStatus(status === "new" ? "new lead" : status),
      assigned_user_name: row.assigned_user_name || "Unassigned",
      created_at: row.created_at,
      updated_at: row.updated_at,
      latest_activity_at: row.latest_activity_at || row.updated_at,
    };
  }

  listUsers() {
    return this.all(
      `
        SELECT id, name, email, role, created_at
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
        SELECT id, name, email, password_hash, role, created_at
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
        SELECT id, name, email, password_hash, role, created_at
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
    return this.all(
      `
        SELECT id, lead_id, type, content, created_at
        FROM activities
        WHERE lead_id = ?
        ORDER BY created_at DESC, id DESC
      `,
      [leadId]
    ).map((row) => ({
      id: Number(row.id),
      lead_id: Number(row.lead_id),
      type: row.type,
      content: row.content,
      created_at: row.created_at,
    }));
  }

  createActivity({ lead_id, type, content, created_at = null }) {
    const timestamp = created_at || new Date().toISOString();

    this.execute(
      `
        INSERT INTO activities (lead_id, type, content, created_at)
        VALUES (?, ?, ?, ?)
      `,
      [lead_id, type, content, timestamp]
    );
  }

  createApiLead(input) {
    const now = new Date().toISOString();
    const storedStatus = toStoredStatus(input.status || "new");
    const assigneeId = this.getDefaultAssigneeId();

    this.execute(
      `
        INSERT INTO leads (
          source,
          status,
          assigned_to,
          customer_name,
          phone,
          email,
          vehicle_interest,
          vehicle_id,
          listing_url,
          message,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.source || "website",
        storedStatus || "new",
        assigneeId,
        input.customer_name || null,
        input.phone || null,
        input.email || null,
        input.vehicle_interest || null,
        input.vehicle_id || null,
        input.listing_url || null,
        input.message || null,
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

    return this.getApiLead(id);
  }

  updateApiLead(id, input) {
    this.getApiLead(id);
    const now = new Date().toISOString();
    const storedStatus = input.status ? toStoredStatus(input.status) : null;

    this.execute(
      `
        UPDATE leads
        SET
          source = ?,
          status = COALESCE(?, status),
          customer_name = ?,
          phone = ?,
          email = ?,
          vehicle_interest = ?,
          vehicle_id = ?,
          listing_url = ?,
          message = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [
        input.source || "website",
        storedStatus,
        input.customer_name || null,
        input.phone || null,
        input.email || null,
        input.vehicle_interest || null,
        input.vehicle_id || null,
        input.listing_url || null,
        input.message || null,
        now,
        id,
      ]
    );

    this.save();
    return this.getApiLead(id);
  }

  updateApiLeadStatus(id, status) {
    const existingLead = this.getApiLead(id);
    const storedStatus = toStoredStatus(status);

    if (!DEALER_PIPELINE_STATUSES.includes(fromStoredStatus(storedStatus))) {
      throw new ValidationError("Invalid lead status.");
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
      content: `${existingLead.status_label} -> ${titleCaseStatus(fromStoredStatus(storedStatus))}`,
    });
    this.save();

    return this.getApiLead(id);
  }

  getApiLeadWithActivities(id, user = null) {
    const lead = this.getApiLead(id, user);

    return {
      lead,
      activities: this.listLeadActivitiesForApi(id),
    };
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
          WHERE status = 'won' AND ${access.clause}
        `,
        access.params
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
    this.execute(
      `
        INSERT INTO users (name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [input.name, input.email.toLowerCase(), input.password_hash, input.role, new Date().toISOString()]
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

  createContact(input) {
    const now = new Date().toISOString();
    this.execute(
      `
        INSERT INTO contacts (
          first_name,
          last_name,
          email,
          phone,
          company,
          job_title,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.first_name,
        input.last_name,
        input.email,
        input.phone,
        input.company,
        input.job_title,
        now,
        now,
      ]
    );
    const id = this.nextId();
    this.save();
    return this.getContact(id);
  }

  updateContact(id, input) {
    this.getContact(id);
    this.execute(
      `
        UPDATE contacts
        SET
          first_name = ?,
          last_name = ?,
          email = ?,
          phone = ?,
          company = ?,
          job_title = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [
        input.first_name,
        input.last_name,
        input.email,
        input.phone,
        input.company,
        input.job_title,
        new Date().toISOString(),
        id,
      ]
    );
    this.save();
    return this.getContact(id);
  }

  deleteContact(id) {
    this.getContact(id);
    this.execute("DELETE FROM contacts WHERE id = ?", [id]);
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

  createLead(input) {
    const assigneeId = input.assigned_to || this.getDefaultAssigneeId();
    const now = new Date().toISOString();

    if (!assigneeId) {
      throw new ValidationError("At least one sales user is required before creating leads.");
    }

    this.execute(
      `
        INSERT INTO leads (
          contact_id,
          assigned_to,
          source,
          status,
          priority,
          follow_up_date,
          next_action,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
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
    return this.getLead(id);
  }

  updateLead(id, input) {
    this.getLead(id);
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
        WHERE id = ?
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
      ]
    );
    this.save();
    return this.getLead(id);
  }

  assignLead(id, assignedTo) {
    this.getLead(id);
    this.execute(
      `
        UPDATE leads
        SET
          assigned_to = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [assignedTo, new Date().toISOString(), id]
    );
    this.save();
    return this.getLead(id);
  }

  updateLeadStatusIfNew(id, status = "contacted") {
    const lead = this.getLead(id);
    if (lead.status !== "new") {
      return lead;
    }

    this.execute(
      `
        UPDATE leads
        SET
          status = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [status, new Date().toISOString(), id]
    );
    this.save();
    return this.getLead(id);
  }

  deleteLead(id) {
    this.getLead(id);
    this.execute("DELETE FROM leads WHERE id = ?", [id]);
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
    this.getLead(leadId);
    this.execute(
      `
        INSERT INTO notes (lead_id, body, created_at)
        VALUES (?, ?, ?)
      `,
      [leadId, body, new Date().toISOString()]
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
    if (!LEAD_ACTIVITY_TYPES.includes(type)) {
      throw new ValidationError("Invalid lead activity type.");
    }

    this.execute(
      `
        INSERT INTO lead_activities (lead_id, user_id, type, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        input.lead_id,
        input.user_id || null,
        type,
        input.content,
        input.created_at || new Date().toISOString(),
      ]
    );
  }

  recordLeadActivity({ lead_id, user_id = null, type, content, created_at = null }) {
    this.getLead(lead_id);
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

  findLeadByPhone(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return null;
    }

    const leads = this.all(
      `
        ${this.leadSelectSql()}
        WHERE contacts.phone IS NOT NULL AND TRIM(contacts.phone) <> ''
        ORDER BY leads.updated_at DESC
      `
    );

    return leads.find((lead) => normalizePhone(lead.contact_phone) === normalizedPhone) || null;
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

    const statusCounts = LEAD_STATUSES.map((status) => ({
      status,
      count: Number(
        this.get(
          `
            SELECT COUNT(*) AS count
            FROM leads
            WHERE status = ? AND ${access.clause}
          `,
          [status, ...access.params]
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

  getDefaultAssigneeId() {
    const user = this.getAssignableSalesUser();
    return user ? Number(user.id) : null;
  }

  displayContactName(contact) {
    const name = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
    return name || contact.company || contact.email || contact.phone || `Contact #${contact.id}`;
  }
}

module.exports = {
  CrmDatabase,
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
};
