import {
  AlertCircle,
  BarChart3,
  BellRing,
  CarFront,
  ClipboardList,
  LayoutDashboard,
  MessageSquareMore,
  Settings,
  Users
} from "lucide-react";

const sections = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Intake", icon: BellRing },
  { label: "Leads", icon: ClipboardList },
  { label: "Unmatched", icon: AlertCircle },
  { label: "Inventory", icon: CarFront },
  { label: "Conversations", icon: MessageSquareMore },
  { label: "Team", icon: Users },
  { label: "Analytics", icon: BarChart3 }
];

export function Sidebar({ activeSection = "Dashboard", onSelectSection, currentUser }) {
  const visibleSections = sections.filter((section) => {
    if (section.label === "Team") {
      return currentUser?.role === "admin" || currentUser?.role === "manager";
    }

    if (section.label === "Intake") {
      return currentUser?.role === "admin" || currentUser?.role === "manager";
    }

    return true;
  });

  return (
    <aside className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900/85 p-5 shadow-card backdrop-blur xl:min-h-[calc(100vh-3rem)]">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-36 rounded-b-[3rem] bg-gradient-to-b from-ice-400/10 to-transparent" />

      <div className="relative flex items-center gap-3 border-b border-white/10 pb-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-500 to-ice-500 text-sm font-bold text-white shadow-glow">
          AC
        </div>
        <div>
          <p className="font-display text-lg font-semibold text-white">Ali CRM</p>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Performance Desk</p>
        </div>
      </div>

      <nav className="relative mt-6 space-y-2">
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
                : "text-slate-300 hover:bg-white/5 hover:text-white"
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

      <div className="relative mt-8 rounded-[1.75rem] border border-white/10 bg-white/5 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Live desk</p>
            <p className="mt-2 font-display text-xl font-semibold text-white">12 shoppers waiting</p>
          </div>
          <BellRing className="h-5 w-5 text-ember-400" />
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Two luxury leads and one truck trade-in need a manager touch in the next 15 minutes.
        </p>
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
