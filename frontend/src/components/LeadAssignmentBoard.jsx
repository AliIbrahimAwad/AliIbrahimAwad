import { GripVertical, UserRound } from "lucide-react";

import { initials, sourceTone, statusTone } from "../lib/format";

function AssignmentCard({ lead, selected, onOpenLead, onDragStart, onDragEnd, draggingDisabled = false }) {
  return (
    <button
      type="button"
      draggable={!draggingDisabled}
      onClick={() => onOpenLead?.(lead.id)}
      onDragStart={(event) => {
        if (draggingDisabled) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(lead.id));
        onDragStart?.(lead.id);
      }}
      onDragEnd={onDragEnd}
      className={`w-full rounded-[1.4rem] border p-4 text-left transition ${
        selected
          ? "border-cyan-400/40 bg-white/10 shadow-glow"
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
        <span className={`rounded-full px-2.5 py-1 font-semibold ${sourceTone(lead.source)}`}>{lead.source}</span>
        {lead.stockNumber ? (
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300">Stock {lead.stockNumber}</span>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
        <span className="truncate">{lead.lastActivity}</span>
        <span className="truncate">{lead.assignedRep}</span>
      </div>
    </button>
  );
}

function AssignmentLane({
  title,
  subtitle,
  badgeTone,
  laneKey,
  leads,
  selectedLeadId,
  draggingLeadId,
  movingLeadId,
  onOpenLead,
  onAssignLead,
  onDragStateChange,
  droppable = false,
}) {
  return (
    <div
      onDragOver={(event) => {
        if (!droppable) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (!droppable) {
          return;
        }
        event.preventDefault();
        const leadId = Number(event.dataTransfer.getData("text/plain"));
        onDragStateChange?.(null);
        if (!leadId || Number.isNaN(leadId)) {
          return;
        }
        onAssignLead?.(leadId, laneKey);
      }}
      className={`flex min-h-[28rem] flex-col rounded-[1.75rem] border p-4 transition ${
        droppable && draggingLeadId != null
          ? "border-cyan-400/25 bg-white/[0.05]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{subtitle}</p>
          <h3 className="mt-1 font-display text-lg font-semibold text-white">{title}</h3>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${badgeTone}`}>{leads.length}</span>
      </div>

      <div className="mt-4 grid gap-3">
        {leads.length ? (
          leads.map((lead) => (
            <AssignmentCard
              key={lead.id}
              lead={lead}
              selected={Number(lead.id) === Number(selectedLeadId)}
              onOpenLead={onOpenLead}
              onDragStart={() => onDragStateChange?.(lead.id)}
              onDragEnd={() => onDragStateChange?.(null)}
              draggingDisabled={Boolean(movingLeadId)}
            />
          ))
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm leading-6 text-slate-400">
            {movingLeadId ? "Updating assignment..." : "No leads in this lane right now."}
          </div>
        )}
      </div>
    </div>
  );
}

export function LeadAssignmentBoard({
  unassignedLeads = [],
  repLanes = [],
  selectedLeadId = null,
  draggingLeadId = null,
  movingLeadId = null,
  onOpenLead,
  onAssignLead,
  onDragStateChange,
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid min-w-[1180px] gap-4"
        style={{ gridTemplateColumns: `minmax(300px, 0.95fr) repeat(${Math.max(repLanes.length, 1)}, minmax(280px, 1fr))` }}
      >
        <AssignmentLane
          title="Unassigned"
          subtitle="Needs owner"
          badgeTone="bg-amber-500/15 text-amber-200"
          laneKey="unassigned"
          leads={unassignedLeads}
          selectedLeadId={selectedLeadId}
          draggingLeadId={draggingLeadId}
          movingLeadId={movingLeadId}
          onOpenLead={onOpenLead}
          onAssignLead={null}
          onDragStateChange={onDragStateChange}
          droppable={false}
        />

        {repLanes.map((lane) => (
          <AssignmentLane
            key={lane.rep.id}
            title={lane.rep.name}
            subtitle={lane.rep.is_available ? "Routing open" : "Routing paused"}
            badgeTone={lane.rep.is_available ? "bg-lime-500/15 text-lime-200" : "bg-white/10 text-slate-300"}
            laneKey={lane.rep.id}
            leads={lane.leads}
            selectedLeadId={selectedLeadId}
            draggingLeadId={draggingLeadId}
            movingLeadId={movingLeadId}
            onOpenLead={onOpenLead}
            onAssignLead={onAssignLead}
            onDragStateChange={onDragStateChange}
            droppable
          />
        ))}
      </div>

      {!repLanes.length ? (
        <div className="mt-4 rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
          <UserRound className="mx-auto h-5 w-5 text-slate-500" />
          <p className="mt-3">No sales reps are available in the roster yet.</p>
        </div>
      ) : null}
    </div>
  );
}
