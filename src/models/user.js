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

function canUpdateLeadStatus(user, lead = null) {
  if (!user) {
    return false;
  }

  if (user.role === "admin" || user.role === "manager") {
    return true;
  }

  if (user.role !== "sales" || !lead) {
    return false;
  }

  const assignedTo = lead.assigned_to ?? lead.assignedTo ?? null;
  return Number(assignedTo) === Number(user.id);
}

function canViewAllLeads(user) {
  return Boolean(user && (user.role === "admin" || user.role === "manager"));
}

module.exports = {
  canAssignLeads,
  canManageUsers,
  canUpdateLeadStatus,
  canViewAllLeads,
  isValidUserRole,
  normalizeUserRole,
};
