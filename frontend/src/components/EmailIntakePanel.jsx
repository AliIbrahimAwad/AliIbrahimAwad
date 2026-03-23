import { useMemo, useState } from "react";

function formatReceivedAt(value) {
  if (!value) {
    return "Just now";
  }

  return new Date(value).toLocaleString();
}

function IntakeTab({ label, count, active, onClick }) {
  const emphasized = count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
        active
          ? "border-white/20 bg-white text-ink-950"
          : emphasized
            ? "border-ice-400/25 bg-ice-400/10 text-white hover:bg-ice-400/15"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]"
      }`}
    >
      <span>{label}</span>
      {count > 0 ? (
        <span
          className={`rounded-full px-2.5 py-1 text-xs ${
            active ? "bg-ink-950/10 text-ink-950" : "bg-white/10 text-white"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function IntakeField({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-white">{value || "Not captured"}</p>
    </div>
  );
}

export function EmailIntakePanel({
  items = [],
  loading = false,
  activeTab = "direct_lead",
  summary = { direct_leads_pending: 0, others_pending: 0 },
  assignees = [],
  assigneesLoading = false,
  assigningId = null,
  resolvingId = null,
  convertingId = null,
  onSelectTab,
  onAssign,
  onResolve,
  onConvert,
}) {
  const [draftAssignments, setDraftAssignments] = useState({});

  const filteredItems = useMemo(
    () => items.filter((item) => item.classification === activeTab),
    [items, activeTab]
  );

  function getDraftAssignment(item) {
    return draftAssignments[item.id] ?? (item.assigned_to ? String(item.assigned_to) : "");
  }

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Automated email intake</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Manager triage</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            New mailbox traffic lands here automatically, gets classified, and waits for assignment or resolution.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <IntakeTab
            label="Direct Leads"
            count={summary.direct_leads_pending || 0}
            active={activeTab === "direct_lead"}
            onClick={() => onSelectTab?.("direct_lead")}
          />
          <IntakeTab
            label="Others"
            count={summary.others_pending || 0}
            active={activeTab === "other"}
            onClick={() => onSelectTab?.("other")}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-56 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
          ))
        ) : filteredItems.length ? (
          filteredItems.map((item) => {
            const assignmentValue = getDraftAssignment(item);
            const messageLabel = activeTab === "direct_lead" ? "Customer message" : "Inquiry body";

            return (
              <article key={item.id} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                      {item.source} | received {formatReceivedAt(item.received_at)}
                    </p>
                    <h3 className="mt-2 font-display text-xl font-semibold text-white">
                      {item.customer_name || item.subject || "Unlabeled inbox item"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-300">{item.subject || "No subject line captured."}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${
                      activeTab === "direct_lead"
                        ? "bg-ice-400/15 text-ice-100"
                        : "bg-white/8 text-slate-200"
                    }`}
                  >
                    {item.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <IntakeField label="Full name" value={item.customer_name} />
                  <IntakeField label="Phone" value={item.phone} />
                  <IntakeField label="Email" value={item.email} />
                  <IntakeField label="Stock number" value={item.stock_number} />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <IntakeField label="Vehicle" value={item.vehicle_display} />
                  <IntakeField label={messageLabel} value={item.message} />
                </div>

                {activeTab === "direct_lead" ? (
                  <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end">
                    <label className="grid flex-1 gap-2">
                      <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Assign to rep</span>
                      <select
                        value={assignmentValue}
                        onChange={(event) =>
                          setDraftAssignments((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        disabled={assigneesLoading || assigningId === item.id}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:opacity-60"
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
                      onClick={() => onAssign?.(item, Number(assignmentValue))}
                      disabled={!assignmentValue || assigningId === item.id}
                      className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {assigningId === item.id ? "Assigning..." : "Assign lead"}
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <label className="grid gap-2 lg:min-w-[260px]">
                      <span className="text-xs uppercase tracking-[0.22em] text-slate-500">
                        Convert and optionally assign
                      </span>
                      <select
                        value={assignmentValue}
                        onChange={(event) =>
                          setDraftAssignments((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        disabled={assigneesLoading || convertingId === item.id}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:opacity-60"
                      >
                        <option value="" className="bg-ink-900">
                          Leave unassigned
                        </option>
                        {assignees.map((user) => (
                          <option key={user.id} value={user.id} className="bg-ink-900">
                            {user.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => onResolve?.(item)}
                        disabled={resolvingId === item.id}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
                      >
                        {resolvingId === item.id ? "Resolving..." : "Resolve"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onConvert?.(item, {
                            assigned_to: assignmentValue ? Number(assignmentValue) : null,
                          })
                        }
                        disabled={convertingId === item.id}
                        className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        {convertingId === item.id ? "Converting..." : "Convert to lead"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
            No intake items are waiting in this tab right now.
          </div>
        )}
      </div>
    </section>
  );
}
