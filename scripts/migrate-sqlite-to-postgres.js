const path = require("path");

const { CrmDatabase } = require("../src/data/database");
const { PostgresCrmDatabase } = require("../src/data/postgres");

async function copyTable(target, tableName, rows) {
  if (rows.length === 0) {
    return;
  }

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `
    INSERT INTO ${tableName} (${columns.join(", ")})
    VALUES (${placeholders})
  `;

  for (const row of rows) {
    await target.execute(
      sql,
      columns.map((column) => row[column])
    );
  }
}

async function resetSequence(target, tableName) {
  await target.execute(
    `
      SELECT setval(
        pg_get_serial_sequence(?, 'id'),
        COALESCE((SELECT MAX(id) FROM ${tableName}), 1),
        COALESCE((SELECT MAX(id) FROM ${tableName}), 0) > 0
      )
    `,
    [tableName]
  );
}

async function main() {
  const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "crm.sqlite");
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const source = await CrmDatabase.initialize({ dbPath: sqlitePath, allowSqlite: true });
  const target = await PostgresCrmDatabase.initialize({ connectionString });

  const users = source.all("SELECT id, name, email, password_hash, role, created_at FROM users ORDER BY id ASC");
  const contacts = source.all(
    "SELECT id, first_name, last_name, email, phone, company, job_title, created_at, updated_at FROM contacts ORDER BY id ASC"
  );
  const leads = source.all(
    `
      SELECT
        id,
        contact_id,
        source,
        assigned_to,
        status,
        priority,
        follow_up_date,
        next_action,
        created_at,
        updated_at,
        customer_name,
        phone,
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
        message
      FROM leads
      ORDER BY id ASC
    `
  );
  const notes = source.all("SELECT id, lead_id, body, created_at FROM notes ORDER BY id ASC");
  const leadActivities = source.all(
    "SELECT id, lead_id, user_id, type, content, created_at FROM lead_activities ORDER BY id ASC"
  );
  const activities = source.all("SELECT id, lead_id, type, content, created_at FROM activities ORDER BY id ASC");
  const importedMessages = source.all(
    `
      SELECT id, external_id, source, lead_id, subject, sender, received_at, status, matched_reason, created_at
      FROM imported_messages
      ORDER BY id ASC
    `
  );

  await target.execute(
    "TRUNCATE imported_messages, activities, lead_activities, notes, leads, contacts, users RESTART IDENTITY CASCADE"
  );

  await copyTable(target, "users", users);
  await copyTable(target, "contacts", contacts);
  await copyTable(target, "leads", leads);
  await copyTable(target, "notes", notes);
  await copyTable(target, "lead_activities", leadActivities);
  await copyTable(target, "activities", activities);
  await copyTable(target, "imported_messages", importedMessages);

  await resetSequence(target, "users");
  await resetSequence(target, "contacts");
  await resetSequence(target, "leads");
  await resetSequence(target, "notes");
  await resetSequence(target, "lead_activities");
  await resetSequence(target, "activities");
  await resetSequence(target, "imported_messages");

  console.log("Migration complete.");
  console.log(`Users: ${users.length}`);
  console.log(`Contacts: ${contacts.length}`);
  console.log(`Leads: ${leads.length}`);
  console.log(`Notes: ${notes.length}`);
  console.log(`Lead activities: ${leadActivities.length}`);
  console.log(`Activities: ${activities.length}`);
  console.log(`Imported messages: ${importedMessages.length}`);

  if (typeof target.close === "function") {
    await target.close();
  }
}

main().catch((error) => {
  console.error("SQLite -> PostgreSQL migration failed.");
  console.error(error);
  process.exit(1);
});
