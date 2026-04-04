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
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Leads", icon: ClipboardList },
  { label: "Pipeline", icon: KanbanSquare },
  { label: "Assignments", icon: Shuffle },
  { label: "Inventory", icon: CarFront },
  { label: "Team", icon: Users },
];

const utilitySections = [
  { label: "Conversations", icon: MessageSquareMore },
  { label: "Unmatched", icon: AlertCircle },
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

export function Sidebar({
  activeSection = "Dashboard",
  onSelectSection,
  onToggleExpanded,
  currentUser,
  toolCounts = {},
  collapsed = false,
}) {
  const visibleSections = primarySections.filter((section) => {
    if (section.label === "Team" || section.label === "Assignments") {
      return currentUser?.role === "admin" || currentUser?.role === "manager";
    }

    return true;
  });

  const currentWorkspace =
    activeSection === "Conversations" || activeSection === "Unmatched" ? "Lead tools" : activeSection;
  const userInitials = getInitials(currentUser?.name);

  function renderExpandedPanel(panelClassName = "") {
    return (
      <div
        className={`crm-sidebar relative overflow-hidden rounded-[2rem] bg-ink-950/88 p-5 backdrop-blur xl:min-h-[calc(100vh-2rem)] ${panelClassName}`}
      >
        <div className="pointer-events-none absolute inset-x-4 top-0 h-40 rounded-b-[3rem] bg-gradient-to-b from-cyan-400/10 via-white/[0.03] to-transparent" />

        <div className="crm-sidebar-brand relative px-1 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500 to-ice-500 text-sm font-bold text-white">
              AC
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-white">Ali CRM</p>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Sales Command</p>
            </div>
          </div>
          <div className="crm-sidebar-workspace mt-4 inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Workspace</span>
            <span className="font-medium text-white">{currentWorkspace}</span>
          </div>
        </div>

        <div className="relative mt-6">
          <p className="px-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">Primary workspace</p>
        </div>
        <nav className="relative mt-3 space-y-2">
          {visibleSections.map(({ label, icon: Icon }) => {
            const active = label === activeSection;

            return (
              <button
                key={label}
                type="button"
                onClick={() => onSelectSection?.(label)}
                className={`crm-sidebar-nav-item flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                  active
                    ? "bg-white text-ink-950"
                    : "border border-transparent text-slate-300 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{label}</span>
                </span>
                {active ? <span className="h-2.5 w-2.5 rounded-full bg-ember-500" /> : null}
              </button>
            );
          })}
        </nav>

        <div className="relative mt-8">
          <p className="px-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">Desk tools</p>
        </div>
        <div className="relative mt-3 grid gap-2">
          {utilitySections.map(({ label, icon: Icon }) => {
            const active = label === activeSection;
            const count = Number(toolCounts?.[label] || 0);

            return (
              <button
                key={label}
                type="button"
                onClick={() => onSelectSection?.(label)}
                className={`crm-sidebar-tool-item flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                  active
                    ? "border-cyan-400/20 bg-cyan-400/[0.08] text-white"
                    : "border-white/[0.06] bg-white/[0.025] text-slate-300 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{label}</span>
                </span>
                <span className="rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {currentUser?.role === "sales" ? (
          <div className="crm-sidebar-routing relative mt-8 rounded-[1.5rem] bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">New contact routing</p>
            <p className="mt-2 text-sm font-semibold text-white">
              {currentUser?.is_available ? "Available for new contacts" : "Paused for new contacts"}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Existing contacts still stay with you even while routing is paused.
            </p>
            <button
              type="button"
              onClick={() => currentUser?.onToggleAvailability?.(!currentUser?.is_available)}
              disabled={currentUser?.availabilityUpdating}
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-wait disabled:opacity-60"
            >
              {currentUser?.availabilityUpdating
                ? "Saving..."
                : currentUser?.is_available
                  ? "Pause new assignments"
                  : "Resume new assignments"}
            </button>
          </div>
        ) : null}

        <div className="crm-sidebar-footer relative mt-8 flex items-center gap-3 pt-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] font-semibold text-white">
            {userInitials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{currentUser?.name || "Ali Ibrahim"}</p>
            <p className="truncate text-xs uppercase tracking-[0.24em] text-slate-400">
              {currentUser?.role || "General manager"}
            </p>
          </div>
          <Settings className="h-4 w-4 text-slate-400" />
        </div>
      </div>
    );
  }

  if (!collapsed) {
    return renderExpandedPanel();
  }

  return (
    <aside className="relative">
      <div className="crm-sidebar relative flex min-h-[calc(100vh-2rem)] w-[84px] flex-col items-center rounded-[2rem] bg-ink-950/90 px-3 py-4 backdrop-blur">
        <button
          type="button"
          aria-label="Open main menu"
          title="Open main menu"
          onClick={() => onToggleExpanded?.()}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          <Menu className="h-4 w-4" />
        </button>

        <nav className="mt-5 flex w-full flex-col items-center gap-2">
          {visibleSections.map(({ label, icon: Icon }) => {
            const active = label === activeSection;

            return (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => onSelectSection?.(label)}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                  active
                    ? "bg-white text-ink-950 shadow-glow"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </nav>

        <div className="mt-4 flex w-full flex-col items-center gap-2">
          {utilitySections.map(({ label, icon: Icon }) => {
            const active = label === activeSection;

            return (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => onSelectSection?.(label)}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                  active
                    ? "bg-white text-ink-950 shadow-glow"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-sm font-semibold text-white">
          {userInitials}
        </div>
      </div>

    </aside>
  );
}
