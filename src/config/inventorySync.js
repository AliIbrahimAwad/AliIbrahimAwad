function normalizeBoolean(value, defaultValue = false) {
  if (value == null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function normalizePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTimeString(value, fallback) {
  const normalized = String(value || "").trim();
  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function normalizeRetryTimes(value, defaults = ["04:00", "05:00"]) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const parsed = raw
    .map((entry) => normalizeTimeString(entry, ""))
    .filter(Boolean);

  return parsed.length ? parsed : defaults;
}

function buildInventorySyncConfig(overrides = {}) {
  const timezone = String(overrides.timezone || process.env.INVENTORY_SYNC_TIMEZONE || "America/Toronto").trim();
  const config = {
    enabled: normalizeBoolean(overrides.enabled ?? process.env.INVENTORY_SYNC_ENABLED, true),
    timezone,
    primaryTime: normalizeTimeString(
      overrides.primaryTime || process.env.INVENTORY_SYNC_PRIMARY_TIME,
      "03:15"
    ),
    retryTimes: normalizeRetryTimes(overrides.retryTimes || process.env.INVENTORY_SYNC_RETRY_TIMES),
    ftp: {
      host: String(overrides.ftpHost || process.env.INVENTORY_FTP_HOST || "").trim(),
      port: normalizePositiveInteger(overrides.ftpPort || process.env.INVENTORY_FTP_PORT, 21),
      user: String(overrides.ftpUser || process.env.INVENTORY_FTP_USERNAME || "").trim(),
      password: String(overrides.ftpPassword || process.env.INVENTORY_FTP_PASSWORD || "").trim(),
      secure: normalizeBoolean(overrides.ftpSecure ?? process.env.INVENTORY_FTP_SECURE, false),
      remoteDirectory: String(
        overrides.ftpRemoteDirectory || process.env.INVENTORY_FTP_REMOTE_DIRECTORY || "."
      ).trim(),
      filePattern: String(overrides.ftpFilePattern || process.env.INVENTORY_FTP_FILE_PATTERN || "").trim(),
      preferredFileName: String(
        overrides.ftpPreferredFileName || process.env.INVENTORY_FTP_PREFERRED_FILE_NAME || ""
      ).trim(),
      format: String(overrides.ftpFormat || process.env.INVENTORY_FTP_FORMAT || "").trim().toLowerCase() || null,
      passive: normalizeBoolean(overrides.ftpPassive ?? process.env.INVENTORY_FTP_PASSIVE, true),
      stableFileAgeMs: Math.max(
        0,
        Number(overrides.ftpStableFileAgeMs || process.env.INVENTORY_FTP_STABLE_FILE_AGE_MS) || 300000
      ),
    },
    sourceName: String(overrides.sourceName || process.env.INVENTORY_SYNC_SOURCE_NAME || "ftp").trim(),
    schedulerGraceMs: Math.max(
      5000,
      Number(overrides.schedulerGraceMs || process.env.INVENTORY_SYNC_SCHEDULER_GRACE_MS) || 15000
    ),
  };

  config.retryTimes = config.retryTimes.filter((time) => time !== config.primaryTime);

  config.hasFtpCredentials = Boolean(config.ftp.host && config.ftp.user && config.ftp.password);
  config.schedulerEnabled = config.enabled && config.hasFtpCredentials;

  return config;
}

module.exports = {
  buildInventorySyncConfig,
  normalizeBoolean,
  normalizeRetryTimes,
  normalizeTimeString,
};
