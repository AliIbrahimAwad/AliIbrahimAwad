import { GripVertical, Phone } from "lucide-react";

import { initials, sourceTone, statusTone } from "../lib/format";

function PipelineLeadCard({ lead, selected, onSelect, onDragStart, onDragEnd }) {
  return (
    <button
      type="button"
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(lead.id));
        onDragStart?.(lead.id);
      }}
      onDragEnd={onDragEnd}
      className={`w-full rounded-[1.4rem] border p-4 text-left transition ${
        selected
          ? "border-ice-400/40 bg-white/10 shadow-glow"
          : "border-white/10 bg-white/[0.045] hover:border-white/20 hover:bg-white/[0.07]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500/90 to-ice-500/90 text-xs font-bold text-white">
            {initials(lead.customerName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-display text-base font-semibold text-white">{lead.customerName}</h3>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(lead.status)}`}>
                {lead.statusLabel}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-300">{lead.vehicleInterest}</p>
          </div>
        </div>
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {lead.stockNumber ? (
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300">Stock {lead.stockNumber}</span>
        ) : null}
        <span className={`rounded-full px-2.5 py-1 font-semibold ${sourceTone(lead.source)}`}>{lead.source}</span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
        <span className="truncate">{lead.assignedRep}</span>
        <span className="shrink-0">{lead.lastActivity}</span>
      </div>

      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-300">
        <Phone className="h-3.5 w-3.5 text-ice-300" />
        <span>{lead.phone}</span>
      </div>
    </button>
  );
}

export function LeadPipelineBoard({
  stages = [],
  groups = {},
  selectedLeadId = null,
  draggingLeadId = null,
  movingLeadId = null,
  onSelectLead,
  onMoveLead,
  onDragStateChange,
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1220px] gap-4 xl:grid-cols-6">
        {stages.map((stage) => {
          const lane = groups[stage.key] || [];
          const isActiveDropTarget = draggingLeadId != null;

          return (
            <div
              key={stage.key}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const leadId = Number(event.dataTransfer.getData("text/plain"));
                onDragStateChange?.(null);
                if (!leadId || Number.isNaN(leadId)) {
                  return;
                }
                onMoveLead?.(leadId, stage.key);
              }}
              className={`flex min-h-[24rem] flex-col rounded-[1.75rem] border p-4 transition ${
                isActiveDropTarget
                  ? "border-ice-400/25 bg-white/[0.045]"
                  : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Pipeline stage</p>
                  <h3 className="mt-1 font-display text-lg font-semibold text-white">{stage.label}</h3>
                </div>
                <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone(stage.key)}`}>
                  {lane.length}
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                {lane.length ? (
                  lane.map((lead) => (
                    <PipelineLeadCard
                      key={lead.id}
                      lead={lead}
                      selected={Number(lead.id) === Number(selectedLeadId)}
                      onSelect={() => onSelectLead?.(lead.id)}
                      onDragStart={() => onDragStateChange?.(lead.id)}
                      onDragEnd={() => onDragStateChange?.(null)}
                    />
                  ))
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm leading-6 text-slate-400">
                    {movingLeadId ? "Updating lead status..." : "Drop a lead here or wait for the next update."}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
