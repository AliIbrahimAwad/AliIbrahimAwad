export function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function sourceTone(source) {
  switch (source) {
    case "Website":
      return "bg-ice-500/15 text-ice-300 ring-1 ring-inset ring-ice-400/20";
    case "Marketplace":
      return "bg-ember-500/15 text-ember-400 ring-1 ring-inset ring-ember-500/25";
    case "Referral":
      return "bg-lime-500/15 text-lime-400 ring-1 ring-inset ring-lime-400/25";
    case "Chat":
      return "bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/25";
    default:
      return "bg-white/10 text-slate-300 ring-1 ring-inset ring-white/10";
  }
}

export function statusTone(status) {
  switch (String(status || "").toLowerCase()) {
    case "hot":
    case "sold":
      return "text-ember-400 bg-ember-500/15";
    case "warm":
    case "contacted":
      return "text-ice-300 bg-ice-500/15";
    case "new":
    case "new lead":
      return "text-lime-400 bg-lime-500/15";
    case "appointment":
      return "text-sky-300 bg-sky-500/15";
    case "negotiation":
      return "text-fuchsia-300 bg-fuchsia-500/15";
    case "lost":
      return "text-slate-300 bg-white/10";
    default:
      return "text-slate-300 bg-white/10";
  }
}

export function pipelineLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();

  switch (normalized) {
    case "new":
      return "New Lead";
    case "contacted":
      return "Contacted";
    case "appointment":
      return "Appointment";
    case "negotiation":
      return "Negotiation";
    case "sold":
      return "Sold";
    case "lost":
      return "Lost";
    default:
      return normalized
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}
