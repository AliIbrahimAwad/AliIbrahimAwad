import { useEffect, useState } from "react";

import { formatPhoneNumber, pipelineLabel } from "../lib/format";

function formatRelative(dateString) {
  if (!dateString) {
    return "Just now";
  }

  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function UnmatchedCommunicationPanel({
  item,
  leads = [],
  loading = false,
  assigning = false,
  creating = false,
  dismissing = false,
  onAssign,
  onCreateLead,
  onDismiss,
}) {
  const [leadId, setLeadId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [stockNumber, setStockNumber] = useState("");

  useEffect(() => {
    setLeadId("");
    setCustomerName("");
    setStockNumber("");
  }, [item?.id]);

  if (loading) {
    return <div className="crm-loading-state tall">Loading side panel...</div>;
  }

  if (!item) {
    return (
      <div className="crm-empty-state side-panel">
        Select an unmatched communication to review it.
      </div>
    );
  }

  const phone = item.normalized_from_number || item.from_number || "Not available";
  const preview =
    item.type === "sms"
      ? item.body_text || "No SMS message body."
      : item.call_duration != null
        ? `Inbound call lasting ${item.call_duration}s`
        : "Inbound call";

  return (
    <div className="crm-side-panel">
      <div className="crm-panel-header">
        <div>
          <h3>{item.type === "sms" ? "Inbound SMS" : "Inbound call"}</h3>
          <p>Unknown communication waiting for manual review or lead creation.</p>
        </div>
        <span className="crm-chip">{item.status}</span>
      </div>

      <div className="crm-focus-card">
        <div className="crm-focus-label">From</div>
        <h4>{formatPhoneNumber(phone)}</h4>
        <p>{preview}</p>
        <div className="crm-focus-meta">
          <span className="crm-chip">{formatRelative(item.received_at)}</span>
          {item.provider_extension_id ? <span className="crm-chip">Ext {item.provider_extension_id}</span> : null}
        </div>
      </div>

      <div className="crm-side-section">
        <div className="crm-side-section-header">
          <h4>Attach to existing lead</h4>
          <p>Use when this phone number belongs to a known customer already in the CRM.</p>
        </div>
        <select
          value={leadId}
          onChange={(event) => setLeadId(event.target.value)}
          className="crm-select-input"
        >
          <option value="" className="bg-ink-900">
            Select a lead
          </option>
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id} className="bg-ink-900">
              #{lead.id} {lead.customerName} | {pipelineLabel(lead.status)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!leadId || assigning}
          onClick={() => onAssign?.(Number(leadId))}
          className="crm-primary-block-button"
        >
          {assigning ? "Attaching..." : "Attach to lead"}
        </button>
      </div>

      <div className="crm-side-section">
        <div className="crm-side-section-header">
          <h4>Create new lead</h4>
          <p>Use when this communication belongs to a new customer not in the CRM yet.</p>
        </div>
        <div className="crm-form-stack">
          <input
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            className="crm-text-input"
            placeholder="Customer name"
          />
          <input
            value={stockNumber}
            onChange={(event) => setStockNumber(event.target.value)}
            className="crm-text-input"
            placeholder="Stock number (optional)"
          />
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => onCreateLead?.({ customer_name: customerName, stock_number: stockNumber })}
          className="crm-primary-block-button success"
        >
          {creating ? "Creating..." : "Create lead"}
        </button>
      </div>

      <button
        type="button"
        disabled={dismissing}
        onClick={() => onDismiss?.()}
        className="crm-secondary-block-button"
      >
        {dismissing ? "Dismissing..." : "Dismiss"}
      </button>
    </div>
  );
}
