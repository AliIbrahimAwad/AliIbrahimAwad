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

function buildInlineBoundary(nextLabels = []) {
  const escapedNextLabels = nextLabels.map((nextLabel) =>
    nextLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  return nextLabels.length > 0
    ? `(?=\\s+(?:${escapedNextLabels.join("|")})(?:\\s*:|\\s)|\\r?\\n|$)`
    : "(?=\\r?\\n|$)";
}

function buildMultilineBoundary(nextLabels = []) {
  const escapedNextLabels = nextLabels.map((nextLabel) =>
    nextLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  return nextLabels.length > 0
    ? `(?=\\s+(?:${escapedNextLabels.join("|")})(?:\\s*:|\\s)|\\n\\s*[A-Za-z][A-Za-z0-9 ?#&()/.-]{1,40}(?:\\s*:|\\s)|$)`
    : "(?=\\n\\s*[A-Za-z][A-Za-z0-9 ?#&()/.-]{1,40}(?:\\s*:|\\s)|$)";
}

function getDelimitedField(text, label, nextLabels = [], { multiline = false } = {}) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = multiline ? buildMultilineBoundary(nextLabels) : buildInlineBoundary(nextLabels);
  const valuePattern = multiline ? "[\\s\\S]*?" : "[^\\r\\n]*?";
  const match = String(text || "").match(new RegExp(`${escapedLabel}\\s*:?\\s*(${valuePattern})${boundary}`, "i"));
  return cleanValue(match ? match[1] : "");
}

function getField(text, label, nextLabels = []) {
  return nextLabels.length > 0
    ? getDelimitedField(text, label, nextLabels) || getFieldSameLine(text, label) || getFieldNextLine(text, label)
    : getFieldSameLine(text, label) || getFieldNextLine(text, label) || getDelimitedField(text, label, nextLabels);
}

function getMultilineField(text, label, nextLabels = []) {
  return getDelimitedField(text, label, nextLabels, { multiline: true }) || getField(text, label, nextLabels);
}

function combineVehicle(parts = []) {
  return cleanValue(parts.filter(Boolean).join(" "));
}

function combinePersonName(parts = []) {
  return cleanValue(
    parts
      .map((part) => cleanValue(part))
      .filter(Boolean)
      .join(" ")
  );
}

function getFirstResolvedField(text, labels = [], nextLabels = []) {
  for (const label of labels) {
    const value = getField(text, label, nextLabels);
    if (value) {
      return value;
    }
  }

  return null;
}

function extractTextPersonName(text, options = {}) {
  const fullName = getFirstResolvedField(text, options.fullLabels || [], options.nextLabels || []);
  const firstName = getFirstResolvedField(text, options.firstLabels || [], options.nextLabels || []);
  const lastName = getFirstResolvedField(text, options.lastLabels || [], options.nextLabels || []);
  const combinedName = combinePersonName([firstName, lastName]);

  return combinedName || fullName || firstName || lastName || null;
}

function extractXmlTagValue(xml, tagName) {
  const escapedTag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${escapedTag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return cleanValue(match ? match[1] : "");
}

function extractXmlSection(xml, tagName) {
  const escapedTag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${escapedTag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return match ? match[1] : "";
}

function extractXmlSourceId(xml, sourceName) {
  const escapedSource = String(sourceName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(
    new RegExp(`<id[^>]*source=["']${escapedSource}["'][^>]*>([\\s\\S]*?)<\\/id>`, "i")
  );
  return cleanValue(match ? match[1] : "");
}

function extractXmlPersonName(xml) {
  const fullNameMatch = String(xml || "").match(/<name[^>]*part=["']full["'][^>]*>([\s\S]*?)<\/name>/i);
  const fullName = cleanValue(fullNameMatch ? fullNameMatch[1] : "");
  if (fullName) {
    return fullName;
  }

  const parts = {};
  for (const match of String(xml || "").matchAll(/<name[^>]*part=["']([^"']+)["'][^>]*>([\s\S]*?)<\/name>/gi)) {
    const part = String(match[1] || "").trim().toLowerCase();
    const value = cleanValue(match[2] || "");
    if (part && value) {
      parts[part] = value;
    }
  }

  const combined = combinePersonName([parts.first, parts.middle, parts.last]);
  if (combined) {
    return combined;
  }

  return extractXmlTagValue(xml, "name");
}

function isAdfXml(text) {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("<adf") && normalized.includes("<prospect");
}

function parseAdfLeadXml(text, message = {}) {
  const vehicleXml = extractXmlSection(text, "vehicle");
  const customerXml = extractXmlSection(text, "customer");
  const contactXml = extractXmlSection(customerXml, "contact");
  const providerXml = extractXmlSection(text, "provider");
  const sourcePartner = extractXmlSourceId(providerXml, "partner") || extractXmlTagValue(providerXml, "id");
  const providerName = extractXmlTagValue(providerXml, "name");
  const source = /cargurus/i.test(`${sourcePartner} ${providerName}`)
    ? "cargurus"
    : /autotrader|auto trader/i.test(`${sourcePartner} ${providerName}`)
      ? "autotrader"
      : detectLeadSource(message, text);
  const year = extractXmlTagValue(vehicleXml, "year");
  const make = extractXmlTagValue(vehicleXml, "make");
  const model = extractXmlTagValue(vehicleXml, "model");
  const trim = extractXmlTagValue(vehicleXml, "trim");

  return {
    source,
    customer_name: extractXmlPersonName(contactXml),
    phone: cleanPhone(extractXmlTagValue(contactXml, "phone")),
    email: extractXmlTagValue(contactXml, "email"),
    vehicle_interest: combineVehicle([year, make, model, trim]),
    vehicle_id: extractXmlTagValue(vehicleXml, "vin"),
    stock_number: extractXmlTagValue(vehicleXml, "stock"),
    vehicle_year: year || null,
    vehicle_make: make || null,
    vehicle_model: model || null,
    vehicle_trim: trim || null,
    vehicle_condition: extractXmlTagValue(vehicleXml, "condition"),
    vehicle_price: extractXmlTagValue(vehicleXml, "price"),
    listing_url: extractXmlTagValue(providerXml, "url"),
    message: extractXmlTagValue(customerXml, "comments"),
    lead_type: extractXmlSourceId(text, "leadtype") || "general_inquiry",
    sender: getSenderEmail(message),
  };
}

function detectLeadSource(message, text) {
  const sender = getSenderEmail(message);
  const subject = String(message.subject || "").toLowerCase();
  const haystack = `${sender}\n${subject}\n${String(text || "").toLowerCase()}`;

  if (isAdfXml(text)) {
    if (haystack.includes("cargurus")) {
      return "cargurus";
    }

    if (haystack.includes("autotrader") || haystack.includes("trader.ca")) {
      return "autotrader";
    }
  }

  if (haystack.includes("messages.cargurus.com") || haystack.includes("lead submission from cargurus")) {
    return "cargurus";
  }

  if (
    haystack.includes("dealerleads.trader.ca") ||
    haystack.includes("no-reply@trader.ca") ||
    haystack.includes("autotrader.ca") ||
    haystack.includes("autotrader") ||
    haystack.includes("auto trader")
  ) {
    return "autotrader";
  }

  if (
    haystack.includes("this form submitted at") &&
    (
      haystack.includes("phone number") ||
      haystack.includes("preferred contact method") ||
      (haystack.includes("first name") && haystack.includes("last name"))
    )
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

  const inlineName = getField(text, "Name", ["Email", "Phone", "Subject", "Trade-In?", "Trade-In"]);
  const inlineEmail = getField(text, "Email", ["Phone", "Subject", "Trade-In?", "Trade-In", "description"]);
  const inlinePhone = getField(text, "Phone", ["Subject", "Trade-In?", "Trade-In", "description", "Message"]);
  const inlineStock = getField(text, "Stock Number", ["Price", "Stock", "VIN", "Condition", "Dealer"]);
  const inlineVin = getField(text, "VIN", ["Stock Number", "Price", "Condition", "Dealer"]);
  const inlineMessage = getMultilineField(text, "Message", [
    "Dealer Price",
    "Price",
    "Term Requested",
    "Finance Rate",
    "Cash Down",
    "Trade In",
    "Trade-In",
    "Loan Amount",
    "Fee",
    "Cost of borrowing",
    "Ad Details",
    "Dealer",
  ]);
  const inlineVehicleLine =
    getField(text, "Subject", ["Trade-In?", "Trade-In", "description", "Message"]) ||
    getField(text, "description", ["Message", "Dealer Price", "Price"]);
  const inlineVehicleInterest = cleanValue(
    String(inlineVehicleLine || "")
      .replace(/^important sales lead from autotrader\.ca/i, "")
      .replace(/^important sales lead/i, "")
      .replace(/^auto\s*trader/i, "")
      .replace(/^trade-in\??\s*:\s*[^ ]+(?:\s+description:)?/i, "")
      .trim()
  );
  const customerName = extractTextPersonName(text, {
    fullLabels: ["Name", "Customer Name", "Full Name"],
    firstLabels: ["First Name"],
    lastLabels: ["Last Name"],
    nextLabels: ["Email", "Phone", "Subject", "Trade-In?", "Trade-In"],
  });

  return {
    source: "autotrader",
    customer_name: customerName || inlineName || getField(text, "Name"),
    phone: cleanPhone(inlinePhone || getField(text, "Phone")),
    email: inlineEmail || getField(text, "Email"),
    vehicle_interest: combineVehicle([
      getField(text, "Year"),
      getField(text, "Make"),
      getField(text, "Model"),
      getField(text, "Trim"),
    ]) || inlineVehicleInterest,
    vehicle_id: inlineVin || getField(text, "Vin"),
    stock_number: inlineStock || getField(text, "Stock Number"),
    vehicle_year: getField(text, "Year"),
    vehicle_make: getField(text, "Make"),
    vehicle_model: getField(text, "Model"),
    vehicle_trim: getField(text, "Trim"),
    vehicle_condition: getField(text, "Condition"),
    vehicle_price: getField(text, "Price"),
    listing_url: getField(text, "SourceUrl"),
    message: inlineMessage || getField(text, "Comment"),
    lead_type: getField(text, "Lead type"),
    sender: getSenderEmail(message),
  };
}

function parseCarGurusEmail(text, message = {}) {
  const customerName = extractTextPersonName(text, {
    fullLabels: ["Full Name", "Name", "Customer Name"],
    firstLabels: ["First Name"],
    lastLabels: ["Last Name"],
    nextLabels: ["Email", "Telephone", "Postal code", "Comments"],
  });

  return {
    source: "cargurus",
    customer_name: customerName,
    phone: cleanPhone(getField(text, "Telephone", ["Postal code", "Comments", "Vehicle", "VIN"])),
    email: getField(text, "Email", ["Telephone", "Postal code", "Comments", "Vehicle"]),
    vehicle_interest: getField(text, "Vehicle", ["Stock Number", "Listed Price", "View Listing on CarGurus"]),
    vehicle_id: getField(text, "VIN", ["Vehicle", "Stock Number", "Listed Price"]),
    stock_number: getField(text, "Stock Number", ["Listed Price", "View Listing on CarGurus"]),
    vehicle_year:
      getField(text, "Vehicle", ["Stock Number", "Listed Price", "View Listing on CarGurus"])?.match(/\b(19|20)\d{2}\b/)?.[0] ||
      null,
    vehicle_make: cleanValue(
      getField(text, "Vehicle", ["Stock Number", "Listed Price", "View Listing on CarGurus"])
        ?.split(" ")
        .slice(1, 2)
        .join(" ")
    ),
    vehicle_model: cleanValue(
      getField(text, "Vehicle", ["Stock Number", "Listed Price", "View Listing on CarGurus"])
        ?.split(" ")
        .slice(2)
        .join(" ")
    ),
    vehicle_trim: null,
    vehicle_condition: null,
    vehicle_price: getField(text, "Listed Price", ["View Listing on CarGurus"]),
    listing_url: getField(text, "View Listing on CarGurus"),
    message: getMultilineField(text, "Comments", ["Listing", "VIN", "Vehicle", "Stock Number"]),
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
  const customerName = extractTextPersonName(text, {
    fullLabels: ["Full Name", "Name", "Customer Name"],
    firstLabels: ["First Name"],
    lastLabels: ["Last Name"],
    nextLabels: ["Email", "Phone Number", "Preferred Contact Method", "Message"],
  });

  return {
    source: "website",
    customer_name: customerName,
    phone: cleanPhone(getField(text, "Phone Number", ["Preferred Contact Method", "Message", "This form submitted at"])),
    email: getField(text, "Email", ["Phone Number", "Preferred Contact Method", "Message"]),
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
    message: getMultilineField(text, "Message", ["This form submitted at", "Preferred Contact Method"]),
    lead_type: "website_form",
    sender: getSenderEmail(message),
  };
}

function parseLeadEmail(message) {
  const text = normalizeContent(message);
  if (isAdfXml(text)) {
    return parseAdfLeadXml(text, message);
  }

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
    extractTextPersonName(text, {
      fullLabels: ["Full Name", "Name", "Customer Name"],
      firstLabels: ["First Name"],
      lastLabels: ["Last Name"],
      nextLabels: ["Email", "Phone", "Phone Number", "Subject", "Message", "Comments"],
    }) ||
    senderName ||
    null;

  return {
    source: detectLeadSource(message, text),
    customer_name: customerName,
    phone:
      cleanPhone(
        getField(text, "Phone", ["Email", "Subject", "Message"]) ||
          getField(text, "Phone Number", ["Email", "Preferred Contact Method", "Message"]) ||
          extractPhone(text)
      ),
    email:
      getField(text, "Email", ["Phone", "Phone Number", "Subject", "Message", "Comments"]) ||
      extractEmail(text) ||
      senderEmail ||
      null,
    vehicle_interest:
      getField(text, "Vehicle", ["Vehicle Interest", "VIN", "Stock Number", "Message"]) ||
      getField(text, "Vehicle Interest", ["VIN", "Stock Number", "Message"]) ||
      null,
    vehicle_id: getField(text, "VIN", ["Stock Number", "Message"]) || extractVin(text),
    stock_number: getField(text, "Stock Number", ["VIN", "Message"]) || extractStockNumber(text),
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    vehicle_trim: null,
    vehicle_condition: null,
    vehicle_price: null,
    listing_url: extractFirstMatch(text, /(https?:\/\/[^\s]+)/i),
    message:
      getMultilineField(text, "Message", ["Comments", "Inquiry", "This form submitted at"]) ||
      getMultilineField(text, "Comments", ["Inquiry", "This form submitted at"]) ||
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
      lead = await db.createApiLead(parsedLead, null, { returnDedupeMeta: true });
      duplicate = lead?._dedupe?.merged
        ? {
            lead,
            reason: lead._dedupe.reason,
          }
        : null;
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
  parseAdfLeadXml,
  parseAutoTraderEmail,
  parseCarGurusEmail,
  parseLeadEmail,
  parseWebsiteLeadEmail,
};
