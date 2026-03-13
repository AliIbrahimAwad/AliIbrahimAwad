import {
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
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Leads", icon: ClipboardList },
  { label: "Inventory", icon: CarFront },
  { label: "Conversations", icon: MessageSquareMore },
  { label: "Team", icon: Users },
  { label: "Analytics", icon: BarChart3 }
];

export function Sidebar() {
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
        {sections.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            type="button"
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
        ))}
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

      <div className="relative mt-8 flex items-center gap-3 border-t border-white/10 pt-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 font-semibold text-white">
          AI
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Ali Ibrahim</p>
          <p className="truncate text-xs uppercase tracking-[0.24em] text-slate-400">General manager</p>
        </div>
        <Settings className="h-4 w-4 text-slate-400" />
      </div>
    </aside>
  );
}
