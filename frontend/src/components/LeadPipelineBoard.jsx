import { GripVertical, Phone } from "lucide-react";

import { initials, sourceTone, statusTone } from "../lib/format";

function PipelineLeadCard({
  lead,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
  canSelect = false,
  selectionChecked = false,
  onToggleSelect,
}) {
  return (
    <div
      className={`flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[1.35rem] border p-3.5 transition ${
        selected
          ? "border-ice-400/40 bg-white/10 shadow-glow"
          : "border-white/10 bg-white/[0.045] hover:border-white/20 hover:bg-white/[0.07]"
      } ${selectionChecked ? "ring-1 ring-ice-300/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
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
          className="flex w-full min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500/90 to-ice-500/90 text-xs font-bold text-white">
            {initials(lead.customerName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="truncate font-display text-[15px] font-semibold text-white">{lead.customerName}</h3>
              <span className={`max-w-full truncate rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(lead.status)}`}>
                {lead.statusLabel}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-slate-300">{lead.vehicleInterest}</p>
          </div>
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        </button>
        {canSelect ? (
          <label
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selectionChecked}
              onChange={() => onToggleSelect?.(lead.id)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-transparent accent-cyan-400"
            />
            Select
          </label>
        ) : null}
      </div>

      <div className="mt-2.5 flex min-w-0 flex-wrap gap-2 text-[11px]">
        {lead.stockNumber ? (
          <span className="max-w-full truncate rounded-full bg-white/5 px-2.5 py-1 text-slate-300">Stock {lead.stockNumber}</span>
        ) : null}
        <span className={`max-w-full truncate rounded-full px-2.5 py-1 font-semibold ${sourceTone(lead.source)}`}>{lead.source}</span>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">
        <span className="truncate">{lead.assignedRep}</span>
        <span className="shrink-0">{lead.lastActivity}</span>
      </div>

      <div className="mt-auto pt-3">
        <div className="inline-flex max-w-full items-center gap-2 overflow-hidden rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-slate-300">
        <Phone className="h-3.5 w-3.5 text-ice-300" />
        <span className="truncate">{lead.phone}</span>
        </div>
      </div>
    </div>
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
  canSelectLead,
  selectedLeadIds = [],
  onToggleLeadSelect,
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid min-w-[1220px] gap-4"
        style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(0, 1fr))` }}
      >
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
              className={`flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border p-4 transition ${
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

              <div className="mt-4 grid min-w-0 gap-3">
                {lane.length ? (
                  lane.map((lead) => (
                    <PipelineLeadCard
                      key={lead.id}
                      lead={lead}
                      selected={Number(lead.id) === Number(selectedLeadId)}
                      onSelect={() => onSelectLead?.(lead.id)}
                      onDragStart={() => onDragStateChange?.(lead.id)}
                      onDragEnd={() => onDragStateChange?.(null)}
                      canSelect={canSelectLead?.(lead)}
                      selectionChecked={selectedLeadIds.includes(Number(lead.id))}
                      onToggleSelect={onToggleLeadSelect}
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
