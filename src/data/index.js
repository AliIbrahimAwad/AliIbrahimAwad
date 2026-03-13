const path = require("path");

const {
  CrmDatabase,
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} = require("./database");
const { PostgresCrmDatabase } = require("./postgres");

async function initializeDatabase(options = {}) {
  const client = options.dbClient || process.env.DB_CLIENT || "";
  const connectionString = options.databaseUrl || process.env.DATABASE_URL || "";
  const usePostgres = client === "postgres" || Boolean(connectionString);

  if (usePostgres) {
    return PostgresCrmDatabase.initialize({
      connectionString,
      ssl: options.databaseSsl === true || process.env.DATABASE_SSL === "true",
    });
  }

  const dbPath = options.dbPath || path.join(__dirname, "..", "..", "data", "crm.sqlite");
  return CrmDatabase.initialize({ dbPath });
}

module.exports = {
  CrmDatabase,
  HttpError,
  NotFoundError,
  PostgresCrmDatabase,
  UnauthorizedError,
  ValidationError,
  initializeDatabase,
};
