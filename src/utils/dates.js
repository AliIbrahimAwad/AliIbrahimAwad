function pad(value) {
  return String(value).padStart(2, "0");
}

function getLocalDateParts(input) {
  const date = input instanceof Date ? input : new Date(input);

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function toDateOnlyString(input = new Date()) {
  const { year, month, day } = getLocalDateParts(input);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function formatDisplayDate(input) {
  if (!input) {
    return "Not scheduled";
  }

  const [year, month, day] = String(input).split("-").map(Number);
  if (!year || !month || !day) {
    return input;
  }

  return new Date(year, month - 1, day).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTimestamp(input) {
  if (!input) {
    return "";
  }

  return new Date(input).toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

module.exports = {
  formatDisplayDate,
  formatTimestamp,
  toDateOnlyString,
};
