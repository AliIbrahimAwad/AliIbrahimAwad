const bcrypt = require("bcrypt");

const { canAssignLeads, isValidUserRole, normalizeUserRole } = require("../models/user");
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

function sanitizeAvailabilityPayload(body) {
  return {
    is_active: body.is_active,
    is_available: body.is_available,
    working_days: body.working_days || body.workingDays,
    working_hours_start: body.working_hours_start || body.workingHoursStart,
    working_hours_end: body.working_hours_end || body.workingHoursEnd,
    timezone: body.timezone,
    max_active_leads: body.max_active_leads || body.maxActiveLeads,
  };
}

function serializeUser(user) {
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    is_active: Boolean(user.is_active),
    is_available: Boolean(user.is_available),
    working_days: user.working_days || [],
    working_hours_start: user.working_hours_start || null,
    working_hours_end: user.working_hours_end || null,
    timezone: user.timezone || null,
    max_active_leads: user.max_active_leads == null ? null : Number(user.max_active_leads),
    created_at: user.created_at,
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
    "/api/users/assignable",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const users = await req.app.locals.db.listSalesUsers(req.currentUser);
      res.json({
        items: users.map(serializeUser),
      });
    })
  );

  app.get(
    "/api/users",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!canAssignLeads(req.currentUser) && !canManageUsers(req.currentUser)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const users = await req.app.locals.db.listUsers(req.currentUser);
      res.json({
        items: users.map(serializeUser),
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
        }, req.currentUser);

        res.status(201).json(serializeUser(user));
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

      await req.app.locals.db.deleteUser(userId, req.currentUser);
      res.status(204).end();
    })
  );

  app.patch(
    "/api/users/:id/availability",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        res.status(422).json({ error: "A valid user is required." });
        return;
      }

      const isSelf = Number(req.currentUser.id) === userId;
      const canManageAvailability = canAssignLeads(req.currentUser) || canManageUsers(req.currentUser);
      if (!isSelf && !canManageAvailability) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const targetUser = await req.app.locals.db.getUser(userId);
      if (
        Number(targetUser.dealership_id || 0) !== Number(req.currentUser.dealership_id || 0) ||
        (!isSelf && targetUser.role !== "sales")
      ) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      const updated = await req.app.locals.db.updateUserAvailability(
        userId,
        sanitizeAvailabilityPayload(req.body),
        req.currentUser
      );

      res.json({ item: serializeUser(updated) });
    })
  );

  app.get(
    "/users",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const users = await req.app.locals.db.listUsers(req.currentUser);
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
        }, req.currentUser);
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
      if (Number(user.dealership_id) !== Number(req.currentUser.dealership_id)) {
        res.status(404).send("Not found");
        return;
      }
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
      const existingUser = await req.app.locals.db.getUser(userId);
      if (Number(existingUser.dealership_id) !== Number(req.currentUser.dealership_id)) {
        res.status(404).send("Not found");
        return;
      }
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
        }, req.currentUser);
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
