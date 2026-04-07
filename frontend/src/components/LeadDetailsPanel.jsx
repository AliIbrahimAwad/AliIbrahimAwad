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
    <div className="crm-detail-block">
      <p className="crm-focus-label">{label}</p>
      <p className="crm-row-primary top-space-tight">{value || "Not available"}</p>
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
  currentUserRole = "sales",
  loading = false,
  onStatusChange,
  statusUpdating = false,
  canAssign = false,
  assignees = [],
  assigneesLoading = false,
  assignmentUpdating = false,
  leadUpdating = false,
  onAssignLead,
  onUpdateLead,
  onCompleteTask,
  taskCompletingId = null,
  onSendSms,
  smsSending = false,
  onGenerateSmsSuggestion,
  smsSuggestionLoading = false,
  onLogCall,
  callLogging = false,
  onHoldVehicle,
  holdSubmitting = false,
}) {
  const [assignmentValue, setAssignmentValue] = useState("");
  const [smsDraft, setSmsDraft] = useState("");
  const [smsGoal, setSmsGoal] = useState("follow_up");
  const [smsSuggestionInfo, setSmsSuggestionInfo] = useState(null);
  const [smsComposerOpen, setSmsComposerOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [editingLead, setEditingLead] = useState(false);
  const [leadForm, setLeadForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    stockNumber: "",
    message: "",
  });
  const smsComposerRef = useRef(null);

  useEffect(() => {
    setAssignmentValue(lead?.assignedTo ? String(lead.assignedTo) : "");
  }, [lead?.assignedTo, lead?.id]);

  useEffect(() => {
    setSmsDraft("");
    setSmsGoal("follow_up");
    setSmsSuggestionInfo(null);
    setSmsComposerOpen(false);
    setActionNotice("");
    setEditingLead(false);
    setLeadForm({
      firstName: lead?.firstName || "",
      lastName: lead?.lastName || "",
      phone: lead?.rawPhone || "",
      email: lead?.email && lead.email !== "No email on file" ? lead.email : "",
      stockNumber: lead?.stockNumber || "",
      message: lead?.message && lead.message !== "No message captured yet." ? lead.message : "",
    });
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
      <aside className="crm-modal-card">
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
      <aside className="crm-modal-card">
        Select a lead to view the full customer story.
      </aside>
    );
  }

  const timeline = lead.timeline || [];
  const isSalesUser = currentUserRole === "sales";
  const canEditStatus = !isSalesUser;
  const hasCallablePhone = Boolean(lead.rawPhone);
  const vehicleLabel =
    [
      lead.inventory?.year || lead.vehicleYear,
      lead.inventory?.make || lead.vehicleMake,
      lead.inventory?.model || lead.vehicleModel,
      lead.inventory?.trim || lead.vehicleTrim,
    ]
      .filter(Boolean)
      .join(" ") || lead.vehicleInterest;

  return (
    <aside className="crm-modal-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="crm-header-eyebrow">{lead.sourceDetail || lead.source}</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">{lead.customerName}</h2>
          <p className="mt-1 text-sm text-slate-300">{vehicleLabel}</p>
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

      {canEditStatus ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {pipelineStatuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => onStatusChange?.(status)}
              disabled={statusUpdating || status === lead.status}
              className={`crm-chip-button ${status === lead.status ? "active" : ""} ${
                status === lead.status
                  ? ""
                  : ""
              } ${statusUpdating ? "cursor-wait opacity-70" : ""}`}
            >
              {pipelineLabel(status)}
            </button>
          ))}
        </div>
      ) : null}

      {canAssign ? (
        <div className="crm-panel-subsection">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="crm-inline-form flex-1">
              <span>Assign lead</span>
              <select
                value={assignmentValue}
                onChange={(event) => setAssignmentValue(event.target.value)}
                disabled={assigneesLoading || assignmentUpdating}
                className="crm-select-input disabled:cursor-wait disabled:opacity-70"
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
              className="crm-primary-block-button light"
            >
              {assignmentUpdating ? "Assigning..." : "Assign lead"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="crm-panel-subsection">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="crm-row-primary">Lead details</p>
            <p className="mt-1 text-xs text-slate-400">
              Fix missing info when the provider sends partial data. If both name fields are empty, the CRM stores
              <span className="font-semibold text-slate-200"> NN Lead</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditingLead((value) => !value)}
            className="crm-table-button"
          >
            {editingLead ? "Close" : "Edit details"}
          </button>
        </div>

        {editingLead ? (
          <div className="crm-form-stack top-space">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={leadForm.firstName}
                onChange={(event) => setLeadForm((current) => ({ ...current, firstName: event.target.value }))}
                placeholder="First name"
                className="crm-text-input"
              />
              <input
                value={leadForm.lastName}
                onChange={(event) => setLeadForm((current) => ({ ...current, lastName: event.target.value }))}
                placeholder="Last name"
                className="crm-text-input"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={leadForm.phone}
                onChange={(event) => setLeadForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="Phone number"
                className="crm-text-input"
              />
              <input
                value={leadForm.email}
                onChange={(event) => setLeadForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="Email"
                className="crm-text-input"
              />
            </div>
            <input
              value={leadForm.stockNumber}
              onChange={(event) => setLeadForm((current) => ({ ...current, stockNumber: event.target.value }))}
              placeholder="Stock number"
              className="crm-text-input"
            />
            <textarea
              value={leadForm.message}
              onChange={(event) => setLeadForm((current) => ({ ...current, message: event.target.value }))}
              placeholder="Customer message"
              rows={4}
              className="crm-text-area"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await onUpdateLead?.({
                      first_name: leadForm.firstName,
                      last_name: leadForm.lastName,
                      customer_name: [leadForm.firstName, leadForm.lastName].filter(Boolean).join(" "),
                      phone: leadForm.phone,
                      email: leadForm.email,
                      stock_number: leadForm.stockNumber,
                      message: leadForm.message,
                    });
                    setEditingLead(false);
                    setActionNotice("Lead details updated.");
                    setSmsSuggestionInfo(null);
                  } catch (_error) {
                    // The parent surfaces API errors, so we keep the form open here.
                  }
                }}
                disabled={leadUpdating}
                className="crm-primary-block-button light"
              >
                {leadUpdating ? "Saving..." : "Save details"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="crm-detail-grid">
        <InfoBlock label="Phone" value={lead.phone} />
        <InfoBlock label="Email" value={lead.email} />
        <InfoBlock label="Stock Number" value={lead.stockNumber} />
        <InfoBlock label="Vehicle" value={vehicleLabel} />
        <InfoBlock label="Year" value={lead.vehicleYear} />
        <InfoBlock label="Make" value={lead.vehicleMake} />
        <InfoBlock label="Model" value={lead.vehicleModel} />
        <InfoBlock label="Trim" value={lead.vehicleTrim} />
        <InfoBlock label="Price" value={lead.vehiclePrice} />
        {!isSalesUser ? <InfoBlock label="Assigned Rep" value={lead.assignedRep} /> : null}
        <InfoBlock label="Source" value={lead.sourceDetail || lead.source} />
      </div>

      <div className="crm-panel-subsection">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <CarFront className="h-4 w-4 text-ice-300" />
          Linked inventory
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {lead.inventory
            ? `${[lead.inventory.year, lead.inventory.make, lead.inventory.model, lead.inventory.trim]
                .filter(Boolean)
                .join(" ")}${lead.inventory.stockNumber ? ` | Stock ${lead.inventory.stockNumber}` : ""}${
                lead.inventory.vin ? ` | VIN ${lead.inventory.vin}` : ""
              }`
            : "No structured inventory unit linked yet. Inventory links automatically when the lead stock number or VIN matches a unit."}
        </p>
      </div>

      <div className="crm-panel-subsection accent">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4 text-ember-400" />
          Lead message
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-300">{lead.message || "No message captured yet."}</p>
      </div>

      {!isSalesUser ? (
        <div className="crm-panel-subsection">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <CheckCircle2 className="h-4 w-4 text-lime-400" />
            Tasks
        </div>
        <div className="mt-4 space-y-3">
          {lead.tasks?.length ? (
            lead.tasks.map((task) => (
              <div key={task.id} className="crm-list-item static">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{task.title}</p>
                      <span className="crm-chip">
                        {task.status}
                      </span>
                      <span className="crm-chip">
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
                      className="crm-table-button"
                    >
                      {taskCompletingId === task.id ? "Completing..." : "Complete"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="crm-empty-state compact">
              No open tasks for this lead.
            </div>
          )}
        </div>
        </div>
      ) : null}

      {!isSalesUser ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="crm-detail-block">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <CalendarDays className="h-4 w-4 text-ice-300" />
              Lead snapshot
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Captured {lead.createdAtLabel}. Last updated {lead.updatedAtLabel}. Source channel is{" "}
              {lead.source.toLowerCase()}.
            </p>
          </div>
          <div className="crm-detail-block">
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
      ) : null}

      {!isSalesUser ? (
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
      ) : null}

      <div className={`mt-6 grid gap-3 ${isSalesUser ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <button
          type="button"
          onClick={async () => {
            try {
              const attempt = await onLogCall?.();
              const deviceLabel = attempt?.from_number || "your configured RingCentral device";
              const customerLabel = attempt?.to_number || lead.phone;
              setActionNotice(
                `RingCentral is ringing ${deviceLabel} first. After you answer, it will connect ${customerLabel}.`
              );
            } catch (_error) {
              // The parent surfaces API errors, so we only avoid clearing the current UI state here.
            }
          }}
          disabled={!hasCallablePhone || callLogging}
          className={`crm-primary-block-button light ${!hasCallablePhone ? "disabled" : ""}`}
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
          disabled={!hasCallablePhone}
          className="crm-secondary-block-button"
        >
          <MessageSquareText className="h-4 w-4" />
          Compose SMS
        </button>
        {!isSalesUser ? (
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
            className="crm-secondary-block-button"
          >
            <CarFront className="h-4 w-4" />
            {holdSubmitting ? "Creating..." : "Hold Vehicle"}
          </button>
        ) : null}
      </div>

      {actionNotice ? (
        <div className="crm-info-banner">
          {actionNotice}
        </div>
      ) : null}

      {smsComposerOpen ? (
        <div className="crm-panel-subsection">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Send className="h-4 w-4 text-ice-300" />
              Compose SMS
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={smsGoal}
                onChange={(event) => setSmsGoal(event.target.value)}
                className="crm-select-input compact"
              >
                <option value="follow_up" className="bg-ink-900">
                  Follow-up
                </option>
                <option value="appointment" className="bg-ink-900">
                  Appointment
                </option>
                <option value="price_drop" className="bg-ink-900">
                  Price drop
                </option>
                <option value="missed_call" className="bg-ink-900">
                  Missed call
                </option>
              </select>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const suggestion = await onGenerateSmsSuggestion?.({ goal: smsGoal });
                    if (!suggestion?.message) {
                      return;
                    }
                    setSmsDraft(suggestion.message);
                    setSmsSuggestionInfo(suggestion);
                    setActionNotice(
                      suggestion.source === "openai"
                        ? `AI draft ready${suggestion.confidence ? ` (${Math.round(suggestion.confidence * 100)}% confidence)` : ""}.`
                        : "Suggested SMS draft ready."
                    );
                  } catch (_error) {
                    // The parent surfaces API errors.
                  }
                }}
                disabled={smsSuggestionLoading || !hasCallablePhone}
                className="crm-table-button amber"
              >
                <Sparkles className="h-4 w-4" />
                {smsSuggestionLoading ? "Generating..." : "AI Draft"}
              </button>
            </div>
          </div>
          <textarea
            ref={smsComposerRef}
            value={smsDraft}
            onChange={(event) => setSmsDraft(event.target.value)}
            rows={4}
            placeholder="Write a quick follow-up..."
            className="crm-text-area top-space"
          />
          {smsSuggestionInfo ? (
            <div className="crm-note-card amber">
              <p className="crm-row-primary">AI suggestion</p>
              <p className="mt-1 text-xs uppercase tracking-[0.22em] text-amber-200/80">
                {smsSuggestionInfo.source === "openai" ? "OpenAI draft" : "Template draft"} | Goal {smsSuggestionInfo.goal}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-200">{smsSuggestionInfo.reasoning}</p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
              Sending to {hasCallablePhone ? lead.phone : "No phone number"}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSmsComposerOpen(false);
                  setSmsDraft("");
                  setSmsSuggestionInfo(null);
                  setActionNotice("");
                }}
                className="crm-table-button"
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
                    setSmsSuggestionInfo(null);
                    setSmsComposerOpen(false);
                    setActionNotice("SMS sent through RingCentral.");
                  } catch (_error) {
                    // The parent surfaces API errors.
                  }
                }}
                disabled={smsSending || !smsDraft.trim()}
                className="crm-table-button primary"
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
