import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { Menu, MoonStar, Search, SunMedium, X } from "lucide-react";

import { AttentionLeadCard } from "./components/AttentionLeadCard";
import { InventoryPanel } from "./components/InventoryPanel";
import { LeadAssignmentBoard } from "./components/LeadAssignmentBoard";
import { LeadDetailsPanel } from "./components/LeadDetailsPanel";
import { LeadPipelineBoard } from "./components/LeadPipelineBoard";
import { LoginPage } from "./components/LoginPage";
import { MetricCard } from "./components/MetricCard";
import { NotificationTray } from "./components/NotificationTray";
import { Sidebar } from "./components/Sidebar";
import { TeamManagementPanel } from "./components/TeamManagementPanel";
import { UnmatchedCommunicationPanel } from "./components/UnmatchedCommunicationPanel";
import {
  autoAssignLeads,
  assignUnmatchedCommunication,
  assignLead,
  completeTask,
  createUser,
  createLeadFromUnmatched,
  dismissUnmatchedCommunication,
  deleteUser,
  getAssignableUsers,
  getConversations,
  getDashboardWorklist,
  getExecutionSettings,
  getInventory,
  getInventoryImportErrors,
  getInventoryImportRuns,
  getInventoryLeads,
  getInventorySyncStatus,
  getLead,
  getLeads,
  getLeadSmsSuggestion,
  getUnmatchedCommunications,
  holdLeadVehicle,
    importInventory,
    getSession,
    runAutoSmsNow,
    getUsers,
    login,
  logLeadCall,
  logout,
  markNotificationRead,
  sendLeadSms,
  syncInventoryNow,
  updateExecutionSettings,
  updateUserAvailability,
  updateLead,
  updateLeadStatus,
} from "./lib/api";
import { formatPhoneNumber, pipelineLabel } from "./lib/format";
import { splitCustomerNameParts } from "./lib/leadNames";

const organizedGroups = ["contacted", "appointment", "negotiation", "sold", "lost"];
const pipelineStages = ["new", ...organizedGroups];

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

function formatLead(lead) {
  const splitName = splitCustomerNameParts(lead.customer_name || "");
  return {
    id: lead.id,
    customerName: lead.customer_name,
    firstName: splitName.firstName,
    lastName: splitName.lastName,
    assignedTo: lead.assigned_to ?? null,
    inventoryId: lead.inventory_id ?? null,
    rawPhone: lead.phone || "",
    phone: lead.phone ? formatPhoneNumber(lead.phone) : "Not available",
    email: lead.email || "No email on file",
    vehicleInterest: lead.vehicle_interest || "Vehicle inquiry",
    source: capitalizeSource(lead.source),
    sourceDetail: capitalizeSource(lead.source),
    status: lead.status,
    statusLabel: lead.status_label || pipelineLabel(lead.status),
    stage: lead.status_label || pipelineLabel(lead.status),
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
    leadType: lead.lead_type || "",
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
    createdAtLabel: formatRelative(lead.created_at),
    updatedAtLabel: formatRelative(lead.updated_at),
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    listingUrl: lead.listing_url || "",
    attentionReason: lead.attention_reason || "",
    attentionReasonCode: lead.attention_reason_code || "",
    aiSummary: lead.ai_summary || "",
    openTasks: lead.open_tasks || [],
    activities: [],
    tasks: [],
  };
}

function formatActivity(activity) {
  return {
    id: activity.id,
    type: activity.type,
    content: activity.content,
    createdAtLabel: formatRelative(activity.created_at),
  };
}

function formatTimelineItem(item) {
  const timestamp = item.timestamp || item.payload?.created_at || item.payload?.happened_at || null;
  return {
    id: item.id,
    type: item.type,
    timestamp,
    timestampLabel: formatRelative(timestamp),
    userName: item.user_name || item.payload?.actor_name || null,
    payload: item.payload || {},
  };
}

function formatConversationItem(item) {
  return {
    id: item.id,
    type: item.type,
    leadId: item.lead_id,
    leadName: item.lead_name,
    leadStatus: item.lead_status,
    leadStatusLabel: pipelineLabel(item.lead_status),
    vehicleInterest: item.vehicle_interest || "Vehicle inquiry",
    stockNumber: item.stock_number || "",
    assignedRep: item.assigned_user_name || "Unassigned",
    actorName: item.actor_name || null,
    direction: item.direction || "unknown",
    externalNumber: item.external_number || "",
    preview: item.preview || "",
    happenedAt: item.happened_at || null,
    happenedAtLabel: formatRelative(item.happened_at),
    result: item.result || null,
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
    preview:
      item.type === "sms"
        ? item.body_text || "No message body."
        : item.call_duration != null
          ? `Inbound call lasting ${item.call_duration}s`
          : "Inbound call",
    bodyText: item.body_text || "",
    callDuration: item.call_duration == null ? null : Number(item.call_duration),
    receivedAt: item.received_at || item.created_at || null,
    receivedAtLabel: formatRelative(item.received_at || item.created_at),
    providerMessageId: item.provider_message_id || null,
    providerCallId: item.provider_call_id || null,
    crmUserId: item.crm_user_id == null ? null : Number(item.crm_user_id),
    providerExtensionId: item.provider_extension_id || null,
    resolvedLeadId: item.resolved_lead_id == null ? null : Number(item.resolved_lead_id),
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
    bodyStyle: item.body_style || "",
    drivetrain: item.drivetrain || "",
    transmission: item.transmission || "",
    engine: item.engine || "",
    fuelType: item.fuel_type || "",
    exteriorColor: item.exterior_color || "",
    interiorColor: item.interior_color || "",
    dateInStock: item.date_in_stock || null,
    isActive: Boolean(item.is_active),
    status: item.status || "",
    source: item.source || "",
    sourceFile: item.source_file || "",
    lastSeenAt: item.last_seen_at || null,
    firstSeenAt: item.first_seen_at || null,
    updatedAt: item.updated_at || null,
    leadCount: Number(item.lead_count || 0),
  };
}

function formatInventoryRun(run) {
  return {
    id: run.id,
    sourceType: run.source_type || "",
    sourceName: run.source_name || "",
    fileName: run.file_name || "",
    status: run.status || "",
    rowsTotal: Number(run.rows_total || 0),
    rowsProcessed: Number(run.rows_processed || 0),
    rowsInserted: Number(run.rows_inserted || 0),
    rowsUpdated: Number(run.rows_updated || 0),
    rowsSkipped: Number(run.rows_skipped || 0),
    rowsDeactivated: Number(run.rows_deactivated || 0),
    failedCount: Number(run.failed_count || 0),
    errorCount: Number(run.error_count || 0),
    startedAt: run.started_at || null,
    completedAt: run.completed_at || null,
    metadata: run.metadata_json || null,
  };
}

function formatInventoryImportError(item) {
  return {
    id: item.id,
    importRunId: item.import_run_id,
    rowNumber: item.row_number ?? null,
    stockNumber: item.stock_number || "",
    vin: item.vin || "",
    rawIdentifier: item.raw_identifier || "",
    errorMessage: item.error_message || "",
    sourceType: item.source_type || "",
    fileName: item.file_name || "",
  };
}

function buildAnalyticsSnapshot({
  leadLibrary = [],
  attentionLeads = [],
  organizedLeadGroups = {},
  conversationFeed = [],
  inventoryItems = [],
}) {
  const statusCounts = {};
  const sourceCounts = {};

  leadLibrary.forEach((lead) => {
    statusCounts[lead.status] = (statusCounts[lead.status] || 0) + 1;
    sourceCounts[lead.source] = (sourceCounts[lead.source] || 0) + 1;
  });

  return {
    totalLeads: leadLibrary.length,
    needsAttention: attentionLeads.length,
    organizedCount: Object.values(organizedLeadGroups).reduce((sum, items) => sum + items.length, 0),
    unassignedCount: leadLibrary.filter((lead) => !lead.assignedTo).length,
    conversationsCount: conversationFeed.length,
    inventoryCount: inventoryItems.length,
    statusCounts,
    sourceCounts,
  };
}

const emptyMetrics = {
  needs_attention_count: 0,
  overdue_task_count: 0,
  unread_notification_count: 0,
};

function getFirstOrganizedLeadId(groups = {}) {
  for (const group of organizedGroups) {
    const candidate = groups[group]?.[0];
    if (candidate) {
      return candidate.id;
    }
  }

  return null;
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const storedTheme = window.localStorage.getItem("crm-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }

    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const storedState = window.localStorage.getItem("crm-sidebar-open");
    if (storedState === "true" || storedState === "false") {
      return storedState === "true";
    }

    return false;
  });
  const [authStatus, setAuthStatus] = useState("loading");
  const [currentUser, setCurrentUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [leadLibrary, setLeadLibrary] = useState([]);
  const [organizedLeadGroups, setOrganizedLeadGroups] = useState({
    contacted: [],
    appointment: [],
    negotiation: [],
    sold: [],
    lost: [],
  });
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryImportRuns, setInventoryImportRuns] = useState([]);
  const [inventorySyncStatus, setInventorySyncStatus] = useState(null);
  const [inventoryImportErrors, setInventoryImportErrors] = useState([]);
  const [inventoryLeadLookup, setInventoryLeadLookup] = useState({});
  const [unmatchedItems, setUnmatchedItems] = useState([]);
  const [conversationFeed, setConversationFeed] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedAutoAssignLeadIds, setSelectedAutoAssignLeadIds] = useState([]);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [selectedLeadDetails, setSelectedLeadDetails] = useState(null);
  const [selectedUnmatchedId, setSelectedUnmatchedId] = useState(null);
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [users, setUsers] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [query, setQuery] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [unmatchedStatusFilter, setUnmatchedStatusFilter] = useState("new");
  const [inventoryFilters, setInventoryFilters] = useState({
    status: "",
    make: "",
    model: "",
    stockNumber: "",
    vin: "",
  });
  const [loading, setLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [bulkAutoAssigning, setBulkAutoAssigning] = useState(false);
  const [leadUpdating, setLeadUpdating] = useState(false);
  const [callLogging, setCallLogging] = useState(false);
    const [holdSubmitting, setHoldSubmitting] = useState(false);
    const [smsSending, setSmsSending] = useState(false);
    const [inventoryImporting, setInventoryImporting] = useState(false);
    const [inventorySyncing, setInventorySyncing] = useState(false);
  const [unmatchedAssigning, setUnmatchedAssigning] = useState(false);
  const [unmatchedCreating, setUnmatchedCreating] = useState(false);
  const [unmatchedDismissing, setUnmatchedDismissing] = useState(false);
  const [taskCompletingId, setTaskCompletingId] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [availabilityUpdatingId, setAvailabilityUpdatingId] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [leadLibraryLoaded, setLeadLibraryLoaded] = useState(false);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [unmatchedLoaded, setUnmatchedLoaded] = useState(false);
  const [conversationFeedLoaded, setConversationFeedLoaded] = useState(false);
  const [executionSettings, setExecutionSettings] = useState(null);
  const [executionSettingsLoading, setExecutionSettingsLoading] = useState(false);
  const [executionSettingsSaving, setExecutionSettingsSaving] = useState(false);
  const [autoSmsRunning, setAutoSmsRunning] = useState(false);
  const [smsSuggestionLoading, setSmsSuggestionLoading] = useState(false);
  const [draggingLeadId, setDraggingLeadId] = useState(null);
  const [pipelineMovingLeadId, setPipelineMovingLeadId] = useState(null);
  const [assignmentDraggingLeadId, setAssignmentDraggingLeadId] = useState(null);
  const [assignmentMovingLeadId, setAssignmentMovingLeadId] = useState(null);
  const [error, setError] = useState("");
  const [inventoryImportForm, setInventoryImportForm] = useState({
    sourceName: "",
    markMissingInactive: false,
  });
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "sales",
  });
  const deferredQuery = useDeferredValue(query);
  const showLeadModal = leadModalOpen && !["Analytics", "Unmatched"].includes(activeSection) && Boolean(selectedLeadId);

  function openLeadModal(leadId) {
    if (!leadId) {
      return;
    }

    startTransition(() => {
      setSelectedLeadId(Number(leadId));
      setLeadModalOpen(true);
      setError("");
    });
  }

  useEffect(() => {
    if (activeSection !== "Analytics") {
      return;
    }

    startTransition(() => {
      setActiveSection("Dashboard");
    });
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "Assignments") {
      return;
    }

    if (currentUser?.role === "admin" || currentUser?.role === "manager") {
      return;
    }

    startTransition(() => {
      setActiveSection("Leads");
    });
  }, [activeSection, currentUser?.role]);

  useEffect(() => {
    if (activeSection !== "Intake") {
      return;
    }

    startTransition(() => {
      setActiveSection("Leads");
    });
  }, [activeSection]);

  useEffect(() => {
    if (!showLeadModal) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setLeadModalOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showLeadModal]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.body.classList.toggle("theme-light", theme === "light");
    document.body.classList.toggle("theme-dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("crm-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("crm-sidebar-open", String(sidebarOpen));
  }, [sidebarOpen]);

  async function refreshWorklist({ preserveSelection = true } = {}) {
    const payload = await getDashboardWorklist();
    const nextAttention = (payload.attention_items || []).map(formatLead);
    const nextOrganized = Object.fromEntries(
      organizedGroups.map((group) => [group, (payload.organized_groups?.[group] || []).map(formatLead)])
    );
    const nextSelectedId =
      preserveSelection && selectedLeadId
        ? selectedLeadId
        : nextAttention[0]?.id || getFirstOrganizedLeadId(nextOrganized) || null;

    setLeads(nextAttention);
    setOrganizedLeadGroups(nextOrganized);
    setMetrics(payload.summary || emptyMetrics);
    setNotifications(payload.notifications || []);
    setSelectedLeadId(nextSelectedId);
    setError("");
  }

  async function loadLeadLibrary({ preserveSelection = true } = {}) {
    setLibraryLoading(true);
    try {
      const payload = await getLeads({ limit: 250 });
      const nextLeads = (payload.items || []).map(formatLead);
      setLeadLibrary(nextLeads);
      setLeadLibraryLoaded(true);
      if ((!preserveSelection || !selectedLeadId) && nextLeads[0]) {
        setSelectedLeadId(nextLeads[0].id);
      }
      if (selectedLeadId && !nextLeads.some((lead) => lead.id === selectedLeadId)) {
        setSelectedLeadId(nextLeads[0]?.id || null);
      }
    } finally {
      setLibraryLoading(false);
    }
  }

  async function loadInventoryData() {
    setInventoryLoading(true);
    try {
      const managerCanSync = currentUser?.role === "admin" || currentUser?.role === "manager";
      const [inventoryResult, runsResult, syncStatusResult, errorsResult] = await Promise.allSettled([
        getInventory({
          limit: 250,
          status: inventoryFilters.status,
          make: inventoryFilters.make,
          model: inventoryFilters.model,
          stock_number: inventoryFilters.stockNumber,
          vin: inventoryFilters.vin,
        }),
        getInventoryImportRuns(10),
        managerCanSync ? getInventorySyncStatus() : Promise.resolve(null),
        managerCanSync ? getInventoryImportErrors({ source_type: "ftp_sync", limit: 10 }) : Promise.resolve({ items: [] }),
      ]);

      if (inventoryResult.status !== "fulfilled") {
        throw inventoryResult.reason;
      }

      setInventoryItems((inventoryResult.value.items || []).map(formatInventoryItem));
      setInventoryImportRuns(
        runsResult.status === "fulfilled" ? (runsResult.value.items || []).map(formatInventoryRun) : []
      );
      setInventorySyncStatus(syncStatusResult.status === "fulfilled" ? syncStatusResult.value : null);
      setInventoryImportErrors(
        errorsResult.status === "fulfilled" ? (errorsResult.value.items || []).map(formatInventoryImportError) : []
      );
      setInventoryLoaded(true);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function handleLoadInventoryLeads(inventoryId, { force = false } = {}) {
    const normalizedInventoryId = Number(inventoryId);
    if (!Number.isInteger(normalizedInventoryId) || normalizedInventoryId <= 0) {
      return;
    }

    const cached = inventoryLeadLookup[normalizedInventoryId];
    if (!force && cached?.loaded && !cached.loading) {
      return;
    }

    setInventoryLeadLookup((current) => ({
      ...current,
      [normalizedInventoryId]: {
        items: current[normalizedInventoryId]?.items || [],
        loading: true,
        loaded: current[normalizedInventoryId]?.loaded || false,
        error: "",
      },
    }));

    try {
      const payload = await getInventoryLeads(normalizedInventoryId, 100);
      setInventoryLeadLookup((current) => ({
        ...current,
        [normalizedInventoryId]: {
          items: (payload.items || []).map(formatLead),
          loading: false,
          loaded: true,
          error: "",
        },
      }));
    } catch (loadError) {
      setInventoryLeadLookup((current) => ({
        ...current,
        [normalizedInventoryId]: {
          items: current[normalizedInventoryId]?.items || [],
          loading: false,
          loaded: false,
          error: loadError.message || "Unable to load linked leads.",
        },
      }));
      setError(loadError.message || "Unable to load linked leads.");
    }
  }

  async function handleSyncInventoryNow() {
    setInventorySyncing(true);
    try {
      await syncInventoryNow();
      await loadInventoryData();
    } finally {
      setInventorySyncing(false);
    }
  }

  async function loadUnmatchedQueue({ preserveSelection = true } = {}) {
    setUnmatchedLoading(true);
    try {
      const payload = await getUnmatchedCommunications({
        limit: 200,
        status: unmatchedStatusFilter === "all" ? "" : unmatchedStatusFilter,
      });
      const items = (payload.items || []).map(formatUnmatchedItem);
      setUnmatchedItems(items);
      setUnmatchedLoaded(true);
      if ((!preserveSelection || !selectedUnmatchedId) && items[0]) {
        setSelectedUnmatchedId(items[0].id);
      }
      if (selectedUnmatchedId && !items.some((item) => item.id === selectedUnmatchedId)) {
        setSelectedUnmatchedId(items[0]?.id || null);
      }
    } finally {
      setUnmatchedLoading(false);
    }
  }

  async function loadConversationFeed({ preserveSelection = true } = {}) {
    setConversationLoading(true);
    try {
      const payload = await getConversations(80);
      const items = (payload.items || []).map(formatConversationItem);
      setConversationFeed(items);
      setConversationFeedLoaded(true);
      if ((!preserveSelection || !selectedLeadId) && items[0]?.leadId) {
        setSelectedLeadId(items[0].leadId);
      }
      if (selectedLeadId && !items.some((item) => Number(item.leadId) === Number(selectedLeadId))) {
        setSelectedLeadId(items[0]?.leadId || null);
      }
    } finally {
      setConversationLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const session = await getSession();
        if (!active) {
          return;
        }

        setCurrentUser(session.user);
        setAuthStatus("authenticated");
        setError("");
      } catch (sessionError) {
        if (!active) {
          return;
        }

        if (sessionError.status === 401) {
          setAuthStatus("unauthenticated");
          setCurrentUser(null);
          setLoading(false);
          return;
        }

        setError(sessionError.message || "Unable to verify your session.");
      }
    }

    initialize();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    let active = true;

    async function loadDashboard() {
      try {
        setLoading(true);
        const payload = await getDashboardWorklist();

        if (!active) {
          return;
        }

        const nextAttention = (payload.attention_items || []).map(formatLead);
        const nextOrganized = Object.fromEntries(
          organizedGroups.map((group) => [group, (payload.organized_groups?.[group] || []).map(formatLead)])
        );
        setLeads(nextAttention);
        setOrganizedLeadGroups(nextOrganized);
        setMetrics(payload.summary || emptyMetrics);
        setNotifications(payload.notifications || []);
        setSelectedLeadId((current) => current ?? nextAttention[0]?.id ?? getFirstOrganizedLeadId(nextOrganized) ?? null);
        setError("");
      } catch (loadError) {
        if (!active) {
          return;
        }

        if (loadError.status === 401) {
          setAuthStatus("unauthenticated");
          setCurrentUser(null);
          setSelectedLeadId(null);
          setSelectedLeadDetails(null);
          return;
        }

        setError(loadError.message || "Unable to load CRM dashboard.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    let cancelled = false;

    async function loadSectionData() {
      try {
        if (["Leads", "Pipeline", "Assignments", "Analytics", "Unmatched"].includes(activeSection) && !leadLibraryLoaded) {
          await loadLeadLibrary();
        }

        if ((activeSection === "Inventory" || !inventoryLoaded) && authStatus === "authenticated") {
          await loadInventoryData();
        }

        if (["Conversations", "Analytics"].includes(activeSection) && !conversationFeedLoaded) {
          await loadConversationFeed();
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load CRM section.");
        }
      }
    }

    loadSectionData();

    return () => {
      cancelled = true;
    };
  }, [activeSection, authStatus, conversationFeedLoaded, leadLibraryLoaded, inventoryLoaded]);

  useEffect(() => {
    if (authStatus !== "authenticated" || activeSection !== "Inventory") {
      return;
    }

    let cancelled = false;

    async function refreshInventory() {
      try {
        await loadInventoryData();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load inventory.");
        }
      }
    }

    refreshInventory();

    return () => {
      cancelled = true;
    };
  }, [
    activeSection,
    authStatus,
    inventoryFilters.status,
    inventoryFilters.make,
    inventoryFilters.model,
    inventoryFilters.stockNumber,
    inventoryFilters.vin,
  ]);

  useEffect(() => {
    if (authStatus !== "authenticated" || activeSection !== "Unmatched") {
      return;
    }

    let cancelled = false;

    async function loadQueue() {
      try {
        await loadUnmatchedQueue();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load unmatched communications.");
        }
      }
    }

    if (!unmatchedLoaded || activeSection === "Unmatched") {
      loadQueue();
    }

    return () => {
      cancelled = true;
    };
  }, [activeSection, authStatus, unmatchedStatusFilter]);

  useEffect(() => {
    if (!selectedLeadId && ["Leads", "Pipeline", "Assignments", "Inventory"].includes(activeSection) && leadLibrary[0]) {
      setSelectedLeadId(leadLibrary[0].id);
      return;
    }

    if (!selectedLeadId && activeSection === "Conversations" && conversationFeed[0]?.leadId) {
      setSelectedLeadId(conversationFeed[0].leadId);
    }
  }, [activeSection, conversationFeed, leadLibrary, selectedLeadId]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !["admin", "manager"].includes(currentUser?.role)) {
      setUsers([]);
      return;
    }

    let active = true;

    async function loadUsers() {
      try {
        setUsersLoading(true);
        const response = await getUsers();
        if (!active) {
          return;
        }

        setUsers(response.items || []);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError.message || "Unable to load users.");
      } finally {
        if (active) {
          setUsersLoading(false);
        }
      }
    }

    loadUsers();

    return () => {
      active = false;
    };
  }, [authStatus, currentUser?.role]);

  useEffect(() => {
    const canAssign = currentUser?.role === "admin" || currentUser?.role === "manager";
    if (authStatus !== "authenticated" || !canAssign) {
      setAssignees([]);
      return;
    }

    let active = true;

    async function loadAssignees() {
      try {
        setAssigneesLoading(true);
        const response = await getAssignableUsers();
        if (!active) {
          return;
        }

        setAssignees(response.items || []);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError.message || "Unable to load assignment options.");
      } finally {
        if (active) {
          setAssigneesLoading(false);
        }
      }
    }

    loadAssignees();

    return () => {
      active = false;
    };
  }, [authStatus, currentUser?.role]);

  useEffect(() => {
    const canManageExecution = currentUser?.role === "admin" || currentUser?.role === "manager";
    if (authStatus !== "authenticated" || !canManageExecution) {
      setExecutionSettings(null);
      return;
    }

    let active = true;

    async function loadExecutionSettings() {
      try {
        setExecutionSettingsLoading(true);
        const response = await getExecutionSettings();
        if (!active) {
          return;
        }

        setExecutionSettings(response);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError.message || "Unable to load CRM execution settings.");
      } finally {
        if (active) {
          setExecutionSettingsLoading(false);
        }
      }
    }

    loadExecutionSettings();

    return () => {
      active = false;
    };
  }, [authStatus, currentUser?.role]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    if (!selectedLeadId) {
      setSelectedLeadDetails(null);
      return;
    }

    let active = true;

    async function loadDetails() {
      try {
        setDetailLoading(true);
        const payload = await getLead(selectedLeadId);
        if (!active) {
          return;
        }

        setSelectedLeadDetails({
          ...formatLead(payload.lead),
          activities: payload.activities.map(formatActivity),
          timeline: (payload.timeline || []).map(formatTimelineItem),
          tasks: payload.tasks || [],
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        if (loadError.status === 401) {
          setAuthStatus("unauthenticated");
          setCurrentUser(null);
          return;
        }

        setError(loadError.message || "Unable to load lead details.");
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    }

    loadDetails();

    return () => {
      active = false;
    };
  }, [authStatus, selectedLeadId]);

  const search = deferredQuery.trim().toLowerCase();
  const matchesSearch = (lead) =>
    !search ||
    [lead.customerName, lead.vehicleInterest, lead.phone, lead.rawPhone, lead.source, lead.messagePreview, lead.attentionReason, lead.aiSummary]
      .join(" ")
      .toLowerCase()
      .includes(search);

  const visibleAttentionLeads = leads.filter(matchesSearch);
  const visibleLeadLibrary = leadLibrary.filter(matchesSearch);
  const visiblePipelineGroups = Object.fromEntries(
    pipelineStages.map((status) => [
      status,
      visibleLeadLibrary.filter(
        (lead) => (leadStatusFilter === "all" || lead.status === leadStatusFilter) && lead.status === status
      ),
    ])
  );
  const visibleOrganizedGroups = Object.fromEntries(
    organizedGroups.map((group) => [group, organizedLeadGroups[group].filter(matchesSearch)])
  );
  const filteredOrganizedGroups = Object.fromEntries(
    organizedGroups.map((group) => [
      group,
      visibleOrganizedGroups[group].filter((lead) => leadStatusFilter === "all" || lead.status === leadStatusFilter),
    ])
  );
  const flattenedOrganizedLeads = organizedGroups.flatMap((group) => filteredOrganizedGroups[group]);
  const flattenedPipelineLeads = pipelineStages.flatMap((status) => visiblePipelineGroups[status] || []);
  const canBulkAutoAssign = ["admin", "manager"].includes(currentUser?.role);
  const assignmentEligibleLeads = visibleLeadLibrary.filter((lead) => !["sold", "lost"].includes(lead.status));
  const salesAssignmentUsers = users
    .filter((user) => user.role === "sales")
    .sort((left, right) => left.name.localeCompare(right.name));
  const assignmentUnassignedLeads = assignmentEligibleLeads.filter((lead) => !lead.assignedTo);
  const assignmentRepLanes = salesAssignmentUsers.map((user) => ({
    rep: user,
    leads: assignmentEligibleLeads.filter((lead) => Number(lead.assignedTo) === Number(user.id)),
  }));
  const visibleBulkAssignableLeadIds = [...new Set(
    [...visibleAttentionLeads, ...flattenedPipelineLeads]
      .filter((lead) => canBulkAutoAssign && !lead.assignedTo)
      .map((lead) => Number(lead.id))
  )];
  const bulkAssignableLeadIdsKey = visibleBulkAssignableLeadIds.join(",");
  const visibleConversationFeed = conversationFeed.filter((item) =>
    !search ||
    [
      item.leadName,
      item.vehicleInterest,
      item.externalNumber,
      item.preview,
      item.assignedRep,
      item.leadStatusLabel,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search)
  );
  const visibleUnmatchedItems = unmatchedItems.filter((item) =>
    !search ||
    [
      item.phone,
      item.rawPhone,
      item.preview,
      item.status,
      item.type,
      item.providerExtensionId,
      item.resolvedLeadName,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search)
  );
  const visibleInventoryItems = inventoryItems;
  const analytics = buildAnalyticsSnapshot({
    leadLibrary: visibleLeadLibrary,
    attentionLeads: visibleAttentionLeads,
    organizedLeadGroups: visibleOrganizedGroups,
    conversationFeed: visibleConversationFeed,
    inventoryItems: visibleInventoryItems,
  });
  const salesUsers = users.filter((user) => user.role === "sales");
  const routingOpenRepCount = salesUsers.filter((user) => user.is_active && user.is_available).length;
  const routingPausedRepCount = salesUsers.filter((user) => !user.is_active || !user.is_available).length;
  const appointmentCount = visibleLeadLibrary.filter((lead) => lead.status === "appointment").length;
  const conversationCallCount = visibleConversationFeed.filter((item) => item.type === "call").length;
  const conversationSmsCount = visibleConversationFeed.filter((item) => item.type === "sms").length;

  const selectedLead =
    selectedLeadDetails && selectedLeadDetails.id === selectedLeadId
      ? selectedLeadDetails
      : visibleAttentionLeads.find((lead) => lead.id === selectedLeadId) ??
        leads.find((lead) => lead.id === selectedLeadId) ??
        visibleLeadLibrary.find((lead) => lead.id === selectedLeadId) ??
        leadLibrary.find((lead) => lead.id === selectedLeadId) ??
        flattenedPipelineLeads.find((lead) => lead.id === selectedLeadId) ??
        flattenedOrganizedLeads.find((lead) => lead.id === selectedLeadId) ??
        organizedGroups.flatMap((group) => organizedLeadGroups[group]).find((lead) => lead.id === selectedLeadId) ??
        null;
  const selectedUnmatched =
    visibleUnmatchedItems.find((item) => item.id === selectedUnmatchedId) ??
    unmatchedItems.find((item) => item.id === selectedUnmatchedId) ??
    null;

  useEffect(() => {
    setSelectedAutoAssignLeadIds((current) => {
      const next = current.filter((leadId) => visibleBulkAssignableLeadIds.includes(leadId));
      if (next.length === current.length && next.every((leadId, index) => leadId === current[index])) {
        return current;
      }
      return next;
    });
  }, [bulkAssignableLeadIdsKey]);

  function toggleBulkLeadSelection(leadId) {
    const normalizedLeadId = Number(leadId);
    if (!Number.isInteger(normalizedLeadId) || normalizedLeadId <= 0) {
      return;
    }

    setSelectedAutoAssignLeadIds((current) =>
      current.includes(normalizedLeadId)
        ? current.filter((candidate) => candidate !== normalizedLeadId)
        : [...current, normalizedLeadId]
    );
  }

  function selectVisibleBulkAssignableLeads() {
    setSelectedAutoAssignLeadIds(visibleBulkAssignableLeadIds);
  }

  function clearBulkLeadSelection() {
    setSelectedAutoAssignLeadIds([]);
  }

  async function handleStatusChange(nextStatus) {
    if (!selectedLeadId) {
      return;
    }

    try {
      setStatusUpdating(true);
      const payload = await updateLeadStatus(selectedLeadId, nextStatus);
      const nextLead = formatLead(payload.lead);
      setSelectedLeadDetails({
        ...nextLead,
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      if (conversationFeedLoaded) {
        await loadConversationFeed();
      }
      setError("");
    } catch (updateError) {
      setError(updateError.message || "Unable to update lead status.");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handlePipelineMove(leadId, nextStatus) {
    const currentLead =
      leadLibrary.find((lead) => Number(lead.id) === Number(leadId)) ??
      leads.find((lead) => Number(lead.id) === Number(leadId)) ??
      null;

    if (!currentLead || currentLead.status === nextStatus) {
      return;
    }

    try {
      setPipelineMovingLeadId(leadId);
      const payload = await updateLeadStatus(leadId, nextStatus);
      const nextLead = formatLead(payload.lead);

      if (Number(selectedLeadId) === Number(leadId)) {
        setSelectedLeadDetails({
          ...nextLead,
          activities: (payload.activities || []).map(formatActivity),
          timeline: (payload.timeline || []).map(formatTimelineItem),
          tasks: payload.tasks || [],
        });
      }

      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary({ preserveSelection: true });
      }
      if (conversationFeedLoaded) {
        await loadConversationFeed();
      }
      setSelectedLeadId(leadId);
      setError("");
    } catch (moveError) {
      setError(moveError.message || "Unable to move the lead in the pipeline.");
    } finally {
      setPipelineMovingLeadId(null);
      setDraggingLeadId(null);
    }
  }

  async function handleAssignmentMove(leadId, assignedTo) {
    const normalizedLeadId = Number(leadId);
    const normalizedAssignedTo = Number(assignedTo);
    const currentLead =
      leadLibrary.find((lead) => Number(lead.id) === normalizedLeadId) ??
      leads.find((lead) => Number(lead.id) === normalizedLeadId) ??
      null;

    if (!currentLead || !normalizedAssignedTo || Number(currentLead.assignedTo) === normalizedAssignedTo) {
      return;
    }

    try {
      setAssignmentMovingLeadId(normalizedLeadId);
      const payload = await assignLead(normalizedLeadId, normalizedAssignedTo);
      const nextLead = formatLead(payload.lead);

      if (Number(selectedLeadId) === normalizedLeadId) {
        setSelectedLeadDetails({
          ...nextLead,
          activities: (payload.activities || []).map(formatActivity),
          timeline: (payload.timeline || []).map(formatTimelineItem),
          tasks: payload.tasks || [],
        });
      }

      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary({ preserveSelection: true });
      }
      if (conversationFeedLoaded) {
        await loadConversationFeed({ preserveSelection: true });
      }
      setError("");
    } catch (assignError) {
      setError(assignError.message || "Unable to reassign lead ownership.");
    } finally {
      setAssignmentMovingLeadId(null);
      setAssignmentDraggingLeadId(null);
    }
  }

  async function handleAssignLead(assignedTo) {
    if (!selectedLeadId) {
      return;
    }

    try {
      setAssignmentUpdating(true);
      const payload = await assignLead(selectedLeadId, assignedTo);
      const updatedLead = formatLead(payload.lead);
      setSelectedLeadDetails({
        ...updatedLead,
        activities: payload.activities.map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      if (conversationFeedLoaded) {
        await loadConversationFeed();
      }
      setError("");
    } catch (assignError) {
      setError(assignError.message || "Unable to assign lead.");
    } finally {
      setAssignmentUpdating(false);
    }
  }

  async function handleBulkAutoAssign() {
    if (!selectedAutoAssignLeadIds.length) {
      return;
    }

    try {
      setBulkAutoAssigning(true);
      const payload = await autoAssignLeads(selectedAutoAssignLeadIds);
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary({ preserveSelection: true });
      }
      if (conversationFeedLoaded) {
        await loadConversationFeed({ preserveSelection: true });
      }
      if (selectedLeadId && selectedAutoAssignLeadIds.includes(Number(selectedLeadId))) {
        const refreshedLead = await getLead(selectedLeadId);
        setSelectedLeadDetails({
          ...formatLead(refreshedLead.lead),
          activities: (refreshedLead.activities || []).map(formatActivity),
          timeline: (refreshedLead.timeline || []).map(formatTimelineItem),
          tasks: refreshedLead.tasks || [],
        });
      }
      setSelectedAutoAssignLeadIds([]);
      setError("");
    } catch (assignError) {
      setError(assignError.message || "Unable to auto-assign selected leads.");
    } finally {
      setBulkAutoAssigning(false);
    }
  }

  async function handleLeadUpdate(input) {
    if (!selectedLeadId || !selectedLead) {
      return;
    }

    try {
      setLeadUpdating(true);
      const payload = await updateLead(selectedLeadId, {
        customer_name: input.customer_name,
        first_name: input.first_name,
        last_name: input.last_name,
        phone: input.phone ?? selectedLead.rawPhone,
        email: input.email ?? (selectedLead.email === "No email on file" ? "" : selectedLead.email),
        stock_number: input.stock_number ?? selectedLead.stockNumber,
        message: input.message ?? (selectedLead.message === "No message captured yet." ? "" : selectedLead.message),
        source: selectedLead.source.toLowerCase(),
        status: selectedLead.status,
        vehicle_interest: selectedLead.vehicleInterest === "Vehicle inquiry" ? "" : selectedLead.vehicleInterest,
        vehicle_id: selectedLead.inventory?.vin || "",
        vehicle_year: selectedLead.vehicleYear,
        vehicle_make: selectedLead.vehicleMake,
        vehicle_model: selectedLead.vehicleModel,
        vehicle_trim: selectedLead.vehicleTrim,
        vehicle_condition: selectedLead.vehicleCondition,
        vehicle_price: selectedLead.vehiclePrice,
        lead_type: selectedLead.leadType,
        listing_url: selectedLead.listingUrl,
      });
      const nextLead = {
        ...formatLead(payload),
        activities: selectedLeadDetails?.activities || [],
        timeline: selectedLeadDetails?.timeline || [],
        tasks: selectedLeadDetails?.tasks || [],
      };
      setSelectedLeadDetails(nextLead);
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      if (conversationFeedLoaded) {
        await loadConversationFeed();
      }
      setError("");
      return nextLead;
    } catch (updateError) {
      setError(updateError.message || "Unable to update lead details.");
      throw updateError;
    } finally {
      setLeadUpdating(false);
    }
  }

  async function handleLogin(email, password) {
    try {
      setAuthLoading(true);
      const session = await login(email, password);
      setCurrentUser(session.user);
      setAuthStatus("authenticated");
      setSelectedLeadId(null);
      setSelectedAutoAssignLeadIds([]);
      setSelectedLeadDetails(null);
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
      setSelectedAutoAssignLeadIds([]);
      setSelectedLeadDetails(null);
      setActiveSection("Dashboard");
      setLeads([]);
      setLeadLibrary([]);
      setInventoryItems([]);
      setInventoryImportRuns([]);
      setInventoryLeadLookup({});
      setOrganizedLeadGroups({
        contacted: [],
        appointment: [],
        negotiation: [],
        sold: [],
        lost: [],
      });
      setUnmatchedItems([]);
      setConversationFeed([]);
      setMetrics(emptyMetrics);
      setUsers([]);
      setAssignees([]);
      setExecutionSettings(null);
      setNotifications([]);
      setLeadLibraryLoaded(false);
      setInventoryLoaded(false);
      setUnmatchedLoaded(false);
      setConversationFeedLoaded(false);
      setSelectedUnmatchedId(null);
    }
  }

  async function handleCompleteTask(taskId) {
    try {
      setTaskCompletingId(taskId);
      await completeTask(taskId);
      if (selectedLeadId) {
        const payload = await getLead(selectedLeadId);
        setSelectedLeadDetails({
          ...formatLead(payload.lead),
          activities: payload.activities.map(formatActivity),
          timeline: (payload.timeline || []).map(formatTimelineItem),
          tasks: payload.tasks || [],
        });
      }
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      setError("");
    } catch (taskError) {
      setError(taskError.message || "Unable to complete task.");
    } finally {
      setTaskCompletingId(null);
    }
  }

  async function handleSendSms(message) {
    if (!selectedLeadId) {
      return;
    }

    try {
      setSmsSending(true);
      const payload = await sendLeadSms(selectedLeadId, message);
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: payload.activities.map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      await loadConversationFeed();
      setError("");
    } catch (smsError) {
      setError(smsError.message || "Unable to send SMS.");
      throw smsError;
    } finally {
      setSmsSending(false);
    }
  }

  async function handleLogCall() {
    if (!selectedLeadId) {
      return;
    }

    try {
      setCallLogging(true);
      const payload = await logLeadCall(selectedLeadId);
      setError("");
      return payload.call_attempt || null;
    } catch (callError) {
      setError(callError.message || "Unable to start the call.");
      throw callError;
    } finally {
      setCallLogging(false);
    }
  }

  async function handleHoldVehicle() {
    if (!selectedLeadId) {
      return;
    }

    try {
      setHoldSubmitting(true);
      const payload = await holdLeadVehicle(selectedLeadId);
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: payload.activities.map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      setError("");
    } catch (holdError) {
      setError(holdError.message || "Unable to create the vehicle hold request.");
    } finally {
      setHoldSubmitting(false);
    }
  }

  async function handleImportInventoryFile(file) {
    try {
      setInventoryImporting(true);
      const csvText = await file.text();
      await importInventory({
        file_name: file.name,
        csv_text: csvText,
        source_name: inventoryImportForm.sourceName || null,
        mark_missing_inactive: inventoryImportForm.markMissingInactive,
      });
      await loadInventoryData();
      setError("");
    } catch (importError) {
      setError(importError.message || "Unable to import inventory.");
    } finally {
      setInventoryImporting(false);
    }
  }

  async function handleAssignUnmatched(leadId) {
    if (!selectedUnmatchedId) {
      return;
    }

    try {
      setUnmatchedAssigning(true);
      const payload = await assignUnmatchedCommunication(selectedUnmatchedId, leadId);
      setSelectedLeadId(payload.lead.id);
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      setActiveSection("Leads");
      await refreshWorklist();
      await loadLeadLibrary();
      await loadConversationFeed();
      await loadUnmatchedQueue({ preserveSelection: false });
      setError("");
    } catch (assignError) {
      setError(assignError.message || "Unable to attach the communication to a lead.");
    } finally {
      setUnmatchedAssigning(false);
    }
  }

  async function handleCreateLeadFromUnmatched(payload = {}) {
    if (!selectedUnmatchedId) {
      return;
    }

    try {
      setUnmatchedCreating(true);
      const response = await createLeadFromUnmatched(selectedUnmatchedId, payload);
      setSelectedLeadId(response.lead.id);
      setSelectedLeadDetails({
        ...formatLead(response.lead),
        activities: (response.activities || []).map(formatActivity),
        timeline: (response.timeline || []).map(formatTimelineItem),
        tasks: response.tasks || [],
      });
      setActiveSection("Leads");
      await refreshWorklist();
      await loadLeadLibrary();
      await loadConversationFeed();
      await loadUnmatchedQueue({ preserveSelection: false });
      setError("");
    } catch (createError) {
      setError(createError.message || "Unable to create a lead from this communication.");
    } finally {
      setUnmatchedCreating(false);
    }
  }

  async function handleDismissUnmatched() {
    if (!selectedUnmatchedId) {
      return;
    }

    try {
      setUnmatchedDismissing(true);
      await dismissUnmatchedCommunication(selectedUnmatchedId);
      await loadUnmatchedQueue({ preserveSelection: false });
      setError("");
    } catch (dismissError) {
      setError(dismissError.message || "Unable to dismiss the communication.");
    } finally {
      setUnmatchedDismissing(false);
    }
  }

  async function handleMarkNotificationRead(notificationId) {
    try {
      await markNotificationRead(notificationId);
      setNotifications((current) =>
        current.map((item) => (item.id === notificationId ? { ...item, status: "read" } : item))
      );
      setMetrics((current) => ({
        ...current,
        unread_notification_count: Math.max(0, Number(current.unread_notification_count || 0) - 1),
      }));
    } catch (notificationError) {
      setError(notificationError.message || "Unable to update notification.");
    }
  }

  async function handleCreateUser() {
    try {
      setUserSubmitting(true);
      const created = await createUser(userForm);
      setUsers((current) =>
        [...current, created].sort((left, right) => String(left.name).localeCompare(String(right.name)))
      );
      setUserForm({
        name: "",
        email: "",
        password: "",
        role: "sales",
      });
      setError("");
    } catch (createError) {
      setError(createError.message || "Unable to create user.");
    } finally {
      setUserSubmitting(false);
    }
  }

  async function handleDeleteUser(user) {
    try {
      setDeletingUserId(user.id);
      await deleteUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setError("");
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete user.");
    } finally {
      setDeletingUserId(null);
    }
  }

  async function handleToggleAvailability(targetUser, nextValue) {
    return handleUpdateUserAvailability(targetUser, { is_available: nextValue });
  }

  async function handleUpdateUserAvailability(targetUser, payload) {
    try {
      setAvailabilityUpdatingId(targetUser.id);
      const response = await updateUserAvailability(targetUser.id, payload);
      const updated = response?.item || null;
      if (!updated) {
        return;
      }

      setUsers((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setAssignees((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      if (Number(currentUser?.id) === Number(updated.id)) {
        setCurrentUser((current) => (current ? { ...current, ...updated } : current));
      }
      setError("");
    } catch (toggleError) {
      setError(toggleError.message || "Unable to update availability.");
    } finally {
      setAvailabilityUpdatingId(null);
    }
  }

  async function handleSaveExecutionSettings(nextSettings) {
    try {
      setExecutionSettingsSaving(true);
      const response = await updateExecutionSettings(nextSettings);
      setExecutionSettings(response);
      setError("");
    } catch (settingsError) {
      setError(settingsError.message || "Unable to save texting automation settings.");
    } finally {
      setExecutionSettingsSaving(false);
    }
  }

  async function handleRunAutoSms() {
    try {
      setAutoSmsRunning(true);
      const result = await runAutoSmsNow();
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      if (conversationFeedLoaded) {
        await loadConversationFeed();
      }
      setError("");
      return result;
    } catch (runError) {
      setError(runError.message || "Unable to run automatic texting.");
      throw runError;
    } finally {
      setAutoSmsRunning(false);
    }
  }

  async function handleGenerateSmsSuggestion(payload = {}) {
    if (!selectedLeadId) {
      return null;
    }

    try {
      setSmsSuggestionLoading(true);
      const response = await getLeadSmsSuggestion(selectedLeadId, payload);
      setError("");
      return response?.suggestion || null;
    } catch (suggestionError) {
      setError(suggestionError.message || "Unable to generate an AI SMS suggestion.");
      throw suggestionError;
    } finally {
      setSmsSuggestionLoading(false);
    }
  }

  if (authStatus === "loading") {
    return (
      <div className="crm-app-shell min-h-screen bg-ink-950 bg-dashboard px-4 py-6 font-body text-slate-100 sm:px-6 lg:px-8">
        <div className="crm-main-shell mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1200px] items-center justify-center rounded-[2.25rem] border border-white/10 bg-ink-900/80 shadow-card backdrop-blur">
          <div className="space-y-4 text-center">
            <div className="mx-auto h-14 w-14 animate-pulse rounded-2xl bg-gradient-to-br from-ember-500 to-ice-500" />
            <p className="text-sm uppercase tracking-[0.32em] text-slate-500">Loading CRM session</p>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus !== "authenticated") {
    return <LoginPage onSubmit={handleLogin} loading={authLoading} error={error} />;
  }

  const showTeam = activeSection === "Team" && (currentUser?.role === "admin" || currentUser?.role === "manager");
  const showDashboard = activeSection === "Dashboard";
  const showLeads = activeSection === "Leads";
  const showPipeline = activeSection === "Pipeline";
  const showAssignments = activeSection === "Assignments" && (currentUser?.role === "admin" || currentUser?.role === "manager");
  const showUnmatched = activeSection === "Unmatched";
  const showConversations = activeSection === "Conversations";
  const showInventory = activeSection === "Inventory";
  const openSection = (section) => {
    startTransition(() => {
      setActiveSection(section);
      if (typeof window !== "undefined" && window.innerWidth < 1280) {
        setSidebarOpen(false);
      }
    });
  };
  const pageCopy = {
    Dashboard: {
      eyebrow: "Command center",
      title: "Dealership desk",
      summary: "Monitor the operation, jump into the right workspace fast, and keep the dashboard focused on direction instead of day-to-day clutter.",
    },
    Leads: {
      eyebrow: "Follow-up desk",
      title: "Lead queue",
      summary: "Work urgent follow-up, review who needs action next, and keep assignment admin and stage movement on their own pages.",
    },
    Pipeline: {
      eyebrow: "Pipeline workspace",
      title: "Drag the active pipeline",
      summary: "Move leads between stages from a dedicated board built for reps and managers to work visually.",
    },
    Assignments: {
      eyebrow: "Ownership desk",
      title: "Assign leads to reps",
      summary: "Drag open leads to the right rep, clean up unassigned traffic, and manage who owns incoming opportunities.",
    },
    Inventory: {
      eyebrow: "Stock workspace",
      title: "Inventory operations",
      summary: "Watch feed health, search units quickly, and see which vehicles are generating interest.",
    },
    Conversations: {
      eyebrow: "Communication feed",
      title: "Recent conversations",
      summary: "Review the latest calls and SMS without mixing them into the rest of the CRM navigation.",
    },
    Unmatched: {
      eyebrow: "Resolution queue",
      title: "Unknown inbound traffic",
      summary: "Resolve inbound calls and SMS that arrived without a matching lead before they get lost.",
    },
    Team: {
      eyebrow: "Routing and access",
      title: "Team management",
      summary: "Control roster access, routing days, availability, and texting automation from one admin workspace.",
    },
  }[activeSection] || {
    eyebrow: "Workspace",
    title: "CRM",
    summary: "Manage the desk with fewer distractions and clearer workflow boundaries.",
  };
  const immersivePipelineShell = showPipeline;

  return (
    <div className="crm-app-shell min-h-screen bg-ink-950 bg-dashboard px-4 py-4 font-body text-slate-100 sm:px-6 lg:px-8">
      {sidebarOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-ink-950/55 backdrop-blur-sm xl:hidden"
          />
          <div className="fixed inset-y-4 left-4 z-40 w-[290px] xl:hidden">
            <Sidebar
              activeSection={activeSection}
              onSelectSection={(section) => {
                openSection(section);
              }}
              toolCounts={{
                Conversations: visibleConversationFeed.length,
                Unmatched: unmatchedItems.filter((item) => item.status === "new").length,
              }}
              currentUser={
                currentUser
                  ? {
                      ...currentUser,
                      availabilityUpdating: availabilityUpdatingId === currentUser.id,
                      onToggleAvailability:
                        currentUser.role === "sales"
                          ? (nextValue) => handleToggleAvailability(currentUser, nextValue)
                          : null,
                    }
                  : currentUser
              }
            />
          </div>
        </>
      ) : null}

      <div className={`grid w-full gap-4 ${sidebarOpen ? "xl:grid-cols-[290px_minmax(0,1fr)]" : "xl:grid-cols-[minmax(0,1fr)]"}`}>
        {sidebarOpen ? (
          <div className="hidden xl:block">
            <Sidebar
              activeSection={activeSection}
              onSelectSection={(section) => {
                openSection(section);
              }}
              toolCounts={{
                Conversations: visibleConversationFeed.length,
                Unmatched: unmatchedItems.filter((item) => item.status === "new").length,
              }}
              currentUser={
                currentUser
                  ? {
                      ...currentUser,
                      availabilityUpdating: availabilityUpdatingId === currentUser.id,
                      onToggleAvailability:
                        currentUser.role === "sales"
                          ? (nextValue) => handleToggleAvailability(currentUser, nextValue)
                          : null,
                    }
                  : currentUser
              }
            />
          </div>
        ) : null}

        <main
          className={`${
            immersivePipelineShell
              ? "crm-main-shell border border-white/5 bg-ink-950/55 p-0 shadow-[0_40px_120px_rgba(0,0,0,0.35)]"
              : "crm-main-shell rounded-[2rem] border border-white/10 bg-ink-900/70 p-4 shadow-card sm:p-6"
          } backdrop-blur`}
        >
          <header
            className={`crm-header-shell flex flex-col gap-4 ${
              immersivePipelineShell
                ? "border-b border-white/5 px-6 py-5 lg:flex-row lg:items-center lg:justify-between"
                : "border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between"
            }`}
          >
            <div>
              <p className="text-xs uppercase tracking-[0.34em] text-slate-500">{pageCopy.eyebrow}</p>
              <h1 className={`mt-2 font-display font-semibold text-white ${immersivePipelineShell ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl"}`}>{pageCopy.title}</h1>
              <p className={`mt-2 ${immersivePipelineShell ? "max-w-4xl text-sm leading-6" : "max-w-3xl text-sm leading-7"} text-slate-300`}>
                {pageCopy.summary}
              </p>
              <p className={`text-xs uppercase tracking-[0.26em] text-slate-500 ${immersivePipelineShell ? "mt-2" : "mt-3"}`}>
                Signed in as {currentUser?.name} | {currentUser?.role}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setSidebarOpen((current) => !current)}
                aria-label={sidebarOpen ? "Hide navigation" : "Show navigation"}
                title={sidebarOpen ? "Hide navigation" : "Show navigation"}
                className="crm-icon-button inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
              >
                <Menu className="h-4 w-4" />
              </button>
              <NotificationTray
                notifications={notifications}
                open={notificationsOpen}
                unreadCount={metrics.unread_notification_count}
                onToggle={() => setNotificationsOpen((current) => !current)}
                onMarkRead={handleMarkNotificationRead}
              />
              <button
                type="button"
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                className="crm-icon-button inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
              >
                {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="crm-secondary-button inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Logout
              </button>
              <label className="crm-search-shell flex min-w-[260px] items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-300 focus-within:border-ice-400/40 focus-within:bg-white/10">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => {
                    startTransition(() => {
                      setQuery(event.target.value);
                    });
                  }}
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  placeholder="Search customer, vehicle, source..."
                />
              </label>
            </div>
          </header>

          {error ? (
            <div className={`${immersivePipelineShell ? "mx-6 mt-4" : "mt-4"} rounded-2xl border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-300`}>
              {error}
            </div>
          ) : null}

          {showTeam ? (
            <TeamManagementPanel
              users={users}
              currentUser={currentUser}
              form={userForm}
              loading={usersLoading}
              submitting={userSubmitting}
              deletingUserId={deletingUserId}
              availabilityUpdatingId={availabilityUpdatingId}
              executionSettings={executionSettings}
              executionSettingsLoading={executionSettingsLoading}
              executionSettingsSaving={executionSettingsSaving}
              autoSmsRunning={autoSmsRunning}
              onFormChange={(field, value) => setUserForm((current) => ({ ...current, [field]: value }))}
              onSubmit={handleCreateUser}
              onDelete={handleDeleteUser}
              onToggleAvailability={handleToggleAvailability}
              onUpdateWorkingDays={(user, workingDays) =>
                handleUpdateUserAvailability(user, {
                  working_days: workingDays,
                })
              }
              onSaveExecutionSettings={handleSaveExecutionSettings}
              onRunAutoSms={handleRunAutoSms}
            />
          ) : (
            <section className={`mt-6 grid gap-6 ${showUnmatched ? "2xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]" : ""}`}>
              <div className="crm-workspace-panel rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                {showDashboard ? (
                  <div className="grid gap-6">
                    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.2fr)_360px]">
                      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-cyan-400/10 via-white/[0.04] to-amber-400/10 p-6">
                        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.18),_transparent_62%)]" />
                        <div className="relative">
                          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Dealership command center</p>
                          <h2 className="mt-3 max-w-2xl font-display text-3xl font-semibold text-white">
                            Use the dashboard to direct the operation, not to work every single lead.
                          </h2>
                          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                            The desk is now split on purpose. Dashboard gives you command visibility, Leads is the working pipeline, and Assignments is the ownership board for managers.
                          </p>
                          <div className="mt-6 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => openSection("Leads")}
                              className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-slate-100"
                            >
                              Open lead desk
                            </button>
                            {currentUser?.role === "admin" || currentUser?.role === "manager" ? (
                              <button
                                type="button"
                                onClick={() => openSection("Assignments")}
                                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                              >
                                Open assignments
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openSection("Inventory")}
                              className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                              Open inventory
                            </button>
                          </div>

                          <div className="mt-8 grid gap-3 md:grid-cols-3">
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Needs attention</p>
                              <p className="mt-2 text-3xl font-semibold text-white">{String(metrics.needs_attention_count).padStart(2, "0")}</p>
                              <p className="mt-2 text-sm text-slate-300">Work these from the lead desk.</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Overdue tasks</p>
                              <p className="mt-2 text-3xl font-semibold text-white">{String(metrics.overdue_task_count).padStart(2, "0")}</p>
                              <p className="mt-2 text-sm text-slate-300">Follow-ups waiting on a rep response.</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Unread alerts</p>
                              <p className="mt-2 text-3xl font-semibold text-white">{String(metrics.unread_notification_count).padStart(2, "0")}</p>
                              <p className="mt-2 text-sm text-slate-300">Routing changes, escalations, and desk alerts.</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4">
                        <MetricCard
                          eyebrow="Tracked leads"
                          value={analytics.totalLeads}
                          detail="Visible leads already inside the CRM today."
                          accent="from-cyan-500/20 to-transparent"
                        />
                        <MetricCard
                          eyebrow="Unassigned"
                          value={analytics.unassignedCount}
                          detail="Leads still waiting for ownership."
                          accent="from-amber-500/20 to-transparent"
                        />
                        <MetricCard
                          eyebrow="Conversations"
                          value={analytics.conversationsCount}
                          detail="Recent calls and SMS tied back to lead history."
                          accent="from-lime-500/20 to-transparent"
                        />
                      </div>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                      <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                        <div className="flex items-end justify-between gap-4 border-b border-white/10 pb-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Priority snapshot</p>
                            <h3 className="mt-2 font-display text-2xl font-semibold text-white">Immediate desk pressure</h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => openSection("Leads")}
                            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                          >
                            View all
                          </button>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {visibleAttentionLeads.slice(0, 5).map((lead) => (
                            <button
                              key={lead.id}
                              type="button"
                              onClick={() => {
                                openSection("Leads");
                                openLeadModal(lead.id);
                              }}
                              className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="truncate font-semibold text-white">{lead.customerName}</h4>
                                    <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                                      {lead.attentionReason}
                                    </span>
                                  </div>
                                  <p className="mt-1 truncate text-sm text-slate-300">{lead.vehicleInterest}</p>
                                </div>
                                <span className="shrink-0 text-xs uppercase tracking-[0.18em] text-slate-500">{lead.lastActivity}</span>
                              </div>
                            </button>
                          ))}
                          {!visibleAttentionLeads.length ? (
                            <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                              Nothing urgent is waiting right now.
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-4">
                        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Routing health</p>
                          <div className="mt-4 grid gap-3">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Open reps</p>
                              <p className="mt-2 text-xl font-semibold text-white">{routingOpenRepCount}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Paused reps</p>
                              <p className="mt-2 text-xl font-semibold text-white">{routingPausedRepCount}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Unmatched queue</p>
                              <p className="mt-2 text-xl font-semibold text-white">
                                {unmatchedItems.filter((item) => item.status === "new").length}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Operational launchpad</p>
                          <div className="mt-4 grid gap-3">
                            <button
                              type="button"
                              onClick={() => openSection("Conversations")}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                            >
                              Open conversations
                            </button>
                            <button
                              type="button"
                              onClick={() => openSection("Unmatched")}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                            >
                              Resolve unmatched traffic
                            </button>
                            <button
                              type="button"
                              onClick={() => openSection("Inventory")}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                            >
                              Open stock workspace
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {showLeads ? (
                  <>
                    <div className="grid gap-4 xl:grid-cols-4">
                      <MetricCard
                        eyebrow="Needs attention"
                        value={visibleAttentionLeads.length}
                        detail="Urgent items that need the next action first."
                        accent="from-amber-500/20 to-transparent"
                      />
                      <MetricCard
                        eyebrow="Open tasks"
                        value={visibleAttentionLeads.reduce((sum, lead) => sum + Number(lead.openTasks?.length || 0), 0)}
                        detail="Open follow-up tasks currently attached to the visible queue."
                        accent="from-cyan-500/20 to-transparent"
                      />
                      <MetricCard
                        eyebrow="Appointments"
                        value={appointmentCount}
                        detail="Leads already moved into the appointment stage."
                        accent="from-lime-500/20 to-transparent"
                      />
                      <MetricCard
                        eyebrow="Unassigned"
                        value={analytics.unassignedCount}
                        detail="Visible leads still waiting for ownership."
                        accent="from-rose-500/20 to-transparent"
                      />
                    </div>

                    <div className="mt-2 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                      <div className="flex flex-col gap-4 border-b border-white/10 pb-4 xl:flex-row xl:items-end xl:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Lead desk controls</p>
                          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Follow-up first, pipeline separate</h2>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                            This page is now for follow-up pressure, routing cleanup, and quick access to the right customer. Stage movement has its own dedicated pipeline workspace.
                          </p>
                        </div>
                        <label className="grid gap-2 xl:min-w-[220px]">
                          <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Stage filter</span>
                          <select
                            value={leadStatusFilter}
                            onChange={(event) => setLeadStatusFilter(event.target.value)}
                            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                          >
                            <option value="all" className="bg-ink-900">
                              All stages
                            </option>
                            {pipelineStages.map((status) => (
                              <option key={status} value={status} className="bg-ink-900">
                                {pipelineLabel(status)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {canBulkAutoAssign ? (
                        <div className="mt-4 flex flex-col gap-3 rounded-[1.5rem] border border-white/10 bg-black/20 p-4 xl:flex-row xl:items-center xl:justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Bulk routing</p>
                            <p className="mt-1 text-sm text-slate-300">
                              Select unassigned leads from the queue, then auto-route them using contact ownership and current routing rules.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                              {selectedAutoAssignLeadIds.length} selected
                            </span>
                            <button
                              type="button"
                              onClick={selectVisibleBulkAssignableLeads}
                              disabled={!visibleBulkAssignableLeadIds.length || bulkAutoAssigning}
                              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Select visible unassigned
                            </button>
                            <button
                              type="button"
                              onClick={clearBulkLeadSelection}
                              disabled={!selectedAutoAssignLeadIds.length || bulkAutoAssigning}
                              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={handleBulkAutoAssign}
                              disabled={!selectedAutoAssignLeadIds.length || bulkAutoAssigning}
                              className="rounded-full border border-cyan-400/30 bg-cyan-400/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {bulkAutoAssigning ? "Auto-assigning..." : "Auto-assign selected"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_320px]">
                      <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.02] p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Priority queue</p>
                            <h3 className="mt-1 font-display text-xl font-semibold text-white">Needs attention</h3>
                          </div>
                          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                            {visibleAttentionLeads.length}
                          </span>
                        </div>
                        <div className="grid max-h-[980px] gap-4 overflow-y-auto pr-1">
                          {visibleAttentionLeads.length ? (
                            visibleAttentionLeads.map((lead) => (
                              <AttentionLeadCard
                                key={lead.id}
                                lead={lead}
                                selected={lead.id === selectedLead?.id}
                                canSelect={canBulkAutoAssign && !lead.assignedTo}
                                selectionChecked={selectedAutoAssignLeadIds.includes(Number(lead.id))}
                                onToggleSelect={toggleBulkLeadSelection}
                                onSelect={() => {
                                  openLeadModal(lead.id);
                                }}
                              />
                            ))
                          ) : (
                            <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                              No leads require attention right now.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-4">
                        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Pipeline snapshot</p>
                          <div className="mt-4 grid gap-3">
                            {pipelineStages.map((status) => (
                              <div key={status} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                <span className="text-sm font-medium text-white">{pipelineLabel(status)}</span>
                                <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
                                  {(visiblePipelineGroups[status] || []).length}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Desk shortcuts</p>
                          <div className="mt-4 grid gap-3">
                            <button
                              type="button"
                              onClick={() => openSection("Pipeline")}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                            >
                              Open full pipeline board
                            </button>
                            {currentUser?.role === "admin" || currentUser?.role === "manager" ? (
                              <button
                                type="button"
                                onClick={() => openSection("Assignments")}
                                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                              >
                                Open assignment board
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openSection("Conversations")}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                            >
                              Review conversations
                            </button>
                            <button
                              type="button"
                              onClick={() => openSection("Inventory")}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                            >
                              Check inventory response
                            </button>
                          </div>
                        </div>

                        {selectedLead ? (
                          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current focus</p>
                            <h3 className="mt-2 font-display text-xl font-semibold text-white">{selectedLead.customerName}</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-300">{selectedLead.vehicleInterest}</p>
                            <div className="mt-4 flex flex-wrap gap-2 text-xs">
                              <span className="rounded-full bg-white/5 px-3 py-1.5 text-slate-300">{selectedLead.assignedRep}</span>
                              <span className="rounded-full bg-white/5 px-3 py-1.5 text-slate-300">{selectedLead.source}</span>
                              <span className="rounded-full bg-white/5 px-3 py-1.5 text-slate-300">{selectedLead.statusLabel}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => openLeadModal(selectedLead.id)}
                              className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                              Open lead popup
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}

                {showPipeline ? (
                  <>
                    <div className="crm-pipeline-panel mx-6 mt-6 rounded-[1.75rem] border border-white/5 bg-white/[0.025] p-5">
                      <div className="flex flex-col gap-4 border-b border-white/10 pb-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="rounded-full bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                            {flattenedPipelineLeads.length} visible leads
                          </span>
                          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                            {(visiblePipelineGroups.new || []).length} new
                          </span>
                          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                            {(visiblePipelineGroups.appointment || []).length} appointment
                          </span>
                          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                            {(visiblePipelineGroups.negotiation || []).length} negotiation
                          </span>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <label className="grid gap-2 sm:min-w-[220px]">
                            <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Stage filter</span>
                            <select
                              value={leadStatusFilter}
                              onChange={(event) => setLeadStatusFilter(event.target.value)}
                              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                            >
                              <option value="all" className="bg-ink-900">
                                All stages
                              </option>
                              {pipelineStages.map((status) => (
                                <option key={status} value={status} className="bg-ink-900">
                                  {pipelineLabel(status)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>

                      <div className="mt-5">
                        {libraryLoading ? (
                          <div className="h-[72vh] animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
                        ) : flattenedPipelineLeads.length ? (
                          <LeadPipelineBoard
                            stages={pipelineStages.map((status) => ({
                              key: status,
                              label: pipelineLabel(status),
                            }))}
                            groups={visiblePipelineGroups}
                            selectedLeadId={selectedLead?.id}
                            draggingLeadId={draggingLeadId}
                            movingLeadId={pipelineMovingLeadId}
                            onSelectLead={(leadId) => {
                              openLeadModal(leadId);
                            }}
                            onMoveLead={handlePipelineMove}
                            onDragStateChange={setDraggingLeadId}
                            canSelectLead={(lead) => canBulkAutoAssign && !lead.assignedTo}
                            selectedLeadIds={selectedAutoAssignLeadIds}
                            onToggleLeadSelect={toggleBulkLeadSelection}
                          />
                        ) : (
                          <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-20 text-center text-slate-400">
                            No leads match this search or stage filter.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}

                {showAssignments ? (
                  <>
                    <div className="grid gap-4 xl:grid-cols-4">
                      <MetricCard
                        eyebrow="Needs owner"
                        value={assignmentUnassignedLeads.length}
                        detail="Visible leads still waiting for a rep assignment."
                        accent="from-amber-500/20 to-transparent"
                      />
                      <MetricCard
                        eyebrow="Routing open reps"
                        value={routingOpenRepCount}
                        detail="Sales reps currently active and open for new lead routing."
                        accent="from-lime-500/20 to-transparent"
                      />
                      <MetricCard
                        eyebrow="Routing paused"
                        value={routingPausedRepCount}
                        detail="Reps paused or inactive for fresh lead assignment."
                        accent="from-slate-500/20 to-transparent"
                      />
                      <MetricCard
                        eyebrow="Owned active leads"
                        value={assignmentEligibleLeads.length - assignmentUnassignedLeads.length}
                        detail="Visible active leads already sitting in a rep lane."
                        accent="from-cyan-500/20 to-transparent"
                      />
                    </div>

                    <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_340px]">
                      <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.02] p-5">
                        <div className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 xl:flex-row xl:items-end xl:justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Lead assignment board</p>
                            <h2 className="mt-1 font-display text-2xl font-semibold text-white">Drag ownership to the right rep</h2>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                              This page is only for ownership cleanup and routing control. It stays separate from the lead desk so managers can assign without disrupting follow-up work.
                            </p>
                          </div>
                          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                            {assignmentEligibleLeads.length} active leads
                          </span>
                        </div>

                        <LeadAssignmentBoard
                          unassignedLeads={assignmentUnassignedLeads}
                          repLanes={assignmentRepLanes}
                          selectedLeadId={selectedLead?.id}
                          draggingLeadId={assignmentDraggingLeadId}
                          movingLeadId={assignmentMovingLeadId}
                          onOpenLead={openLeadModal}
                          onAssignLead={handleAssignmentMove}
                          onDragStateChange={setAssignmentDraggingLeadId}
                        />
                      </div>

                      <div className="grid gap-4">
                        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Routing rules</p>
                          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                            <li>Existing contacts keep their assigned rep.</li>
                            <li>New contacts route only to active, available reps.</li>
                            <li>Day-off routing lives in Team for each rep.</li>
                            <li>Manual drag assignment updates ownership history too.</li>
                          </ul>
                        </div>

                        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Sales roster</p>
                          <div className="mt-4 grid gap-3">
                            {salesUsers.length ? (
                              salesUsers.map((user) => (
                                <div key={user.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="font-semibold text-white">{user.name}</p>
                                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                                        {user.is_available ? "Routing open" : "Routing paused"}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => openSection("Team")}
                                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-200 transition hover:bg-white/10"
                                    >
                                      Edit in team
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-slate-400">
                                No sales reps found yet.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {showUnmatched ? (
                  <>
                    <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Inbox for unknown numbers</p>
                        <h2 className="mt-2 font-display text-2xl font-semibold text-white">Unmatched communications</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                          Inbound calls and SMS that did not match a lead stay here until a user attaches them, creates a lead, or dismisses them.
                        </p>
                      </div>
                      <label className="grid gap-2 lg:min-w-[220px]">
                        <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Status filter</span>
                        <select
                          value={unmatchedStatusFilter}
                          onChange={(event) => setUnmatchedStatusFilter(event.target.value)}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                        >
                          <option value="new" className="bg-ink-900">
                            New only
                          </option>
                          <option value="resolved" className="bg-ink-900">
                            Resolved
                          </option>
                          <option value="dismissed" className="bg-ink-900">
                            Dismissed
                          </option>
                          <option value="all" className="bg-ink-900">
                            All statuses
                          </option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-4 grid gap-4">
                      {unmatchedLoading ? (
                        Array.from({ length: 4 }).map((_, index) => (
                          <div key={index} className="h-36 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
                        ))
                      ) : visibleUnmatchedItems.length ? (
                        visibleUnmatchedItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedUnmatchedId(item.id)}
                            className={`w-full rounded-[1.75rem] border p-5 text-left transition ${
                              item.id === selectedUnmatched?.id
                                ? "border-ice-400/40 bg-white/10 shadow-glow"
                                : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                                  {item.type === "call" ? "Call" : "SMS"} | {item.receivedAtLabel}
                                </p>
                                <h3 className="mt-2 font-display text-lg font-semibold text-white">{item.phone}</h3>
                                <p className="mt-1 text-sm text-slate-300">{item.preview}</p>
                              </div>
                              <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                                {item.status}
                              </span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                              <span>{item.direction}</span>
                              {item.providerExtensionId ? <span>Ext {item.providerExtensionId}</span> : null}
                              {item.callDuration != null ? <span>{item.callDuration}s</span> : null}
                              {item.resolvedLeadName ? <span>{item.resolvedLeadName}</span> : null}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                          No unmatched communications match this view.
                        </div>
                      )}
                    </div>
                  </>
                ) : null}

                {showConversations ? (
                  <>
                    <div className="border-b border-white/10 pb-4">
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Live communication feed</p>
                      <h2 className="mt-2 font-display text-2xl font-semibold text-white">Recent conversations</h2>
                    </div>
                    <div className="mt-4 grid gap-4">
                      {conversationLoading ? (
                        Array.from({ length: 4 }).map((_, index) => (
                          <div key={index} className="h-36 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
                        ))
                      ) : visibleConversationFeed.length ? (
                        visibleConversationFeed.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              openLeadModal(item.leadId);
                            }}
                            className={`w-full rounded-[1.75rem] border p-5 text-left transition ${
                              Number(item.leadId) === Number(selectedLead?.id)
                                ? "border-ice-400/40 bg-white/10 shadow-glow"
                                : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                                  {item.type === "call" ? "Call" : "SMS"} | {item.happenedAtLabel}
                                </p>
                                <h3 className="mt-2 font-display text-lg font-semibold text-white">{item.leadName}</h3>
                                <p className="mt-1 text-sm text-slate-300">{item.vehicleInterest}</p>
                              </div>
                              <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                                {item.leadStatusLabel}
                              </span>
                            </div>
                            <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-300">{item.preview}</p>
                            <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                              <span>{item.direction}</span>
                              <span>{item.assignedRep}</span>
                              {item.durationSeconds ? <span>{item.durationSeconds}s</span> : null}
                              {item.recordingAvailable ? <span>recording</span> : null}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                          No recent conversations matched this search.
                        </div>
                      )}
                    </div>
                  </>
                ) : null}

                {showInventory ? (
                  <InventoryPanel
                    items={visibleInventoryItems}
                    loading={inventoryLoading}
                    filters={inventoryFilters}
                    onFilterChange={(field, value) =>
                      setInventoryFilters((current) => ({
                        ...current,
                        [field]: value,
                      }))
                    }
                    canImport={currentUser?.role === "admin" || currentUser?.role === "manager"}
                    importSourceName={inventoryImportForm.sourceName}
                    importMarkMissingInactive={inventoryImportForm.markMissingInactive}
                    importSubmitting={inventoryImporting}
                    importRuns={inventoryImportRuns}
                    syncStatus={inventorySyncStatus}
                    syncSubmitting={inventorySyncing}
                    importErrors={inventoryImportErrors}
                    inventoryLeadLookup={inventoryLeadLookup}
                    onImportSourceNameChange={(value) =>
                      setInventoryImportForm((current) => ({
                        ...current,
                        sourceName: value,
                      }))
                    }
                    onImportMarkMissingInactiveChange={(checked) =>
                      setInventoryImportForm((current) => ({
                        ...current,
                        markMissingInactive: checked,
                      }))
                    }
                    onImportFileSelected={handleImportInventoryFile}
                    onSyncNow={handleSyncInventoryNow}
                    onLoadInventoryLeads={handleLoadInventoryLeads}
                    onOpenLead={openLeadModal}
                  />
                ) : null}
              </div>

              {showUnmatched ? (
                <div className="2xl:sticky 2xl:top-6 2xl:self-start">
                  <UnmatchedCommunicationPanel
                    item={selectedUnmatched}
                    leads={leadLibrary}
                    loading={unmatchedLoading}
                    assigning={unmatchedAssigning}
                    creating={unmatchedCreating}
                    dismissing={unmatchedDismissing}
                    onAssign={handleAssignUnmatched}
                    onCreateLead={handleCreateLeadFromUnmatched}
                    onDismiss={handleDismissUnmatched}
                  />
                </div>
              ) : null}
            </section>
          )}
        </main>
      </div>

      {showLeadModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/82 px-4 py-6 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close lead details"
            className="absolute inset-0"
            onClick={() => setLeadModalOpen(false)}
          />
          <div className="relative z-10 max-h-[92vh] w-full max-w-5xl overflow-y-auto">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setLeadModalOpen(false)}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-ink-900/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <X className="h-4 w-4" />
                Close
              </button>
            </div>
            <LeadDetailsPanel
              lead={selectedLead}
              currentUserRole={currentUser?.role}
              loading={detailLoading}
              onStatusChange={handleStatusChange}
              statusUpdating={statusUpdating}
              canAssign={currentUser?.role === "admin" || currentUser?.role === "manager"}
              assignees={assignees}
              assigneesLoading={assigneesLoading}
              assignmentUpdating={assignmentUpdating}
              leadUpdating={leadUpdating}
              onAssignLead={handleAssignLead}
              onUpdateLead={handleLeadUpdate}
              onCompleteTask={handleCompleteTask}
              taskCompletingId={taskCompletingId}
              onSendSms={handleSendSms}
              smsSending={smsSending}
              onGenerateSmsSuggestion={handleGenerateSmsSuggestion}
              smsSuggestionLoading={smsSuggestionLoading}
              onLogCall={handleLogCall}
              callLogging={callLogging}
              onHoldVehicle={handleHoldVehicle}
              holdSubmitting={holdSubmitting}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
