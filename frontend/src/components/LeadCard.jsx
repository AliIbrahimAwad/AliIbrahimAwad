import { ChevronRight, Phone } from "lucide-react";

import { initials, sourceTone, statusTone } from "../lib/format";

export function LeadCard({ lead, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full rounded-[1.75rem] border p-5 text-left transition ${
        selected
          ? "border-ice-400/40 bg-white/10 shadow-glow"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500/90 to-ice-500/90 text-sm font-bold text-white">
            {initials(lead.customerName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-semibold text-white">{lead.customerName}</h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(lead.status)}`}>
                {lead.statusLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-300">{lead.vehicleInterest}</p>
          </div>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-500 transition group-hover:text-white" />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-slate-200">
          <Phone className="h-3.5 w-3.5 text-ice-300" />
          {lead.phone}
        </span>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sourceTone(lead.source)}`}>
          {lead.source}
        </span>
        <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">{lead.stage}</span>
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-300">{lead.messagePreview}</p>

      <div className="mt-4 flex items-center justify-between text-xs uppercase tracking-[0.24em] text-slate-500">
        <span>{lead.assignedRep}</span>
        <span>{lead.lastActivity}</span>
      </div>
    </button>
  );
}
