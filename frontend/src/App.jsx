import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { Menu, Search, SlidersHorizontal } from "lucide-react";

import { AttentionLeadCard } from "./components/AttentionLeadCard";
import { LeadCard } from "./components/LeadCard";
import { LeadDetailsPanel } from "./components/LeadDetailsPanel";
import { LoginPage } from "./components/LoginPage";
import { MetricCard } from "./components/MetricCard";
import { NotificationTray } from "./components/NotificationTray";
import { Sidebar } from "./components/Sidebar";
import { TeamManagementPanel } from "./components/TeamManagementPanel";
import {
  assignLead,
  completeTask,
  createUser,
  deleteUser,
  getAssignableUsers,
  getDashboardWorklist,
  getLead,
  getSession,
  getUsers,
  login,
  logout,
  markNotificationRead,
  updateLeadStatus,
} from "./lib/api";
import { pipelineLabel } from "./lib/format";

const tabs = ["Needs Attention", "Organized Leads"];
const organizedGroups = ["contacted", "engaged", "appointment", "negotiation", "sold", "lost"];

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
    phone: lead.phone || "No phone on file",
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
    lastActivity: formatRelative(lead.latest_activity_at || lead.updated_at),
    createdAtLabel: formatRelative(lead.created_at),
    updatedAtLabel: formatRelative(lead.updated_at),
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
  const [organizedLeadGroups, setOrganizedLeadGroups] = useState({
    contacted: [],
    engaged: [],
    appointment: [],
    negotiation: [],
    sold: [],
    lost: [],
  });
  const [notifications, setNotifications] = useState([]);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedLeadDetails, setSelectedLeadDetails] = useState(null);
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [activeTab, setActiveTab] = useState("Needs Attention");
  const [users, setUsers] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [taskCompletingId, setTaskCompletingId] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [error, setError] = useState("");
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
    [lead.customerName, lead.vehicleInterest, lead.phone, lead.source, lead.messagePreview, lead.attentionReason, lead.aiSummary]
      .join(" ")
      .toLowerCase()
      .includes(search);

  const visibleAttentionLeads = leads.filter(matchesSearch);
  const visibleOrganizedGroups = Object.fromEntries(
    organizedGroups.map((group) => [group, organizedLeadGroups[group].filter(matchesSearch)])
  );
  const flattenedOrganizedLeads = organizedGroups.flatMap((group) => visibleOrganizedGroups[group]);

  const selectedLead =
    selectedLeadDetails && selectedLeadDetails.id === selectedLeadId
      ? selectedLeadDetails
      : visibleAttentionLeads.find((lead) => lead.id === selectedLeadId) ??
        leads.find((lead) => lead.id === selectedLeadId) ??
        flattenedOrganizedLeads.find((lead) => lead.id === selectedLeadId) ??
        organizedGroups.flatMap((group) => organizedLeadGroups[group]).find((lead) => lead.id === selectedLeadId) ??
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
      setOrganizedLeadGroups({
        contacted: [],
        engaged: [],
        appointment: [],
        negotiation: [],
        sold: [],
        lost: [],
      });
      setMetrics(emptyMetrics);
      setUsers([]);
      setAssignees([]);
      setNotifications([]);
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
      setError("");
    } catch (taskError) {
      setError(taskError.message || "Unable to complete task.");
    } finally {
      setTaskCompletingId(null);
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

  return (
    <div className="min-h-screen bg-ink-950 bg-dashboard px-4 py-4 font-body text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1800px] gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
        <div className="xl:block">
          <Sidebar activeSection={activeSection} onSelectSection={setActiveSection} currentUser={currentUser} />
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
                <h1 className="mt-2 font-display text-3xl font-semibold text-white sm:text-4xl">
                  Sales execution
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
                  Focus the team on leads that need action now, and keep the rest of the pipeline organized in the background.
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.26em] text-slate-500">
                  Signed in as {currentUser?.name} • {currentUser?.role}
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
          ) : (
          <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              <div className="flex flex-col gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Sales execution queue</p>
                  <h2 className="mt-2 font-display text-2xl font-semibold text-white">
                    {activeTab === "Needs Attention" ? "Needs attention" : "Organized leads"}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        startTransition(() => {
                          setActiveTab(tab);
                        });
                      }}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        activeTab === tab
                          ? "bg-white text-ink-950"
                          : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-4">
                {loading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-48 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04]" />
                  ))
                ) : activeTab === "Needs Attention" ? (
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
                ) : (
                  organizedGroups.map((group) =>
                    visibleOrganizedGroups[group]?.length ? (
                      <div key={group} className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] p-4">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Organized</p>
                            <h3 className="mt-1 font-display text-xl font-semibold text-white">{pipelineLabel(group)}</h3>
                          </div>
                          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                            {visibleOrganizedGroups[group].length}
                          </span>
                        </div>
                        <div className="grid gap-4">
                          {visibleOrganizedGroups[group].map((lead) => (
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
                )}
                {!loading &&
                ((activeTab === "Needs Attention" && visibleAttentionLeads.length === 0) ||
                  (activeTab === "Organized Leads" && flattenedOrganizedLeads.length === 0)) ? (
                  <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                    {activeTab === "Needs Attention"
                      ? "No leads require attention right now."
                      : "No organized leads match this filter."}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="2xl:sticky 2xl:top-6 2xl:self-start">
              <LeadDetailsPanel
                lead={selectedLead}
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
              />
            </div>
          </section>
          )}
        </main>
      </div>
    </div>
  );
}
