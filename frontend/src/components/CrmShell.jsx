import {
  Bell,
  CalendarDays,
  CirclePlus,
  LayoutDashboard,
  MessageSquareText,
  PhoneCall,
  ReceiptText,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";

function Chip({ children, tone = "neutral" }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

function EmptyState({ label, compact = false }) {
  return <div className={`empty-state ${compact ? "compact" : ""}`}>{label}</div>;
}

function StatCard({ value, label, note }) {
  return (
    <div className="stat">
      <div className="k">{value}</div>
      <div>{label}</div>
      <div className="tiny">{note}</div>
    </div>
  );
}

function DataTable({ headers, rows, emptyLabel }) {
  if (!rows.length) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} onClick={row.onClick} className={row.active ? "active-row" : ""}>
            {row.cells.map((cell, index) => (
              <td key={`${row.key}-${index}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeadWorkspaceSection({ lead, detailLoading, buildVehicleLabel, getLeadChipTone, getLeadNextAction, onOpenSms, onOpenAssign, onOpenAppointment }) {
  if (detailLoading) {
    return (
      <div className="split-3">
        <div className="card"><EmptyState label="Loading customer..." /></div>
        <div className="card"><EmptyState label="Loading timeline..." /></div>
        <div className="card"><EmptyState label="Loading actions..." /></div>
      </div>
    );
  }

  if (!lead) {
    return <EmptyState label="Select a lead to open the full customer workspace." />;
  }

  return (
    <div className="split-3">
      <section className="card">
        <h3>Customer</h3>
        <div className="list">
          <div className="list-item"><strong>{lead.customerName}</strong><div className="tiny">{lead.phone} | {lead.email}</div></div>
          <div className="list-item"><strong>Interested in</strong><div className="tiny">{buildVehicleLabel(lead)}</div></div>
          <div className="list-item"><strong>Lead source</strong><div className="tiny">{lead.source} | {lead.statusLabel}</div></div>
        </div>
      </section>
      <section className="card">
        <div className="section-title"><h3>Activity timeline</h3><Chip tone={getLeadChipTone(lead)}>{lead.attentionReason || lead.statusLabel}</Chip></div>
        {lead.aiSummary ? <div className="event"><div className="row"><strong>AI summary</strong><Chip tone="blue">Generated</Chip></div><div className="tiny">{lead.aiSummary}</div></div> : null}
        <div className="timeline">
          {(lead.timeline || []).length ? lead.timeline.map((item) => (
            <div key={item.id} className="event">
              <div className="row"><strong>{String(item.type || "activity").replace(/_/g, " ")}</strong><span className="tiny">{item.timestampLabel}</span></div>
              <div className="tiny">{item.payload?.summary || item.payload?.content || item.payload?.message || "CRM timeline event"}</div>
            </div>
          )) : <EmptyState label="No detailed timeline has been captured yet." compact />}
        </div>
      </section>
      <section className="card">
        <div className="section-title"><h3>Next actions</h3><div className="toolbar"><button className="small-btn" onClick={onOpenSms}>Text</button><button className="small-btn" onClick={onOpenAssign}>Assign</button><button className="small-btn" onClick={onOpenAppointment}>Book</button></div></div>
        <div className="list">
          <div className="list-item"><div className="row"><strong>{getLeadNextAction(lead)}</strong><Chip tone={getLeadChipTone(lead)}>{lead.statusLabel}</Chip></div></div>
          {lead.inventory ? <div className="list-item"><strong>Matched inventory</strong><div className="tiny">{[lead.inventory.year, lead.inventory.make, lead.inventory.model, lead.inventory.trim].filter(Boolean).join(" ")} | {lead.inventory.stockNumber ? `Stock #${lead.inventory.stockNumber}` : lead.inventory.vin}</div></div> : <EmptyState label="No inventory match is linked yet." compact />}
        </div>
      </section>
    </div>
  );
}

export function CrmShell({ data, actions }) {
  const {
    currentUser,
    error,
    search,
    effectiveViewMode,
    viewMode,
    isManagerViewAllowed,
    salesUsers,
    repPreviewId,
    missedCallRecoveryCount,
    unreadNotificationCount,
    notifications,
    activePage,
    navItems,
    pageMeta,
    selectedLead,
    selectedUnmatched,
    visibleLeadLibrary,
    visibleAttentionLeads,
    visibleConversationFeed,
    visibleUnmatchedItems,
    visibleInventoryItems,
    visiblePipelineGroups,
    hotLeadRows,
    appointmentPreview,
    repPerformance,
    openGrossPotential,
    routingOpenRepCount,
    users,
    executionSettings,
    inventoryImportRuns,
    inventoryImportErrors,
    inventorySyncStatus,
    activeRep,
    myLeadLibrary,
    myConversationFeed,
    myAppointments,
    myUrgentLeads,
    myTasks,
    metrics,
    unmatchedCreateName,
    buildVehicleLabel,
    getLeadChipTone,
    getConversationChipTone,
    getUnmatchedChipTone,
    getLeadNextAction,
    formatCurrencyCompact,
    formatRelative,
  } = data;
  const {
    setSearch,
    setViewMode,
    setRepPreviewId,
    setSelectedUnmatchedId,
    setNotificationsOpen,
    setActivePage,
    setLeadDrawerOpen,
    setNewLeadOpen,
    setSmsOpen,
    setAssignOpen,
    setAppointmentOpen,
    setUnmatchedCreateName,
    onLogout,
    onMarkNotificationRead,
    onOpenLead,
    onAssignUnmatched,
    onCreateLeadFromUnmatched,
    onDismissUnmatched,
    onInventorySync,
    onInventoryImport,
    onToggleAvailability,
    onRunAutoSms,
  } = actions;

  const page = pageMeta[activePage] || pageMeta.dashboard;
  const managerIcons = {
    dashboard: LayoutDashboard,
    leads: UserRound,
    "lead-detail": ReceiptText,
    comms: MessageSquareText,
    appointments: CalendarDays,
    deals: ReceiptText,
    inventory: ReceiptText,
    team: Users,
    unmatched: PhoneCall,
    "rep-home": LayoutDashboard,
    "rep-tasks": ReceiptText,
    "rep-inbox": MessageSquareText,
    "rep-day": CalendarDays,
    "rep-customer": UserRound,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div><h1>Ali CRM</h1><span>{effectiveViewMode === "manager" ? "Manager / Admin View" : "Sales Rep View"}</span></div>
        </div>
        <div className="nav-group-title">Workspace</div>
        <div className="nav">
          {navItems.map((item) => {
            const Icon = managerIcons[item.id] || LayoutDashboard;
            return (
              <button key={item.id} type="button" className={`nav-btn ${activePage === item.id ? "active" : ""}`} onClick={() => setActivePage(item.id)}>
                <span className="nav-label"><Icon className="nav-icon" /> {item.label}</span>
                <span className="badge">{item.badge}</span>
              </button>
            );
          })}
        </div>
        <div className="sidebar-footer"><div className="rep"><div><div className="footer-title">Routing status</div><div>{effectiveViewMode === "rep" ? (activeRep?.name || "Sales desk") : "Round robin active"}</div></div><Chip tone={effectiveViewMode === "rep" ? (activeRep?.is_available ? "green" : "amber") : "green"}>{effectiveViewMode === "rep" ? (activeRep?.is_available ? "Open" : "Paused") : "Open"}</Chip></div></div>
      </aside>

      <header className="topbar">
        <label className="search"><Search className="search-icon" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, VIN, stock #, phone, task, deal" /></label>
        {isManagerViewAllowed ? <div className="mode-switch"><button type="button" className={viewMode === "manager" ? "active" : ""} onClick={() => setViewMode("manager")}>Manager / Admin</button><button type="button" className={viewMode === "rep" ? "active" : ""} onClick={() => setViewMode("rep")}>Sales Rep</button></div> : null}
        {isManagerViewAllowed && effectiveViewMode === "rep" && salesUsers.length ? <label className="rep-picker"><span>Rep</span><select value={repPreviewId || ""} onChange={(event) => setRepPreviewId(Number(event.target.value))}>{salesUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label> : null}
        <button type="button" className="pill call" onClick={() => setActivePage("unmatched")}>{missedCallRecoveryCount} missed calls need recovery</button>
        <button type="button" className="icon-btn" onClick={() => setNotificationsOpen(true)} aria-label="Notifications"><Bell className="nav-icon" /></button>
        <button type="button" className="cta" onClick={() => setNewLeadOpen(true)}><CirclePlus className="nav-icon" />New lead</button>
        <button type="button" className="icon-btn" onClick={onLogout} aria-label="Logout"><X className="nav-icon" /></button>
      </header>

      <main className="content">
        <section className="page active-page">
          <div className="page-header">
            <div><h2 className="page-title">{page.title}</h2><div className="sub">{page.sub}</div></div>
            <div className="toolbar">
              <button type="button" className="small-btn" onClick={() => setLeadDrawerOpen(true)} disabled={!selectedLead}>Open side view</button>
              <button type="button" className="small-btn" onClick={() => setSmsOpen(true)} disabled={!selectedLead}>Text</button>
              <button type="button" className="small-btn" onClick={() => setAppointmentOpen(true)} disabled={!selectedLead}>Book appointment</button>
            </div>
          </div>
          {error ? <div className="error-banner">{error}</div> : null}
          {effectiveViewMode === "manager" ? (
            <ManagerPages
              activePage={activePage}
              hotLeadRows={hotLeadRows}
              appointmentPreview={appointmentPreview}
              repPerformance={repPerformance}
              visibleLeadLibrary={visibleLeadLibrary}
              visibleConversationFeed={visibleConversationFeed}
              visibleUnmatchedItems={visibleUnmatchedItems}
              visibleInventoryItems={visibleInventoryItems}
              visiblePipelineGroups={visiblePipelineGroups}
              selectedLead={selectedLead}
              selectedUnmatched={selectedUnmatched}
              users={users}
              executionSettings={executionSettings}
              inventoryImportRuns={inventoryImportRuns}
              inventoryImportErrors={inventoryImportErrors}
              inventorySyncStatus={inventorySyncStatus}
              metrics={metrics}
              unmatchedCreateName={unmatchedCreateName}
              unreadNotificationCount={unreadNotificationCount}
              routingOpenRepCount={routingOpenRepCount}
              openGrossPotential={openGrossPotential}
              buildVehicleLabel={buildVehicleLabel}
              getLeadChipTone={getLeadChipTone}
              getConversationChipTone={getConversationChipTone}
              getUnmatchedChipTone={getUnmatchedChipTone}
              getLeadNextAction={getLeadNextAction}
              formatCurrencyCompact={formatCurrencyCompact}
              onOpenLead={onOpenLead}
              onSetPage={setActivePage}
              onAssignUnmatched={onAssignUnmatched}
              onCreateLeadFromUnmatched={onCreateLeadFromUnmatched}
              onDismissUnmatched={onDismissUnmatched}
              onInventorySync={onInventorySync}
              onInventoryImport={onInventoryImport}
              onToggleAvailability={onToggleAvailability}
              onRunAutoSms={onRunAutoSms}
              setUnmatchedCreateName={setUnmatchedCreateName}
              onOpenSms={() => setSmsOpen(true)}
              onOpenAssign={() => setAssignOpen(true)}
              onOpenAppointment={() => setAppointmentOpen(true)}
              setSelectedUnmatchedId={setSelectedUnmatchedId}
            />
          ) : (
            <RepPages activePage={activePage} selectedLead={selectedLead} myLeadLibrary={myLeadLibrary} myConversationFeed={myConversationFeed} myAppointments={myAppointments} myUrgentLeads={myUrgentLeads} myTasks={myTasks} buildVehicleLabel={buildVehicleLabel} getLeadChipTone={getLeadChipTone} getConversationChipTone={getConversationChipTone} formatCurrencyCompact={formatCurrencyCompact} onOpenLead={onOpenLead} onOpenSms={() => setSmsOpen(true)} onOpenAssign={() => setAssignOpen(true)} onOpenAppointment={() => setAppointmentOpen(true)} />
          )}
        </section>
      </main>

      <NotificationDrawer open={data.notificationsOpen} notifications={notifications} unreadNotificationCount={unreadNotificationCount} onClose={() => setNotificationsOpen(false)} onMarkNotificationRead={onMarkNotificationRead} formatRelative={formatRelative} />
    </div>
  );
}

function ManagerPages(props) {
  const { activePage, hotLeadRows, appointmentPreview, repPerformance, visibleLeadLibrary, visibleConversationFeed, visibleUnmatchedItems, visibleInventoryItems, visiblePipelineGroups, selectedLead, selectedUnmatched, users, executionSettings, inventoryImportRuns, inventoryImportErrors, inventorySyncStatus, metrics, unreadNotificationCount, routingOpenRepCount, openGrossPotential, buildVehicleLabel, getLeadChipTone, getConversationChipTone, getUnmatchedChipTone, getLeadNextAction, formatCurrencyCompact, onOpenLead, onSetPage, onAssignUnmatched, onCreateLeadFromUnmatched, onDismissUnmatched, onInventorySync, onInventoryImport, onToggleAvailability, onRunAutoSms, unmatchedCreateName, setUnmatchedCreateName, onOpenSms, onOpenAssign, onOpenAppointment, setSelectedUnmatchedId } = props;
  const salesUsers = users.filter((user) => user.role === "sales");

  if (activePage === "dashboard") {
    return (
      <>
        <div className="stats">
          <StatCard value={visibleLeadLibrary.length} label="Fresh leads" note={`${hotLeadRows.length} need contact right now`} />
          <StatCard value={visibleUnmatchedItems.filter((item) => item.status === "new" && item.type === "call").length} label="Missed calls" note={`${visibleUnmatchedItems.filter((item) => item.status === "new").length} unknown inbox items`} />
          <StatCard value={appointmentPreview.length} label="Appointments today" note={`${routingOpenRepCount} reps open for routing`} />
          <StatCard value={formatCurrencyCompact(openGrossPotential)} label="Open gross potential" note={`${visibleLeadLibrary.filter((lead) => !lead.assignedTo).length} still unassigned`} />
        </div>
        <div className="grid dashboard-grid">
          <section className="card"><div className="section-title"><h3>Hot leads needing contact</h3><Chip tone="red">{hotLeadRows.length} urgent</Chip></div><DataTable headers={["Customer", "Vehicle", "Source", "Last Touch", "Owner", "Actions"]} rows={hotLeadRows.map((lead) => ({ key: lead.id, cells: [<div key="customer"><strong>{lead.customerName}</strong><div className="tiny">{lead.phone}</div></div>, <div key="vehicle"><strong>{buildVehicleLabel(lead)}</strong><div className="tiny">{lead.stockNumber ? `Stock #${lead.stockNumber}` : lead.vehicleCondition || "Vehicle inquiry"}</div></div>, lead.source, lead.lastActivity, lead.assignedRep, <button key="action" className="small-btn" onClick={() => onOpenLead(lead.id, { page: "lead-detail", drawer: true })}>Open</button>] }))} emptyLabel="No hot leads are waiting right now." /></section>
          <section className="card"><div className="section-title"><h3>Appointments today</h3><Chip tone="blue">{appointmentPreview.length} total</Chip></div><div className="list">{appointmentPreview.length ? appointmentPreview.map((lead) => <button key={lead.id} type="button" className="list-item button-reset" onClick={() => onOpenLead(lead.id, { page: "lead-detail", drawer: true })}><div className="row"><strong>{lead.customerName}</strong><Chip tone="green">{lead.statusLabel}</Chip></div><div className="tiny">{buildVehicleLabel(lead)}</div><div className="tiny">{lead.assignedRep} | {lead.lastActivity}</div></button>) : <EmptyState label="No appointment-stage leads in this view." compact />}</div></section>
          <section className="card"><div className="section-title"><h3>Rep performance</h3><Chip>Today</Chip></div><div className="list">{repPerformance.length ? repPerformance.map((user) => <div key={user.id} className="list-item"><div className="row"><strong>{user.name}</strong><span>{user.contactCount} contacts</span></div><div className="progress"><div style={{ width: `${Math.max(10, Math.min(100, user.contactCount * 10))}%` }} /></div><div className="tiny">{user.assignedLeadCount} owned leads</div></div>) : <EmptyState label="No sales rep activity in the current view." compact />}</div></section>
        </div>
      </>
    );
  }

  if (activePage === "leads") {
    return <section className="card"><DataTable headers={["Customer", "Vehicle", "Source", "Status", "Last Contact", "Next Action", "Owner", "Actions"]} rows={visibleLeadLibrary.map((lead) => ({ key: lead.id, cells: [<div key="customer"><strong>{lead.customerName}</strong><div className="tiny">{lead.phone}</div></div>, <div key="vehicle"><strong>{buildVehicleLabel(lead)}</strong><div className="tiny">{lead.stockNumber ? `Stock #${lead.stockNumber}` : lead.vehicleCondition || "Vehicle inquiry"}</div></div>, lead.source, <Chip key="status" tone={getLeadChipTone(lead)}>{lead.attentionReason || lead.statusLabel}</Chip>, lead.lastActivity, <div key="next"><strong>{getLeadNextAction(lead)}</strong><div className="tiny">{lead.messagePreview}</div></div>, lead.assignedRep, <div key="actions" className="toolbar"><button className="small-btn" onClick={() => onOpenLead(lead.id, { page: "lead-detail", drawer: true })}>Open</button><button className="small-btn" onClick={() => onOpenLead(lead.id, { page: "lead-detail", drawer: true })}>View</button></div>] }))} emptyLabel="No leads match the current search." /></section>;
  }

  if (activePage === "lead-detail") {
    return <LeadWorkspaceSection lead={selectedLead} detailLoading={false} buildVehicleLabel={buildVehicleLabel} getLeadChipTone={getLeadChipTone} getLeadNextAction={getLeadNextAction} onOpenSms={onOpenSms} onOpenAssign={onOpenAssign} onOpenAppointment={onOpenAppointment} />;
  }

  if (activePage === "comms") {
    return <div className="split-3"><section className="card"><div className="section-title"><h3>Conversations</h3><Chip tone="red">{visibleConversationFeed.length} active</Chip></div><div className="list">{visibleConversationFeed.map((item) => <button key={item.id} type="button" className="list-item button-reset" onClick={() => item.leadId && onOpenLead(item.leadId, { page: "comms", drawer: true })}><div className="row"><strong>{item.leadName || "Unknown lead"}</strong><Chip tone={getConversationChipTone(item)}>{item.type === "call" ? "Call" : "SMS"}</Chip></div><div className="tiny">{item.preview}</div><div className="tiny">{item.happenedAtLabel}</div></button>)}</div></section><section className="card"><div className="section-title"><h3>Customer context</h3><Chip tone="blue">Live CRM data</Chip></div>{selectedLead ? <div className="list"><div className="list-item"><strong>{selectedLead.customerName}</strong><div className="tiny">{selectedLead.phone} | {selectedLead.email}</div></div><div className="list-item"><strong>Target vehicle</strong><div className="tiny">{buildVehicleLabel(selectedLead)}</div></div><div className="list-item"><strong>Next move</strong><div className="tiny">{getLeadNextAction(selectedLead)}</div></div></div> : <EmptyState label="Open a lead conversation to see thread context here." />}</section><section className="card"><div className="section-title"><h3>Unknown inbox</h3><Chip tone="amber">{visibleUnmatchedItems.filter((item) => item.status === "new").length} new</Chip></div><div className="list">{visibleUnmatchedItems.slice(0, 6).map((item) => <button key={item.id} type="button" className="list-item button-reset" onClick={() => { setSelectedUnmatchedId(item.id); onSetPage("unmatched"); }}><div className="row"><strong>{item.phone}</strong><Chip tone={getUnmatchedChipTone(item)}>{item.type === "call" ? "Call" : "SMS"}</Chip></div><div className="tiny">{item.preview}</div><div className="tiny">{item.receivedAtLabel}</div></button>)}</div></section></div>;
  }

  if (activePage === "appointments") {
    return <section className="card calendar-list"><div className="list">{appointmentPreview.length ? appointmentPreview.map((lead, index) => <div key={lead.id} className="list-item calendar-item"><strong>{index + 1}:00 PM</strong><div><strong>{lead.customerName} | {buildVehicleLabel(lead)}</strong><div className="tiny">Rep: {lead.assignedRep} | {lead.source}</div></div><Chip tone="green">{lead.statusLabel}</Chip></div>) : <EmptyState label="No appointment-stage leads are visible right now." />}</div></section>;
  }

  if (activePage === "deals") {
    return <div className="kanban">{Object.entries(visiblePipelineGroups).map(([status, items]) => <div key={status} className="column"><h3>{status.replace(/^\w/, (letter) => letter.toUpperCase())}</h3>{items.length ? items.map((lead) => <button key={lead.id} type="button" className="deal button-reset" onClick={() => onOpenLead(lead.id, { page: "lead-detail", drawer: true })}><strong>{lead.customerName}</strong><div className="tiny">{buildVehicleLabel(lead)} | {formatCurrencyCompact(lead.vehiclePrice)}</div></button>) : <div className="deal empty">No leads</div>}</div>)}</div>;
  }

  if (activePage === "inventory") {
    return <div className="grid split-2"><section className="card"><div className="section-title"><h3>Inventory feed</h3><div className="toolbar"><button className="small-btn" onClick={onInventorySync}>Sync now</button><label className="small-btn file-btn">Import CSV<input type="file" accept=".csv,text/csv" onChange={(event) => onInventoryImport(event.target.files?.[0] || null)} /></label></div></div><div className="inventory-grid">{visibleInventoryItems.slice(0, 9).map((item) => <div key={item.id} className="vehicle"><div className="img" /><div className="body"><div className="row"><strong>{[item.year, item.make, item.model, item.trim].filter(Boolean).join(" ") || item.stockNumber}</strong><Chip tone={item.leadCount ? "green" : "neutral"}>{item.leadCount ? `${item.leadCount} leads` : "No leads"}</Chip></div><div className="tiny">{item.stockNumber ? `Stock #${item.stockNumber}` : item.vin}</div><div className="tiny">{formatCurrencyCompact(item.price)} | {item.mileage ? `${item.mileage} km` : "Mileage n/a"} | {item.updatedAtLabel}</div></div></div>)}</div></section><section className="card"><div className="section-title"><h3>Feed health</h3><Chip tone="blue">{inventorySyncStatus?.status || "tracking"}</Chip></div><div className="list">{inventoryImportRuns.map((run) => <div key={run.id} className="list-item"><div className="row"><strong>{run.sourceName || run.fileName || "Inventory import"}</strong><Chip tone={run.status === "completed" ? "green" : run.status === "failed" ? "red" : "amber"}>{run.status}</Chip></div><div className="tiny">{run.rowsProcessed} processed | {run.rowsInserted} inserted | {run.rowsUpdated} updated | {run.completedAtLabel}</div></div>)}{inventoryImportErrors.length ? <div className="list-item"><strong>Recent import issues</strong><div className="tiny">{inventoryImportErrors.slice(0, 3).map((item) => `${item.stockNumber || item.vin || "row"}: ${item.errorMessage}`).join(" | ")}</div></div> : null}</div></section></div>;
  }

  if (activePage === "team") {
    return <div className="split-2"><section className="card"><div className="section-title"><h3>Rep availability</h3><Chip tone="green">{routingOpenRepCount} open</Chip></div><div className="list">{salesUsers.length ? salesUsers.map((user) => <div key={user.id} className="list-item"><div className="row"><strong>{user.name}</strong><Chip tone={user.is_available ? "green" : "amber"}>{user.is_available ? "Available" : "Paused"}</Chip></div><div className="tiny">{user.email || "No email on file"}</div><div className="toolbar top-gap"><button className="small-btn" onClick={() => onToggleAvailability(user)}>{user.is_available ? "Pause routing" : "Open routing"}</button></div></div>) : <EmptyState label="No sales reps found yet." />}</div></section><section className="card"><div className="section-title"><h3>Execution controls</h3><Chip tone="blue">{executionSettings ? "Connected" : "Unavailable"}</Chip></div><div className="list"><div className="list-item"><div className="row"><strong>Auto SMS runner</strong><button className="small-btn" onClick={onRunAutoSms}>Run now</button></div><div className="tiny">Use the current backend texting configuration without leaving the CRM.</div></div><div className="list-item"><div className="row"><strong>Unread notifications</strong><Chip tone="amber">{unreadNotificationCount}</Chip></div><div className="tiny">Managers can triage system alerts from the notification drawer in the top bar.</div></div><div className="list-item"><div className="row"><strong>Store health</strong><Chip tone="green">{metrics.overdue_task_count || 0} overdue tasks</Chip></div><div className="tiny">{visibleLeadLibrary.filter((lead) => !lead.assignedTo).length} visible leads still need an owner.</div></div></div></section></div>;
  }

  if (activePage === "unmatched") {
    return <div className="split-2"><section className="card"><div className="section-title"><h3>Unknown inbox</h3><Chip tone="red">{visibleUnmatchedItems.filter((item) => item.status === "new").length} new</Chip></div><DataTable headers={["Type", "Phone", "Preview", "Status", "Received", "Context"]} rows={visibleUnmatchedItems.map((item) => ({ key: item.id, active: Number(item.id) === Number(selectedUnmatched?.id), onClick: () => setSelectedUnmatchedId(item.id), cells: [<Chip key="type" tone={getUnmatchedChipTone(item)}>{item.type === "call" ? "Call" : "SMS"}</Chip>, item.phone, item.preview, item.status, item.receivedAtLabel, [item.direction, item.providerExtensionId ? `Ext ${item.providerExtensionId}` : null, item.resolvedLeadName].filter(Boolean).join(" | ")] }))} emptyLabel="No unmatched communications match this search." /></section><section className="card"><div className="section-title"><h3>Resolve selected item</h3><Chip tone={selectedUnmatched ? getUnmatchedChipTone(selectedUnmatched) : "neutral"}>{selectedUnmatched ? selectedUnmatched.status : "Waiting"}</Chip></div>{selectedUnmatched ? <div className="list"><div className="list-item"><strong>{selectedUnmatched.phone}</strong><div className="tiny">{selectedUnmatched.preview}</div><div className="tiny">{selectedUnmatched.receivedAtLabel}</div></div><label className="field"><span>Attach to lead</span><select defaultValue="" onChange={(event) => event.target.value && onAssignUnmatched(event.target.value)}><option value="">Choose a lead</option>{visibleLeadLibrary.slice(0, 100).map((lead) => <option key={lead.id} value={lead.id}>{lead.customerName} | {buildVehicleLabel(lead)}</option>)}</select></label><label className="field"><span>Create as new lead</span><input value={unmatchedCreateName} onChange={(event) => setUnmatchedCreateName(event.target.value)} placeholder="Customer name (optional)" /></label><div className="toolbar"><button className="cta" onClick={onCreateLeadFromUnmatched}>Create lead</button><button className="small-btn" onClick={onDismissUnmatched}>Dismiss</button></div></div> : <EmptyState label="Select an unmatched call or SMS to resolve it." />}</section></div>;
  }

  return null;
}

function RepPages({ activePage, selectedLead, myLeadLibrary, myConversationFeed, myAppointments, myUrgentLeads, myTasks, buildVehicleLabel, getLeadChipTone, getConversationChipTone, formatCurrencyCompact, onOpenLead, onOpenSms, onOpenAssign, onOpenAppointment }) {
  if (activePage === "rep-home") {
    return <><div className="stats"><StatCard value={myLeadLibrary.length} label="My active leads" note={`${myUrgentLeads.length} need action now`} /><StatCard value={myAppointments.length} label="Appointments today" note={`${myAppointments.length} visible appointment leads`} /><StatCard value={myConversationFeed.length} label="Unread threads" note={`${myConversationFeed.filter((item) => item.type === "call").length} calls in feed`} /><StatCard value={formatCurrencyCompact(myLeadLibrary.reduce((sum, lead) => sum + Number(String(lead.vehiclePrice || 0).replace(/[^0-9.-]/g, "")), 0))} label="My open gross" note={`${myLeadLibrary.filter((lead) => lead.status === "negotiation").length} strong deals`} /></div><div className="split-2"><section className="card"><div className="section-title"><h3>Need action now</h3><Chip tone="red">{myUrgentLeads.length} urgent</Chip></div><div className="list">{myUrgentLeads.length ? myUrgentLeads.map((lead) => <button key={lead.id} type="button" className="list-item button-reset" onClick={() => onOpenLead(lead.id, { page: "rep-customer", drawer: true })}><div className="row"><strong>{lead.customerName}</strong><Chip tone={getLeadChipTone(lead)}>{lead.attentionReason || lead.statusLabel}</Chip></div><div className="tiny">{buildVehicleLabel(lead)}</div></button>) : <EmptyState label="Your desk is clear right now." compact />}</div></section><section className="card"><div className="section-title"><h3>My appointments</h3><Chip tone="blue">Today</Chip></div><div className="list">{myAppointments.length ? myAppointments.map((lead) => <button key={lead.id} type="button" className="list-item button-reset" onClick={() => onOpenLead(lead.id, { page: "rep-customer", drawer: true })}><div className="row"><strong>{lead.customerName}</strong><Chip tone="green">{lead.statusLabel}</Chip></div><div className="tiny">{buildVehicleLabel(lead)}</div></button>) : <EmptyState label="No appointment-stage leads on this desk." compact />}</div></section></div></>;
  }

  if (activePage === "rep-tasks") {
    return <section className="card"><div className="list">{myTasks.length ? myTasks.map((task) => <div key={task.id} className="list-item"><div className="row"><strong>{task.title}</strong><button className="small-btn" onClick={() => onOpenLead(task.leadId, { page: "rep-customer", drawer: true })}>Open lead</button></div><div className="tiny">{task.leadName}</div></div>) : <EmptyState label="No follow-up tasks are assigned to this desk." />}</div></section>;
  }

  if (activePage === "rep-inbox") {
    return <section className="card"><DataTable headers={["Type", "Customer", "Vehicle", "Preview", "When"]} rows={myConversationFeed.map((item) => ({ key: item.id, onClick: () => item.leadId && onOpenLead(item.leadId, { page: "rep-customer", drawer: true }), cells: [<Chip key="type" tone={getConversationChipTone(item)}>{item.type === "call" ? "Call" : "SMS"}</Chip>, item.leadName || "Unknown lead", item.vehicleInterest, item.preview, item.happenedAtLabel] }))} emptyLabel="No calls or SMS are tied to this desk yet." /></section>;
  }

  if (activePage === "rep-day") {
    return <div className="split-2"><section className="card"><div className="section-title"><h3>Today's agenda</h3><Chip tone="blue">{myAppointments.length}</Chip></div><div className="list">{myAppointments.length ? myAppointments.map((lead, index) => <div key={lead.id} className="list-item calendar-item"><strong>{index + 2}:00 PM</strong><div><strong>{lead.customerName}</strong><div className="tiny">{buildVehicleLabel(lead)}</div></div><Chip tone="green">{lead.statusLabel}</Chip></div>) : <EmptyState label="No appointments are booked for this desk." />}</div></section><section className="card"><div className="section-title"><h3>Priority threads</h3><Chip tone="red">{myUrgentLeads.length}</Chip></div><div className="list">{myUrgentLeads.slice(0, 5).map((lead) => <button key={lead.id} type="button" className="list-item button-reset" onClick={() => onOpenLead(lead.id, { page: "rep-customer", drawer: true })}><div className="row"><strong>{lead.customerName}</strong><Chip tone={getLeadChipTone(lead)}>{lead.attentionReason || lead.statusLabel}</Chip></div></button>)}</div></section></div>;
  }

  if (activePage === "rep-customer") {
    return <LeadWorkspaceSection lead={selectedLead} detailLoading={false} buildVehicleLabel={buildVehicleLabel} getLeadChipTone={getLeadChipTone} getLeadNextAction={() => ""} onOpenSms={onOpenSms} onOpenAssign={onOpenAssign} onOpenAppointment={onOpenAppointment} />;
  }

  return null;
}

function NotificationDrawer({ open, notifications, unreadNotificationCount, onClose, onMarkNotificationRead, formatRelative }) {
  return (
    <div className={`drawer ${open ? "open" : ""}`}>
      <div className="drawer-header"><div><h3>Notifications</h3><div className="tiny">{unreadNotificationCount} unread</div></div><button type="button" className="close-btn" onClick={onClose}><X className="nav-icon" /></button></div>
      <div className="list">{notifications.length ? notifications.map((item) => <div key={item.id} className="list-item"><div className="row"><strong>{item.title || item.subject || item.content || item.type || "Notification"}</strong><Chip tone={item.status === "read" ? "neutral" : "amber"}>{item.status || "new"}</Chip></div><div className="tiny">{item.content || item.message || item.description || "CRM notification"}</div><div className="row top-gap"><span className="tiny">{formatRelative(item.created_at || item.updated_at || item.timestamp)}</span>{item.status !== "read" ? <button type="button" className="small-btn" onClick={() => onMarkNotificationRead(item.id)}>Mark read</button> : null}</div></div>) : <EmptyState label="No notifications are waiting right now." />}</div>
    </div>
  );
}

export function LeadDrawerPanel({ open, lead, detailLoading, leadForm, onLeadFormChange, onSaveLead, savingLead, onStatusChange, statusUpdating, assignees, assignTarget, onAssignTargetChange, onAssignLead, onOpenSms, onOpenAppointment, onLogCall, callLogging, onHoldVehicle, holdSubmitting, onCompleteTask, taskCompletingId, onClose, statusChoices }) {
  return (
    <div className={`drawer ${open ? "open" : ""}`}>
      <div className="drawer-header"><div><h3>{lead ? lead.customerName : "Lead details"}</h3></div><button type="button" className="close-btn" onClick={onClose}><X className="nav-icon" /></button></div>
      {detailLoading ? <EmptyState label="Loading lead details..." /> : !lead ? <EmptyState label="Select a lead to open the side view." /> : <div className="drawer-body"><div className="card inner-card"><div className="section-title"><h3>{lead.customerName}</h3><Chip tone="blue">{lead.statusLabel}</Chip></div><div className="tiny">{lead.phone} | {lead.email}</div><div className="tiny">{lead.vehicleInterest}</div></div><div className="card inner-card"><h3>Quick actions</h3><div className="toolbar wrap"><button type="button" className="small-btn" onClick={onLogCall} disabled={callLogging}>{callLogging ? "Logging call..." : "Log call"}</button><button type="button" className="small-btn" onClick={onOpenSms}>Text</button><button type="button" className="small-btn" onClick={onOpenAppointment}>Book appointment</button><button type="button" className="small-btn" onClick={onHoldVehicle} disabled={holdSubmitting}>{holdSubmitting ? "Holding..." : "Hold vehicle"}</button></div></div><div className="card inner-card"><h3>Edit lead</h3><div className="form-grid"><Field label="Customer name"><input value={leadForm.customer_name} onChange={(event) => onLeadFormChange((current) => ({ ...current, customer_name: event.target.value }))} /></Field><Field label="Phone"><input value={leadForm.phone} onChange={(event) => onLeadFormChange((current) => ({ ...current, phone: event.target.value }))} /></Field><Field label="Email"><input value={leadForm.email} onChange={(event) => onLeadFormChange((current) => ({ ...current, email: event.target.value }))} /></Field><Field label="Stock number"><input value={leadForm.stock_number} onChange={(event) => onLeadFormChange((current) => ({ ...current, stock_number: event.target.value }))} /></Field><Field label="Vehicle interest" full><input value={leadForm.vehicle_interest} onChange={(event) => onLeadFormChange((current) => ({ ...current, vehicle_interest: event.target.value }))} /></Field><Field label="Message" full><textarea value={leadForm.message} onChange={(event) => onLeadFormChange((current) => ({ ...current, message: event.target.value }))} /></Field></div><div className="modal-actions"><button type="button" className="cta" onClick={onSaveLead} disabled={savingLead}>{savingLead ? "Saving..." : "Save changes"}</button></div></div><div className="card inner-card"><h3>Status and ownership</h3><div className="form-grid"><Field label="Status"><select defaultValue={lead.status} onChange={(event) => onStatusChange(event.target.value)} disabled={statusUpdating}>{statusChoices.map((status) => <option key={status} value={status}>{status}</option>)}</select></Field><Field label="Assigned rep"><select value={assignTarget} onChange={(event) => onAssignTargetChange(event.target.value)}><option value="">Unassigned</option>{assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field></div><div className="modal-actions"><button type="button" className="small-btn" onClick={onAssignLead} disabled={!assignTarget}>Reassign</button></div></div><div className="card inner-card"><h3>Tasks</h3><div className="list">{(lead.tasks || []).length ? lead.tasks.map((task) => <div key={task.id} className="list-item"><div className="row"><strong>{task.title || task.content || "Follow-up"}</strong><button type="button" className="small-btn" onClick={() => onCompleteTask(task.id)} disabled={taskCompletingId === task.id}>{taskCompletingId === task.id ? "Completing..." : "Complete"}</button></div></div>) : <EmptyState label="No open tasks on this lead." compact />}</div></div></div>}
    </div>
  );
}

export function ModalFrame({ open, title, children, onClose }) {
  return <div className={`overlay ${open ? "open" : ""}`}><div className="modal"><div className="modal-header"><div><h3>{title}</h3></div><button type="button" className="close-btn" onClick={onClose}><X className="nav-icon" /></button></div>{children}</div></div>;
}

export function Field({ label, full = false, children }) {
  return <label className={`field ${full ? "full" : ""}`}><span>{label}</span>{children}</label>;
}
