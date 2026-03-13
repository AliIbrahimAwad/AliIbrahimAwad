import { CalendarDays, CarFront, MessageSquareText, PhoneCall, ShieldCheck, Sparkles } from "lucide-react";

import { pipelineLabel, sourceTone, statusTone } from "../lib/format";

const pipelineStatuses = ["new", "contacted", "appointment", "negotiation", "sold", "lost"];

function InfoBlock({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-100">{value || "Not available"}</p>
    </div>
  );
}

export function LeadDetailsPanel({ lead, loading = false, onStatusChange, statusUpdating = false }) {
  if (loading) {
    return (
      <aside className="rounded-[2rem] border border-white/10 bg-ink-900/85 p-6 shadow-card backdrop-blur">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-28 rounded-full bg-white/10" />
          <div className="h-8 w-56 rounded-full bg-white/10" />
          <div className="h-24 rounded-[1.75rem] bg-white/5" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-24 rounded-2xl bg-white/5" />
            <div className="h-24 rounded-2xl bg-white/5" />
          </div>
        </div>
      </aside>
    );
  }

  if (!lead) {
    return (
      <aside className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] p-6 text-slate-400">
        Select a lead to view the full customer story.
      </aside>
    );
  }

  const activities = lead.activities || [];

  return (
    <aside className="rounded-[2rem] border border-white/10 bg-ink-900/85 p-6 shadow-card backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">{lead.sourceDetail || lead.source}</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">{lead.customerName}</h2>
          <p className="mt-1 text-sm text-slate-300">{lead.vehicleInterest}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone(lead.status)}`}>
            {lead.statusLabel}
          </span>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sourceTone(lead.source)}`}>
            {lead.source}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {pipelineStatuses.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onStatusChange?.(status)}
            disabled={statusUpdating || status === lead.status}
            className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
              status === lead.status
                ? "bg-white text-ink-950"
                : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            } ${statusUpdating ? "cursor-wait opacity-70" : ""}`}
          >
            {pipelineLabel(status)}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <InfoBlock label="Phone" value={lead.phone} />
        <InfoBlock label="Assigned Rep" value={lead.assignedRep} />
        <InfoBlock label="Email" value={lead.email} />
        <InfoBlock label="Listing URL" value={lead.listingUrl || "Direct inventory inquiry"} />
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-white/8 to-white/[0.03] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4 text-ember-400" />
          Lead message
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-300">{lead.message || "No message captured yet."}</p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarDays className="h-4 w-4 text-ice-300" />
            Lead snapshot
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Captured {lead.createdAtLabel}. Last updated {lead.updatedAtLabel}. Source channel is{" "}
            {lead.source.toLowerCase()}.
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-lime-400" />
            Activity count
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
              {activities.length} recorded touchpoints
            </span>
            <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
              Status: {lead.statusLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <MessageSquareText className="h-4 w-4 text-ember-400" />
          Timeline
        </div>
        <ol className="mt-4 space-y-4">
          {activities.length ? (
            activities.map((event) => (
              <li key={`${lead.id}-${event.id}`} className="flex gap-4">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-ice-400" />
                <div>
                  <p className="text-sm font-semibold text-white">{pipelineLabel(event.type)}</p>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{event.createdAtLabel}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">{event.content}</p>
                </div>
              </li>
            ))
          ) : (
            <p className="text-sm text-slate-400">No activity has been recorded yet.</p>
          )}
        </ol>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-slate-100"
        >
          <PhoneCall className="h-4 w-4" />
          Call Lead
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <MessageSquareText className="h-4 w-4" />
          Send SMS
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <CarFront className="h-4 w-4" />
          Hold Vehicle
        </button>
      </div>
    </aside>
  );
}
