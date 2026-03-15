import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { Menu, Search, SlidersHorizontal } from "lucide-react";

import { LeadCard } from "./components/LeadCard";
import { LeadDetailsPanel } from "./components/LeadDetailsPanel";
import { LoginPage } from "./components/LoginPage";
import { MetricCard } from "./components/MetricCard";
import { Sidebar } from "./components/Sidebar";
import { TeamManagementPanel } from "./components/TeamManagementPanel";
import {
  assignLead,
  createUser,
  deleteUser,
  getAssignableUsers,
  getDashboardMetrics,
  getLead,
  getLeads,
  getSession,
  getUsers,
  login,
  logout,
  updateLeadStatus,
} from "./lib/api";
import { pipelineLabel } from "./lib/format";

const tabs = ["All leads", "New Lead", "Contacted", "Appointment", "Negotiation", "Sold", "Lost"];

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
    activities: [],
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

const emptyMetrics = {
  new_leads_today: 0,
  leads_this_week: 0,
  appointments_scheduled: 0,
  vehicles_sold: 0,
  conversion_rate: 0,
};

export default function App() {
  const [authStatus, setAuthStatus] = useState("loading");
  const [currentUser, setCurrentUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedLeadDetails, setSelectedLeadDetails] = useState(null);
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [activeTab, setActiveTab] = useState("All leads");
  const [users, setUsers] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [error, setError] = useState("");
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "sales",
  });
  const deferredQuery = useDeferredValue(query);

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
        const [leadResponse, dashboardMetrics] = await Promise.all([
          getLeads({ limit: 100 }),
          getDashboardMetrics(),
        ]);

        if (!active) {
          return;
        }

        const nextLeads = leadResponse.items.map(formatLead);
        setLeads(nextLeads);
        setMetrics(dashboardMetrics);
        setSelectedLeadId((current) => current ?? nextLeads[0]?.id ?? null);
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

  const visibleLeads = leads.filter((lead) => {
    const matchesTab = activeTab === "All leads" ? true : lead.statusLabel === activeTab;
    const search = deferredQuery.trim().toLowerCase();

    if (!search) {
      return matchesTab;
    }

    return (
      matchesTab &&
      [lead.customerName, lead.vehicleInterest, lead.phone, lead.source, lead.messagePreview]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  });

  const selectedLead =
    selectedLeadDetails && selectedLeadDetails.id === selectedLeadId
      ? selectedLeadDetails
      : visibleLeads.find((lead) => lead.id === selectedLeadId) ?? leads.find((lead) => lead.id === selectedLeadId) ?? null;

  async function handleStatusChange(nextStatus) {
    if (!selectedLeadId) {
      return;
    }

    try {
      setStatusUpdating(true);
      const updatedLead = formatLead(await updateLeadStatus(selectedLeadId, nextStatus));

      setLeads((current) =>
        current.map((lead) => (lead.id === updatedLead.id ? { ...lead, ...updatedLead } : lead))
      );
      setSelectedLeadDetails((current) =>
        current && current.id === updatedLead.id ? { ...current, ...updatedLead } : current
      );
      setMetrics((current) => ({
        ...current,
        appointments_scheduled:
          nextStatus === "appointment" || selectedLead?.status === "appointment"
            ? current.appointments_scheduled + (nextStatus === "appointment" ? 1 : -1)
            : current.appointments_scheduled,
      }));
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

      setLeads((current) =>
        current.map((lead) => (lead.id === updatedLead.id ? { ...lead, ...updatedLead } : lead))
      );
      setSelectedLeadDetails({
        ...updatedLead,
        activities: payload.activities.map(formatActivity),
      });
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
      setMetrics(emptyMetrics);
      setUsers([]);
      setAssignees([]);
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
                  Deal desk performance
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
                  Monitor live shopper momentum, respond faster, and keep every lead moving toward an appointment.
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.26em] text-slate-500">
                  Signed in as {currentUser?.name} • {currentUser?.role}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              eyebrow="New leads today"
              value={String(metrics.new_leads_today).padStart(2, "0")}
              detail="Fresh opportunities created since midnight."
              accent="from-lime-500/20 to-transparent"
            />
            <MetricCard
              eyebrow="This week"
              value={String(metrics.leads_this_week).padStart(2, "0")}
              detail="Total new shoppers captured in the last 7 days."
              accent="from-ice-500/20 to-transparent"
            />
            <MetricCard
              eyebrow="Appointments"
              value={String(metrics.appointments_scheduled).padStart(2, "0")}
              detail="Pipeline records currently sitting in appointment."
              accent="from-sky-500/20 to-transparent"
            />
            <MetricCard
              eyebrow="Vehicles sold"
              value={String(metrics.vehicles_sold).padStart(2, "0")}
              detail="Closed deals sourced from the CRM pipeline."
              accent="from-ember-500/20 to-transparent"
            />
            <MetricCard
              eyebrow="Conversion rate"
              value={`${metrics.conversion_rate}%`}
              detail="Closed deals divided by total leads on file."
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
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Lead queue</p>
                  <h2 className="mt-2 font-display text-2xl font-semibold text-white">Active shoppers</h2>
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
                ) : (
                  visibleLeads.map((lead) => (
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
                  ))
                )}
                {!loading && visibleLeads.length === 0 ? (
                  <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-slate-400">
                    No leads match this filter. Try another status or search phrase.
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
              />
            </div>
          </section>
          )}
        </main>
      </div>
    </div>
  );
}
