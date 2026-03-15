const { USER_ROLES } = require("../types/models");

function normalizeUserRole(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidUserRole(value) {
  return USER_ROLES.includes(normalizeUserRole(value));
}

function canManageUsers(user) {
  return user && user.role === "admin";
}

function canAssignLeads(user) {
  return Boolean(user && (user.role === "admin" || user.role === "manager"));
}

function canViewAllLeads(user) {
  return Boolean(user && (user.role === "admin" || user.role === "manager"));
}

module.exports = {
  canAssignLeads,
  canManageUsers,
  canViewAllLeads,
  isValidUserRole,
  normalizeUserRole,
};
