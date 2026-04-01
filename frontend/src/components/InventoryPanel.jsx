import { useState } from "react";

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
  syncStatus = null,
  syncSubmitting = false,
  importErrors = [],
  inventoryLeadLookup = {},
  onImportSourceNameChange,
  onImportMarkMissingInactiveChange,
  onImportFileSelected,
  onSyncNow,
  onLoadInventoryLeads,
  onOpenLead,
}) {
  const [expandedInventoryId, setExpandedInventoryId] = useState(null);
  const lastRun = syncStatus?.latest_run || null;

  return (
    <>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Structured inventory</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Inventory foundation</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            The FTP feed is the source of truth, with manual upload kept only as a fallback when the feed needs help.
          </p>
        </div>

        {syncStatus ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Last success</p>
              <p className="mt-2 text-sm font-medium text-white">
                {syncStatus.last_success_at ? new Date(syncStatus.last_success_at).toLocaleString() : "No success yet"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Latest status</p>
              <p className="mt-2 text-sm font-medium text-white">{syncStatus.latest_status || "Idle"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Source file</p>
              <p className="mt-2 text-sm font-medium text-white">{lastRun?.file_name || "Not available"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Next scheduled sync</p>
              <p className="mt-2 text-sm font-medium text-white">
                {syncStatus.next_scheduled_sync_at
                  ? new Date(syncStatus.next_scheduled_sync_at).toLocaleString()
                  : "Scheduler disabled"}
              </p>
            </div>
          </div>
        ) : null}

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
              {syncStatus ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  <p className="font-medium text-white">FTP sync health</p>
                  <p className="mt-1 text-slate-300">
                    {syncStatus.configured
                      ? `${syncStatus.remote_directory || "/"}${syncStatus.file_pattern ? ` | ${syncStatus.file_pattern}` : ""}`
                      : "FTP credentials are not configured yet."}
                  </p>
                </div>
              ) : null}
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
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => onSyncNow?.()}
                disabled={syncSubmitting || syncStatus?.is_running}
                className="inline-flex items-center justify-center rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncSubmitting || syncStatus?.is_running ? "Syncing..." : "Sync now"}
              </button>
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
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                    {item.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextExpanded = expandedInventoryId === item.id ? null : item.id;
                      setExpandedInventoryId(nextExpanded);
                      if (nextExpanded && !inventoryLeadLookup[item.id]?.loaded) {
                        onLoadInventoryLeads?.(item.id);
                      }
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                  >
                    {item.leadCount} lead{item.leadCount === 1 ? "" : "s"}
                  </button>
                </div>
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
              {expandedInventoryId === item.id ? (
                <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-ink-950/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Linked leads</p>
                      <p className="mt-1 text-sm text-slate-300">
                        See every visible lead tied to this inventory unit.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onLoadInventoryLeads?.(item.id, { force: true })}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {inventoryLeadLookup[item.id]?.loading ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">
                        Loading linked leads...
                      </div>
                    ) : inventoryLeadLookup[item.id]?.error ? (
                      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
                        {inventoryLeadLookup[item.id].error}
                      </div>
                    ) : inventoryLeadLookup[item.id]?.items?.length ? (
                      inventoryLeadLookup[item.id].items.map((lead) => (
                        <button
                          key={lead.id}
                          type="button"
                          onClick={() => onOpenLead?.(lead.id)}
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{lead.customerName}</p>
                              <p className="mt-1 text-sm text-slate-300">{lead.vehicleInterest}</p>
                            </div>
                            <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
                              {lead.statusLabel}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {lead.source ? <span>{lead.source}</span> : null}
                            {lead.assignedRep ? <span>{lead.assignedRep}</span> : null}
                            {lead.createdAtLabel ? <span>{lead.createdAtLabel}</span> : null}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">
                        No visible leads are linked to this unit yet.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
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
                  <span>{run.sourceType || "manual_upload"}</span>
                  <span>{run.rowsSkipped} skipped</span>
                  <span>{run.failedCount ?? run.rowsSkipped} failed</span>
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

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Recent row issues</p>
        <div className="mt-4 space-y-3">
          {importErrors.length ? (
            importErrors.map((issue) => (
              <div key={issue.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">{issue.raw_identifier || issue.stock_number || issue.vin || `Row ${issue.row_number || issue.id}`}</p>
                    <p className="mt-1 text-sm text-slate-300">{issue.error_message}</p>
                  </div>
                  <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                    {issue.file_name || issue.source_type || "inventory"}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No recent inventory sync issues.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
