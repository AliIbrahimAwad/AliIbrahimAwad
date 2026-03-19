import { useEffect, useState } from "react";

import { formatPhoneNumber, pipelineLabel } from "../lib/format";

function formatRelative(dateString) {
  if (!dateString) {
    return "Just now";
  }

  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function UnmatchedCommunicationPanel({
  item,
  leads = [],
  loading = false,
  assigning = false,
  creating = false,
  dismissing = false,
  onAssign,
  onCreateLead,
  onDismiss,
}) {
  const [leadId, setLeadId] = useState("");
  const [customerName, setCustomerName] = useState("");

  useEffect(() => {
    setLeadId("");
    setCustomerName("");
  }, [item?.id]);

  if (loading) {
    return <div className="h-[520px] animate-pulse rounded-[2rem] border border-white/10 bg-white/[0.04]" />;
  }

  if (!item) {
    return (
      <div className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-slate-400">
        Select an unmatched communication to review it.
      </div>
    );
  }

  const phone = item.normalized_from_number || item.from_number || "Not available";
  const preview =
    item.type === "sms"
      ? item.body_text || "No SMS message body."
      : item.call_duration != null
        ? `Inbound call lasting ${item.call_duration}s`
        : "Inbound call";

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
      <div className="border-b border-white/10 pb-5">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Unmatched communication</p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-white">
          {item.type === "sms" ? "Inbound SMS" : "Inbound call"}
        </h2>
        <p className="mt-2 text-sm text-slate-300">{formatPhoneNumber(phone)}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{item.status}</span>
          <span>{formatRelative(item.received_at)}</span>
          {item.provider_extension_id ? <span>Ext {item.provider_extension_id}</span> : null}
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Preview</p>
          <p className="mt-3 text-sm leading-6 text-slate-200">{preview}</p>
        </div>

        <label className="grid gap-2">
          <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Attach to existing lead</span>
          <select
            value={leadId}
            onChange={(event) => setLeadId(event.target.value)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
          >
            <option value="" className="bg-ink-900">
              Select a lead
            </option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id} className="bg-ink-900">
                #{lead.id} {lead.customerName} | {pipelineLabel(lead.status)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={!leadId || assigning}
          onClick={() => onAssign?.(Number(leadId))}
          className="inline-flex w-full items-center justify-center rounded-2xl bg-ice-500 px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-ice-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {assigning ? "Attaching..." : "Attach to lead"}
        </button>

        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Create new lead</p>
          <label className="mt-3 grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Customer name (optional)</span>
            <input
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              placeholder="Leave blank if unknown"
            />
          </label>
          <button
            type="button"
            disabled={creating}
            onClick={() => onCreateLead?.({ customer_name: customerName })}
            className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create lead"}
          </button>
        </div>

        <button
          type="button"
          disabled={dismissing}
          onClick={() => onDismiss?.()}
          className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {dismissing ? "Dismissing..." : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
