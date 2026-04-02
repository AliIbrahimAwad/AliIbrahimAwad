import { AlertTriangle, ChevronRight, Clock3 } from "lucide-react";

import { initials, sourceTone, statusTone } from "../lib/format";

export function AttentionLeadCard({
  lead,
  selected,
  onSelect,
  canSelect = false,
  selectionChecked = false,
  onToggleSelect,
}) {
  return (
    <div
      className={`rounded-[1.75rem] border p-5 transition ${
        selected
          ? "border-ember-400/50 bg-white/10 shadow-glow"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
      } ${selectionChecked ? "ring-1 ring-ice-300/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={onSelect} className="group flex min-w-0 flex-1 items-start gap-4 text-left">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500/90 to-ice-500/90 text-sm font-bold text-white">
            {initials(lead.customerName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-semibold text-white">{lead.customerName}</h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(lead.status)}`}>
                {lead.statusLabel}
              </span>
              <span className="rounded-full bg-ember-500/15 px-2.5 py-1 text-xs font-semibold text-ember-200">
                {lead.attentionReason}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-300">{lead.vehicleInterest}</p>
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-500 transition group-hover:text-white" />
        </button>
        {canSelect ? (
          <label
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selectionChecked}
              onChange={() => onToggleSelect?.(lead.id)}
              className="h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-400"
            />
            Select
          </label>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-slate-200">
          <Clock3 className="h-3.5 w-3.5 text-ice-300" />
          {lead.lastActivity}
        </span>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sourceTone(lead.source)}`}>
          {lead.source}
        </span>
        <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
          {lead.assignedRep}
        </span>
        {lead.openTasks?.length ? (
          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
            {lead.openTasks.length} open task{lead.openTasks.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-500">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
          AI / Action Summary
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">
          {lead.aiSummary || lead.messagePreview || "No summary available yet."}
        </p>
      </div>
    </div>
  );
}
