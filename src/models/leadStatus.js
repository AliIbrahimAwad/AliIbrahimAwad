const CRM_LEAD_STATUSES = ["new", "contacted", "appointment", "negotiation", "sold", "lost"];

const LEAD_STATUS_FLOW = {
  new: ["contacted", "appointment", "negotiation", "lost"],
  contacted: ["appointment", "negotiation", "lost"],
  appointment: ["contacted", "negotiation", "sold", "lost"],
  negotiation: ["appointment", "contacted", "sold", "lost"],
  sold: [],
  lost: ["contacted"],
};

function normalizeLeadStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (normalized === "new_lead") {
    return "new";
  }

  if (normalized === "won") {
    return "sold";
  }

  return normalized;
}

function isValidLeadStatus(value) {
  return CRM_LEAD_STATUSES.includes(normalizeLeadStatus(value));
}

function canTransitionLeadStatus(currentStatus, nextStatus) {
  const current = normalizeLeadStatus(currentStatus);
  const next = normalizeLeadStatus(nextStatus);

  if (!isValidLeadStatus(current) || !isValidLeadStatus(next)) {
    return false;
  }

  if (current === next) {
    return true;
  }

  return LEAD_STATUS_FLOW[current].includes(next);
}

module.exports = {
  CRM_LEAD_STATUSES,
  LEAD_STATUS_FLOW,
  canTransitionLeadStatus,
  isValidLeadStatus,
  normalizeLeadStatus,
};
