/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} name
 * @property {string} email
 * @property {string} password_hash
 * @property {"admin"|"manager"|"sales"} role
 * @property {string} created_at
 */

/**
 * @typedef {Object} Contact
 * @property {number} id
 * @property {string} first_name
 * @property {string} last_name
 * @property {string|null} email
 * @property {string|null} phone
 * @property {string|null} company
 * @property {string|null} job_title
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Lead
 * @property {number} id
 * @property {number|null} contact_id
 * @property {number|null} assigned_to
 * @property {string} source
 * @property {string} status
 * @property {string|null} priority
 * @property {string|null} follow_up_date
 * @property {string|null} next_action
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Note
 * @property {number} id
 * @property {number} lead_id
 * @property {string} body
 * @property {string} created_at
 */

const USER_ROLES = ["admin", "manager", "sales"];
const LEAD_STATUSES = ["new", "contacted", "appointment", "test_drive", "negotiation", "won", "lost"];
const LEAD_SOURCES = ["website", "autotrader", "cargurus", "manual"];
const LEAD_ACTIVITY_TYPES = ["call", "sms", "note"];

module.exports = {
  LEAD_ACTIVITY_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  USER_ROLES,
};
