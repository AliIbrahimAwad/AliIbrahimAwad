import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CarFront,
  CheckCircle2,
  ChevronDown,
  MessageSquareText,
  PhoneCall,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

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

function renderTimelineHeadline(event) {
  if (event.type === "sms") {
    return event.payload.direction === "outbound" ? "Outbound SMS" : "Inbound SMS";
  }

  if (event.type === "call") {
    return event.payload.direction === "outbound" ? "Outbound Call" : "Inbound Call";
  }

  if (event.type === "status_change") {
    return "Lead Status Changed";
  }

  return "Activity";
}

export function LeadDetailsPanel({
  lead,
  loading = false,
  onStatusChange,
  statusUpdating = false,
  canAssign = false,
  assignees = [],
  assigneesLoading = false,
  assignmentUpdating = false,
  onAssignLead,
  onCompleteTask,
  taskCompletingId = null,
  onSendSms,
  smsSending = false,
  onLogCall,
  callLogging = false,
  onHoldVehicle,
  holdSubmitting = false,
}) {
  const [assignmentValue, setAssignmentValue] = useState("");
  const [smsDraft, setSmsDraft] = useState("");
  const [smsComposerOpen, setSmsComposerOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const smsComposerRef = useRef(null);

  useEffect(() => {
    setAssignmentValue(lead?.assignedTo ? String(lead.assignedTo) : "");
  }, [lead?.assignedTo, lead?.id]);

  useEffect(() => {
    setSmsDraft("");
    setSmsComposerOpen(false);
    setActionNotice("");
  }, [lead?.id]);

  useEffect(() => {
    if (!smsComposerOpen || !smsComposerRef.current) {
      return;
    }

    smsComposerRef.current.focus();
    smsComposerRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [smsComposerOpen]);

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

  const timeline = lead.timeline || [];

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

      {canAssign ? (
        <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="grid flex-1 gap-2">
              <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Assign lead</span>
              <select
                value={assignmentValue}
                onChange={(event) => setAssignmentValue(event.target.value)}
                disabled={assigneesLoading || assignmentUpdating}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:cursor-wait disabled:opacity-70"
              >
                <option value="" className="bg-ink-900">
                  Select salesperson
                </option>
                {assignees.map((user) => (
                  <option key={user.id} value={user.id} className="bg-ink-900">
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => onAssignLead?.(Number(assignmentValue))}
              disabled={
                assigneesLoading ||
                assignmentUpdating ||
                !assignmentValue ||
                Number(assignmentValue) === Number(lead.assignedTo)
              }
              className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {assignmentUpdating ? "Assigning..." : "Assign lead"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <InfoBlock label="Phone" value={lead.phone} />
        <InfoBlock label="Assigned Rep" value={lead.assignedRep} />
        <InfoBlock label="Email" value={lead.email} />
        <InfoBlock label="Listing URL" value={lead.listingUrl || "Direct inventory inquiry"} />
        <InfoBlock label="Stock Number" value={lead.stockNumber} />
        <InfoBlock label="Lead Type" value={lead.leadType} />
        <InfoBlock label="Year" value={lead.vehicleYear} />
        <InfoBlock label="Make" value={lead.vehicleMake} />
        <InfoBlock label="Model" value={lead.vehicleModel} />
        <InfoBlock label="Trim" value={lead.vehicleTrim} />
        <InfoBlock label="Condition" value={lead.vehicleCondition} />
        <InfoBlock label="Price" value={lead.vehiclePrice} />
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-white/8 to-white/[0.03] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4 text-ember-400" />
          Lead message
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-300">{lead.message || "No message captured yet."}</p>
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <CheckCircle2 className="h-4 w-4 text-lime-400" />
          Tasks
        </div>
        <div className="mt-4 space-y-3">
          {lead.tasks?.length ? (
            lead.tasks.map((task) => (
              <div key={task.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{task.title}</p>
                      <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                        {task.status}
                      </span>
                      <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                        {task.source}
                      </span>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                      Due {task.due_at ? new Date(task.due_at).toLocaleString() : "as soon as possible"}
                    </p>
                  </div>
                  {task.status !== "completed" ? (
                    <button
                      type="button"
                      onClick={() => onCompleteTask?.(task.id)}
                      disabled={taskCompletingId === task.id}
                      className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                    >
                      {taskCompletingId === task.id ? "Completing..." : "Complete"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No open tasks for this lead.
            </div>
          )}
        </div>
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
              {timeline.length} recorded touchpoints
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
          {timeline.length ? (
            timeline.map((event) => (
              <li key={`${lead.id}-${event.id}`} className="flex gap-4">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-ice-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{renderTimelineHeadline(event)}</p>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{event.timestampLabel}</p>
                  </div>
                  {event.userName ? (
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">User: {event.userName}</p>
                  ) : null}

                  {event.type === "sms" ? (
                    <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                        {event.payload.direction === "outbound" ? "Sent SMS" : "Received SMS"}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{event.payload.body_text || "No message body."}</p>
                    </div>
                  ) : null}

                  {event.type === "call" ? (
                    <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                          {event.payload.direction === "outbound" ? "Outbound" : "Inbound"}
                        </span>
                        <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                          {event.payload.duration_seconds || 0}s
                        </span>
                        <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                          {event.payload.result || "Synced"}
                        </span>
                        <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                          Recording {event.payload.recording_available ? "Available" : "Unavailable"}
                        </span>
                      </div>

                      {event.payload.ai_insights ? (
                        <details className="mt-3 overflow-hidden rounded-2xl border border-amber-400/15 bg-amber-400/5">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white">
                            AI insights
                            <ChevronDown className="h-4 w-4 text-amber-300" />
                          </summary>
                          <div className="grid gap-3 border-t border-white/10 px-4 py-4 sm:grid-cols-2">
                            <InfoBlock label="Summary" value={event.payload.ai_insights.summary} />
                            <InfoBlock label="Intent" value={event.payload.ai_insights.intent} />
                            <InfoBlock label="Objections" value={event.payload.ai_insights.objections} />
                            <InfoBlock label="Next action" value={event.payload.ai_insights.next_action} />
                            <InfoBlock
                              label="Confidence"
                              value={
                                event.payload.ai_insights.confidence == null
                                  ? "Not available"
                                  : `${Math.round(event.payload.ai_insights.confidence * 100)}%`
                              }
                            />
                            <InfoBlock label="Reasoning" value={event.payload.ai_insights.reasoning_summary} />
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : null}

                  {event.type === "status_change" ? (
                    <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                          {pipelineLabel(event.payload.previous_status || "new")}
                          {" -> "}
                          {pipelineLabel(event.payload.new_status || "new")}
                        </span>
                        <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                          Source: {String(event.payload.source || "manual").replace(/_/g, " ")}
                        </span>
                        {event.payload.confidence != null ? (
                          <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-200">
                            Confidence {Math.round(event.payload.confidence * 100)}%
                          </span>
                        ) : null}
                      </div>
                      {event.payload.reasoning_summary ? (
                        <p className="mt-3 text-sm leading-6 text-slate-300">{event.payload.reasoning_summary}</p>
                      ) : null}
                    </div>
                  ) : null}
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
          onClick={async () => {
            try {
              await onLogCall?.();
              setActionNotice("Call logged. If this device supports phone links, your dialer should open now.");
              if (lead.phone && typeof window !== "undefined") {
                window.location.href = `tel:${lead.phone}`;
              }
            } catch (_error) {
              // The parent surfaces API errors, so we only avoid clearing the current UI state here.
            }
          }}
          disabled={!lead.phone || callLogging}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
            lead.phone
              ? "bg-white text-ink-950 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70"
              : "cursor-not-allowed bg-white/10 text-slate-500"
          }`}
        >
          <PhoneCall className="h-4 w-4" />
          {callLogging ? "Starting..." : "Call Lead"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSmsComposerOpen(true);
            setActionNotice("SMS composer ready.");
          }}
          disabled={!lead.phone}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <MessageSquareText className="h-4 w-4" />
          Compose SMS
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await onHoldVehicle?.();
              setActionNotice("Hold request task created for this lead.");
            } catch (_error) {
              // The parent surfaces API errors, so we only avoid clearing the current UI state here.
            }
          }}
          disabled={holdSubmitting}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <CarFront className="h-4 w-4" />
          {holdSubmitting ? "Creating..." : "Hold Vehicle"}
        </button>
      </div>

      {actionNotice ? (
        <div className="mt-4 rounded-2xl border border-ice-400/25 bg-ice-400/10 px-4 py-3 text-sm text-ice-100">
          {actionNotice}
        </div>
      ) : null}

      {smsComposerOpen ? (
        <div className="mt-4 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Send className="h-4 w-4 text-ice-300" />
            Compose SMS
          </div>
          <textarea
            ref={smsComposerRef}
            value={smsDraft}
            onChange={(event) => setSmsDraft(event.target.value)}
            rows={4}
            placeholder="Write a quick follow-up..."
            className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
              Sending to {lead.phone || "No phone number"}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSmsComposerOpen(false);
                  setSmsDraft("");
                  setActionNotice("");
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const trimmed = smsDraft.trim();
                  if (!trimmed) {
                    return;
                  }
                  try {
                    await onSendSms?.(trimmed);
                    setSmsDraft("");
                    setSmsComposerOpen(false);
                    setActionNotice("SMS sent through RingCentral.");
                  } catch (_error) {
                    // The parent surfaces API errors.
                  }
                }}
                disabled={smsSending || !smsDraft.trim()}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {smsSending ? "Sending..." : "Send message"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
