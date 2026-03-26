function cleanToken(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDisplayToken(value) {
  return cleanToken(value).toLowerCase();
}

function isPlaceholderToken(value) {
  const normalized = normalizeDisplayToken(value);
  return (
    !normalized ||
    normalized === "null" ||
    normalized === "undefined" ||
    normalized === "-" ||
    normalized === "unknown" ||
    normalized === "name"
  );
}

function dedupeRepeatedHalves(tokens = []) {
  if (!Array.isArray(tokens) || tokens.length < 2 || tokens.length % 2 !== 0) {
    return tokens;
  }

  const midpoint = tokens.length / 2;
  const firstHalf = tokens.slice(0, midpoint).map(normalizeDisplayToken).join(" ");
  const secondHalf = tokens.slice(midpoint).map(normalizeDisplayToken).join(" ");
  return firstHalf && firstHalf === secondHalf ? tokens.slice(0, midpoint) : tokens;
}

export function splitCustomerNameParts(value = "") {
  const normalized = cleanToken(value);
  if (!normalized || normalizeDisplayToken(normalized) === "nn lead") {
    return { firstName: "", lastName: "" };
  }

  const rawTokens = normalized.split(" ").map(cleanToken).filter(Boolean);
  const deduped = dedupeRepeatedHalves(rawTokens);
  const filtered = deduped.filter((token) => !isPlaceholderToken(token));
  if (!filtered.length) {
    return { firstName: "", lastName: "" };
  }

  return {
    firstName: filtered[0] || "",
    lastName: filtered.slice(1).join(" ").trim(),
  };
}
