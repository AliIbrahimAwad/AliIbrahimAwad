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
  loading = false,
  submitting = false,
  deletingUserId = null,
}) {
  return (
    <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/10 p-3 text-white">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Admin controls</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-white">Add team member</h2>
          </div>
        </div>

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
                      {isSelf ? (
                        <span className="rounded-full bg-ice-500/15 px-3 py-1 text-xs font-semibold text-ice-300">
                          Current session
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDelete(user)}
                    disabled={isSelf || deletingUserId === user.id}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                    {deletingUserId === user.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
