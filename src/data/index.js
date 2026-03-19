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
  const explicitSqlitePath = options.dbPath || "";
  const allowSqlite = options.allowSqlite === true || Boolean(explicitSqlitePath);
  const usePostgres = client === "postgres" || Boolean(connectionString);

  if (usePostgres) {
    return PostgresCrmDatabase.initialize({
      connectionString,
      ssl: options.databaseSsl === true || process.env.DATABASE_SSL === "true",
    });
  }

  if (explicitSqlitePath && allowSqlite) {
    return CrmDatabase.initialize({ dbPath: explicitSqlitePath, allowSqlite: true });
  }

  throw new Error(
    "PostgreSQL configuration is required for runtime CRM usage. SQLite is reserved for isolated test paths only."
  );
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
