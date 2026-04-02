export function MetricCard({ eyebrow, value, detail, accent = "from-ice-500/30 to-transparent" }) {
  return (
    <article className="crm-metric-card relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-glow">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${accent}`} />
      <p className="relative text-xs uppercase tracking-[0.3em] text-slate-400">{eyebrow}</p>
      <p className="relative mt-4 font-display text-3xl font-semibold text-white">{value}</p>
      <p className="relative mt-2 text-sm text-slate-300">{detail}</p>
    </article>
  );
}
