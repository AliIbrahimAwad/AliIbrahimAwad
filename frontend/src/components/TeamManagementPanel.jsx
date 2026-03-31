import { Trash2, UserPlus } from "lucide-react";

const roles = ["admin", "manager", "sales"];

function formatRole(role) {
  return String(role || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function TeamManagementPanel({
  users,
  currentUser,
  form,
  onFormChange,
  onSubmit,
  onDelete,
  onToggleAvailability,
  executionSettings,
  executionSettingsLoading = false,
  executionSettingsSaving = false,
  autoSmsRunning = false,
  onSaveExecutionSettings,
  onRunAutoSms,
  loading = false,
  submitting = false,
  deletingUserId = null,
  availabilityUpdatingId = null,
}) {
  const canManageRoster = currentUser?.role === "admin";
  const canManageAutomation = currentUser?.role === "admin" || currentUser?.role === "manager";

  return (
    <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/10 p-3 text-white">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
              {canManageRoster ? "Admin controls" : "Availability rules"}
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-white">
              {canManageRoster ? "Add team member" : "Assignment routing"}
            </h2>
          </div>
        </div>

        {canManageRoster ? (
          <div className="mt-6 grid gap-4">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Full name</span>
              <input
                value={form.name}
                onChange={(event) => onFormChange("name", event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                placeholder="CRM Sales Rep"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Email</span>
              <input
                value={form.email}
                onChange={(event) => onFormChange("email", event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                placeholder="rep@loolooauto.ca"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Password</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => onFormChange("password", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                  placeholder="At least 6 characters"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Role</span>
                <select
                  value={form.role}
                  onChange={(event) => onFormChange("role", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                >
                  {roles.map((role) => (
                    <option key={role} value={role} className="bg-ink-900">
                      {formatRole(role)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70"
            >
              <UserPlus className="h-4 w-4" />
              {submitting ? "Creating..." : "Add user"}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-slate-300">
              Managers can review who is available for fresh contact routing here. Sales reps can also pause their own
              routing from the sidebar without losing ownership of existing contacts.
            </div>

            {canManageAutomation ? (
              <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Texting automation</p>
                  <h3 className="mt-1 font-display text-xl font-semibold text-white">AI texting controls</h3>
                </div>

                {executionSettingsLoading ? (
                  <div className="mt-4 h-36 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
                ) : (
                  <div className="mt-4 grid gap-4">
                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <span>
                        <span className="block text-sm font-semibold text-white">AI SMS suggestions</span>
                        <span className="block text-xs text-slate-400">Allow reps to generate AI draft replies in the lead modal.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(Number(executionSettings?.ai_sms_enabled || 0))}
                        onChange={(event) =>
                          onSaveExecutionSettings?.({
                            ...executionSettings,
                            ai_sms_enabled: event.target.checked ? 1 : 0,
                          })
                        }
                        disabled={executionSettingsSaving}
                        className="h-5 w-5 rounded border-white/10 bg-white/5"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <span>
                        <span className="block text-sm font-semibold text-white">Automatic first follow-up texts</span>
                        <span className="block text-xs text-slate-400">Send one automatic first-response SMS to clean fresh leads.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(Number(executionSettings?.auto_sms_enabled || 0))}
                        onChange={(event) =>
                          onSaveExecutionSettings?.({
                            ...executionSettings,
                            auto_sms_enabled: event.target.checked ? 1 : 0,
                          })
                        }
                        disabled={executionSettingsSaving}
                        className="h-5 w-5 rounded border-white/10 bg-white/5"
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Delay before first auto-text</span>
                      <div className="flex gap-3">
                        <input
                          type="number"
                          min="1"
                          value={executionSettings?.auto_sms_delay_minutes ?? 10}
                          onChange={(event) =>
                            onSaveExecutionSettings?.({
                              ...executionSettings,
                              auto_sms_delay_minutes: Number(event.target.value) || 10,
                            })
                          }
                          disabled={executionSettingsSaving}
                          className="w-32 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => onRunAutoSms?.()}
                          disabled={autoSmsRunning || executionSettingsSaving}
                          className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                        >
                          {autoSmsRunning ? "Running..." : "Run auto-texts now"}
                        </button>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Team roster</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-white">Users</h2>
          </div>
          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300">
            {users.length} active
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          {loading ? (
            <div className="h-48 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
          ) : (
            users.map((user) => {
              const isSelf = Number(currentUser?.id) === Number(user.id);

              return (
                <div
                  key={user.id}
                  className="flex flex-col gap-3 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-display text-lg font-semibold text-white">{user.name}</p>
                    <p className="mt-1 text-sm text-slate-300">{user.email}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                        {formatRole(user.role)}
                      </span>
                      {user.role === "sales" ? (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            user.is_available
                              ? "bg-lime-500/15 text-lime-300"
                              : "bg-ember-500/15 text-ember-300"
                          }`}
                        >
                          {user.is_available ? "Available" : "Paused"}
                        </span>
                      ) : null}
                      {isSelf ? (
                        <span className="rounded-full bg-ice-500/15 px-3 py-1 text-xs font-semibold text-ice-300">
                          Current session
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {user.role === "sales" ? (
                      <button
                        type="button"
                        onClick={() => onToggleAvailability?.(user, !user.is_available)}
                        disabled={availabilityUpdatingId === user.id}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                      >
                        {availabilityUpdatingId === user.id
                          ? "Saving..."
                          : user.is_available
                            ? "Pause routing"
                            : "Resume routing"}
                      </button>
                    ) : null}

                    {canManageRoster ? (
                      <button
                        type="button"
                        onClick={() => onDelete(user)}
                        disabled={isSelf || deletingUserId === user.id}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingUserId === user.id ? "Deleting..." : "Delete"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
