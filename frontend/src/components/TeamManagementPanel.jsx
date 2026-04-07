import { useState } from "react";
import { Trash2, UserPlus, X } from "lucide-react";

const roles = ["admin", "manager", "sales"];
const dayOptions = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

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
  onUpdateWorkingDays,
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
  const [selectedScheduleUser, setSelectedScheduleUser] = useState(null);
  const canManageRoster = currentUser?.role === "admin";
  const canManageAutomation = currentUser?.role === "admin" || currentUser?.role === "manager";
  const canManageRouting = currentUser?.role === "admin" || currentUser?.role === "manager";

  return (
    <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="crm-panel-card">
        <div className="flex items-center gap-3">
          <div className="crm-icon-pill">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <p className="crm-header-eyebrow">
              {canManageRoster ? "Admin controls" : "Availability rules"}
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-white">
              {canManageRoster ? "Add team member" : "Assignment routing"}
            </h2>
          </div>
        </div>

        {canManageRoster ? (
          <div className="crm-form-stack top-space">
            <label className="crm-inline-form">
              <span>Full name</span>
              <input
                value={form.name}
                onChange={(event) => onFormChange("name", event.target.value)}
                className="crm-text-input"
                placeholder="CRM Sales Rep"
              />
            </label>

            <label className="crm-inline-form">
              <span>Email</span>
              <input
                value={form.email}
                onChange={(event) => onFormChange("email", event.target.value)}
                className="crm-text-input"
                placeholder="rep@loolooauto.ca"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="crm-inline-form">
                <span>Password</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => onFormChange("password", event.target.value)}
                  className="crm-text-input"
                  placeholder="At least 6 characters"
                />
              </label>

              <label className="crm-inline-form">
                <span>Role</span>
                <select
                  value={form.role}
                  onChange={(event) => onFormChange("role", event.target.value)}
                  className="crm-select-input"
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
              className="crm-primary-block-button light"
            >
              <UserPlus className="h-4 w-4" />
              {submitting ? "Creating..." : "Add user"}
            </button>
          </div>
        ) : (
          <>
            <div className="crm-list-item static top-space">
              Managers can review who is available for fresh contact routing here. Sales reps can also pause their own
              routing from the sidebar without losing ownership of existing contacts.
            </div>

            {canManageAutomation ? (
              <div className="crm-panel-subsection">
                <div className="crm-panel-header">
                  <div>
                    <h3>AI texting controls</h3>
                    <p>Automation settings for SMS suggestions and first-response auto texts.</p>
                  </div>
                </div>

                {executionSettingsLoading ? (
                  <div className="crm-loading-state compact">Loading automation settings...</div>
                ) : (
                  <div className="crm-form-stack">
                    <label className="crm-toggle-row">
                      <span>
                        <span className="crm-row-primary">AI SMS suggestions</span>
                        <span className="crm-list-item-meta">Allow reps to generate AI draft replies in the lead modal.</span>
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
                      />
                    </label>

                    <label className="crm-toggle-row">
                      <span>
                        <span className="crm-row-primary">Automatic first follow-up texts</span>
                        <span className="crm-list-item-meta">Send one automatic first-response SMS to clean fresh leads.</span>
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
                      />
                    </label>

                    <label className="crm-inline-form">
                      <span>Delay before first auto-text</span>
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
                          className="crm-text-input w-32"
                        />
                        <button
                          type="button"
                          onClick={() => onRunAutoSms?.()}
                          disabled={autoSmsRunning || executionSettingsSaving}
                          className="crm-table-button"
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

      <div className="crm-panel-card">
        <div className="crm-panel-header">
          <div>
            <h3>Users</h3>
            <p>Roster, role, routing availability, and day-off scheduling.</p>
          </div>
          <span className="crm-chip">
            {users.length} active
          </span>
        </div>

        <div className="crm-list-stack">
          {loading ? (
            <div className="crm-loading-state">Loading team roster...</div>
          ) : (
            users.map((user) => {
              const isSelf = Number(currentUser?.id) === Number(user.id);

              return (
                <div key={user.id} className="crm-list-item static">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="crm-row-primary">{user.name}</p>
                    <p className="crm-list-item-meta">{user.email}</p>
                    <div className="crm-row-actions top-space">
                      <span className="crm-chip">
                        {formatRole(user.role)}
                      </span>
                      {user.role === "sales" ? (
                        <span
                          className={`crm-chip ${user.is_available ? "green" : "amber"}`}
                        >
                          {user.is_available ? "Available" : "Paused"}
                        </span>
                      ) : null}
                      {isSelf ? (
                        <span className="crm-chip blue">
                          Current session
                        </span>
                      ) : null}
                    </div>
                    {user.role === "sales" && canManageRouting ? (
                      <div className="crm-row-actions top-space">
                        <span className="crm-list-item-meta">
                          Routing days: {(user.working_days || []).map((day) => day.slice(0, 3)).join(", ") || "None"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedScheduleUser(user)}
                          className="crm-table-button"
                        >
                          Edit days off
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {user.role === "sales" ? (
                      <button
                        type="button"
                        onClick={() => onToggleAvailability?.(user, !user.is_available)}
                        disabled={availabilityUpdatingId === user.id}
                        className="crm-table-button"
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
                        className="crm-table-button"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingUserId === user.id ? "Deleting..." : "Delete"}
                      </button>
                    ) : null}
                  </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedScheduleUser ? (
        <div className="crm-modal-overlay">
          <div
            className="absolute inset-0"
            onClick={() => setSelectedScheduleUser(null)}
          />
          <div className="crm-modal-card narrow">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="crm-header-eyebrow">Routing schedule</p>
                <h3 className="mt-1 font-display text-2xl font-semibold text-white">{selectedScheduleUser.name}</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Pick the days this rep should receive new leads. Leave a day off to keep routing away from them.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedScheduleUser(null)}
                className="crm-icon-button inline-flex h-10 w-10 items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {dayOptions.map((day) => {
                const active = (selectedScheduleUser.working_days || []).includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => {
                      const currentDays = Array.isArray(selectedScheduleUser.working_days)
                        ? selectedScheduleUser.working_days
                        : [];
                      const nextDays = active
                        ? currentDays.filter((entry) => entry !== day.value)
                        : [...currentDays, day.value];
                      setSelectedScheduleUser((current) => ({
                        ...current,
                        working_days: nextDays,
                      }));
                      onUpdateWorkingDays?.(selectedScheduleUser, nextDays);
                    }}
                    disabled={availabilityUpdatingId === selectedScheduleUser.id}
                    className={`crm-chip-button ${active ? "active" : ""} disabled:cursor-wait disabled:opacity-60`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>

            <div className="crm-list-item static top-space">
              {availabilityUpdatingId === selectedScheduleUser.id
                ? "Saving routing days..."
                : `Active routing days: ${(selectedScheduleUser.working_days || []).map((day) => day.slice(0, 3)).join(", ") || "None"}`}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
