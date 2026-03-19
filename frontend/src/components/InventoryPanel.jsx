function formatInventoryTitle(item) {
  return [item.year, item.make, item.model, item.trim].filter(Boolean).join(" ") || item.stockNumber || "Inventory unit";
}

function formatPrice(value) {
  if (value == null || value === "") {
    return "Price not set";
  }

  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function InventoryPanel({
  items = [],
  loading = false,
  filters = {},
  onFilterChange,
  canImport = false,
  importSourceName = "",
  importMarkMissingInactive = false,
  importSubmitting = false,
  importRuns = [],
  onImportSourceNameChange,
  onImportMarkMissingInactiveChange,
  onImportFileSelected,
}) {
  return (
    <>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Structured inventory</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Inventory foundation</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Manual uploads create or update real inventory units so leads can link to a structured vehicle instead of raw text.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            value={filters.status || ""}
            onChange={(event) => onFilterChange?.("status", event.target.value)}
            placeholder="Status"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <input
            value={filters.make || ""}
            onChange={(event) => onFilterChange?.("make", event.target.value)}
            placeholder="Make"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <input
            value={filters.model || ""}
            onChange={(event) => onFilterChange?.("model", event.target.value)}
            placeholder="Model"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <input
            value={filters.stockNumber || ""}
            onChange={(event) => onFilterChange?.("stockNumber", event.target.value)}
            placeholder="Stock number"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <input
            value={filters.vin || ""}
            onChange={(event) => onFilterChange?.("vin", event.target.value)}
            placeholder="VIN"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>

      </div>

      {canImport ? (
        <div className="mt-4 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-3">
              <input
                value={importSourceName}
                onChange={(event) => onImportSourceNameChange?.(event.target.value)}
                placeholder="Source name (e.g. Dealer feed)"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={importMarkMissingInactive}
                  onChange={(event) => onImportMarkMissingInactiveChange?.(event.target.checked)}
                />
                Mark unseen active units from this source as inactive after import
              </label>
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-slate-100">
              {importSubmitting ? "Importing..." : "Upload CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onImportFileSelected?.(file);
                  }
                  event.target.value = "";
                }}
                disabled={importSubmitting}
              />
            </label>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
          ))
        ) : items.length ? (
          items.map((item) => (
            <div key={item.id} className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    {item.stockNumber || item.vin || `Unit ${item.id}`}
                  </p>
                  <h3 className="mt-2 font-display text-lg font-semibold text-white">{formatInventoryTitle(item)}</h3>
                </div>
                <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                  {item.status}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-300">
                {item.condition ? <span>{item.condition}</span> : null}
                {item.bodyStyle ? <span>{item.bodyStyle}</span> : null}
                <span>{formatPrice(item.price)}</span>
                {item.mileage != null ? <span>{item.mileage.toLocaleString()} km</span> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                {item.exteriorColor ? <span>{item.exteriorColor}</span> : null}
                {item.interiorColor ? <span>{item.interiorColor}</span> : null}
                {item.lastSeenAt ? <span>Seen {new Date(item.lastSeenAt).toLocaleString()}</span> : null}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
            No inventory units match this filter yet.
          </div>
        )}
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Recent import runs</p>
        <div className="mt-4 space-y-3">
          {importRuns.length ? (
            importRuns.map((run) => (
              <div key={run.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">{run.fileName || run.sourceName || `Run ${run.id}`}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                      {run.status} | {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Started"}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                    {run.rowsInserted} new / {run.rowsUpdated} updated
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                  <span>{run.rowsSkipped} skipped</span>
                  <span>{run.rowsDeactivated} inactive</span>
                  <span>{run.errorCount} errors</span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No inventory imports have been run yet.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
