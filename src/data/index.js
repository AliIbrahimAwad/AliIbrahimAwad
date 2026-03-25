const { HttpError, NotFoundError, UnauthorizedError, ValidationError } = require("./core");
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

  throw new Error("PostgreSQL configuration is required. SQLite is no longer supported.");
}

module.exports = {
  HttpError,
  NotFoundError,
  PostgresCrmDatabase,
  UnauthorizedError,
  ValidationError,
  initializeDatabase,
};
