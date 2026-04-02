import { GripVertical } from "lucide-react";

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
      className={`crm-pipeline-card flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[1.1rem] border px-3.5 py-3 transition ${
        selected
          ? "border-ice-400/30 bg-white/7 shadow-glow"
          : "border-white/[0.04] bg-white/[0.035] hover:border-white/[0.08] hover:bg-white/[0.05]"
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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ember-500/90 to-ice-500/90 text-[11px] font-bold text-white">
            {initials(lead.customerName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-display text-[15px] font-semibold text-white">{lead.customerName}</h3>
                <span className={`mt-2 inline-flex max-w-full truncate rounded-md px-2 py-1 text-[11px] font-semibold ${sourceTone(lead.source)}`}>
                  {lead.vehicleInterest}
                </span>
              </div>
            </div>
          </div>
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
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

      <div className="mt-3 flex min-w-0 items-center justify-between gap-3 text-[11px] text-slate-400">
        <div className="flex min-w-0 flex-wrap gap-2">
          {lead.stockNumber ? (
            <span className="max-w-full truncate text-slate-400">Stock {lead.stockNumber}</span>
          ) : null}
          <span className="max-w-full truncate">{lead.source}</span>
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-slate-500">{lead.lastActivity}</span>
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
        className="grid min-w-[1220px] gap-5"
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
              className={`crm-pipeline-lane flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-[1.6rem] p-3 transition ${
                isActiveDropTarget
                  ? "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(88,183,255,0.16)]"
                  : "bg-transparent"
              }`}
            >
              <div className="flex items-center justify-between gap-3 px-1 pb-2">
                <div>
                  <h3 className="font-display text-[15px] font-semibold text-white">{stage.label}</h3>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(stage.key)}`}>
                  {lane.length}
                </span>
              </div>

              <div className="mt-1 grid min-w-0 gap-3">
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
                  <div className="crm-pipeline-empty rounded-[1.1rem] bg-white/[0.02] px-4 py-8 text-center text-sm leading-6 text-slate-500">
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
