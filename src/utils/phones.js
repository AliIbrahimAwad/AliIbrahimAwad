function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length > 11 && String(value || "").trim().startsWith("+")) {
    return `+${digits}`;
  }

  return "";
}

module.exports = {
  normalizePhone,
};
