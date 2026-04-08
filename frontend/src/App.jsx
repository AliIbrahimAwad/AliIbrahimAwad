import { useDeferredValue, useEffect, useState } from "react";

import { LoginPage } from "./components/LoginPage";
import { CrmShell, Field, LeadDrawerPanel, ModalFrame } from "./components/CrmShell";
import {
  assignLead,
  assignUnmatchedCommunication,
  completeTask,
  createLead,
  createLeadFromUnmatched,
  dismissUnmatchedCommunication,
  getAssignableUsers,
  getConversations,
  getDashboardWorklist,
  getExecutionSettings,
  getInventory,
  getInventoryImportErrors,
  getInventoryImportRuns,
  getInventorySyncStatus,
  getLead,
  getLeads,
  getLeadSmsSuggestion,
  getSession,
  getUnmatchedCommunications,
  getUsers,
  holdLeadVehicle,
  importInventory,
  login,
  logout,
  logLeadCall,
  markNotificationRead,
  runAutoSmsNow,
  sendLeadSms,
  syncInventoryNow,
  updateLead,
  updateLeadStatus,
  updateUserAvailability,
} from "./lib/api";
import { formatPhoneNumber, pipelineLabel } from "./lib/format";
import { splitCustomerNameParts } from "./lib/leadNames";

const organizedGroups = ["contacted", "appointment", "negotiation", "sold", "lost"];
const pipelineStages = ["new", ...organizedGroups];
const statusChoices = ["new", "contacted", "appointment", "negotiation", "sold", "lost"];
const emptyMetrics = { needs_attention_count: 0, overdue_task_count: 0, unread_notification_count: 0 };
const emptyLeadForm = {
  customer_name: "",
  phone: "",
  email: "",
  source: "website",
  vehicle_interest: "",
  stock_number: "",
  message: "",
};

function capitalizeSource(source) {
  return String(source || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

function parseMoneyAmount(value) {
  if (value == null || value === "") {
    return 0;
  }
  const normalized = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(normalized) ? normalized : 0;
}

function formatCurrencyCompact(value) {
  const amount = parseMoneyAmount(value);
  if (amount <= 0) {
    return "$0";
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

function buildVehicleLabel(lead) {
  const inventoryLabel = [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel, lead.vehicleTrim]
    .filter(Boolean)
    .join(" ");
  return inventoryLabel || lead.vehicleInterest || "Vehicle inquiry";
}

function getLeadChipTone(lead) {
  if (lead.attentionReason) return "red";
  if (lead.status === "appointment") return "blue";
  if (lead.status === "negotiation") return "amber";
  if (lead.status === "sold") return "green";
  if (lead.status === "lost") return "red";
  if (lead.status === "contacted") return "neutral";
  return "red";
}

function getConversationChipTone(item) {
  if (item.type === "call") return item.direction === "inbound" ? "red" : "blue";
  return item.direction === "inbound" ? "green" : "neutral";
}

function getUnmatchedChipTone(item) {
  if (item.status === "dismissed") return "neutral";
  if (item.status === "resolved") return "green";
  return item.type === "call" ? "red" : "amber";
}

function getLeadNextAction(lead) {
  const firstTask = lead.openTasks?.[0];
  if (typeof firstTask === "string" && firstTask.trim()) return firstTask.trim();
  if (firstTask?.title) return firstTask.title;
  if (firstTask?.content) return firstTask.content;
  if (lead.attentionReason) return lead.attentionReason;
  return pipelineLabel(lead.status);
}

function formatLead(lead) {
  const splitName = splitCustomerNameParts(lead.customer_name || "");
  return {
    id: lead.id,
    customerName: lead.customer_name || "NN Lead",
    firstName: splitName.firstName,
    lastName: splitName.lastName,
    assignedTo: lead.assigned_to ?? null,
    inventoryId: lead.inventory_id ?? null,
    rawPhone: lead.phone || "",
    phone: lead.phone ? formatPhoneNumber(lead.phone) : "Not available",
    email: lead.email || "No email on file",
    vehicleInterest: lead.vehicle_interest || "Vehicle inquiry",
    source: capitalizeSource(lead.source),
    status: lead.status,
    statusLabel: lead.status_label || pipelineLabel(lead.status),
    messagePreview: lead.message_preview || "No message captured yet.",
    message: lead.message || "No message captured yet.",
    assignedRep: lead.assigned_user_name || "Unassigned",
    stockNumber: lead.stock_number || "",
    vehicleYear: lead.vehicle_year || "",
    vehicleMake: lead.vehicle_make || "",
    vehicleModel: lead.vehicle_model || "",
    vehicleTrim: lead.vehicle_trim || "",
    vehicleCondition: lead.vehicle_condition || "",
    vehiclePrice: lead.vehicle_price || "",
    listingUrl: lead.listing_url || "",
    attentionReason: lead.attention_reason || "",
    aiSummary: lead.ai_summary || "",
    openTasks: lead.open_tasks || [],
    inventory: lead.inventory
      ? {
          id: lead.inventory.id,
          stockNumber: lead.inventory.stock_number || "",
          vin: lead.inventory.vin || "",
          year: lead.inventory.year || "",
          make: lead.inventory.make || "",
          model: lead.inventory.model || "",
          trim: lead.inventory.trim || "",
          price: lead.inventory.price ?? null,
          status: lead.inventory.status || "",
        }
      : null,
    lastActivity: formatRelative(lead.latest_activity_at || lead.updated_at),
    activities: [],
    timeline: [],
    tasks: [],
  };
}

function formatActivity(activity) {
  return { id: activity.id, type: activity.type, content: activity.content, createdAtLabel: formatRelative(activity.created_at) };
}

function formatTimelineItem(item) {
  const timestamp = item.timestamp || item.payload?.created_at || item.payload?.happened_at || null;
  return { id: item.id, type: item.type, timestampLabel: formatRelative(timestamp), payload: item.payload || {} };
}

function formatConversationItem(item) {
  return {
    id: item.id,
    type: item.type,
    leadId: item.lead_id,
    leadName: item.lead_name,
    leadStatusLabel: pipelineLabel(item.lead_status),
    vehicleInterest: item.vehicle_interest || "Vehicle inquiry",
    assignedRep: item.assigned_user_name || "Unassigned",
    actorName: item.actor_name || null,
    direction: item.direction || "unknown",
    externalNumber: item.external_number || "",
    preview: item.preview || "",
    happenedAtLabel: formatRelative(item.happened_at),
    durationSeconds: Number(item.duration_seconds || 0),
    recordingAvailable: Boolean(item.recording_available),
  };
}

function formatUnmatchedItem(item) {
  const phone = item.normalized_from_number || item.from_number || "";
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    direction: item.direction || "inbound",
    rawPhone: phone,
    phone: phone ? formatPhoneNumber(phone) : "Not available",
    preview: item.type === "sms" ? item.body_text || "No message body." : item.call_duration != null ? `Inbound call lasting ${item.call_duration}s` : "Inbound call",
    bodyText: item.body_text || "",
    callDuration: item.call_duration == null ? null : Number(item.call_duration),
    receivedAtLabel: formatRelative(item.received_at || item.created_at),
    providerExtensionId: item.provider_extension_id || null,
    resolvedLeadName: item.resolved_lead_name || null,
  };
}

function formatInventoryItem(item) {
  return {
    id: item.id,
    stockNumber: item.stock_number || "",
    vin: item.vin || "",
    year: item.year ?? null,
    make: item.make || "",
    model: item.model || "",
    trim: item.trim || "",
    price: item.price ?? null,
    mileage: item.mileage ?? null,
    condition: item.condition || "",
    status: item.status || "",
    source: item.source || "",
    leadCount: Number(item.lead_count || 0),
    updatedAtLabel: formatRelative(item.updated_at),
  };
}

function formatInventoryRun(run) {
  return {
    id: run.id,
    sourceName: run.source_name || "",
    fileName: run.file_name || "",
    status: run.status || "",
    rowsProcessed: Number(run.rows_processed || 0),
    rowsInserted: Number(run.rows_inserted || 0),
    rowsUpdated: Number(run.rows_updated || 0),
    completedAtLabel: formatRelative(run.completed_at || run.started_at),
  };
}

function formatInventoryImportError(item) {
  return { id: item.id, rowNumber: item.row_number ?? null, stockNumber: item.stock_number || "", vin: item.vin || "", errorMessage: item.error_message || "" };
}

export default function App() {
  const [authStatus, setAuthStatus] = useState("loading");
  const [authLoading, setAuthLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [viewMode, setViewMode] = useState("manager");
  const [activePage, setActivePage] = useState("dashboard");
  const [search, setSearch] = useState("");

  const [leads, setLeads] = useState([]);
  const [leadLibrary, setLeadLibrary] = useState([]);
  const [conversationFeed, setConversationFeed] = useState([]);
  const [unmatchedItems, setUnmatchedItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryImportRuns, setInventoryImportRuns] = useState([]);
  const [inventoryImportErrors, setInventoryImportErrors] = useState([]);
  const [inventorySyncStatus, setInventorySyncStatus] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [users, setUsers] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [executionSettings, setExecutionSettings] = useState(null);

  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedLeadDetails, setSelectedLeadDetails] = useState(null);
  const [selectedUnmatchedId, setSelectedUnmatchedId] = useState(null);
  const [repPreviewId, setRepPreviewId] = useState(null);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [leadDrawerOpen, setLeadDrawerOpen] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [appointmentOpen, setAppointmentOpen] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [savingLead, setSavingLead] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assigningLead, setAssigningLead] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsSuggestionLoading, setSmsSuggestionLoading] = useState(false);
  const [callLogging, setCallLogging] = useState(false);
  const [holdSubmitting, setHoldSubmitting] = useState(false);
  const [taskCompletingId, setTaskCompletingId] = useState(null);
  const [inventorySyncing, setInventorySyncing] = useState(false);
  const [inventoryImporting, setInventoryImporting] = useState(false);
  const [runningAutoSms, setRunningAutoSms] = useState(false);
  const [availabilityUpdatingId, setAvailabilityUpdatingId] = useState(null);
  const [unmatchedWorking, setUnmatchedWorking] = useState(false);

  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [newLeadForm, setNewLeadForm] = useState(emptyLeadForm);
  const [smsDraft, setSmsDraft] = useState("");
  const [assignTarget, setAssignTarget] = useState("");
  const [appointmentNote, setAppointmentNote] = useState("");
  const [unmatchedCreateName, setUnmatchedCreateName] = useState("");

  const deferredSearch = useDeferredValue(search);
  const isManagerViewAllowed = currentUser?.role === "admin" || currentUser?.role === "manager";
  const effectiveViewMode = isManagerViewAllowed ? viewMode : "rep";

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (!active) return;
        setCurrentUser(session.user);
        setViewMode(session.user?.role === "sales" ? "rep" : "manager");
        setActivePage(session.user?.role === "sales" ? "rep-home" : "dashboard");
        setAuthStatus("authenticated");
      })
      .catch((sessionError) => {
        if (!active) return;
        if (sessionError.status === 401) setAuthStatus("unauthenticated");
        else setError(sessionError.message || "Unable to verify your session.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (currentUser?.role === "sales") {
      setViewMode("rep");
      setActivePage((current) => (String(current).startsWith("rep-") ? current : "rep-home"));
    }
  }, [currentUser?.role]);

  useEffect(() => {
    if (!isManagerViewAllowed) {
      return;
    }

    if (viewMode === "manager" && String(activePage).startsWith("rep-")) {
      setActivePage("dashboard");
      return;
    }

    if (viewMode === "rep" && !String(activePage).startsWith("rep-")) {
      setActivePage("rep-home");
    }
  }, [activePage, isManagerViewAllowed, viewMode]);

  async function loadCoreData() {
    setBootLoading(true);
    try {
      const dashboardTask = getDashboardWorklist();
      const leadsTask = getLeads({ limit: 250 });
      const conversationsTask = getConversations(120);
      const unmatchedTask = getUnmatchedCommunications({ limit: 200 });
      const inventoryTask = getInventory({ limit: 200 });
      const usersTask = isManagerViewAllowed ? getUsers() : Promise.resolve({ items: [] });
      const assigneesTask = isManagerViewAllowed ? getAssignableUsers() : Promise.resolve({ items: [] });
      const settingsTask = isManagerViewAllowed ? getExecutionSettings() : Promise.resolve(null);
      const runsTask = getInventoryImportRuns(10);
      const errorsTask = isManagerViewAllowed ? getInventoryImportErrors({ source_type: "ftp_sync", limit: 6 }) : Promise.resolve({ items: [] });
      const syncTask = isManagerViewAllowed ? getInventorySyncStatus() : Promise.resolve(null);

      const [dashboard, allLeads, conversations, unmatched, inventory, team, assignable, settings, runs, importErrors, syncStatus] = await Promise.all([
        dashboardTask,
        leadsTask,
        conversationsTask,
        unmatchedTask,
        inventoryTask,
        usersTask,
        assigneesTask,
        settingsTask,
        runsTask,
        errorsTask,
        syncTask,
      ]);

      const attentionItems = (dashboard.attention_items || []).map(formatLead);
      setLeads(attentionItems);
      setLeadLibrary((allLeads.items || []).map(formatLead));
      setConversationFeed((conversations.items || []).map(formatConversationItem));
      const unmatchedList = (unmatched.items || []).map(formatUnmatchedItem);
      setUnmatchedItems(unmatchedList);
      setInventoryItems((inventory.items || []).map(formatInventoryItem));
      setInventoryImportRuns((runs.items || []).map(formatInventoryRun));
      setInventoryImportErrors((importErrors.items || []).map(formatInventoryImportError));
      setInventorySyncStatus(syncStatus);
      setNotifications(dashboard.notifications || []);
      setMetrics(dashboard.summary || emptyMetrics);
      setUsers(team.items || []);
      setAssignees(assignable.items || []);
      setExecutionSettings(settings);
      setSelectedLeadId((current) => current ?? attentionItems[0]?.id ?? allLeads.items?.[0]?.id ?? null);
      setSelectedUnmatchedId((current) => current ?? unmatchedList[0]?.id ?? null);
      setError("");
    } catch (loadError) {
      if (loadError.status === 401) {
        setAuthStatus("unauthenticated");
        setCurrentUser(null);
      } else {
        setError(loadError.message || "Unable to load the CRM.");
      }
    } finally {
      setBootLoading(false);
    }
  }

  useEffect(() => {
    if (authStatus === "authenticated") {
      loadCoreData();
    }
  }, [authStatus]);

  useEffect(() => {
    const sales = users.filter((user) => user.role === "sales");
    if (sales.length) {
      setRepPreviewId((current) => current ?? sales[0].id);
    }
  }, [users]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !selectedLeadId) {
      setSelectedLeadDetails(null);
      return;
    }

    let active = true;

    async function loadDetails() {
      try {
        setDetailLoading(true);
        const payload = await getLead(selectedLeadId);
        if (!active) return;
        setSelectedLeadDetails({
          ...formatLead(payload.lead),
          activities: (payload.activities || []).map(formatActivity),
          timeline: (payload.timeline || []).map(formatTimelineItem),
          tasks: payload.tasks || [],
        });
      } catch (loadError) {
        if (active) setError(loadError.message || "Unable to load lead details.");
      } finally {
        if (active) setDetailLoading(false);
      }
    }

    loadDetails();

    return () => {
      active = false;
    };
  }, [authStatus, selectedLeadId]);

  const selectedLead =
    selectedLeadDetails && Number(selectedLeadDetails.id) === Number(selectedLeadId)
      ? selectedLeadDetails
      : leadLibrary.find((lead) => Number(lead.id) === Number(selectedLeadId)) || leads.find((lead) => Number(lead.id) === Number(selectedLeadId)) || null;
  const selectedUnmatched = unmatchedItems.find((item) => Number(item.id) === Number(selectedUnmatchedId)) || null;

  useEffect(() => {
    if (!selectedLead) {
      setLeadForm(emptyLeadForm);
      setAssignTarget("");
      return;
    }
    setLeadForm({
      customer_name: selectedLead.customerName,
      phone: selectedLead.rawPhone,
      email: selectedLead.email === "No email on file" ? "" : selectedLead.email,
      source: String(selectedLead.source || "website").toLowerCase(),
      vehicle_interest: selectedLead.vehicleInterest === "Vehicle inquiry" ? "" : selectedLead.vehicleInterest,
      stock_number: selectedLead.stockNumber,
      message: selectedLead.message === "No message captured yet." ? "" : selectedLead.message,
    });
    setAssignTarget(selectedLead.assignedTo ? String(selectedLead.assignedTo) : "");
  }, [selectedLead]);

  const searchTerm = deferredSearch.trim().toLowerCase();
  const matchesTextSearch = (...values) =>
    !searchTerm || values.join(" ").toLowerCase().includes(searchTerm);

  const visibleAttentionLeads = leads.filter((lead) =>
    matchesTextSearch(
      lead.customerName,
      lead.vehicleInterest,
      lead.stockNumber,
      lead.phone,
      lead.rawPhone,
      lead.source,
      lead.messagePreview,
      lead.aiSummary,
      lead.attentionReason
    )
  );
  const visibleLeadLibrary = leadLibrary.filter((lead) =>
    matchesTextSearch(
      lead.customerName,
      lead.vehicleInterest,
      lead.stockNumber,
      lead.phone,
      lead.rawPhone,
      lead.source,
      lead.messagePreview,
      lead.aiSummary,
      lead.attentionReason
    )
  );
  const visibleConversationFeed = conversationFeed.filter((item) =>
    matchesTextSearch(item.leadName, item.vehicleInterest, item.externalNumber, item.preview, item.assignedRep, item.leadStatusLabel)
  );
  const visibleUnmatchedItems = unmatchedItems.filter((item) =>
    matchesTextSearch(item.phone, item.rawPhone, item.preview, item.status, item.type, item.resolvedLeadName, item.providerExtensionId)
  );
  const visibleInventoryItems = inventoryItems.filter((item) =>
    matchesTextSearch(item.stockNumber, item.vin, item.make, item.model, item.trim, item.condition, item.status, item.source)
  );

  const salesUsers = users.filter((user) => user.role === "sales");
  const activeRep =
    currentUser?.role === "sales"
      ? currentUser
      : salesUsers.find((user) => Number(user.id) === Number(repPreviewId)) || salesUsers[0] || null;

  const myLeadLibrary = activeRep ? visibleLeadLibrary.filter((lead) => Number(lead.assignedTo) === Number(activeRep.id)) : [];
  const myConversationFeed = activeRep ? visibleConversationFeed.filter((item) => item.assignedRep === activeRep.name || item.actorName === activeRep.name) : [];
  const myAppointments = myLeadLibrary.filter((lead) => lead.status === "appointment");
  const myUrgentLeads = myLeadLibrary.filter((lead) => lead.attentionReason || lead.status === "new");
  const myTasks = myLeadLibrary.flatMap((lead) =>
    (lead.openTasks || []).map((task, index) => ({
      id: task.id || `${lead.id}-${index}`,
      leadId: lead.id,
      leadName: lead.customerName,
      title: typeof task === "string" ? task : task.title || task.content || "Follow-up",
    }))
  );

  const visiblePipelineGroups = Object.fromEntries(
    pipelineStages.map((status) => [status, visibleLeadLibrary.filter((lead) => lead.status === status)])
  );
  const hotLeadRows = visibleAttentionLeads.slice(0, 6);
  const appointmentPreview = visibleLeadLibrary.filter((lead) => lead.status === "appointment").slice(0, 6);
  const repPerformance = salesUsers
    .map((user) => ({
      ...user,
      assignedLeadCount: visibleLeadLibrary.filter((lead) => Number(lead.assignedTo) === Number(user.id)).length,
      contactCount: visibleConversationFeed.filter((item) => item.assignedRep === user.name || item.actorName === user.name).length,
    }))
    .sort((left, right) => right.contactCount - left.contactCount || right.assignedLeadCount - left.assignedLeadCount)
    .slice(0, 4);

  const unreadNotificationCount = notifications.filter((item) => item.status !== "read").length;
  const missedCallRecoveryCount = unmatchedItems.filter((item) => item.status === "new" && item.type === "call").length;
  const openGrossPotential = visibleLeadLibrary.reduce((sum, lead) => sum + parseMoneyAmount(lead.vehiclePrice), 0);
  const routingOpenRepCount = salesUsers.filter((user) => user.is_active && user.is_available).length;

  const managerNav = [
    { id: "dashboard", label: "Dashboard", badge: metrics.needs_attention_count || hotLeadRows.length },
    { id: "leads", label: "Leads", badge: visibleLeadLibrary.length },
    { id: "lead-detail", label: "Lead Detail", badge: selectedLead ? 1 : 0 },
    { id: "comms", label: "Calls & SMS", badge: visibleConversationFeed.length },
    { id: "appointments", label: "Appointments", badge: appointmentPreview.length },
    { id: "deals", label: "Deals", badge: visibleLeadLibrary.filter((lead) => !["sold", "lost"].includes(lead.status)).length },
    { id: "inventory", label: "Inventory Match", badge: visibleInventoryItems.length },
    { id: "team", label: "Team", badge: salesUsers.length },
    { id: "unmatched", label: "Unknown Inbox", badge: unmatchedItems.filter((item) => item.status === "new").length },
  ];
  const repNav = [
    { id: "rep-home", label: "My Desk", badge: myLeadLibrary.length },
    { id: "rep-tasks", label: "My Follow-Ups", badge: myTasks.length },
    { id: "rep-inbox", label: "My Calls & SMS", badge: myConversationFeed.length },
    { id: "rep-day", label: "My Day", badge: myAppointments.length },
    { id: "rep-customer", label: "Customer View", badge: selectedLead ? 1 : 0 },
  ];

  const pageMeta = {
    dashboard: { title: "Dashboard", sub: "High-volume lead desk, appointments, performance, and missed-opportunity recovery." },
    leads: { title: "Lead Command Center", sub: "Dense operational lead table with source, ownership, urgency, and next-action control." },
    "lead-detail": { title: "Lead Detail Workspace", sub: "Three-column customer workspace with communication history, next steps, and inventory context." },
    comms: { title: "Calls & SMS Hub", sub: "Conversation-first workspace with customer context and missed-call recovery in the same flow." },
    appointments: { title: "Appointments", sub: "Compact agenda for showroom arrivals, confirmations, and rep follow-up." },
    deals: { title: "Deals Pipeline", sub: "Operational pipeline with stage clarity, urgency, ownership, and gross potential." },
    inventory: { title: "Inventory Match", sub: "Vehicle recommendation surface linked to active leads when exact inventory changes or sells." },
    team: { title: "Team & Routing", sub: "Ownership visibility, rep availability, texting execution, and store routing health." },
    unmatched: { title: "Unknown Inbox", sub: "Inbound calls and SMS that still need to be attached, converted, or dismissed." },
    "rep-home": { title: "My Desk", sub: "Focused on speed, follow-ups, calls, appointments, and today's closing opportunities." },
    "rep-tasks": { title: "My Follow-Ups", sub: "Rep-focused task stack with minimal clutter and fast completions." },
    "rep-inbox": { title: "My Calls & SMS", sub: "Live thread feed for this desk only, with direct jump back into the customer view." },
    "rep-day": { title: "My Day", sub: "Appointments, urgent conversations, and the rep's active working load in one place." },
    "rep-customer": { title: "Customer View", sub: "Single-customer workspace with actions, conversation context, and deal guidance." },
  };

  const shellData = {
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
    notificationsOpen,
    activePage,
    navItems: effectiveViewMode === "manager" ? managerNav : repNav,
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
    assignees,
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
    statusChoices,
    formatCurrencyCompact,
    buildVehicleLabel,
    getLeadChipTone,
    getConversationChipTone,
    getUnmatchedChipTone,
    getLeadNextAction,
    formatRelative,
  };

  function openLeadWorkspace(leadId, { page = null, drawer = true } = {}) {
    if (!leadId) return;
    setSelectedLeadId(Number(leadId));
    if (page) setActivePage(page);
    if (drawer) setLeadDrawerOpen(true);
  }

  async function handleLogin(email, password) {
    try {
      setAuthLoading(true);
      const session = await login(email, password);
      setCurrentUser(session.user);
      setViewMode(session.user?.role === "sales" ? "rep" : "manager");
      setActivePage(session.user?.role === "sales" ? "rep-home" : "dashboard");
      setAuthStatus("authenticated");
      setError("");
    } catch (loginError) {
      setError(loginError.message || "Unable to sign in.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      setCurrentUser(null);
      setAuthStatus("unauthenticated");
      setSelectedLeadId(null);
      setSelectedLeadDetails(null);
      setLeadDrawerOpen(false);
      setNotificationsOpen(false);
    }
  }

  async function refreshAfterMutation() {
    await loadCoreData();
  }

  async function handleCreateLead() {
    try {
      setSavingLead(true);
      const response = await createLead(newLeadForm);
      const createdLead = formatLead(response.lead || response);
      setSelectedLeadId(createdLead.id);
      setNewLeadForm(emptyLeadForm);
      setNewLeadOpen(false);
      setLeadDrawerOpen(true);
      setActivePage(effectiveViewMode === "manager" ? "lead-detail" : "rep-customer");
      await refreshAfterMutation();
      setError("");
    } catch (createError) {
      setError(createError.message || "Unable to create the lead.");
    } finally {
      setSavingLead(false);
    }
  }

  async function handleSaveLead() {
    if (!selectedLeadId || !selectedLead) return;
    try {
      setSavingLead(true);
      const response = await updateLead(selectedLeadId, { ...leadForm, status: selectedLead.status });
      setSelectedLeadDetails({
        ...formatLead(response),
        activities: selectedLeadDetails?.activities || [],
        timeline: selectedLeadDetails?.timeline || [],
        tasks: selectedLeadDetails?.tasks || [],
      });
      await refreshAfterMutation();
      setError("");
    } catch (saveError) {
      setError(saveError.message || "Unable to update lead details.");
    } finally {
      setSavingLead(false);
    }
  }

  async function handleStatusChange(nextStatus) {
    if (!selectedLeadId) return;
    try {
      setStatusUpdating(true);
      const payload = await updateLeadStatus(selectedLeadId, nextStatus);
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      await refreshAfterMutation();
      setError("");
    } catch (statusError) {
      setError(statusError.message || "Unable to update lead status.");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleAssignLead() {
    if (!selectedLeadId || !assignTarget) return;
    try {
      setAssigningLead(true);
      const payload = await assignLead(selectedLeadId, Number(assignTarget));
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      setAssignOpen(false);
      await refreshAfterMutation();
      setError("");
    } catch (assignError) {
      setError(assignError.message || "Unable to assign lead.");
    } finally {
      setAssigningLead(false);
    }
  }

  async function handleSendSms() {
    if (!selectedLeadId || !smsDraft.trim()) return;
    try {
      setSmsSending(true);
      const payload = await sendLeadSms(selectedLeadId, smsDraft.trim());
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      setSmsDraft("");
      setSmsOpen(false);
      await refreshAfterMutation();
      setError("");
    } catch (smsError) {
      setError(smsError.message || "Unable to send SMS.");
    } finally {
      setSmsSending(false);
    }
  }

  async function handleGenerateSmsSuggestion() {
    if (!selectedLeadId) return;
    try {
      setSmsSuggestionLoading(true);
      const response = await getLeadSmsSuggestion(selectedLeadId, { intent: "follow_up" });
      if (response?.suggestion) setSmsDraft(response.suggestion);
      setError("");
    } catch (suggestionError) {
      setError(suggestionError.message || "Unable to generate an AI SMS suggestion.");
    } finally {
      setSmsSuggestionLoading(false);
    }
  }

  async function handleLogCall() {
    if (!selectedLeadId) return;
    try {
      setCallLogging(true);
      await logLeadCall(selectedLeadId);
      await refreshAfterMutation();
      setError("");
    } catch (callError) {
      setError(callError.message || "Unable to log the call.");
    } finally {
      setCallLogging(false);
    }
  }

  async function handleBookAppointment() {
    if (!selectedLeadId) return;
    try {
      setStatusUpdating(true);
      if (appointmentNote.trim()) {
        await updateLead(selectedLeadId, {
          ...leadForm,
          message: [leadForm.message, `Appointment note: ${appointmentNote.trim()}`].filter(Boolean).join("\n"),
          status: selectedLead?.status || "new",
        });
      }
      const payload = await updateLeadStatus(selectedLeadId, "appointment");
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      setAppointmentNote("");
      setAppointmentOpen(false);
      await refreshAfterMutation();
      setError("");
    } catch (appointmentError) {
      setError(appointmentError.message || "Unable to book the appointment.");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleCompleteTask(taskId) {
    try {
      setTaskCompletingId(taskId);
      await completeTask(taskId);
      const payload = await getLead(selectedLeadId);
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      await refreshAfterMutation();
      setError("");
    } catch (taskError) {
      setError(taskError.message || "Unable to complete the task.");
    } finally {
      setTaskCompletingId(null);
    }
  }

  async function handleHoldVehicle() {
    if (!selectedLeadId) return;
    try {
      setHoldSubmitting(true);
      const payload = await holdLeadVehicle(selectedLeadId);
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      await refreshAfterMutation();
      setError("");
    } catch (holdError) {
      setError(holdError.message || "Unable to create the vehicle hold.");
    } finally {
      setHoldSubmitting(false);
    }
  }

  async function handleMarkNotificationRead(notificationId) {
    try {
      await markNotificationRead(notificationId);
      setNotifications((current) => current.map((item) => (Number(item.id) === Number(notificationId) ? { ...item, status: "read" } : item)));
      setMetrics((current) => ({ ...current, unread_notification_count: Math.max(0, Number(current.unread_notification_count || 0) - 1) }));
    } catch (notificationError) {
      setError(notificationError.message || "Unable to update the notification.");
    }
  }

  async function handleAssignUnmatched(leadId) {
    if (!selectedUnmatchedId || !leadId) return;
    try {
      setUnmatchedWorking(true);
      const payload = await assignUnmatchedCommunication(selectedUnmatchedId, Number(leadId));
      setSelectedLeadId(payload.lead.id);
      setLeadDrawerOpen(true);
      setActivePage("lead-detail");
      await refreshAfterMutation();
      setError("");
    } catch (assignError) {
      setError(assignError.message || "Unable to attach the communication to a lead.");
    } finally {
      setUnmatchedWorking(false);
    }
  }

  async function handleCreateLeadFromUnmatched() {
    if (!selectedUnmatchedId) return;
    try {
      setUnmatchedWorking(true);
      const response = await createLeadFromUnmatched(selectedUnmatchedId, { customer_name: unmatchedCreateName || undefined });
      setSelectedLeadId(response.lead.id);
      setLeadDrawerOpen(true);
      setUnmatchedCreateName("");
      setActivePage("lead-detail");
      await refreshAfterMutation();
      setError("");
    } catch (createError) {
      setError(createError.message || "Unable to create a lead from this communication.");
    } finally {
      setUnmatchedWorking(false);
    }
  }

  async function handleDismissUnmatched() {
    if (!selectedUnmatchedId) return;
    try {
      setUnmatchedWorking(true);
      await dismissUnmatchedCommunication(selectedUnmatchedId);
      await refreshAfterMutation();
      setError("");
    } catch (dismissError) {
      setError(dismissError.message || "Unable to dismiss the communication.");
    } finally {
      setUnmatchedWorking(false);
    }
  }

  async function handleInventorySync() {
    try {
      setInventorySyncing(true);
      await syncInventoryNow();
      await refreshAfterMutation();
      setError("");
    } catch (syncError) {
      setError(syncError.message || "Unable to sync inventory.");
    } finally {
      setInventorySyncing(false);
    }
  }

  async function handleInventoryImport(file) {
    if (!file) return;
    try {
      setInventoryImporting(true);
      const csvText = await file.text();
      await importInventory({ file_name: file.name, csv_text: csvText, source_name: "manual_upload", mark_missing_inactive: false });
      await refreshAfterMutation();
      setError("");
    } catch (importError) {
      setError(importError.message || "Unable to import inventory.");
    } finally {
      setInventoryImporting(false);
    }
  }

  async function handleToggleAvailability(user) {
    try {
      setAvailabilityUpdatingId(user.id);
      const response = await updateUserAvailability(user.id, { is_available: !user.is_available });
      const updated = response?.item || null;
      if (updated) {
        setUsers((current) => current.map((item) => (Number(item.id) === Number(updated.id) ? { ...item, ...updated } : item)));
        if (Number(currentUser?.id) === Number(updated.id)) setCurrentUser((current) => (current ? { ...current, ...updated } : current));
      }
      setError("");
    } catch (toggleError) {
      setError(toggleError.message || "Unable to update rep availability.");
    } finally {
      setAvailabilityUpdatingId(null);
    }
  }

  async function handleRunAutoSms() {
    try {
      setRunningAutoSms(true);
      await runAutoSmsNow();
      await refreshAfterMutation();
      setError("");
    } catch (runError) {
      setError(runError.message || "Unable to run automatic texting.");
    } finally {
      setRunningAutoSms(false);
    }
  }

  if (authStatus === "loading" || (authStatus === "authenticated" && bootLoading)) {
    return <div className="crm-loading-screen"><div className="crm-loading-card"><div className="crm-loading-mark" /><p>Loading CRM session</p></div></div>;
  }
  if (authStatus !== "authenticated") {
    return <LoginPage onSubmit={handleLogin} loading={authLoading} error={error} />;
  }

  const actions = {
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
    onLogout: handleLogout,
    onMarkNotificationRead: handleMarkNotificationRead,
    onOpenLead: openLeadWorkspace,
    onAssignUnmatched: handleAssignUnmatched,
    onCreateLeadFromUnmatched: handleCreateLeadFromUnmatched,
    onDismissUnmatched: handleDismissUnmatched,
    onInventorySync: handleInventorySync,
    onInventoryImport: handleInventoryImport,
    onToggleAvailability: handleToggleAvailability,
    onRunAutoSms: handleRunAutoSms,
  };

  return (
    <>
      <CrmShell data={shellData} actions={actions} />

      <LeadDrawerPanel
        open={leadDrawerOpen}
        lead={selectedLead}
        detailLoading={detailLoading}
        leadForm={leadForm}
        onLeadFormChange={setLeadForm}
        onSaveLead={handleSaveLead}
        savingLead={savingLead}
        onStatusChange={handleStatusChange}
        statusUpdating={statusUpdating}
        assignees={assignees}
        assignTarget={assignTarget}
        onAssignTargetChange={setAssignTarget}
        onAssignLead={() => setAssignOpen(true)}
        onOpenSms={() => setSmsOpen(true)}
        onOpenAppointment={() => setAppointmentOpen(true)}
        onLogCall={handleLogCall}
        callLogging={callLogging}
        onHoldVehicle={handleHoldVehicle}
        holdSubmitting={holdSubmitting}
        onCompleteTask={handleCompleteTask}
        taskCompletingId={taskCompletingId}
        onClose={() => setLeadDrawerOpen(false)}
        statusChoices={statusChoices}
      />

      <ModalFrame open={newLeadOpen} title="Create lead" onClose={() => setNewLeadOpen(false)}>
        <div className="form-grid">
          <Field label="Customer name"><input value={newLeadForm.customer_name} onChange={(event) => setNewLeadForm((current) => ({ ...current, customer_name: event.target.value }))} /></Field>
          <Field label="Source"><select value={newLeadForm.source} onChange={(event) => setNewLeadForm((current) => ({ ...current, source: event.target.value }))}><option value="website">Website</option><option value="marketplace">Marketplace</option><option value="google_ads">Google Ads</option><option value="phone">Phone</option><option value="ringcentral">RingCentral</option></select></Field>
          <Field label="Phone"><input value={newLeadForm.phone} onChange={(event) => setNewLeadForm((current) => ({ ...current, phone: event.target.value }))} /></Field>
          <Field label="Email"><input value={newLeadForm.email} onChange={(event) => setNewLeadForm((current) => ({ ...current, email: event.target.value }))} /></Field>
          <Field label="Vehicle interest"><input value={newLeadForm.vehicle_interest} onChange={(event) => setNewLeadForm((current) => ({ ...current, vehicle_interest: event.target.value }))} /></Field>
          <Field label="Stock number"><input value={newLeadForm.stock_number} onChange={(event) => setNewLeadForm((current) => ({ ...current, stock_number: event.target.value }))} /></Field>
          <Field label="Message" full><textarea value={newLeadForm.message} onChange={(event) => setNewLeadForm((current) => ({ ...current, message: event.target.value }))} /></Field>
        </div>
        <div className="modal-actions"><button type="button" className="small-btn" onClick={() => setNewLeadOpen(false)}>Cancel</button><button type="button" className="cta" onClick={handleCreateLead} disabled={savingLead}>{savingLead ? "Creating..." : "Create lead"}</button></div>
      </ModalFrame>

      <ModalFrame open={smsOpen} title={selectedLead ? `Text ${selectedLead.customerName}` : "Text customer"} onClose={() => setSmsOpen(false)}>
        <Field label="Message"><textarea value={smsDraft} onChange={(event) => setSmsDraft(event.target.value)} placeholder="Write your text message" /></Field>
        <div className="toolbar"><button type="button" className="small-btn" onClick={handleGenerateSmsSuggestion} disabled={smsSuggestionLoading}>{smsSuggestionLoading ? "Generating..." : "AI suggestion"}</button></div>
        <div className="modal-actions"><button type="button" className="small-btn" onClick={() => setSmsOpen(false)}>Cancel</button><button type="button" className="cta" onClick={handleSendSms} disabled={smsSending || !selectedLead}>{smsSending ? "Sending..." : "Send SMS"}</button></div>
      </ModalFrame>

      <ModalFrame open={assignOpen} title={selectedLead ? `Assign ${selectedLead.customerName}` : "Assign lead"} onClose={() => setAssignOpen(false)}>
        <Field label="Assign to"><select value={assignTarget} onChange={(event) => setAssignTarget(event.target.value)}><option value="">Select a rep</option>{assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <div className="modal-actions"><button type="button" className="small-btn" onClick={() => setAssignOpen(false)}>Cancel</button><button type="button" className="cta" onClick={handleAssignLead} disabled={assigningLead || !assignTarget}>{assigningLead ? "Assigning..." : "Assign lead"}</button></div>
      </ModalFrame>

      <ModalFrame open={appointmentOpen} title={selectedLead ? `Book appointment for ${selectedLead.customerName}` : "Book appointment"} onClose={() => setAppointmentOpen(false)}>
        <Field label="Appointment note"><textarea value={appointmentNote} onChange={(event) => setAppointmentNote(event.target.value)} placeholder="Optional note for the customer timeline" /></Field>
        <div className="modal-actions"><button type="button" className="small-btn" onClick={() => setAppointmentOpen(false)}>Cancel</button><button type="button" className="cta" onClick={handleBookAppointment} disabled={statusUpdating || !selectedLead}>{statusUpdating ? "Saving..." : "Book appointment"}</button></div>
      </ModalFrame>
    </>
  );
}
