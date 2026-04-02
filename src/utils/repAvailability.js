const VALID_WORKING_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DEFAULT_WORKING_DAYS = ["mon", "tue", "wed", "thu", "fri"];
const DEFAULT_WORKING_HOURS_START = "09:00";
const DEFAULT_WORKING_HOURS_END = "18:00";
const DEFAULT_REP_TIMEZONE = "America/Toronto";

function normalizeBoolean(value, fallback = true) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeWorkingDays(value, fallback = DEFAULT_WORKING_DAYS) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : value.split(",");
          } catch (_error) {
            return value.split(",");
          }
        })()
      : fallback;

  const normalized = source
    .map((entry) => String(entry || "").trim().slice(0, 3).toLowerCase())
    .filter((entry, index, array) => VALID_WORKING_DAYS.includes(entry) && array.indexOf(entry) === index);

  return normalized.length ? normalized : [...fallback];
}

function normalizeWorkingHoursValue(value, fallback) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeRepAvailabilityInput(input = {}, existing = {}) {
  return {
    is_active: normalizeBoolean(input.is_active, normalizeBoolean(existing.is_active, true)),
    is_available: normalizeBoolean(input.is_available, normalizeBoolean(existing.is_available, true)),
    working_days: normalizeWorkingDays(input.working_days ?? existing.working_days),
    working_hours_start: normalizeWorkingHoursValue(
      input.working_hours_start ?? existing.working_hours_start,
      DEFAULT_WORKING_HOURS_START
    ),
    working_hours_end: normalizeWorkingHoursValue(
      input.working_hours_end ?? existing.working_hours_end,
      DEFAULT_WORKING_HOURS_END
    ),
    timezone: String(input.timezone || existing.timezone || DEFAULT_REP_TIMEZONE).trim() || DEFAULT_REP_TIMEZONE,
    max_active_leads:
      input.max_active_leads == null || input.max_active_leads === ""
        ? existing.max_active_leads == null || existing.max_active_leads === ""
          ? null
          : Number(existing.max_active_leads)
        : Math.max(0, Number(input.max_active_leads) || 0),
  };
}

function timeStringToMinutes(value, fallback = 0) {
  const normalized = normalizeWorkingHoursValue(value, "");
  if (!normalized) {
    return fallback;
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function getLocalTimeParts(at = new Date(), timeZone = DEFAULT_REP_TIMEZONE) {
  const date = at instanceof Date ? at : new Date(at);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: String(lookup.weekday || "").slice(0, 3).toLowerCase(),
    hour: Number(lookup.hour || 0),
    minute: Number(lookup.minute || 0),
  };
}

function evaluateRepAvailability(rep = {}, at = new Date()) {
  const normalized = normalizeRepAvailabilityInput(rep);
  if (!normalized.is_active) {
    return { eligible: false, reason: "inactive", rep: normalized };
  }
  if (!normalized.is_available) {
    return { eligible: false, reason: "manual_off", rep: normalized };
  }

  const local = getLocalTimeParts(at, normalized.timezone);
  if (!normalized.working_days.includes(local.weekday)) {
    return { eligible: false, reason: "outside_working_day", rep: normalized, local };
  }

  return {
    eligible: true,
    reason: "eligible",
    rep: normalized,
    local,
  };
}

function isRepEligible(rep = {}, at = new Date()) {
  return evaluateRepAvailability(rep, at).eligible;
}

module.exports = {
  DEFAULT_REP_TIMEZONE,
  DEFAULT_WORKING_DAYS,
  DEFAULT_WORKING_HOURS_END,
  DEFAULT_WORKING_HOURS_START,
  VALID_WORKING_DAYS,
  evaluateRepAvailability,
  isRepEligible,
  normalizeRepAvailabilityInput,
  normalizeWorkingDays,
  normalizeWorkingHoursValue,
  timeStringToMinutes,
};
