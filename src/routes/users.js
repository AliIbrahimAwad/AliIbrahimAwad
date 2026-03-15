const bcrypt = require("bcrypt");

const { isValidUserRole, normalizeUserRole } = require("../models/user");
const { USER_ROLES } = require("../types/models");
const { renderUserForm, renderUsersListPage } = require("../views/users");
const { requireAdmin, requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("./helpers");

function sanitizeUserPayload(body) {
  return {
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    password: String(body.password || ""),
    role: normalizeUserRole(body.role),
  };
}

function validateUserPayload(payload, { requirePassword }) {
  const errors = {};

  if (!payload.name) {
    errors.name = "Name is required.";
  }

  if (!payload.email) {
    errors.email = "Email is required.";
  }

  if (!isValidUserRole(payload.role)) {
    errors.role = "Choose a valid role.";
  }

  if (requirePassword && payload.password.length < 6) {
    errors.password = "Password must be at least 6 characters.";
  }

  if (!requirePassword && payload.password && payload.password.length < 6) {
    errors.password = "Password must be at least 6 characters.";
  }

  return errors;
}

function registerUserRoutes(app) {
  app.get(
    "/api/users",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const users = await req.app.locals.db.listUsers();
      res.json({
        items: users.map((user) => ({
          id: Number(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
          created_at: user.created_at,
        })),
      });
    })
  );

  app.post(
    "/api/users",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const payload = sanitizeUserPayload(req.body);
      const errors = validateUserPayload(payload, { requirePassword: true });

      if (Object.keys(errors).length > 0) {
        res.status(422).json({ error: Object.values(errors)[0] || "Invalid user payload." });
        return;
      }

      try {
        const passwordHash = await bcrypt.hash(payload.password, 10);
        const user = await req.app.locals.db.createUser({
          name: payload.name,
          email: payload.email,
          password_hash: passwordHash,
          role: payload.role,
        });

        res.status(201).json({
          id: Number(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
          created_at: user.created_at,
        });
      } catch (error) {
        res.status(422).json({
          error:
            error.code === "23505" || error.message.includes("UNIQUE")
              ? "That email is already in use."
              : "Could not create the user.",
        });
      }
    })
  );

  app.delete(
    "/api/users/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const userId = Number(req.params.id);
      if (Number(req.currentUser.id) === userId) {
        res.status(400).json({ error: "You cannot delete your own user while signed in." });
        return;
      }

      await req.app.locals.db.deleteUser(userId);
      res.status(204).end();
    })
  );

  app.get(
    "/users",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const users = await req.app.locals.db.listUsers();
      res.send(renderUsersListPage({ users, currentUser: req.currentUser }));
    })
  );

  app.get("/users/new", requireAuth, requireAdmin, (req, res) => {
    res.send(
      renderUserForm({
        title: "New user",
        action: "/users",
        formData: {
          name: "",
          email: "",
          password: "",
          role: "sales",
        },
        roles: USER_ROLES,
        currentUser: req.currentUser,
        submitLabel: "Create user",
      })
    );
  });

  app.post(
    "/users",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const payload = sanitizeUserPayload(req.body);
      const errors = validateUserPayload(payload, { requirePassword: true });

      if (Object.keys(errors).length > 0) {
        res.status(422).send(
          renderUserForm({
            title: "New user",
            action: "/users",
            formData: payload,
            errors,
            roles: USER_ROLES,
            currentUser: req.currentUser,
            submitLabel: "Create user",
          })
        );
        return;
      }

      try {
        const passwordHash = await bcrypt.hash(payload.password, 10);
        await req.app.locals.db.createUser({
          name: payload.name,
          email: payload.email,
          password_hash: passwordHash,
          role: payload.role,
        });
        res.redirect("/users");
      } catch (error) {
        res.status(422).send(
          renderUserForm({
            title: "New user",
            action: "/users",
            formData: payload,
            errors: {
              form:
                error.code === "23505" || error.message.includes("UNIQUE")
                  ? "That email is already in use."
                  : "Could not create the user.",
            },
            roles: USER_ROLES,
            currentUser: req.currentUser,
            submitLabel: "Create user",
          })
        );
      }
    })
  );

  app.get(
    "/users/:id/edit",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const user = await req.app.locals.db.getUser(Number(req.params.id));
      res.send(
        renderUserForm({
          title: "Edit user",
          action: `/users/${user.id}`,
          formData: {
            name: user.name,
            email: user.email,
            password: "",
            role: user.role,
          },
          roles: USER_ROLES,
          currentUser: req.currentUser,
          submitLabel: "Save user",
        })
      );
    })
  );

  app.post(
    "/users/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const userId = Number(req.params.id);
      await req.app.locals.db.getUser(userId);
      const payload = sanitizeUserPayload(req.body);
      const errors = validateUserPayload(payload, { requirePassword: false });

      if (Object.keys(errors).length > 0) {
        res.status(422).send(
          renderUserForm({
            title: "Edit user",
            action: `/users/${userId}`,
            formData: payload,
            errors,
            roles: USER_ROLES,
            currentUser: req.currentUser,
            submitLabel: "Save user",
          })
        );
        return;
      }

      try {
        const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : null;
        await req.app.locals.db.updateUser(userId, {
          name: payload.name,
          email: payload.email,
          role: payload.role,
          password_hash: passwordHash,
        });
        res.redirect("/users");
      } catch (error) {
        res.status(422).send(
          renderUserForm({
            title: "Edit user",
            action: `/users/${userId}`,
            formData: payload,
            errors: {
              form:
                error.code === "23505" || error.message.includes("UNIQUE")
                  ? "That email is already in use."
                  : "Could not update the user.",
            },
            roles: USER_ROLES,
            currentUser: req.currentUser,
            submitLabel: "Save user",
          })
        );
      }
    })
  );
}

module.exports = {
  registerUserRoutes,
};
