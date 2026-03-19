const { getDefaultDealershipId } = require("../config/dealership");

const DEALER_PIPELINE_STATUSES = ["new", "contacted", "appointment", "negotiation", "sold", "lost"];

function toStoredStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  switch (normalized) {
    case "new_lead":
      return "new";
    case "sold":
      return "won";
    default:
      return normalized;
  }
}

function fromStoredStatus(status) {
  return status === "won" ? "sold" : String(status || "new").trim().toLowerCase();
}

function titleCaseStatus(status) {
  return String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

class HttpError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

class NotFoundError extends HttpError {
  constructor(message) {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

class ValidationError extends HttpError {
  constructor(message) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

class BaseCrmDatabase {
  currentDealershipId(user = null) {
    return Number(user?.dealership_id || getDefaultDealershipId());
  }

  displayContactName(contact) {
    const name = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
    return name || contact.company || contact.email || contact.phone || `Contact #${contact.id}`;
  }
}

module.exports = {
  BaseCrmDatabase,
  DEALER_PIPELINE_STATUSES,
  fromStoredStatus,
  HttpError,
  NotFoundError,
  titleCaseStatus,
  toStoredStatus,
  UnauthorizedError,
  ValidationError,
};
