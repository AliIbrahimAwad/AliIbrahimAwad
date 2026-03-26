const test = require("node:test");
const assert = require("node:assert/strict");

const { parseInventoryFeed } = require("../services/inventoryFeedParser");
const { importInventoryRows, isVerifiedInventoryRow, mapInventoryRow } = require("../services/inventoryImport");
const { InventorySyncScheduler } = require("../services/inventorySyncScheduler");

test("inventory feed parser normalizes CSV rows", () => {
  const parsed = parseInventoryFeed({
    fileName: "inventory.csv",
    text: ["Stock Number,VIN,Year,Make,Model,Transmission", "D1000,1HGCM82633A000001,2024,Ford,F-150,Automatic"].join(
      "\n"
    ),
  });

  assert.equal(parsed.format, "csv");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].raw.stock_number, "D1000");
  assert.equal(parsed.rows[0].raw.transmission, "Automatic");
});

test("importInventoryRows does not mark missing units inactive after a partial run", async () => {
  let markedInactive = false;
  const db = {
    currentDealershipId() {
      return 1;
    },
    async createInventoryImportRun() {
      return { id: 1 };
    },
    async updateInventoryImportRun(_id, payload) {
      return payload;
    },
    async upsertInventoryRecord(input) {
      if (input.stock_number === "BAD1") {
        throw new Error("Bad row");
      }

      return {
        action: "inserted",
        inventory: { id: 55 },
      };
    },
    async createInventoryImportError() {
      return null;
    },
    async markInventoryMissingFromImport() {
      markedInactive = true;
      return 1;
    },
  };

  const result = await importInventoryRows({
    db,
    rows: [
      { rowNumber: 2, raw: { stock_number: "GOOD1", vin: "VIN1", verified: "YES" } },
      { rowNumber: 3, raw: { stock_number: "BAD1", vin: "VIN2", verified: "YES" } },
    ],
    sourceName: "ftp",
    sourceType: "ftp_sync",
    markMissingInactive: true,
  });

  assert.equal(result.run.status, "partial");
  assert.equal(markedInactive, false);
});

test("inventory import only processes rows marked verified yes", async () => {
  const upserts = [];
  const db = {
    currentDealershipId() {
      return 1;
    },
    async createInventoryImportRun() {
      return { id: 2 };
    },
    async updateInventoryImportRun(_id, payload) {
      return payload;
    },
    async upsertInventoryRecord(input) {
      upserts.push(input.stock_number);
      return {
        action: "inserted",
        inventory: { id: 77 },
      };
    },
    async createInventoryImportError() {
      throw new Error("Unverified rows should not create import errors.");
    },
  };

  const result = await importInventoryRows({
    db,
    rows: [
      { rowNumber: 2, raw: { stock_number: "GOOD1", vin: "VIN1", verified: "YES" } },
      { rowNumber: 3, raw: { stock_number: "SKIP1", vin: "VIN2", verified: "NO" } },
      { rowNumber: 4, raw: { stock_number: "SKIP2", vin: "VIN3", verified: "" } },
    ],
    sourceName: "ftp",
    sourceType: "ftp_sync",
  });

  assert.deepEqual(upserts, ["GOOD1"]);
  assert.equal(result.run.status, "success");
  assert.equal(result.run.rows_processed, 1);
  assert.equal(result.run.rows_inserted, 1);
  assert.equal(result.run.rows_skipped, 2);
  assert.equal(result.run.failed_count, 0);
});

test("inventory row mapping captures verified field aliases", () => {
  const mapped = mapInventoryRow(
    {
      stock_number: "D1000",
      is_verified: "YES",
    },
    { sourceName: "ftp", fileName: "inventory.csv" }
  );

  assert.equal(mapped.verified, "YES");
  assert.equal(isVerifiedInventoryRow(mapped.verified), true);
  assert.equal(isVerifiedInventoryRow("NO"), false);
  assert.equal(isVerifiedInventoryRow(""), false);
});

test("inventory scheduler picks the first retry slot when today's primary failed", async () => {
  const now = new Date("2026-03-25T07:20:00.000Z");
  const scheduler = new InventorySyncScheduler({
    syncService: {
      async listRecentRuns() {
        return [
          {
            status: "failed",
            started_at: "2026-03-25T07:15:00.000Z",
            metadata_json: { schedule_slot: "primary" },
          },
        ];
      },
      async failStaleRunningRuns() {
        return 0;
      },
      isRunning() {
        return false;
      },
    },
    config: {
      schedulerEnabled: true,
      timezone: "America/Toronto",
      primaryTime: "03:15",
      retryTimes: ["04:00", "05:00"],
      schedulerGraceMs: 15000,
    },
  });

  const next = await scheduler.calculateNextRun(now);
  assert.equal(next.slot, "retry_1");
});
