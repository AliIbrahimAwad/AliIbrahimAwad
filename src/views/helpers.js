function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function when(condition, content) {
  return condition ? content : "";
}

function fieldClass(errors, key) {
  return errors[key] ? "input error" : "input";
}

module.exports = {
  escapeHtml,
  fieldClass,
  when,
};
