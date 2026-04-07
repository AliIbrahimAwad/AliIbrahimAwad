import {
  AlertCircle,
  CarFront,
  ClipboardList,
  KanbanSquare,
  LayoutDashboard,
  Menu,
  MessageSquareMore,
  Settings,
  Shuffle,
  Users,
} from "lucide-react";

const primarySections = [
  { label: "Dashboard", display: "Dashboard", icon: LayoutDashboard },
  { label: "Leads", display: "Leads", icon: ClipboardList },
  { label: "Pipeline", display: "Pipeline", icon: KanbanSquare },
  { label: "Assignments", display: "Assignments", icon: Shuffle, managerOnly: true },
  { label: "Inventory", display: "Inventory Match", icon: CarFront },
  { label: "Team", display: "Team", icon: Users, managerOnly: true },
];

const utilitySections = [
  { label: "Conversations", display: "Calls & SMS", icon: MessageSquareMore },
  { label: "Unmatched", display: "Unknown Inbox", icon: AlertCircle },
];

function getInitials(name = "") {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "AI";
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function renderBadge(count) {
  if (!Number.isFinite(Number(count)) || Number(count) <= 0) {
    return null;
  }

  return <span className="crm-sidebar-badge">{count}</span>;
}

export function Sidebar({
  activeSection = "Dashboard",
  onSelectSection,
  onToggleExpanded,
  currentUser,
  toolCounts = {},
  collapsed = false,
}) {
  const isManagerView = currentUser?.role === "admin" || currentUser?.role === "manager";
  const visiblePrimary = primarySections.filter((section) => !section.managerOnly || isManagerView);
  const userInitials = getInitials(currentUser?.name);
  const roleLabel = isManagerView ? "Manager / Admin View" : "Sales Rep View";
  const currentWorkspace =
    primarySections.find((section) => section.label === activeSection)?.display ||
    utilitySections.find((section) => section.label === activeSection)?.display ||
    activeSection;
  const routingOpen = currentUser?.role === "sales" ? Boolean(currentUser?.is_available) : true;

  function renderExpanded() {
    return (
      <div className="crm-sidebar">
        <div className="crm-sidebar-brand">
          <div className="crm-brand-mark">LA</div>
          <div>
            <p className="crm-brand-title">Looloo CRM</p>
            <p className="crm-brand-subtitle">{roleLabel}</p>
          </div>
        </div>

        <div className="crm-sidebar-group">
          <p className="crm-sidebar-group-title">Workspace</p>
          <nav className="crm-sidebar-nav">
            {visiblePrimary.map(({ label, display, icon: Icon }) => {
              const active = label === activeSection;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onSelectSection?.(label)}
                  className={`crm-sidebar-nav-item ${active ? "active" : ""}`}
                >
                  <span className="crm-sidebar-nav-label">
                    <Icon className="h-4 w-4" />
                    <span>{display}</span>
                  </span>
                  {renderBadge(toolCounts?.[label])}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="crm-sidebar-group">
          <p className="crm-sidebar-group-title">Desk tools</p>
          <nav className="crm-sidebar-nav">
            {utilitySections.map(({ label, display, icon: Icon }) => {
              const active = label === activeSection;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onSelectSection?.(label)}
                  className={`crm-sidebar-nav-item utility ${active ? "active" : ""}`}
                >
                  <span className="crm-sidebar-nav-label">
                    <Icon className="h-4 w-4" />
                    <span>{display}</span>
                  </span>
                  {renderBadge(toolCounts?.[label])}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="crm-sidebar-footer-card">
          <div className="crm-sidebar-footer-copy">
            <p className="crm-sidebar-group-title">Routing status</p>
            <p className="crm-sidebar-footer-title">
              {currentUser?.role === "sales"
                ? routingOpen
                  ? "My queue is live"
                  : "Routing paused"
                : "Round robin active"}
            </p>
            <p className="crm-sidebar-footer-meta">{currentWorkspace}</p>
          </div>
          <span className={`crm-sidebar-status ${routingOpen ? "open" : "paused"}`}>
            {routingOpen ? "Open" : "Paused"}
          </span>
        </div>

        <div className="crm-sidebar-user">
          <div className="crm-sidebar-user-avatar">{userInitials}</div>
          <div className="crm-sidebar-user-copy">
            <p className="crm-sidebar-user-name">{currentUser?.name || "Ali Ibrahim"}</p>
            <p className="crm-sidebar-user-role">{currentUser?.role || "manager"}</p>
          </div>
          <Settings className="h-4 w-4 text-slate-500" />
        </div>
      </div>
    );
  }

  if (!collapsed) {
    return renderExpanded();
  }

  return (
    <aside className="crm-sidebar-compact">
      <button
        type="button"
        aria-label="Open main menu"
        title="Open main menu"
        onClick={() => onToggleExpanded?.()}
        className="crm-sidebar-compact-toggle"
      >
        <Menu className="h-4 w-4" />
      </button>

      <nav className="crm-sidebar-compact-nav">
        {visiblePrimary.map(({ label, display, icon: Icon }) => {
          const active = label === activeSection;
          return (
            <button
              key={label}
              type="button"
              aria-label={display}
              title={display}
              onClick={() => onSelectSection?.(label)}
              className={`crm-sidebar-compact-item ${active ? "active" : ""}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </nav>

      <nav className="crm-sidebar-compact-nav secondary">
        {utilitySections.map(({ label, display, icon: Icon }) => {
          const active = label === activeSection;
          return (
            <button
              key={label}
              type="button"
              aria-label={display}
              title={display}
              onClick={() => onSelectSection?.(label)}
              className={`crm-sidebar-compact-item ${active ? "active" : ""}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </nav>

      <div className="crm-sidebar-compact-user">{userInitials}</div>
    </aside>
  );
}
