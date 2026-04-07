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
        className="crm-icon-button relative inline-flex h-11 w-11 items-center justify-center"
      >
        <Bell className="h-4 w-4" />
        {unreadCount ? (
          <span className="crm-notification-badge absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center px-1.5 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="crm-notification-panel absolute right-0 z-20 mt-3 w-[380px] p-4">
          <div className="crm-panel-header">
            <div>
              <h3>Notifications</h3>
              <p>Desk alerts, assignment changes, and follow-up signals.</p>
            </div>
            <span className="crm-chip">
              {unreadCount} unread
            </span>
          </div>

          <div className="crm-list-stack">
            {notifications.length ? (
              notifications.map((item) => (
                <div key={item.id} className="crm-notification-item">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="crm-row-primary">{item.title}</p>
                      <p className="crm-list-item-meta">{item.body}</p>
                      <p className="crm-list-item-meta">
                        {item.lead_name || "CRM notification"}
                      </p>
                    </div>
                    {item.status === "unread" ? (
                      <button
                        type="button"
                        onClick={() => onMarkRead?.(item.id)}
                        className="crm-table-button inline-flex h-9 w-9 shrink-0 items-center justify-center p-0"
                        title="Mark as read"
                      >
                        <CheckCheck className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="crm-empty-state compact">
                No in-app notifications right now.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
