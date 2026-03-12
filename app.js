const express = require("express");
const session = require("express-session");
const path = require("path");

const { createRingCentralService } = require("./services/ringcentral");
const { CrmDatabase } = require("./src/data/database");
const { attachCurrentUser } = require("./src/middleware/auth");
const { registerApiRoutes } = require("./src/routes/api");
const { registerAuthRoutes } = require("./src/routes/auth");
const { registerUserRoutes } = require("./src/routes/users");
const { registerWebRoutes } = require("./src/routes/web");
const { renderDocument } = require("./src/views/layout");
const { LEAD_STATUSES } = require("./src/types/models");

async function createApp(options = {}) {
  const app = express();
  const dbPath = options.dbPath || path.join(__dirname, "data", "crm.sqlite");
  const db = await CrmDatabase.initialize({ dbPath });
  const ringcentral = createRingCentralService(options.ringcentral);

  app.locals.db = db;
  app.locals.leadStatuses = LEAD_STATUSES;
  app.locals.ringcentral = ringcentral;

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
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
  registerUserRoutes(app);
  registerWebRoutes(app);

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

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`CRM listening on http://localhost:${port}`);
      resolve({ app, server });
    });
  });
}

module.exports = {
  createApp,
  startServer,
};
