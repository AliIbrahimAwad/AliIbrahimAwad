const { canManageUsers } = require("../models/user");

function attachCurrentUser(req, res, next) {
  const userId = req.session && req.session.userId;

  if (!userId) {
    req.currentUser = null;
    return next();
  }

  try {
    req.currentUser = req.app.locals.db.getUser(userId);
    return next();
  } catch (error) {
    req.session.userId = null;
    req.currentUser = null;
    return next();
  }
}

function requireAuth(req, res, next) {
  if (req.currentUser) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Authentication required." });
  }

  return res.redirect("/login");
}

function requireAdmin(req, res, next) {
  if (canManageUsers(req.currentUser)) {
    return next();
  }

  return res.status(403).send("Forbidden");
}

module.exports = {
  attachCurrentUser,
  requireAdmin,
  requireAuth,
};
