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
      <div className="crm-stats-grid">
        <div className="crm-stat-card">
          <p className="crm-stat-value">{items.length}</p>
          <p className="crm-stat-title">Visible units</p>
          <p className="crm-stat-note">Inventory rows matching the current search filters</p>
        </div>
        <div className="crm-stat-card">
          <p className="crm-stat-value">{lastRun?.rowsInserted || 0}</p>
          <p className="crm-stat-title">Last import new</p>
          <p className="crm-stat-note">Rows inserted in the most recent sync/import run</p>
        </div>
        <div className="crm-stat-card">
          <p className="crm-stat-value">{lastRun?.rowsUpdated || 0}</p>
          <p className="crm-stat-title">Last import updated</p>
          <p className="crm-stat-note">Rows refreshed in the latest inventory run</p>
        </div>
        <div className="crm-stat-card">
          <p className="crm-stat-value">{importErrors.length}</p>
          <p className="crm-stat-title">Row issues</p>
          <p className="crm-stat-note">Recent inventory rows with validation or import problems</p>
        </div>
      </div>

      <div className="crm-panel-card mt-4">
        <div className="crm-panel-header">
          <div>
            <h3>Inventory foundation</h3>
            <p>The FTP feed is the source of truth, with manual upload kept only as fallback when the feed needs help.</p>
          </div>
        </div>
        {syncStatus ? (
          <div className="crm-stats-grid compact">
            <div className="crm-stat-card compact">
              <p className="crm-stat-title">Last success</p>
              <p className="crm-stat-note strong">
                {syncStatus.last_success_at ? new Date(syncStatus.last_success_at).toLocaleString() : "No success yet"}
              </p>
            </div>
            <div className="crm-stat-card compact">
              <p className="crm-stat-title">Latest status</p>
              <p className="crm-stat-note strong">{syncStatus.latest_status || "Idle"}</p>
            </div>
            <div className="crm-stat-card compact">
              <p className="crm-stat-title">Source file</p>
              <p className="crm-stat-note strong">{lastRun?.file_name || "Not available"}</p>
            </div>
            <div className="crm-stat-card compact">
              <p className="crm-stat-title">Next scheduled sync</p>
              <p className="crm-stat-note strong">
                {syncStatus.next_scheduled_sync_at
                  ? new Date(syncStatus.next_scheduled_sync_at).toLocaleString()
                  : "Scheduler disabled"}
              </p>
            </div>
          </div>
        ) : null}

        <div className="crm-filter-grid top-space">
          <input
            value={filters.status || ""}
            onChange={(event) => onFilterChange?.("status", event.target.value)}
            placeholder="Status"
            className="crm-text-input"
          />
          <input
            value={filters.make || ""}
            onChange={(event) => onFilterChange?.("make", event.target.value)}
            placeholder="Make"
            className="crm-text-input"
          />
          <input
            value={filters.model || ""}
            onChange={(event) => onFilterChange?.("model", event.target.value)}
            placeholder="Model"
            className="crm-text-input"
          />
          <input
            value={filters.stockNumber || ""}
            onChange={(event) => onFilterChange?.("stockNumber", event.target.value)}
            placeholder="Stock number"
            className="crm-text-input"
          />
          <input
            value={filters.vin || ""}
            onChange={(event) => onFilterChange?.("vin", event.target.value)}
            placeholder="VIN"
            className="crm-text-input"
          />
        </div>
      </div>

      {canImport ? (
        <div className="crm-panel-card mt-4">
          <div className="crm-panel-header">
            <div>
              <h3>Sync and import controls</h3>
              <p>FTP sync is primary. Manual CSV upload stays available for recovery workflows.</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="crm-form-stack">
              {syncStatus ? (
                <div className="crm-list-item static">
                  <p className="crm-row-primary">FTP sync health</p>
                  <p className="crm-list-item-meta">
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
                className="crm-text-input"
              />
              <label className="crm-toggle-row">
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
                className="crm-primary-block-button amber"
              >
                {syncSubmitting || syncStatus?.is_running ? "Syncing..." : "Sync now"}
              </button>
              <label className="crm-primary-block-button light cursor-pointer">
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

      <div className="crm-panel-card mt-4">
        <div className="crm-panel-header">
          <div>
            <h3>Inventory units</h3>
            <p>Searchable stock workspace with linked-lead expansion and latest feed context.</p>
          </div>
        </div>
        {loading ? (
          <div className="crm-loading-state">Loading inventory...</div>
        ) : items.length ? (
          items.map((item) => (
            <div key={item.id} className="crm-list-item static inventory-row">
              <div className="crm-list-item-row">
                <strong>{formatInventoryTitle(item)}</strong>
                <span className="crm-chip">{item.status}</span>
              </div>
              <div className="crm-list-item-meta">
                {item.stockNumber || item.vin || `Unit ${item.id}`} | {formatPrice(item.price)} {item.mileage != null ? `| ${item.mileage.toLocaleString()} km` : ""}
              </div>
              <div className="crm-list-item-meta">
                {[item.condition, item.bodyStyle, item.exteriorColor, item.interiorColor, item.lastSeenAt ? `Seen ${new Date(item.lastSeenAt).toLocaleString()}` : null]
                  .filter(Boolean)
                  .join(" | ")}
              </div>
              <div className="crm-row-actions top-space">
                <button
                  type="button"
                  onClick={() => {
                    const nextExpanded = expandedInventoryId === item.id ? null : item.id;
                    setExpandedInventoryId(nextExpanded);
                    if (nextExpanded && !inventoryLeadLookup[item.id]?.loaded) {
                      onLoadInventoryLeads?.(item.id);
                    }
                  }}
                  className="crm-table-button"
                >
                  {item.leadCount} lead{item.leadCount === 1 ? "" : "s"}
                </button>
              </div>
              {expandedInventoryId === item.id ? (
                <div className="crm-expanded-block">
                  <div className="crm-panel-header">
                    <div>
                      <h3>Linked leads</h3>
                      <p>Visible leads currently tied to this unit.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onLoadInventoryLeads?.(item.id, { force: true })}
                      className="crm-table-button"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="crm-list-stack">
                    {inventoryLeadLookup[item.id]?.loading ? (
                      <div className="crm-loading-state compact">Loading linked leads...</div>
                    ) : inventoryLeadLookup[item.id]?.error ? (
                      <div className="crm-error-state">{inventoryLeadLookup[item.id].error}</div>
                    ) : inventoryLeadLookup[item.id]?.items?.length ? (
                      inventoryLeadLookup[item.id].items.map((lead) => (
                        <button
                          key={lead.id}
                          type="button"
                          onClick={() => onOpenLead?.(lead.id)}
                          className="crm-list-item"
                        >
                          <div className="crm-list-item-row">
                            <strong>{lead.customerName}</strong>
                            <span className="crm-chip">{lead.statusLabel}</span>
                          </div>
                          <div className="crm-list-item-meta">{lead.vehicleInterest}</div>
                          <div className="crm-list-item-meta">
                            {[lead.source, lead.assignedRep, lead.createdAtLabel].filter(Boolean).join(" | ")}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="crm-empty-state compact">No visible leads are linked to this unit yet.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="crm-empty-state">
            No inventory units match this filter yet.
          </div>
        )}
      </div>

      <div className="crm-panel-card mt-6">
        <div className="crm-panel-header">
          <div>
            <h3>Recent import runs</h3>
            <p>Latest sync/upload history with inserted, updated, skipped, and errored rows.</p>
          </div>
        </div>
        <div className="crm-list-stack">
          {importRuns.length ? (
            importRuns.map((run) => (
              <div key={run.id} className="crm-list-item static">
                <div className="crm-list-item-row">
                  <strong>{run.fileName || run.sourceName || `Run ${run.id}`}</strong>
                  <span className="crm-chip">{run.rowsInserted} new / {run.rowsUpdated} updated</span>
                </div>
                <div className="crm-list-item-meta">
                  {run.status} | {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Started"}
                </div>
                <div className="crm-list-item-meta">
                  {[run.sourceType || "manual_upload", `${run.rowsSkipped} skipped`, `${run.failedCount ?? run.rowsSkipped} failed`, `${run.rowsDeactivated} inactive`, `${run.errorCount} errors`].join(" | ")}
                </div>
              </div>
            ))
          ) : (
            <div className="crm-empty-state compact">
              No inventory imports have been run yet.
            </div>
          )}
        </div>
      </div>

      <div className="crm-panel-card mt-6">
        <div className="crm-panel-header">
          <div>
            <h3>Recent row issues</h3>
            <p>Rows that failed validation or import mapping and need cleanup.</p>
          </div>
        </div>
        <div className="crm-list-stack">
          {importErrors.length ? (
            importErrors.map((issue) => (
              <div key={issue.id} className="crm-list-item static">
                <div className="crm-list-item-row">
                  <strong>{issue.raw_identifier || issue.stock_number || issue.vin || `Row ${issue.row_number || issue.id}`}</strong>
                  <span className="crm-chip amber">{issue.file_name || issue.source_type || "inventory"}</span>
                </div>
                <div className="crm-list-item-meta">{issue.error_message}</div>
              </div>
            ))
          ) : (
            <div className="crm-empty-state compact">
              No recent inventory sync issues.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
