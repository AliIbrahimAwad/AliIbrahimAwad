import {
  AlertCircle,
  CarFront,
  ClipboardList,
  KanbanSquare,
  LayoutDashboard,
  MessageSquareMore,
  Shuffle,
  Settings,
  Users
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

export function Sidebar({ activeSection = "Dashboard", onSelectSection, currentUser, toolCounts = {} }) {
  const visibleSections = primarySections.filter((section) => {
    if (section.label === "Team" || section.label === "Assignments") {
      return currentUser?.role === "admin" || currentUser?.role === "manager";
    }

    return true;
  });

  return (
    <aside className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-ink-950/90 p-5 shadow-card backdrop-blur xl:min-h-[calc(100vh-3rem)]">
      <div className="pointer-events-none absolute inset-x-4 top-0 h-48 rounded-b-[3rem] bg-gradient-to-b from-cyan-400/10 via-white/5 to-transparent" />

      <div className="relative rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500 to-ice-500 text-sm font-bold text-white shadow-glow">
            AC
          </div>
          <div>
            <p className="font-display text-lg font-semibold text-white">Ali CRM</p>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Sales Command</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">Current workspace</p>
          <p className="mt-1 text-sm font-medium text-white">
            {activeSection === "Conversations" || activeSection === "Unmatched" ? "Lead tools" : activeSection}
          </p>
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
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
              active
                ? "bg-white text-ink-950 shadow-glow"
                : "border border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
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
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                active
                  ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white"
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
        <div className="relative mt-8 rounded-[1.75rem] border border-white/10 bg-white/5 p-4">
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
            className="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
          >
            {currentUser?.availabilityUpdating
              ? "Saving..."
              : currentUser?.is_available
                ? "Pause new assignments"
                : "Resume new assignments"}
          </button>
        </div>
      ) : null}

      <div className="relative mt-8 flex items-center gap-3 border-t border-white/10 pt-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 font-semibold text-white">
          AI
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{currentUser?.name || "Ali Ibrahim"}</p>
          <p className="truncate text-xs uppercase tracking-[0.24em] text-slate-400">
            {currentUser?.role || "General manager"}
          </p>
        </div>
        <Settings className="h-4 w-4 text-slate-400" />
      </div>
    </aside>
  );
}
