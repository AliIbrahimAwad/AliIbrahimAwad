const crypto = require("crypto");

const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("./helpers");

function registerRingCentralRoutes(app) {
  app.get(
    "/api/ringcentral/status",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await req.app.locals.ringcentral.getConnectionStatusForUser(req.currentUser.id));
    })
  );

  app.get(
    "/api/ringcentral/connect",
    requireAuth,
    asyncHandler(async (req, res) => {
      const state = crypto.randomUUID();
      const authorizationUrl = req.app.locals.ringcentral.buildAuthorizationUrl(state);
      req.session.ringcentralOauth = {
        state,
        userId: Number(req.currentUser.id),
        createdAt: Date.now(),
      };

      await new Promise((resolve, reject) => {
        req.session.save((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      const wantsHtml =
        String(req.query.redirect || "") === "1" ||
        String(req.headers.accept || "").includes("text/html");

      if (wantsHtml) {
        res.redirect(authorizationUrl);
        return;
      }

      res.json({
        url: authorizationUrl,
      });
    })
  );

  app.get(
    "/api/ringcentral/oauth/callback",
    asyncHandler(async (req, res) => {
      const expected = req.session.ringcentralOauth;
      const state = String(req.query.state || "");
      const code = String(req.query.code || "");

      if (!expected || expected.state !== state || !code) {
        res.status(400).send("Invalid RingCentral OAuth callback.");
        return;
      }

      await req.app.locals.ringcentral.completeOAuthConnection(expected.userId, code);
      req.session.ringcentralOauth = null;
      res.redirect("/?ringcentral=connected");
    })
  );

  app.post(
    "/api/ringcentral/disconnect",
    requireAuth,
    asyncHandler(async (req, res) => {
      await req.app.locals.ringcentral.disconnectUser(req.currentUser.id);
      res.status(204).end();
    })
  );

  app.post(
    "/api/ringcentral/webhooks",
    asyncHandler(async (req, res) => {
      const validationToken = req.app.locals.ringcentral.getValidationToken(req.headers);
      if (validationToken) {
        res.setHeader("Validation-Token", validationToken);
        res.status(200).end();
        return;
      }

      if (!req.app.locals.ringcentral.isValidWebhookRequest(req.headers)) {
        res.status(401).json({ error: "Invalid webhook request." });
        return;
      }

      const result = await req.app.locals.ringcentral.processWebhookEnvelope(
        req.app.locals.ringcentral.getEventEnvelope(req.body)
      );
      res.json(result);
    })
  );

  app.post(
    "/api/ringcentral/process-jobs",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.currentUser || req.currentUser.role === "sales") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json({
        items: await req.app.locals.ringcentral.processPendingJobs({
          limit: Number(req.body.limit || 10),
        }),
      });
    })
  );

  app.get(
    "/api/ringcentral/jobs",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.currentUser || req.currentUser.role === "sales") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json({
        items: await req.app.locals.ringcentral.store.summarizeJobs(),
      });
    })
  );

  app.post(
    "/api/ringcentral/reconcile",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.currentUser || req.currentUser.role === "sales") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json({
        items: await req.app.locals.ringcentral.reconcileConnectedAccounts({
          hoursBack: Number(req.body.hours_back || req.body.hoursBack || 24),
        }),
      });
    })
  );
}

module.exports = {
  registerRingCentralRoutes,
};
