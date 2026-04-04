import { ChevronRight } from "lucide-react";

import { initials, statusTone } from "../lib/format";

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
      className={`rounded-[1.5rem] border p-4 transition ${
        selected
          ? "border-ember-400/35 bg-white/[0.06]"
          : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.12] hover:bg-white/[0.04]"
      } ${selectionChecked ? "ring-1 ring-ice-300/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} className="group flex min-w-0 flex-1 items-start gap-3 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ember-500/85 to-ice-500/85 text-xs font-bold text-white">
            {initials(lead.customerName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-[17px] font-semibold text-white">{lead.customerName}</h3>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(lead.status)}`}>
                {lead.statusLabel}
              </span>
              <span className="rounded-full bg-ember-500/15 px-2.5 py-1 text-[11px] font-semibold text-ember-200">
                {lead.attentionReason}
              </span>
            </div>
            <p className="mt-1 line-clamp-1 text-sm text-slate-300">{lead.vehicleInterest}</p>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">
              {lead.aiSummary || lead.messagePreview || "No summary available yet."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
              <span>{lead.source}</span>
              <span>{lead.lastActivity}</span>
              {lead.assignedRep && lead.assignedRep !== "Unassigned" ? <span>{lead.assignedRep}</span> : null}
              {lead.openTasks?.length ? <span>{lead.openTasks.length} open task{lead.openTasks.length === 1 ? "" : "s"}</span> : null}
            </div>
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-600 transition group-hover:text-white" />
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
    </div>
  );
}
