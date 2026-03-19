const express = require("express");
const session = require("express-session");
const fs = require("fs");
const http = require("http");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const { createRingCentralService } = require("./services/ringcentral");
const { initializeDatabase } = require("./src/data");
const { attachCurrentUser } = require("./src/middleware/auth");
const { registerApiRoutes } = require("./src/routes/api");
const { registerAuthRoutes } = require("./src/routes/auth");
const { registerRingCentralRoutes } = require("./src/routes/ringcentral");
const { registerUserRoutes } = require("./src/routes/users");
const { registerWebRoutes } = require("./src/routes/web");
const { renderDocument } = require("./src/views/layout");
const { CRM_LEAD_STATUSES } = require("./src/models/leadStatus");

function shouldServeReactApp(options = {}) {
  // Legacy server-rendered routes remain available only as an explicit compatibility mode.
  if (options.uiMode === "legacy") {
    return false;
  }

  if (options.uiMode === "react") {
    return true;
  }

  if (process.env.CRM_UI_MODE === "legacy") {
    return false;
  }

  return true;
}

async function createApp(options = {}) {
  const app = express();
  const db = await initializeDatabase({
    dbClient: options.dbClient,
    dbPath: options.dbPath,
    databaseSsl: options.databaseSsl,
    databaseUrl: options.databaseUrl,
  });
  const ringcentralConfig = { ...(options.ringcentral || {}) };
  const ringcentralFetchImpl = ringcentralConfig.fetchImpl;
  delete ringcentralConfig.fetchImpl;
  const ringcentral = await createRingCentralService(ringcentralConfig, {
    db,
    fetchImpl: ringcentralFetchImpl,
  });
  const frontendDistPath = path.join(__dirname, "frontend", "dist");
  const serveReactApp = shouldServeReactApp(options) && fs.existsSync(frontendDistPath);

  app.locals.db = db;
  app.locals.leadStatuses = CRM_LEAD_STATUSES;
  app.locals.ringcentral = ringcentral;

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "10mb" }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "crm-dev-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
      },
    })
  );
  app.use(attachCurrentUser);
  app.use("/public", express.static(path.join(__dirname, "public")));

  app.get("/health", (req, res) => {
    res.type("text/plain").send("OK");
  });

  registerAuthRoutes(app);
  registerApiRoutes(app);
  registerRingCentralRoutes(app);
  registerUserRoutes(app);

  if (serveReactApp) {
    app.use(express.static(frontendDistPath, { index: false }));

    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/health") {
        next();
        return;
      }

      res.sendFile(path.join(frontendDistPath, "index.html"));
    });
  } else {
    registerWebRoutes(app);
  }

  app.use((req, res) => {
    res
      .status(404)
      .send(
        renderDocument({
          title: "Not Found",
          activePath: req.path,
          currentUser: req.currentUser,
          content: `
            <section class="panel stack">
              <h1>Page not found</h1>
              <p>The page you requested does not exist.</p>
              <p><a class="button secondary" href="/">Return to dashboard</a></p>
            </section>
          `,
        })
      );
  });

  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error(error);
    }

    if (req.path.startsWith("/api/")) {
      res.status(statusCode).json({ error: error.message || "Unexpected error." });
      return;
    }

    res
      .status(statusCode)
      .send(
        renderDocument({
          title: statusCode === 404 ? "Not Found" : "Server Error",
          activePath: req.path,
          currentUser: req.currentUser,
          content: `
            <section class="panel stack">
              <h1>${statusCode === 404 ? "Record not found" : "Unexpected error"}</h1>
              <p>${error.message || "Something went wrong while loading the CRM."}</p>
              <p><a class="button secondary" href="/">Return to dashboard</a></p>
            </section>
          `,
        })
      );
  });

  return app;
}

async function startServer(options = {}) {
  const app = await createApp(options);
  const port = options.port || Number(process.env.PORT) || 3000;

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.once("error", reject);
    server.listen(port, () => {
      console.log(`CRM listening on http://localhost:${port}`);
      resolve({ app, server });
    });
  });
}

module.exports = {
  createApp,
  startServer,
};
