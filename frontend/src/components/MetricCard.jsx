export function MetricCard({ eyebrow, value, detail, accent = "from-ice-500/30 to-transparent" }) {
  return (
    <article className="crm-metric-card relative overflow-hidden rounded-[1.6rem] border border-white/[0.06] bg-white/[0.025] p-5">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${accent} opacity-60`} />
      <p className="relative text-[11px] uppercase tracking-[0.28em] text-slate-500">{eyebrow}</p>
      <div className="relative mt-4 flex items-end gap-3">
        <p className="font-display text-3xl font-semibold text-white">{value}</p>
      </div>
      <p className="relative mt-2 text-sm leading-6 text-slate-400">{detail}</p>
    </article>
  );
}
