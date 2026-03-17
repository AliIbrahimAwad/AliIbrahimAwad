import { Bell, CheckCheck } from "lucide-react";

export function NotificationTray({
  notifications = [],
  open = false,
  unreadCount = 0,
  onToggle,
  onMarkRead,
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
      >
        <Bell className="h-4 w-4" />
        {unreadCount ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-ember-500 px-1.5 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-3 w-[360px] rounded-[1.5rem] border border-white/10 bg-ink-900/95 p-4 shadow-card backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Notifications</p>
              <h3 className="mt-1 font-display text-lg font-semibold text-white">What changed</h3>
            </div>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              {unreadCount} unread
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {notifications.length ? (
              notifications.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{item.body}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                        {item.lead_name || "CRM notification"}
                      </p>
                    </div>
                    {item.status === "unread" ? (
                      <button
                        type="button"
                        onClick={() => onMarkRead?.(item.id)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
                        title="Mark as read"
                      >
                        <CheckCheck className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-slate-400">
                No in-app notifications right now.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
