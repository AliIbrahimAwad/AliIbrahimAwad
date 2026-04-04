const { ValidationError } = require("../src/data/core");
const { parseInventoryFeed, normalizeHeader } = require("./inventoryFeedParser");

const INVENTORY_HEADER_ALIASES = {
  stock_number: [
    "stock_number",
    "stocknumber",
    "stock",
    "stock_no",
    "stocknumber_",
    "stock_number_",
    "stock#",
    "stock #",
    "stk",
    "stk#",
  ],
  vin: ["vin", "vehicle_identification_number"],
  year: ["year"],
  make: ["make"],
  model: ["model"],
  trim: ["trim"],
  price: ["price", "sale_price", "saleprice", "internet_price", "list_price", "listprice"],
  mileage: ["mileage", "miles", "odometer", "odometer_reading", "kilometers", "kilometres"],
  condition: ["condition", "vehicle_condition", "inventorytype", "new_used", "used_new"],
  body_style: ["body_style", "bodystyle", "body_style_", "body style", "body"],
  drivetrain: ["drivetrain", "drive_train", "drive type", "drive_type"],
  transmission: ["transmission", "trans", "gearbox"],
  engine: ["engine", "engine_description", "engine_desc", "motor"],
  fuel_type: ["fuel_type", "fuel", "fueltype"],
  exterior_color: ["exterior_color", "extcolour", "ext_color", "exterior colour", "exterior color", "colour", "color"],
  interior_color: ["interior_color", "intcolour", "int_color", "interior colour", "interior color"],
  status: ["status", "inventory_status", "availability"],
  verified: [
    "verified",
    "isverified",
    "is_verified",
    "isverfied",
    "verified_",
    "online",
    "is_online",
    "advertised",
    "is_advertised",
  ],
  date_in_stock: ["date_in_stock", "instockdate", "date_added", "date_in", "dateinstock"],
  photos_json: ["photos", "photo_urls", "photo_urls_json", "image_urls", "images", "image_list"],
};

function firstValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return null;
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isVerifiedInventoryRow(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["yes", "y", "true", "1", "on", "active", "available", "published", "live", "online", "advertised"].includes(
    normalized
  );
}

function isExplicitlyUnverifiedInventoryRow(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["no", "n", "false", "0", "off", "inactive", "unpublished", "hidden"].includes(normalized);
}

function determineVerifiedImportMode(rows = []) {
  const summary = {
    populated: 0,
    verified: 0,
    unverified: 0,
    unknown: 0,
  };

  for (const entry of rows) {
    const mapped = mapInventoryRow(entry.raw || {});
    const value = String(mapped.verified || "").trim();
    if (!value) {
      continue;
    }

    summary.populated += 1;
    if (isVerifiedInventoryRow(value)) {
      summary.verified += 1;
      continue;
    }

    if (isExplicitlyUnverifiedInventoryRow(value)) {
      summary.unverified += 1;
      continue;
    }

    summary.unknown += 1;
  }

  return {
    mode: summary.verified > 0 || summary.unverified > 0 ? "enforce_verified_only" : "treat_feed_as_prefiltered",
    summary,
  };
}

function mapInventoryRow(row, context = {}) {
  const mapped = Object.fromEntries(
    Object.entries(INVENTORY_HEADER_ALIASES).map(([field, aliases]) => [field, firstValue(row, aliases)])
  );

  return {
    stock_number: mapped.stock_number,
    vin: mapped.vin,
    year: mapped.year,
    make: mapped.make,
    model: mapped.model,
    trim: mapped.trim,
    price: mapped.price,
    mileage: mapped.mileage,
    condition: mapped.condition,
    body_style: mapped.body_style,
    drivetrain: mapped.drivetrain,
    transmission: mapped.transmission,
    engine: mapped.engine,
    fuel_type: mapped.fuel_type,
    exterior_color: mapped.exterior_color,
    interior_color: mapped.interior_color,
    status: mapped.status || "active",
    verified: mapped.verified,
    date_in_stock: mapped.date_in_stock,
    photos_json: mapped.photos_json,
    source: context.sourceName || "manual_upload",
    source_file: context.fileName || null,
  };
}

async function importInventoryRows({
  db,
  user,
  rows,
  fileName = null,
  sourceName = null,
  sourceType = "manual_upload",
  markMissingInactive = false,
  metadata = null,
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ValidationError("Inventory feed did not contain any rows.");
  }

  const normalizedSourceName = String(sourceName || "").trim() || "manual_upload";
  const dealershipId = normalizePositiveInteger(
    typeof db.currentDealershipId === "function" ? db.currentDealershipId(user) : user?.dealership_id || 1
  );
  if (!dealershipId) {
    throw new ValidationError("Unable to determine dealership for inventory import.");
  }

  const run = await db.createInventoryImportRun(
    {
      dealership_id: dealershipId,
      source_type: sourceType,
      source_name: normalizedSourceName,
      file_name: fileName || null,
      status: "running",
      rows_total: rows.length,
      rows_processed: 0,
      failed_count: 0,
      metadata_json: metadata || null,
    },
    user
  );

  const summary = {
    rows_total: rows.length,
    rows_processed: 0,
    rows_inserted: 0,
    rows_updated: 0,
    rows_skipped: 0,
    rows_deactivated: 0,
    failed_count: 0,
  };
  const seenInventoryIds = new Set();
  const verifiedImport = determineVerifiedImportMode(rows);

  try {
    for (const entry of rows) {
      try {
        const mapped = mapInventoryRow(entry.raw || {}, {
          sourceName: normalizedSourceName,
          fileName,
        });

        if (
          verifiedImport.mode === "enforce_verified_only" &&
          !isVerifiedInventoryRow(mapped.verified)
        ) {
          summary.rows_skipped += 1;
          continue;
        }

        if (!mapped.stock_number && !mapped.vin) {
          throw new ValidationError("Each inventory row needs a stock number or VIN.");
        }

        const result = await db.upsertInventoryRecord({
          dealership_id: dealershipId,
          ...mapped,
          last_seen_at: new Date().toISOString(),
        });

        const inventoryId = normalizePositiveInteger(result?.inventory?.id);
        if (!inventoryId) {
          throw new ValidationError("Imported inventory row did not return a valid inventory ID.");
        }

        if (typeof db.linkLeadsToInventoryByIdentity === "function") {
          await db.linkLeadsToInventoryByIdentity({
            dealership_id: dealershipId,
            inventory_id: inventoryId,
            stock_number: mapped.stock_number,
            vin: mapped.vin,
          });
        }

        summary.rows_processed += 1;
        seenInventoryIds.add(inventoryId);
        if (result.action === "inserted") {
          summary.rows_inserted += 1;
        } else {
          summary.rows_updated += 1;
        }
      } catch (error) {
        summary.rows_skipped += 1;
        summary.failed_count += 1;
        await db.createInventoryImportError(
          {
            import_run_id: run.id,
            dealership_id: dealershipId,
            row_number: normalizePositiveInteger(entry.rowNumber),
            stock_number: firstValue(entry.raw || {}, INVENTORY_HEADER_ALIASES.stock_number),
            vin: firstValue(entry.raw || {}, INVENTORY_HEADER_ALIASES.vin),
            raw_identifier:
              firstValue(entry.raw || {}, INVENTORY_HEADER_ALIASES.stock_number) ||
              firstValue(entry.raw || {}, INVENTORY_HEADER_ALIASES.vin) ||
              null,
            error_message: error.message || "Unable to import inventory row.",
            raw_row_json: JSON.stringify(entry.raw || {}),
          },
          user
        );
      }
    }

    if (markMissingInactive && summary.failed_count === 0 && seenInventoryIds.size > 0) {
      summary.rows_deactivated = await db.markInventoryMissingFromImport({
        dealership_id: dealershipId,
        source: normalizedSourceName,
        seen_inventory_ids: [...seenInventoryIds],
        next_status: "inactive",
      });
    }

    const finalStatus = summary.failed_count > 0 ? "partial" : "success";
    const completedRun = await db.updateInventoryImportRun(
      run.id,
      {
        dealership_id: dealershipId,
        status: finalStatus,
        ...summary,
        metadata_json: {
          ...(metadata || {}),
          verified_import_mode: verifiedImport.mode,
          verified_value_summary: verifiedImport.summary,
        },
        completed_at: new Date().toISOString(),
      },
      user
    );

    return {
      run: completedRun,
    };
  } catch (error) {
    await db.updateInventoryImportRun(
      run.id,
      {
        dealership_id: dealershipId,
        status: "failed",
        error_message: error.message || "Inventory import failed.",
        ...summary,
        completed_at: new Date().toISOString(),
      },
      user
    );
    throw error;
  }
}

async function importInventoryCsv({
  db,
  user,
  csvText,
  fileName = null,
  sourceName = null,
  markMissingInactive = false,
  sourceType = "manual_upload",
  metadata = null,
}) {
  if (!String(csvText || "").trim()) {
    throw new ValidationError("A CSV file is required.");
  }

  const parsed = parseInventoryFeed({
    fileName: fileName || "inventory.csv",
    text: csvText,
    format: "csv",
  });

  return importInventoryRows({
    db,
    user,
    rows: parsed.rows,
    fileName,
    sourceName,
    sourceType,
    markMissingInactive,
    metadata,
  });
}

module.exports = {
  importInventoryCsv,
  importInventoryRows,
  determineVerifiedImportMode,
  isVerifiedInventoryRow,
  mapInventoryRow,
  parseInventoryFeed,
};
