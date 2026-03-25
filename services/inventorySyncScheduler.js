function formatLocalDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeKey: `${parts.hour}:${parts.minute}`,
  };
}

class InventorySyncScheduler {
  constructor({ syncService, config }) {
    this.syncService = syncService;
    this.config = config;
    this.timer = null;
    this.nextRunAt = null;
    this.nextSlot = null;
    this.running = false;
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunAt = null;
    this.nextSlot = null;
    this.running = false;
  }

  getSnapshot() {
    return {
      enabled: Boolean(this.config?.schedulerEnabled),
      timezone: this.config?.timezone || "America/Toronto",
      primaryTime: this.config?.primaryTime || "03:15",
      retryTimes: this.config?.retryTimes || [],
      nextRunAt: this.nextRunAt ? this.nextRunAt.toISOString() : null,
      nextSlot: this.nextSlot || null,
      running: this.syncService?.isRunning?.() || false,
    };
  }

  async start() {
    if (!this.config?.schedulerEnabled) {
      this.stop();
      return;
    }

    await this.syncService.failStaleRunningRuns();
    await this.scheduleNext();
  }

  async scheduleNext() {
    this.stop();

    const next = await this.calculateNextRun();
    if (!next) {
      return;
    }

    this.nextRunAt = next.runAt;
    this.nextSlot = next.slot;

    const delayMs = Math.max(1000, next.runAt.getTime() - Date.now());
    this.timer = setTimeout(async () => {
      this.running = true;
      try {
        await this.syncService.runScheduledSync(next.slot);
      } catch (error) {
        console.error("Scheduled inventory sync failed.", error);
      } finally {
        this.running = false;
        await this.scheduleNext();
      }
    }, delayMs);

    this.timer.unref?.();
  }

  async calculateNextRun(now = new Date()) {
    const runs = await this.syncService.listRecentRuns(20);
    const timezone = this.config.timezone;
    const todayKey = formatLocalDateParts(now, timezone).dateKey;
    const todaysRuns = runs.filter((run) => {
      const startedAt = run.started_at || run.created_at || run.updated_at;
      return startedAt && formatLocalDateParts(new Date(startedAt), timezone).dateKey === todayKey;
    });

    const successToday = todaysRuns.some((run) => run.status === "success");
    if (successToday) {
      return this.findNextMatchingSlot(now, { allowPrimaryCatchUp: false, requireRetry: false, skipToday: true });
    }

    const primaryRun = todaysRuns.find((run) => run.metadata_json?.schedule_slot === "primary");
    if (!primaryRun) {
      return this.findPrimaryOrCatchUp(now);
    }

    if (primaryRun.status === "success") {
      return this.findNextMatchingSlot(now, { allowPrimaryCatchUp: false, requireRetry: false, skipToday: true });
    }

    for (let index = 0; index < this.config.retryTimes.length; index += 1) {
      const slot = `retry_${index + 1}`;
      const existingRun = todaysRuns.find((run) => run.metadata_json?.schedule_slot === slot);
      if (existingRun?.status === "success") {
        return this.findNextMatchingSlot(now, { allowPrimaryCatchUp: false, requireRetry: false, skipToday: true });
      }
      if (!existingRun) {
        return this.findRetryOrCatchUp(now, slot, this.config.retryTimes[index]);
      }
      if (existingRun.status !== "success") {
        continue;
      }
    }

    return this.findNextMatchingSlot(now, { allowPrimaryCatchUp: false, requireRetry: false, skipToday: true });
  }

  findPrimaryOrCatchUp(now) {
    const { dateKey, timeKey } = formatLocalDateParts(now, this.config.timezone);
    if (timeKey < this.config.primaryTime) {
      return this.findNextMatchingSlot(now, { targetDateKey: dateKey, targetTime: this.config.primaryTime, slot: "primary" });
    }

    return {
      runAt: new Date(now.getTime() + this.config.schedulerGraceMs),
      slot: "primary",
    };
  }

  findRetryOrCatchUp(now, slot, retryTime) {
    const { dateKey, timeKey } = formatLocalDateParts(now, this.config.timezone);
    if (timeKey < retryTime) {
      return this.findNextMatchingSlot(now, { targetDateKey: dateKey, targetTime: retryTime, slot });
    }

    return {
      runAt: new Date(now.getTime() + this.config.schedulerGraceMs),
      slot,
    };
  }

  findNextMatchingSlot(now, options = {}) {
    const searchStart = new Date(now.getTime() + 60000);
    for (let minute = 0; minute < 60 * 48; minute += 1) {
      const candidate = new Date(searchStart.getTime() + minute * 60000);
      const local = formatLocalDateParts(candidate, this.config.timezone);
      if (options.skipToday && local.dateKey === formatLocalDateParts(now, this.config.timezone).dateKey) {
        continue;
      }
      if (options.targetDateKey && local.dateKey !== options.targetDateKey) {
        continue;
      }
      if (options.targetTime) {
        if (local.timeKey === options.targetTime) {
          return {
            runAt: candidate,
            slot: options.slot || "primary",
          };
        }
        continue;
      }
      if (local.timeKey === this.config.primaryTime) {
        return {
          runAt: candidate,
          slot: "primary",
        };
      }
    }

    return null;
  }
}

module.exports = {
  InventorySyncScheduler,
  formatLocalDateParts,
};
