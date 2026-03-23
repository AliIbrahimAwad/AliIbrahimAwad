import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { Menu, Search, SlidersHorizontal } from "lucide-react";

import { AttentionLeadCard } from "./components/AttentionLeadCard";
import { EmailIntakePanel } from "./components/EmailIntakePanel";
import { InventoryPanel } from "./components/InventoryPanel";
import { LeadCard } from "./components/LeadCard";
import { LeadDetailsPanel } from "./components/LeadDetailsPanel";
import { LoginPage } from "./components/LoginPage";
import { MetricCard } from "./components/MetricCard";
import { NotificationTray } from "./components/NotificationTray";
import { Sidebar } from "./components/Sidebar";
import { TeamManagementPanel } from "./components/TeamManagementPanel";
import { UnmatchedCommunicationPanel } from "./components/UnmatchedCommunicationPanel";
import {
  assignUnmatchedCommunication,
  assignLead,
  assignEmailIntakeItem,
  completeTask,
  convertEmailIntakeItem,
  createUser,
  createLeadFromUnmatched,
  dismissUnmatchedCommunication,
  deleteUser,
  getEmailIntakeItems,
  getEmailIntakeSummary,
  getAssignableUsers,
  getConversations,
  getDashboardWorklist,
  getInventory,
  getInventoryImportRuns,
  getLead,
  getLeads,
  getUnmatchedCommunications,
  holdLeadVehicle,
  importInventory,
  getSession,
  getUsers,
  linkLeadInventory,
  login,
  logLeadCall,
  logout,
  markNotificationRead,
  resolveEmailIntakeItem,
  sendLeadSms,
  updateLeadStatus,
} from "./lib/api";
import { formatPhoneNumber, pipelineLabel } from "./lib/format";

const organizedGroups = ["contacted", "appointment", "negotiation", "sold", "lost"];

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
  return {
    id: lead.id,
    customerName: lead.customer_name,
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
    exteriorColor: item.exterior_color || "",
    interiorColor: item.interior_color || "",
    status: item.status || "",
    source: item.source || "",
    sourceFile: item.source_file || "",
    lastSeenAt: item.last_seen_at || null,
    updatedAt: item.updated_at || null,
  };
}

function formatInventoryRun(run) {
  return {
    id: run.id,
    sourceName: run.source_name || "",
    fileName: run.file_name || "",
    status: run.status || "",
    rowsTotal: Number(run.rows_total || 0),
    rowsInserted: Number(run.rows_inserted || 0),
    rowsUpdated: Number(run.rows_updated || 0),
    rowsSkipped: Number(run.rows_skipped || 0),
    rowsDeactivated: Number(run.rows_deactivated || 0),
    errorCount: Number(run.error_count || 0),
    startedAt: run.started_at || null,
    completedAt: run.completed_at || null,
  };
}

function formatEmailIntakeItem(item) {
  return {
    id: item.id,
    externalId: item.external_id,
    source: capitalizeSource(item.source),
    subject: item.subject || "",
    sender: item.sender || "",
    message: item.message || "",
    receivedAt: item.received_at || null,
    classification: item.classification || "other",
    status: item.status || "open",
    assignedTo: item.assigned_to ?? null,
    assignedRep: item.assigned_user_name || "Unassigned",
    leadId: item.lead_id ?? null,
    customerName: item.customer_name || "",
    phone: item.phone ? formatPhoneNumber(item.phone) : "Not available",
    rawPhone: item.phone || "",
    email: item.email || "No email captured",
    stockNumber: item.stock_number || "",
    inventoryId: item.inventory_id ?? null,
    vehicleDisplay: item.vehicle_display || "Vehicle not matched",
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
  const [emailIntakeItems, setEmailIntakeItems] = useState([]);
  const [emailIntakeSummary, setEmailIntakeSummary] = useState({
    direct_leads_pending: 0,
    others_pending: 0,
  });
  const [emailIntakeTab, setEmailIntakeTab] = useState("direct_lead");
  const [unmatchedItems, setUnmatchedItems] = useState([]);
  const [conversationFeed, setConversationFeed] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
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
  const [emailIntakeLoading, setEmailIntakeLoading] = useState(false);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [callLogging, setCallLogging] = useState(false);
  const [holdSubmitting, setHoldSubmitting] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [inventoryImporting, setInventoryImporting] = useState(false);
  const [inventoryLinking, setInventoryLinking] = useState(false);
  const [emailIntakeAssigningId, setEmailIntakeAssigningId] = useState(null);
  const [emailIntakeResolvingId, setEmailIntakeResolvingId] = useState(null);
  const [emailIntakeConvertingId, setEmailIntakeConvertingId] = useState(null);
  const [unmatchedAssigning, setUnmatchedAssigning] = useState(false);
  const [unmatchedCreating, setUnmatchedCreating] = useState(false);
  const [unmatchedDismissing, setUnmatchedDismissing] = useState(false);
  const [taskCompletingId, setTaskCompletingId] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [leadLibraryLoaded, setLeadLibraryLoaded] = useState(false);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [emailIntakeLoaded, setEmailIntakeLoaded] = useState(false);
  const [unmatchedLoaded, setUnmatchedLoaded] = useState(false);
  const [conversationFeedLoaded, setConversationFeedLoaded] = useState(false);
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
      const [inventoryResult, runsResult] = await Promise.allSettled([
        getInventory({
          limit: 250,
          status: inventoryFilters.status,
          make: inventoryFilters.make,
          model: inventoryFilters.model,
          stock_number: inventoryFilters.stockNumber,
          vin: inventoryFilters.vin,
        }),
        getInventoryImportRuns(10),
      ]);

      if (inventoryResult.status !== "fulfilled") {
        throw inventoryResult.reason;
      }

      setInventoryItems((inventoryResult.value.items || []).map(formatInventoryItem));
      setInventoryImportRuns(
        runsResult.status === "fulfilled" ? (runsResult.value.items || []).map(formatInventoryRun) : []
      );
      setInventoryLoaded(true);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function loadEmailIntakeData() {
    setEmailIntakeLoading(true);
    try {
      const [itemsPayload, summaryPayload] = await Promise.all([
        getEmailIntakeItems({
          classification: emailIntakeTab,
          pending_only: true,
          limit: 200,
        }),
        getEmailIntakeSummary(),
      ]);

      setEmailIntakeItems((itemsPayload.items || []).map(formatEmailIntakeItem));
      setEmailIntakeSummary(summaryPayload || { direct_leads_pending: 0, others_pending: 0 });
      setEmailIntakeLoaded(true);
    } finally {
      setEmailIntakeLoading(false);
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
        if (activeSection === "Intake" && !emailIntakeLoaded) {
          await loadEmailIntakeData();
        }

        if (["Leads", "Analytics", "Unmatched"].includes(activeSection) && !leadLibraryLoaded) {
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
  }, [activeSection, authStatus, conversationFeedLoaded, emailIntakeLoaded, leadLibraryLoaded, inventoryLoaded]);

  useEffect(() => {
    if (authStatus !== "authenticated" || activeSection !== "Intake") {
      return;
    }

    let cancelled = false;

    async function refreshIntake() {
      try {
        await loadEmailIntakeData();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load email intake.");
        }
      }
    }

    refreshIntake();

    return () => {
      cancelled = true;
    };
  }, [activeSection, authStatus, emailIntakeTab]);

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
    if (!selectedLeadId && ["Leads", "Inventory"].includes(activeSection) && leadLibrary[0]) {
      setSelectedLeadId(leadLibrary[0].id);
      return;
    }

    if (!selectedLeadId && activeSection === "Conversations" && conversationFeed[0]?.leadId) {
      setSelectedLeadId(conversationFeed[0].leadId);
    }
  }, [activeSection, conversationFeed, leadLibrary, selectedLeadId]);

  useEffect(() => {
    if (authStatus !== "authenticated" || currentUser?.role !== "admin") {
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
  const visibleEmailIntakeItems = emailIntakeItems.filter((item) =>
    !search ||
    [
      item.customerName,
      item.subject,
      item.email,
      item.phone,
      item.stockNumber,
      item.vehicleDisplay,
      item.message,
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

  const selectedLead =
    selectedLeadDetails && selectedLeadDetails.id === selectedLeadId
      ? selectedLeadDetails
      : visibleAttentionLeads.find((lead) => lead.id === selectedLeadId) ??
        leads.find((lead) => lead.id === selectedLeadId) ??
        visibleLeadLibrary.find((lead) => lead.id === selectedLeadId) ??
        leadLibrary.find((lead) => lead.id === selectedLeadId) ??
        flattenedOrganizedLeads.find((lead) => lead.id === selectedLeadId) ??
        organizedGroups.flatMap((group) => organizedLeadGroups[group]).find((lead) => lead.id === selectedLeadId) ??
        null;
  const selectedUnmatched =
    visibleUnmatchedItems.find((item) => item.id === selectedUnmatchedId) ??
    unmatchedItems.find((item) => item.id === selectedUnmatchedId) ??
    null;

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

  async function handleLogin(email, password) {
    try {
      setAuthLoading(true);
      const session = await login(email, password);
      setCurrentUser(session.user);
      setAuthStatus("authenticated");
      setSelectedLeadId(null);
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
      setSelectedLeadDetails(null);
      setActiveSection("Dashboard");
      setLeads([]);
      setLeadLibrary([]);
      setInventoryItems([]);
      setInventoryImportRuns([]);
      setEmailIntakeItems([]);
      setEmailIntakeSummary({
        direct_leads_pending: 0,
        others_pending: 0,
      });
      setEmailIntakeTab("direct_lead");
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
      setNotifications([]);
      setLeadLibraryLoaded(false);
      setInventoryLoaded(false);
      setEmailIntakeLoaded(false);
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

  async function handleLinkInventory(inventoryId) {
    if (!selectedLeadId) {
      return;
    }

    try {
      setInventoryLinking(true);
      const payload = await linkLeadInventory(selectedLeadId, inventoryId);
      setSelectedLeadDetails({
        ...formatLead(payload.lead),
        activities: (payload.activities || []).map(formatActivity),
        timeline: (payload.timeline || []).map(formatTimelineItem),
        tasks: payload.tasks || [],
      });
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      await refreshWorklist();
      setError("");
    } catch (linkError) {
      setError(linkError.message || "Unable to link inventory.");
      throw linkError;
    } finally {
      setInventoryLinking(false);
    }
  }

  async function handleAssignEmailIntake(item, assignedTo) {
    if (!item?.id || !assignedTo) {
      return;
    }

    try {
      setEmailIntakeAssigningId(item.id);
      const payload = await assignEmailIntakeItem(item.id, assignedTo);
      if (payload.lead) {
        setSelectedLeadId(payload.lead.id);
        setSelectedLeadDetails({
          ...formatLead(payload.lead),
          activities: (payload.activities || []).map(formatActivity),
          timeline: (payload.timeline || []).map(formatTimelineItem),
          tasks: payload.tasks || [],
        });
      }
      await loadEmailIntakeData();
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      setError("");
    } catch (assignError) {
      setError(assignError.message || "Unable to assign the intake lead.");
    } finally {
      setEmailIntakeAssigningId(null);
    }
  }

  async function handleResolveEmailIntake(item) {
    if (!item?.id) {
      return;
    }

    try {
      setEmailIntakeResolvingId(item.id);
      await resolveEmailIntakeItem(item.id);
      await loadEmailIntakeData();
      setError("");
    } catch (resolveError) {
      setError(resolveError.message || "Unable to resolve this intake item.");
    } finally {
      setEmailIntakeResolvingId(null);
    }
  }

  async function handleConvertEmailIntake(item, payload) {
    if (!item?.id) {
      return;
    }

    try {
      setEmailIntakeConvertingId(item.id);
      const response = await convertEmailIntakeItem(item.id, payload);
      if (response.lead) {
        setSelectedLeadId(response.lead.id);
        setSelectedLeadDetails({
          ...formatLead(response.lead),
          activities: (response.activities || []).map(formatActivity),
          timeline: (response.timeline || []).map(formatTimelineItem),
          tasks: response.tasks || [],
        });
      }
      await loadEmailIntakeData();
      await refreshWorklist();
      if (leadLibraryLoaded) {
        await loadLeadLibrary();
      }
      setError("");
    } catch (convertError) {
      setError(convertError.message || "Unable to convert this intake item into a lead.");
    } finally {
      setEmailIntakeConvertingId(null);
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

  if (authStatus === "loading") {
    return (
      <div className="min-h-screen bg-ink-950 bg-dashboard px-4 py-6 font-body text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1200px] items-center justify-center rounded-[2.25rem] border border-white/10 bg-ink-900/80 shadow-card backdrop-blur">
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

  const showTeam = activeSection === "Team" && currentUser?.role === "admin";
  const showDashboard = activeSection === "Dashboard";
  const showIntake = activeSection === "Intake" && (currentUser?.role === "admin" || currentUser?.role === "manager");
  const showLeads = activeSection === "Leads";
  const showUnmatched = activeSection === "Unmatched";
  const showConversations = activeSection === "Conversations";
  const showInventory = activeSection === "Inventory";
  const showAnalytics = activeSection === "Analytics";
  const sectionTitle = {
    Dashboard: "Sales execution",
    Intake: "Email intake",
    Leads: "Lead pipeline",
    Unmatched: "Unmatched communications",
    Conversations: "Conversations",
    Inventory: "Inventory focus",
    Analytics: "Pipeline analytics",
    Team: "Team management",
  }[activeSection];
  const sectionDescription = {
    Dashboard: "Show only the leads that need a rep or manager to act right now.",
    Intake: "Automatically ingested email traffic lands here first so managers can triage before reps work the lead.",
    Leads: "Review the organized pipeline after urgent work is handled.",
    Unmatched: "Capture inbound calls and SMS that did not match a lead, then resolve them into the CRM.",
    Conversations: "See the latest inbound and outbound communication in one place and jump straight into the lead record.",
    Inventory: "Manage real dealership inventory units, import CSV snapshots, and link leads to structured stock records.",
    Analytics: "Track where leads sit, which sources are feeding the desk, and how much of the pipeline is actionable.",
    Team: "Manage CRM access for the dealership team.",
  }[activeSection];

  return (
    <div className="min-h-screen bg-ink-950 bg-dashboard px-4 py-4 font-body text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1800px] gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
        <div className="xl:block">
          <Sidebar
            activeSection={activeSection}
            onSelectSection={(section) => {
              startTransition(() => {
                setActiveSection(section);
              });
            }}
            currentUser={currentUser}
          />
        </div>

        <main className="rounded-[2rem] border border-white/10 bg-ink-900/70 p-4 shadow-card backdrop-blur sm:p-6">
          <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <button
                type="button"
                className="mt-1 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 xl:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs uppercase tracking-[0.34em] text-slate-500">Automotive command center</p>
                <h1 className="mt-2 font-display text-3xl font-semibold text-white sm:text-4xl">{sectionTitle}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">{sectionDescription}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.26em] text-slate-500">
                  Signed in as {currentUser?.name} | {currentUser?.role}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <NotificationTray
                notifications={notifications}
                open={notificationsOpen}
                unreadCount={metrics.unread_notification_count}
                onToggle={() => setNotificationsOpen((current) => !current)}
                onMarkRead={handleMarkNotificationRead}
              />
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Logout
              </button>
              <label className="flex min-w-[260px] items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-300 focus-within:border-ice-400/40 focus-within:bg-white/10">
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
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
              </button>
            </div>
          </header>

          {error ? (
            <div className="mt-4 rounded-2xl border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-300">
              {error}
            </div>
          ) : null}

          {!showTeam ? (
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              eyebrow="Needs attention"
              value={String(metrics.needs_attention_count).padStart(2, "0")}
              detail="Leads that should be worked before anything else."
              accent="from-lime-500/20 to-transparent"
            />
            <MetricCard
              eyebrow="Overdue tasks"
              value={String(metrics.overdue_task_count).padStart(2, "0")}
              detail="Follow-ups already past due."
              accent="from-ice-500/20 to-transparent"
            />
            <MetricCard
              eyebrow="Unread alerts"
              value={String(metrics.unread_notification_count).padStart(2, "0")}
              detail="Assignments, overdue tasks, and flagged AI interactions."
              accent="from-fuchsia-500/20 to-transparent"
            />
            </section>
          ) : null}

          {showTeam ? (
            <TeamManagementPanel
              users={users}
              currentUser={currentUser}
              form={userForm}
              loading={usersLoading}
              submitting={userSubmitting}
              deletingUserId={deletingUserId}
              onFormChange={(field, value) => setUserForm((current) => ({ ...current, [field]: value }))}
              onSubmit={handleCreateUser}
              onDelete={handleDeleteUser}
            />
          ) : showAnalytics ? (
            <section className="mt-6 grid gap-4 xl:grid-cols-3">
              <MetricCard
                eyebrow="Total leads"
                value={String(analytics.totalLeads).padStart(2, "0")}
                detail="All accessible leads in the CRM."
                accent="from-white/10 to-transparent"
              />
              <MetricCard
                eyebrow="Organized leads"
                value={String(analytics.organizedCount).padStart(2, "0")}
                detail="Leads currently not demanding immediate attention."
                accent="from-ice-500/20 to-transparent"
              />
              <MetricCard
                eyebrow="Tracked conversations"
                value={String(analytics.conversationsCount).padStart(2, "0")}
                detail="Recent SMS and call records available for the desk."
                accent="from-ember-500/20 to-transparent"
              />

              <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5 xl:col-span-2">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Status distribution</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(analytics.statusCounts).map(([status, count]) => (
                    <div key={status} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{pipelineLabel(status)}</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{count}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Source mix</p>
                <div className="mt-4 space-y-3">
                  {Object.entries(analytics.sourceCounts).map(([source, count]) => (
                    <div key={source} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <span className="text-sm font-medium text-white">{source}</span>
                      <span className="text-sm text-slate-300">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                {showDashboard ? (
                  <>
                    <div className="border-b border-white/10 pb-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Sales execution queue</p>
                        <h2 className="mt-2 font-display text-2xl font-semibold text-white">Needs attention</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                          Only leads that need follow-up, callback, task completion, or manager action belong here.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4">
                      {loading ? (
                        Array.from({ length: 4 }).map((_, index) => (
                          <div key={index} className="h-48 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
                        ))
                      ) : (
                        visibleAttentionLeads.map((lead) => (
                          <AttentionLeadCard
                            key={lead.id}
                            lead={lead}
                            selected={lead.id === selectedLead?.id}
                            onSelect={() => {
                              startTransition(() => {
                                setSelectedLeadId(lead.id);
                              });
                            }}
                          />
                        ))
                      )}
                      {!loading && visibleAttentionLeads.length === 0 ? (
                        <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                          No leads require attention right now.
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {showIntake ? (
                  <EmailIntakePanel
                    items={visibleEmailIntakeItems}
                    loading={emailIntakeLoading}
                    activeTab={emailIntakeTab}
                    summary={emailIntakeSummary}
                    assignees={assignees}
                    assigneesLoading={assigneesLoading}
                    assigningId={emailIntakeAssigningId}
                    resolvingId={emailIntakeResolvingId}
                    convertingId={emailIntakeConvertingId}
                    onSelectTab={setEmailIntakeTab}
                    onAssign={handleAssignEmailIntake}
                    onResolve={handleResolveEmailIntake}
                    onConvert={handleConvertEmailIntake}
                  />
                ) : null}

                {showLeads ? (
                  <>
                    <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Organized pipeline</p>
                        <h2 className="mt-2 font-display text-2xl font-semibold text-white">Lead library</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                          Everything not demanding immediate action lives here, grouped by stage so the desk can work cleanly.
                        </p>
                      </div>
                      <label className="grid gap-2 lg:min-w-[220px]">
                        <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Status filter</span>
                        <select
                          value={leadStatusFilter}
                          onChange={(event) => setLeadStatusFilter(event.target.value)}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                        >
                          <option value="all" className="bg-ink-900">
                            All organized leads
                          </option>
                          {organizedGroups.map((status) => (
                            <option key={status} value={status} className="bg-ink-900">
                              {pipelineLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-4 grid gap-4">
                      {libraryLoading ? (
                        Array.from({ length: 4 }).map((_, index) => (
                          <div key={index} className="h-44 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
                        ))
                      ) : flattenedOrganizedLeads.length ? (
                        organizedGroups.map((group) =>
                          filteredOrganizedGroups[group]?.length ? (
                            <div key={group} className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] p-4">
                              <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stage</p>
                                  <h3 className="mt-1 font-display text-xl font-semibold text-white">{pipelineLabel(group)}</h3>
                                </div>
                                <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                                  {filteredOrganizedGroups[group].length}
                                </span>
                              </div>
                              <div className="grid gap-4">
                                {filteredOrganizedGroups[group].map((lead) => (
                                  <LeadCard
                                    key={lead.id}
                                    lead={lead}
                                    selected={lead.id === selectedLead?.id}
                                    onSelect={() => {
                                      startTransition(() => {
                                        setSelectedLeadId(lead.id);
                                      });
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null
                        )
                      ) : (
                        <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                          No organized leads match this search.
                        </div>
                      )}
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
                            onClick={() => setSelectedLeadId(item.leadId)}
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
                  />
                ) : null}
              </div>

              {!showAnalytics && !showUnmatched && !showIntake ? (
                <div className="2xl:sticky 2xl:top-6 2xl:self-start">
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
                    onAssignLead={handleAssignLead}
                    onCompleteTask={handleCompleteTask}
                    taskCompletingId={taskCompletingId}
                    onSendSms={handleSendSms}
                    smsSending={smsSending}
                    onLogCall={handleLogCall}
                    callLogging={callLogging}
                    onHoldVehicle={handleHoldVehicle}
                    holdSubmitting={holdSubmitting}
                    inventoryOptions={inventoryItems}
                    inventoryLinking={inventoryLinking}
                    onLinkInventory={handleLinkInventory}
                  />
                </div>
              ) : null}
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
    </div>
  );
}
