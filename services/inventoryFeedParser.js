const { ValidationError } = require("../src/data/core");

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

function parseCsvRows(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    throw new ValidationError("Inventory feed must include a header row and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const raw = {};
    headers.forEach((header, headerIndex) => {
      raw[header] = values[headerIndex] ?? "";
    });

    return {
      rowNumber: index + 2,
      raw,
    };
  });
}

function parseJsonRows(text) {
  let payload;
  try {
    payload = JSON.parse(String(text || ""));
  } catch (_error) {
    throw new ValidationError("Inventory JSON feed could not be parsed.");
  }

  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.inventory)
        ? payload.inventory
        : null;

  if (!records || !records.length) {
    throw new ValidationError("Inventory JSON feed does not contain any records.");
  }

  return records.map((row, index) => ({
    rowNumber: index + 1,
    raw: Object.fromEntries(
      Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), value == null ? "" : String(value)])
    ),
  }));
}

function extractXmlRecords(text) {
  const xml = String(text || "");
  const recordMatches = [...xml.matchAll(/<(vehicle|unit|item|record)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  if (recordMatches.length === 0) {
    throw new ValidationError("Inventory XML feed does not contain recognizable vehicle records.");
  }

  return recordMatches.map((match, index) => {
    const body = match[2] || "";
    const raw = {};
    for (const tagMatch of body.matchAll(/<([a-z0-9_:-]+)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
      const tag = normalizeHeader(tagMatch[1]);
      const value = String(tagMatch[2] || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!raw[tag] && value) {
        raw[tag] = value;
      }
    }

    return {
      rowNumber: index + 1,
      raw,
    };
  });
}

function detectInventoryFormat({ fileName = "", configuredFormat = null } = {}) {
  if (configuredFormat) {
    return String(configuredFormat).trim().toLowerCase();
  }

  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".csv")) {
    return "csv";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".xml")) {
    return "xml";
  }

  return "csv";
}

function parseInventoryFeed({ fileName = "", text = "", format = null } = {}) {
  const detectedFormat = detectInventoryFormat({ fileName, configuredFormat: format });

  if (detectedFormat === "csv") {
    return {
      format: detectedFormat,
      rows: parseCsvRows(text),
    };
  }

  if (detectedFormat === "json") {
    return {
      format: detectedFormat,
      rows: parseJsonRows(text),
    };
  }

  if (detectedFormat === "xml") {
    return {
      format: detectedFormat,
      rows: extractXmlRecords(text),
    };
  }

  throw new ValidationError(`Unsupported inventory feed format: ${detectedFormat}`);
}

module.exports = {
  detectInventoryFormat,
  normalizeHeader,
  parseInventoryFeed,
};
