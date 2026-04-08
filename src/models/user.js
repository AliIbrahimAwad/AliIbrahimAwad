const { USER_ROLES } = require("../types/models");

function normalizeUserRole(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidUserRole(value) {
  return USER_ROLES.includes(normalizeUserRole(value));
}

function canManageUsers(user) {
  return Boolean(user && normalizeUserRole(user.role) === "admin");
}

function canAssignLeads(user) {
  const role = normalizeUserRole(user?.role);
  return Boolean(user && (role === "admin" || role === "manager"));
}

function canUpdateLeadStatus(user, lead = null) {
  if (!user) {
    return false;
  }

  const role = normalizeUserRole(user.role);

  if (role === "admin" || role === "manager") {
    return true;
  }

  if (role !== "sales" || !lead) {
    return false;
  }

  const assignedTo = lead.assigned_to ?? lead.assignedTo ?? null;
  return Number(assignedTo) === Number(user.id);
}

function canViewAllLeads(user) {
  const role = normalizeUserRole(user?.role);
  return Boolean(user && (role === "admin" || role === "manager"));
}

module.exports = {
  canAssignLeads,
  canManageUsers,
  canUpdateLeadStatus,
  canViewAllLeads,
  isValidUserRole,
  normalizeUserRole,
};
