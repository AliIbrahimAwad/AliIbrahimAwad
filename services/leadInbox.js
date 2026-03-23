function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeContent(message = {}) {
  const contentType = String(message.body?.contentType || "").toLowerCase();
  const content = String(message.body?.content || message.bodyPreview || "");
  return contentType === "html" ? stripHtml(content) : decodeHtmlEntities(content);
}

function cleanValue(value) {
  const normalized = decodeHtmlEntities(String(value || "")).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function cleanPhone(value) {
  return cleanValue(value ? String(value).replace(/[.,;:]+$/, "") : "");
}

function getSenderEmail(message = {}) {
  return String(message.from?.emailAddress?.address || "").trim().toLowerCase();
}

function getSenderName(message = {}) {
  return cleanValue(message.from?.emailAddress?.name || "");
}

function getFieldSameLine(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*:?\\s*(.+)$`, "im"));
  return cleanValue(match ? match[1] : "");
}

function getFieldNextLine(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*$\\n+\\s*(.+)$`, "im"));
  return cleanValue(match ? match[1] : "");
}

function getField(text, label) {
  return getFieldSameLine(text, label) || getFieldNextLine(text, label);
}

function combineVehicle(parts = []) {
  return cleanValue(parts.filter(Boolean).join(" "));
}

function detectLeadSource(message, text) {
  const sender = getSenderEmail(message);
  const subject = String(message.subject || "").toLowerCase();
  const haystack = `${sender}\n${subject}\n${String(text || "").toLowerCase()}`;

  if (haystack.includes("messages.cargurus.com") || haystack.includes("lead submission from cargurus")) {
    return "cargurus";
  }

  if (haystack.includes("dealerleads.trader.ca") || haystack.includes("auto trader")) {
    return "autotrader";
  }

  if (
    haystack.includes("preferred contact method") &&
    haystack.includes("this form submitted at") &&
    haystack.includes("phone number")
  ) {
    return "website";
  }

  if (haystack.includes("contact us") || haystack.includes("contact-us")) {
    return "website";
  }

  return "email";
}

function parseAutoTraderEmail(text, message = {}) {
  const carfaxMatch = text.match(
    /Please send the CARFAX Canada report to:\s*([^\s,]+)[,\s]+Phone:\s*([+\d(). -]+)/i
  );
  const vehicleLineMatch = text.match(/Your\s+(.+?)\s+\(Stock #:\s*([^)]+)\)\s+ad:/i);
  const listingUrlMatch = text.match(/https?:\/\/www\.autotrader\.ca\/[^\s]+/i);
  const carfaxUrlMatch = text.match(/https?:\/\/www\.carfax\.ca\/[^\s]+/i);

  if (carfaxMatch || vehicleLineMatch) {
    return {
      source: "autotrader",
      customer_name: null,
      phone: cleanPhone(carfaxMatch ? carfaxMatch[2] : ""),
      email: cleanValue(carfaxMatch ? carfaxMatch[1] : ""),
      vehicle_interest: cleanValue(vehicleLineMatch ? vehicleLineMatch[1] : ""),
      vehicle_id: null,
      stock_number: cleanValue(vehicleLineMatch ? vehicleLineMatch[2] : ""),
      vehicle_year: cleanValue((vehicleLineMatch?.[1] || "").match(/\b(19|20)\d{2}\b/)?.[0]),
      vehicle_make: null,
      vehicle_model: null,
      vehicle_trim: null,
      vehicle_condition: null,
      vehicle_price: null,
      lead_type: "carfax_request",
      listing_url: cleanValue(listingUrlMatch ? listingUrlMatch[0] : ""),
      message: cleanValue(
        carfaxUrlMatch
          ? `Requested a CARFAX Canada report. Purchase link: ${carfaxUrlMatch[0]}`
          : "Requested a CARFAX Canada report."
      ),
      sender: getSenderEmail(message),
    };
  }

  return {
    source: "autotrader",
    customer_name: getField(text, "Name"),
    phone: cleanPhone(getField(text, "Phone")),
    email: getField(text, "Email"),
    vehicle_interest: combineVehicle([
      getField(text, "Year"),
      getField(text, "Make"),
      getField(text, "Model"),
      getField(text, "Trim"),
    ]),
    vehicle_id: getField(text, "Vin"),
    stock_number: getField(text, "Stock Number"),
    vehicle_year: getField(text, "Year"),
    vehicle_make: getField(text, "Make"),
    vehicle_model: getField(text, "Model"),
    vehicle_trim: getField(text, "Trim"),
    vehicle_condition: getField(text, "Condition"),
    vehicle_price: getField(text, "Price"),
    listing_url: getField(text, "SourceUrl"),
    message: getField(text, "Comment"),
    lead_type: getField(text, "Lead type"),
    sender: getSenderEmail(message),
  };
}

function parseCarGurusEmail(text, message = {}) {
  const firstName = getField(text, "First Name");
  const lastName = getField(text, "Last Name");

  return {
    source: "cargurus",
    customer_name: cleanValue([firstName, lastName].filter(Boolean).join(" ")),
    phone: cleanPhone(getField(text, "Telephone")),
    email: getField(text, "Email"),
    vehicle_interest: getField(text, "Vehicle"),
    vehicle_id: getField(text, "VIN"),
    stock_number: getField(text, "Stock Number"),
    vehicle_year: getField(text, "Vehicle")?.match(/\b(19|20)\d{2}\b/)?.[0] || null,
    vehicle_make: cleanValue(getField(text, "Vehicle")?.split(" ").slice(1, 2).join(" ")),
    vehicle_model: cleanValue(getField(text, "Vehicle")?.split(" ").slice(2).join(" ")),
    vehicle_trim: null,
    vehicle_condition: null,
    vehicle_price: getField(text, "Listed Price"),
    listing_url: getField(text, "View Listing on CarGurus"),
    message: getField(text, "Comments"),
    lead_type: "general_inquiry",
    sender: getSenderEmail(message),
  };
}

function parseWebsiteLeadEmail(text, message = {}) {
  const listingUrl = getField(text, "This form submitted at");
  const slug = listingUrl ? listingUrl.split("/").filter(Boolean).pop() : "";
  const derivedVehicle = slug
    ? slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .replace(/\s+d\d+$/i, "")
    : null;

  return {
    source: "website",
    customer_name: getField(text, "Full Name"),
    phone: cleanPhone(getField(text, "Phone Number")),
    email: getField(text, "Email"),
    vehicle_interest: derivedVehicle,
    vehicle_id: null,
    stock_number: listingUrl ? listingUrl.match(/-([A-Za-z]\d+)\//)?.[1] || null : null,
    vehicle_year: derivedVehicle?.match(/\b(19|20)\d{2}\b/)?.[0] || null,
    vehicle_make: null,
    vehicle_model: null,
    vehicle_trim: null,
    vehicle_condition: null,
    vehicle_price: null,
    listing_url: listingUrl,
    message: getField(text, "Message"),
    lead_type: "website_form",
    sender: getSenderEmail(message),
  };
}

function parseLeadEmail(message) {
  const text = normalizeContent(message);
  const source = detectLeadSource(message, text);

  if (source === "autotrader") {
    return parseAutoTraderEmail(text, message);
  }

  if (source === "cargurus") {
    return parseCarGurusEmail(text, message);
  }

  if (source === "website") {
    return parseWebsiteLeadEmail(text, message);
  }

  return null;
}

function extractFirstMatch(text, regex, group = 1) {
  const match = String(text || "").match(regex);
  return cleanValue(match ? match[group] : "");
}

function extractEmail(text) {
  return extractFirstMatch(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
}

function extractPhone(text) {
  return cleanPhone(
    extractFirstMatch(
      text,
      /(\+?\d[\d().\-\s]{7,}\d)/
    )
  );
}

function extractVin(text) {
  return extractFirstMatch(text, /\b([A-HJ-NPR-Z0-9]{17})\b/i);
}

function extractStockNumber(text) {
  return (
    extractFirstMatch(text, /\bstock(?:\s*(?:number|#))?\s*[:#-]?\s*([A-Z]\d{2,}|[A-Z0-9-]{3,})\b/i) ||
    extractFirstMatch(text, /\b([A-Z]\d{3,5})\b/)
  );
}

function buildGenericEmailParse(message, text) {
  const senderEmail = getSenderEmail(message);
  const senderName = getSenderName(message);
  const subject = cleanValue(message.subject || "");
  const customerName =
    getField(text, "Full Name") ||
    getField(text, "Name") ||
    getField(text, "Customer Name") ||
    senderName ||
    null;

  return {
    source: detectLeadSource(message, text),
    customer_name: customerName,
    phone: cleanPhone(getField(text, "Phone") || getField(text, "Phone Number") || extractPhone(text)),
    email: getField(text, "Email") || extractEmail(text) || senderEmail || null,
    vehicle_interest: getField(text, "Vehicle") || getField(text, "Vehicle Interest") || null,
    vehicle_id: getField(text, "VIN") || extractVin(text),
    stock_number: getField(text, "Stock Number") || extractStockNumber(text),
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    vehicle_trim: null,
    vehicle_condition: null,
    vehicle_price: null,
    listing_url: extractFirstMatch(text, /(https?:\/\/[^\s]+)/i),
    message:
      getField(text, "Message") ||
      getField(text, "Comments") ||
      getField(text, "Inquiry") ||
      text ||
      subject,
    lead_type: null,
    subject,
    sender: senderEmail,
  };
}

function classifyParsedEmail(parsed, message, text) {
  const source = String(parsed.source || "").toLowerCase();
  if (source === "autotrader" || source === "cargurus") {
    return "direct_lead";
  }

  const subject = String(message.subject || "").toLowerCase();
  const haystack = `${subject}\n${String(text || "").toLowerCase()}`;
  const directSignals = [
    "availability",
    "available",
    "finance",
    "financing",
    "trade-in",
    "trade in",
    "appointment",
    "test drive",
    "buy",
    "buying",
    "purchase",
    "interested in",
    "vehicle",
    "stock",
    "vin",
  ];
  const hasVehicleContext = Boolean(parsed.stock_number || parsed.vehicle_id || parsed.vehicle_interest);

  if (hasVehicleContext || directSignals.some((term) => haystack.includes(term))) {
    return "direct_lead";
  }

  return "other";
}

function mergeLeadData(existingLead, importedLead) {
  return {
    source: existingLead.source || importedLead.source || "website",
    customer_name: existingLead.customer_name || importedLead.customer_name,
    phone: existingLead.phone || importedLead.phone,
    email: existingLead.email || importedLead.email,
    vehicle_interest: existingLead.vehicle_interest || importedLead.vehicle_interest,
    vehicle_id: existingLead.vehicle_id || importedLead.vehicle_id,
    stock_number: existingLead.stock_number || importedLead.stock_number,
    vehicle_year: existingLead.vehicle_year || importedLead.vehicle_year,
    vehicle_make: existingLead.vehicle_make || importedLead.vehicle_make,
    vehicle_model: existingLead.vehicle_model || importedLead.vehicle_model,
    vehicle_trim: existingLead.vehicle_trim || importedLead.vehicle_trim,
    vehicle_condition: existingLead.vehicle_condition || importedLead.vehicle_condition,
    vehicle_price: existingLead.vehicle_price || importedLead.vehicle_price,
    lead_type: existingLead.lead_type || importedLead.lead_type,
    listing_url: existingLead.listing_url || importedLead.listing_url,
    message: existingLead.message || importedLead.message,
    status: existingLead.status || "new",
  };
}

function deriveIntakeStatusFromLead(lead) {
  if (!lead) {
    return "unassigned";
  }

  if (String(lead.status || "").toLowerCase() !== "new") {
    return "contacted";
  }

  return lead.assigned_to ? "assigned" : "unassigned";
}

function buildIntakePayload(message, parsed, classification, lead = null) {
  const externalId = String(message.internetMessageId || message.id || "").trim();
  const vehicleDisplay =
    lead?.inventory
      ? [lead.inventory.year, lead.inventory.make, lead.inventory.model, lead.inventory.trim].filter(Boolean).join(" ")
      : [lead?.vehicle_year, lead?.vehicle_make, lead?.vehicle_model, lead?.vehicle_trim]
          .filter(Boolean)
          .join(" ") || parsed.vehicle_interest || null;

  return {
    external_id: externalId,
    source: parsed.source || "email",
    subject: cleanValue(message.subject || ""),
    sender: getSenderEmail(message),
    message: parsed.message || normalizeContent(message) || null,
    received_at: message.receivedDateTime || new Date().toISOString(),
    classification,
    status: classification === "direct_lead" ? deriveIntakeStatusFromLead(lead) : "open",
    assigned_to: lead?.assigned_to || null,
    lead_id: lead?.id || null,
    customer_name: parsed.customer_name || null,
    phone: parsed.phone || null,
    email: parsed.email || null,
    stock_number: lead?.stock_number || parsed.stock_number || null,
    inventory_id: lead?.inventory_id || null,
    vehicle_display: vehicleDisplay || null,
    raw_payload_json: JSON.stringify({
      id: message.id || null,
      internetMessageId: message.internetMessageId || null,
      subject: message.subject || null,
      receivedDateTime: message.receivedDateTime || null,
      from: message.from || null,
      bodyPreview: message.bodyPreview || null,
    }),
  };
}

async function createLeadInboxService({ db, graph }) {
  async function importMessage(message) {
    const externalId = String(message.internetMessageId || message.id || "").trim();
    if (!externalId) {
      return { skipped: true, reason: "missing_external_id" };
    }

    const existingImport = await db.getImportedMessageByExternalId(externalId);
    if (existingImport) {
      return { skipped: true, reason: "already_imported" };
    }

    const text = normalizeContent(message);
    const parsedLead = parseLeadEmail(message) || buildGenericEmailParse(message, text);
    const classification = classifyParsedEmail(parsedLead, message, text);
    let lead = null;
    let duplicate = null;

    if (classification === "direct_lead") {
      duplicate = await db.findLeadDuplicate(parsedLead, {
        dealership_id: parsedLead.dealership_id,
      });

      if (duplicate) {
        const existingLead = await db.getApiLead(duplicate.lead.id);
        const merged = mergeLeadData(existingLead, parsedLead);
        lead = await db.updateApiLead(existingLead.id, merged);
        await db.createActivity({
          lead_id: lead.id,
          type: "note_added",
          content: `Duplicate ${parsedLead.source} email matched by ${duplicate.reason}.`,
        });
      } else {
        lead = await db.createApiLead(parsedLead);
      }
    }

    const intakeItem = await db.createEmailIntakeItem(buildIntakePayload(message, parsedLead, classification, lead));
    await db.recordImportedMessage({
      external_id: externalId,
      source: parsedLead.source || "email",
      lead_id: lead?.id || null,
      subject: message.subject,
      sender: getSenderEmail(message),
      received_at: message.receivedDateTime,
      status: duplicate ? "duplicate" : "imported",
      matched_reason: duplicate ? duplicate.reason : classification,
    });
    await graph.markProcessed(message);

    if (duplicate) {
      return {
        imported: true,
        duplicate: true,
        reason: duplicate.reason,
        item: intakeItem,
        lead,
      };
    }

    return {
      imported: true,
      item: intakeItem,
      lead,
    };
  }

  async function importUnreadLeads({ limit = 25 } = {}) {
    const messages = await graph.listMessages({ limit });
    const results = [];

    for (const message of messages) {
      results.push(await importMessage(message));
    }

    return results;
  }

  return {
    importUnreadLeads,
    importMessage,
  };
}

module.exports = {
  buildGenericEmailParse,
  classifyParsedEmail,
  createLeadInboxService,
  detectLeadSource,
  mergeLeadData,
  normalizeContent,
  parseAutoTraderEmail,
  parseCarGurusEmail,
  parseLeadEmail,
  parseWebsiteLeadEmail,
};
