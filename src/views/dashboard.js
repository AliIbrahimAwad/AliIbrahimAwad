const { formatDisplayDate } = require("../utils/dates");
const { escapeHtml } = require("./helpers");
const { renderDocument } = require("./layout");

function renderDashboardPage({ metrics, activePath = "/", currentUser }) {
  const statusCards = metrics.statusCounts
    .map(
      (item) => `
        <article class="stat-card">
          <span class="stat-label">${escapeHtml(item.status)}</span>
          <strong class="stat-value">${item.count}</strong>
        </article>
      `
    )
    .join("");

  const upcomingRows = metrics.upcomingLeads.length
    ? metrics.upcomingLeads
        .map(
          (lead) => `
            <tr>
              <td><a href="/leads/${lead.id}">${escapeHtml(lead.display_name)}</a></td>
              <td>${escapeHtml(lead.status)}</td>
              <td>${escapeHtml(lead.assigned_user_name || "Unassigned")}</td>
              <td>${escapeHtml(formatDisplayDate(lead.follow_up_date))}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No follow-ups scheduled yet.</td></tr>`;

  const salespersonRows = metrics.leadsPerSalesperson.length
    ? metrics.leadsPerSalesperson
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td>${row.count}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="2" class="empty">No sales users available yet.</td></tr>`;

  const recentActivityRows = metrics.recentActivities.length
    ? metrics.recentActivities
        .map(
          (activity) => `
            <tr>
              <td><a href="/leads/${activity.lead_id}">${escapeHtml(activity.lead_name)}</a></td>
              <td>${escapeHtml(activity.type)}</td>
              <td>${escapeHtml(activity.actor_name || "System")}</td>
              <td>${escapeHtml(activity.content)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No activity recorded yet.</td></tr>`;

  return renderDocument({
    title: "Dashboard",
    activePath,
    currentUser,
    content: `
      <section class="hero panel">
        <div>
          <p class="eyebrow">Today at a glance</p>
          <h1>${currentUser.role === "sales" ? "My lead dashboard" : "Manager dashboard"}</h1>
          <p>Track lead ownership, follow-ups, and pipeline health in one place.</p>
        </div>
        <div class="hero-actions">
          <a class="button" href="/contacts/new">New contact</a>
          <a class="button secondary" href="/leads/new">New lead</a>
        </div>
      </section>

      <section class="metrics-grid">
        <article class="stat-card accent">
          <span class="stat-label">Total leads</span>
          <strong class="stat-value">${metrics.totalLeads}</strong>
        </article>
        <article class="stat-card accent">
          <span class="stat-label">Overdue follow-ups</span>
          <strong class="stat-value">${metrics.followUps.overdue}</strong>
        </article>
        <article class="stat-card accent">
          <span class="stat-label">Due today</span>
          <strong class="stat-value">${metrics.followUps.today}</strong>
        </article>
        <article class="stat-card accent">
          <span class="stat-label">Upcoming</span>
          <strong class="stat-value">${metrics.followUps.upcoming}</strong>
        </article>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Leads by status</h2>
          <a href="/leads">View all leads</a>
        </div>
        <div class="metrics-grid">
          ${statusCards}
        </div>
      </section>

      ${
        currentUser.role === "manager" || currentUser.role === "admin"
          ? `
            <section class="panel stack">
              <div class="section-heading">
                <h2>Leads per salesperson</h2>
                ${currentUser.role === "admin" ? '<a href="/users">Manage users</a>' : ""}
              </div>
              <table class="table">
                <thead>
                  <tr>
                    <th>Salesperson</th>
                    <th>Lead count</th>
                  </tr>
                </thead>
                <tbody>${salespersonRows}</tbody>
              </table>
            </section>
          `
          : ""
      }

      <section class="panel stack">
        <div class="section-heading">
          <h2>Next follow-ups</h2>
          <a href="/leads/new">Schedule a follow-up</a>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Status</th>
              <th>Assigned</th>
              <th>Follow-up</th>
            </tr>
          </thead>
          <tbody>
            ${upcomingRows}
          </tbody>
        </table>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Recent activities</h2>
          <a href="/leads">Open lead list</a>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Type</th>
              <th>User</th>
              <th>Content</th>
            </tr>
          </thead>
          <tbody>${recentActivityRows}</tbody>
        </table>
      </section>
    `,
  });
}

module.exports = {
  renderDashboardPage,
};
