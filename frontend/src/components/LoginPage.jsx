import { ArrowRight, ShieldCheck } from "lucide-react";
import { useState } from "react";

export function LoginPage({ onSubmit, error = "", loading = false }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="min-h-screen bg-ink-950 bg-dashboard px-4 py-6 font-body text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1500px] gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-ink-900/80 p-8 shadow-card backdrop-blur sm:p-10">
          <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-ice-500/12 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-ember-500/10 blur-3xl" />

          <div className="relative">
            <p className="text-xs uppercase tracking-[0.34em] text-slate-500">Automotive CRM</p>
            <h1 className="mt-4 max-w-xl font-display text-5xl font-semibold leading-tight text-white">
              Close leads faster from a desk built for dealerships.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
              Track inbound shoppers, manage appointments, and move every opportunity from first touch to delivery with
              one live command center.
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                ["Live Pipeline", "Every lead stage in one dark command view."],
                ["Desk Visibility", "See calls, notes, and lead ownership instantly."],
                ["Fast Follow-Up", "Work hot shoppers before they cool off."],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5">
                  <p className="font-display text-xl font-semibold text-white">{title}</p>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[2.25rem] border border-white/10 bg-ink-900/90 p-8 shadow-card backdrop-blur sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-lime-400/20 bg-lime-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.26em] text-lime-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure access
          </div>

          <h2 className="mt-6 font-display text-3xl font-semibold text-white">Sign in to Ali CRM</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Managers and admins can review the full store pipeline. Sales users see only their assigned opportunities.
          </p>

          {error ? (
            <div className="mt-6 rounded-2xl border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-300">
              {error}
            </div>
          ) : null}

          <form
            className="mt-8 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit?.(email, password);
            }}
          >
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-ice-400/40 focus:bg-white/10"
                autoComplete="username"
                placeholder="you@dealership.com"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-ice-400/40 focus:bg-white/10"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-sm font-semibold text-ink-950 transition hover:bg-slate-100 ${
                loading ? "cursor-wait opacity-70" : ""
              }`}
            >
              {loading ? "Signing in..." : "Enter dashboard"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
