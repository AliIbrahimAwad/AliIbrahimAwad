const { ValidationError } = require("../src/data/core");

const INVENTORY_HEADER_ALIASES = {
  stock_number: ["stock_number", "stock", "stock_no", "stock_number_", "stock#", "stock #", "stk", "stk#"],
  vin: ["vin", "vehicle_identification_number"],
  year: ["year"],
  make: ["make"],
  model: ["model"],
  trim: ["trim"],
  price: ["price", "sale_price", "internet_price", "list_price"],
  mileage: ["mileage", "miles", "odometer", "odometer_reading", "kilometers", "kilometres"],
  condition: ["condition", "vehicle_condition", "new_used", "used_new"],
  body_style: ["body_style", "body_style_", "body style", "body"],
  exterior_color: ["exterior_color", "ext_color", "exterior colour", "exterior color", "colour", "color"],
  interior_color: ["interior_color", "int_color", "interior colour", "interior color"],
  status: ["status", "inventory_status"],
  verified: ["verified", "is_verified", "verified_status", "verification_status"],
};

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        quoted = false;
        continue;
      }

      current += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ",") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvText(csvText) {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    throw new ValidationError("Inventory CSV must include a header row and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] ?? "";
    });

    return {
      rowNumber: index + 2,
      raw: row,
    };
  });
}

function firstValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return null;
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
    exterior_color: mapped.exterior_color,
    interior_color: mapped.interior_color,
    status: mapped.status || "active",
    verified: mapped.verified || "yes",
    source: context.sourceName || "manual_upload",
    source_file: context.fileName || null,
  };
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function importInventoryCsv({
  db,
  user,
  csvText,
  fileName = null,
  sourceName = null,
  markMissingInactive = false,
}) {
  if (!String(csvText || "").trim()) {
    throw new ValidationError("A CSV file is required.");
  }

  const parsedRows = parseCsvText(csvText);
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
      source_type: "manual_upload",
      source_name: normalizedSourceName,
      file_name: fileName || null,
      status: "running",
      rows_total: parsedRows.length,
    },
    user
  );

  const summary = {
    rows_total: parsedRows.length,
    rows_inserted: 0,
    rows_updated: 0,
    rows_skipped: 0,
    rows_deactivated: 0,
  };
  const seenInventoryIds = new Set();

  try {
    for (const entry of parsedRows) {
      try {
        const mapped = mapInventoryRow(entry.raw, {
          sourceName: normalizedSourceName,
          fileName,
        });

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

        seenInventoryIds.add(inventoryId);
        if (result.action === "inserted") {
          summary.rows_inserted += 1;
        } else {
          summary.rows_updated += 1;
        }
      } catch (error) {
        summary.rows_skipped += 1;
        const importRunId = normalizePositiveInteger(run?.id);
        if (!importRunId) {
          throw error;
        }

        await db.createInventoryImportError(
          {
            import_run_id: importRunId,
            dealership_id: dealershipId,
            row_number: normalizePositiveInteger(entry.rowNumber),
            stock_number: firstValue(entry.raw, INVENTORY_HEADER_ALIASES.stock_number),
            vin: firstValue(entry.raw, INVENTORY_HEADER_ALIASES.vin),
            error_message: error.message || "Unable to import inventory row.",
            raw_row_json: JSON.stringify(entry.raw),
          },
          user
        );
      }
    }

    if (markMissingInactive && sourceName && seenInventoryIds.size > 0) {
      summary.rows_deactivated = await db.markInventoryMissingFromImport({
        dealership_id: dealershipId,
        source: normalizedSourceName,
        seen_inventory_ids: [...seenInventoryIds],
        next_status: "inactive",
      });
    }

    const finalStatus = summary.rows_skipped > 0 ? "completed_with_errors" : "completed";
    const completedRun = await db.updateInventoryImportRun(
      normalizePositiveInteger(run?.id),
      {
        dealership_id: dealershipId,
        status: finalStatus,
        ...summary,
        completed_at: new Date().toISOString(),
      },
      user
    );

    return {
      run: {
        ...completedRun,
        rows_total: Number(completedRun.rows_total || 0),
        rows_inserted: Number(completedRun.rows_inserted || 0),
        rows_updated: Number(completedRun.rows_updated || 0),
        rows_skipped: Number(completedRun.rows_skipped || 0),
        rows_deactivated: Number(completedRun.rows_deactivated || 0),
      },
    };
  } catch (error) {
    await db.updateInventoryImportRun(
      normalizePositiveInteger(run?.id),
      {
        dealership_id: dealershipId,
        status: "failed",
        error_message: error.message || "Inventory import failed.",
        rows_total: summary.rows_total,
        rows_inserted: summary.rows_inserted,
        rows_updated: summary.rows_updated,
        rows_skipped: summary.rows_skipped,
        rows_deactivated: summary.rows_deactivated,
        completed_at: new Date().toISOString(),
      },
      user
    );
    throw error;
  }
}

module.exports = {
  importInventoryCsv,
};
