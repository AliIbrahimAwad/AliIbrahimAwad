const fs = require("fs/promises");

const { ValidationError } = require("../src/data/core");
const { buildInventorySyncConfig } = require("../src/config/inventorySync");
const { InventoryFtpClient } = require("./inventoryFtp");
const { importInventoryRows, parseInventoryFeed } = require("./inventoryImport");

class InventorySyncService {
  constructor({ db, config = {}, ftpClientFactory = null } = {}) {
    this.db = db;
    this.config = buildInventorySyncConfig(config);
    this.ftpClientFactory = ftpClientFactory;
    this.currentRun = null;
  }

  isConfigured() {
    return Boolean(this.config?.hasFtpCredentials);
  }

  isRunning() {
    return Boolean(this.currentRun);
  }

  async failStaleRunningRuns() {
    if (typeof this.db.failStaleInventoryImportRuns !== "function") {
      return 0;
    }

    return this.db.failStaleInventoryImportRuns({
      source_type: "ftp_sync",
      older_than_iso: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    });
  }

  async listRecentRuns(limit = 20, user = null) {
    const runs = await this.db.listInventoryImportRuns(user, limit);
    return runs.filter((run) => run.source_type === "ftp_sync");
  }

  async getStatus(user = null, schedulerSnapshot = null) {
    const recentRuns = await this.listRecentRuns(10, user);
    const lastSuccess = recentRuns.find((run) => run.status === "success") || null;
    const latestRun = recentRuns[0] || null;
    const recentErrors = typeof this.db.listInventoryImportErrors === "function"
      ? await this.db.listInventoryImportErrors({ user, source_type: "ftp_sync", limit: 25 })
      : [];

    return {
      enabled: this.config.schedulerEnabled,
      configured: this.isConfigured(),
      source_name: this.config.sourceName,
      remote_directory: this.config.ftp.remoteDirectory,
      file_pattern: this.config.ftp.filePattern || null,
      preferred_file_name: this.config.ftp.preferredFileName || null,
      timezone: this.config.timezone,
      primary_time: this.config.primaryTime,
      retry_times: this.config.retryTimes,
      is_running: this.isRunning(),
      latest_status: latestRun?.status || null,
      latest_run: latestRun,
      last_success_at: lastSuccess?.completed_at || null,
      next_scheduled_sync_at: schedulerSnapshot?.nextRunAt || null,
      next_scheduled_slot: schedulerSnapshot?.nextSlot || null,
      recent_runs: recentRuns,
      recent_errors: recentErrors,
    };
  }

  async runScheduledSync(slot = "primary") {
    return this.runSync({
      trigger: "scheduled",
      schedule_slot: slot,
      initiated_by: null,
    });
  }

  async runManualSync(user = null) {
    return this.runSync({
      trigger: "manual",
      schedule_slot: "manual",
      initiated_by: user ? { id: Number(user.id), role: user.role || null } : null,
      user,
    });
  }

  async runSync(context = {}) {
    if (!this.isConfigured()) {
      throw new ValidationError("FTP inventory sync is not configured.");
    }

    if (this.currentRun) {
      const error = new ValidationError("Inventory sync is already running.");
      error.statusCode = 409;
      throw error;
    }

    const runPromise = this.executeSync(context)
      .finally(() => {
        this.currentRun = null;
      });

    this.currentRun = runPromise;
    return runPromise;
  }

  async executeSync(context = {}) {
    const ftpClient = new InventoryFtpClient(this.config.ftp, {
      clientFactory: this.ftpClientFactory,
    });
    const downloaded = await ftpClient.fetchLatestFile();

    try {
      const text = await fs.readFile(downloaded.localPath, "utf8");
      const parsed = parseInventoryFeed({
        fileName: downloaded.name,
        text,
        format: this.config.ftp.format,
      });

      return await importInventoryRows({
        db: this.db,
        user: context.user || null,
        rows: parsed.rows,
        fileName: downloaded.name,
        sourceName: this.config.sourceName,
        sourceType: "ftp_sync",
        markMissingInactive: true,
        metadata: {
          trigger: context.trigger || "scheduled",
          schedule_slot: context.schedule_slot || "primary",
          remote_path: downloaded.path,
          modified_at: downloaded.modifiedAt ? downloaded.modifiedAt.toISOString() : null,
          format: parsed.format,
          initiated_by: context.initiated_by || null,
        },
      });
    } finally {
      await fs.rm(downloaded.tempDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  InventorySyncService,
};
