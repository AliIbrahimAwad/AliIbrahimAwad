const { renderLoginPage } = require("../views/auth");
const { asyncHandler } = require("./helpers");

const DEMO_USERS = [
  { role: "admin", email: "admin@crm.local", password: "admin123" },
  { role: "manager", email: "manager@crm.local", password: "manager123" },
  { role: "sales", email: "sales@crm.local", password: "sales123" },
];

function registerAuthRoutes(app) {
  app.get("/api/auth/session", (req, res) => {
    if (!req.currentUser) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    res.json({
      user: {
        id: req.currentUser.id,
        name: req.currentUser.name,
        email: req.currentUser.email,
        role: req.currentUser.role,
      },
    });
  });

  app.get("/login", (req, res) => {
    if (req.currentUser) {
      res.redirect("/");
      return;
    }

    res.send(
      renderLoginPage({
        formData: { email: "" },
        demoUsers: DEMO_USERS,
      })
    );
  });

  app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
      const email = String(req.body.email || "").trim();
      const password = String(req.body.password || "");

      const user = await req.app.locals.db.authenticateUser(email, password);
      req.session.userId = user.id;

      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    })
  );

  app.post(
    "/login",
    asyncHandler(async (req, res) => {
      const email = String(req.body.email || "").trim();
      const password = String(req.body.password || "");

      try {
        const user = await req.app.locals.db.authenticateUser(email, password);
        req.session.userId = user.id;
        res.redirect("/");
      } catch (error) {
        res.status(401).send(
          renderLoginPage({
            formData: { email },
            errors: { form: error.message, email: "Invalid", password: "Invalid" },
            demoUsers: DEMO_USERS,
          })
        );
      }
    })
  );

  app.post("/api/auth/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }

      res.status(204).end();
    });
  });

  app.post("/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }

      res.redirect("/login");
    });
  });
}

module.exports = {
  registerAuthRoutes,
};
