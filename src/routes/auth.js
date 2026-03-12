const { renderLoginPage } = require("../views/auth");
const { asyncHandler } = require("./helpers");

const DEMO_USERS = [
  { role: "admin", email: "admin@crm.local", password: "admin123" },
  { role: "manager", email: "manager@crm.local", password: "manager123" },
  { role: "sales", email: "sales@crm.local", password: "sales123" },
];

function registerAuthRoutes(app) {
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
