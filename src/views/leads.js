const { LEAD_SOURCES } = require("../types/models");
const { formatDisplayDate, formatTimestamp } = require("../utils/dates");
const { escapeHtml, fieldClass, when } = require("./helpers");
const { renderDocument } = require("./layout");

function renderLeadForm({
  title,
  action,
  formData,
  contacts,
  statuses,
  assignees,
  errors = {},
  activePath = "/leads",
  submitLabel = "Save lead",
  currentUser,
  allowAssignment = false,
}) {
  const contactOptions = [
    `<option value="">No linked contact</option>`,
    ...contacts.map(
      (contact) => `
        <option value="${contact.id}" ${String(formData.contact_id || "") === String(contact.id) ? "selected" : ""}>
          ${escapeHtml(contact.display_name)}
        </option>
      `
    ),
  ].join("");

  const statusOptions = statuses
    .map(
      (status) => `
        <option value="${status}" ${formData.status === status ? "selected" : ""}>${escapeHtml(status)}</option>
      `
    )
    .join("");

  const sourceOptions = LEAD_SOURCES.map(
    (source) => `
      <option value="${source}" ${formData.source === source ? "selected" : ""}>${escapeHtml(source)}</option>
    `
  ).join("");

  const assigneeOptions = assignees
    .map(
      (user) => `
        <option value="${user.id}" ${String(formData.assigned_to || "") === String(user.id) ? "selected" : ""}>
          ${escapeHtml(user.name)}
        </option>
      `
    )
    .join("");

  return renderDocument({
    title,
    activePath,
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <h1>${escapeHtml(title)}</h1>
          <a href="/leads">Back to leads</a>
        </div>
        <form class="stack" method="post" action="${action}">
          ${when(errors.status, `<p class="error-text">${escapeHtml(errors.status)}</p>`)}
          ${when(errors.contact_id, `<p class="error-text">${escapeHtml(errors.contact_id)}</p>`)}
          ${when(errors.follow_up_date, `<p class="error-text">${escapeHtml(errors.follow_up_date)}</p>`)}
          ${when(errors.source, `<p class="error-text">${escapeHtml(errors.source)}</p>`)}
          ${when(errors.assigned_to, `<p class="error-text">${escapeHtml(errors.assigned_to)}</p>`)}
          <div class="grid two">
            <label class="field">
              <span>Linked contact</span>
              <select class="${fieldClass(errors, "contact_id")}" name="contact_id">
                ${contactOptions}
              </select>
            </label>
            <label class="field">
              <span>Status</span>
              <select class="${fieldClass(errors, "status")}" name="status" required>
                ${statusOptions}
              </select>
            </label>
          </div>
          <div class="grid two">
            <label class="field">
              <span>Source</span>
              <select class="${fieldClass(errors, "source")}" name="source" required>
                ${sourceOptions}
              </select>
            </label>
            <label class="field">
              <span>Priority</span>
              <input class="${fieldClass(errors, "priority")}" type="text" name="priority" value="${escapeHtml(formData.priority)}" />
            </label>
          </div>
          <div class="grid two">
            <label class="field">
              <span>Follow-up date</span>
              <input class="${fieldClass(errors, "follow_up_date")}" type="date" name="follow_up_date" value="${escapeHtml(formData.follow_up_date)}" />
            </label>
            <label class="field">
              <span>Next action</span>
              <input class="${fieldClass(errors, "next_action")}" type="text" name="next_action" value="${escapeHtml(formData.next_action)}" />
            </label>
          </div>
          ${
            allowAssignment
              ? `
                <label class="field">
                  <span>Assigned salesperson</span>
                  <select class="${fieldClass(errors, "assigned_to")}" name="assigned_to" required>
                    ${assigneeOptions}
                  </select>
                </label>
              `
              : `<input type="hidden" name="assigned_to" value="${escapeHtml(formData.assigned_to)}" />`
          }
          <div class="actions">
            <button class="button" type="submit">${escapeHtml(submitLabel)}</button>
            <a class="button secondary" href="/leads">Cancel</a>
          </div>
        </form>
      </section>
    `,
  });
}

function renderLeadsListPage({ leads, activePath = "/leads", currentUser }) {
  const rows = leads.length
    ? leads
        .map(
          (lead) => `
            <tr>
              <td><a href="/leads/${lead.id}">${escapeHtml(lead.display_name)}</a></td>
              <td>${escapeHtml(lead.source)}</td>
              <td>${escapeHtml(lead.status)}</td>
              <td>${escapeHtml(lead.assigned_user_name || "Unassigned")}</td>
              <td>${escapeHtml(formatDisplayDate(lead.follow_up_date))}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="5" class="empty">No leads available for this user yet.</td></tr>`;

  return renderDocument({
    title: "Leads",
    activePath,
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Pipeline</p>
            <h1>Leads</h1>
          </div>
          <a class="button" href="/leads/new">New lead</a>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Source</th>
              <th>Status</th>
              <th>Assigned</th>
              <th>Follow-up</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
}

function renderLeadDetailPage({
  lead,
  contacts,
  notes,
  activities = [],
  assignees = [],
  activePath = "/leads",
  currentUser,
  canAssign = false,
  assignmentError = "",
  communicationError = "",
  smsDraft = "",
  callDuration = "",
}) {
  const notesMarkup = notes.length
    ? notes
        .map(
          (note) => `
            <article class="note-card">
              <p>${escapeHtml(note.body)}</p>
              <time>${escapeHtml(formatTimestamp(note.created_at))}</time>
            </article>
          `
        )
        .join("")
    : `<p class="empty">No notes yet. Add the latest update below.</p>`;

  const linkedContact = lead.contact_id
    ? contacts.find((contact) => Number(contact.id) === Number(lead.contact_id))
    : null;

  const assigneeOptions = assignees
    .map(
      (user) => `
        <option value="${user.id}" ${Number(lead.assigned_to) === Number(user.id) ? "selected" : ""}>
          ${escapeHtml(user.name)}
        </option>
      `
    )
    .join("");

  const callHistory = activities.filter((activity) => activity.type === "call");
  const messageHistory = activities.filter((activity) => activity.type === "sms");
  const activityTimeline = activities.length
    ? activities
        .map(
          (activity) => `
            <article class="note-card">
              <p><strong>${escapeHtml(activity.type)}</strong> ${escapeHtml(activity.content)}</p>
              <time>${escapeHtml(activity.actor_name || "System")} • ${escapeHtml(formatTimestamp(activity.created_at))}</time>
            </article>
          `
        )
        .join("")
    : `<p class="empty">No activity has been recorded yet.</p>`;

  const callHistoryMarkup = callHistory.length
    ? callHistory
        .map(
          (activity) => `
            <article class="note-card">
              <p>${escapeHtml(activity.content)}</p>
              <time>${escapeHtml(activity.actor_name || "System")} • ${escapeHtml(formatTimestamp(activity.created_at))}</time>
            </article>
          `
        )
        .join("")
    : `<p class="empty">No calls have been logged yet.</p>`;

  const messageHistoryMarkup = messageHistory.length
    ? messageHistory
        .map(
          (activity) => `
            <article class="note-card">
              <p>${escapeHtml(activity.content)}</p>
              <time>${escapeHtml(activity.actor_name || "System")} • ${escapeHtml(formatTimestamp(activity.created_at))}</time>
            </article>
          `
        )
        .join("")
    : `<p class="empty">No SMS activity yet.</p>`;

  return renderDocument({
    title: lead.display_name,
    activePath,
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Lead record</p>
            <h1>${escapeHtml(lead.display_name)}</h1>
          </div>
          <div class="actions">
            <a class="button" href="/leads/${lead.id}/edit">Edit</a>
            <form method="post" action="/leads/${lead.id}/delete">
              <button class="button danger" type="submit">Delete</button>
            </form>
          </div>
        </div>
        <dl class="details-grid">
          <div><dt>Status</dt><dd>${escapeHtml(lead.status)}</dd></div>
          <div><dt>Source</dt><dd>${escapeHtml(lead.source)}</dd></div>
          <div><dt>Assigned</dt><dd>${escapeHtml(lead.assigned_user_name || "Unassigned")}</dd></div>
          <div><dt>Priority</dt><dd>${escapeHtml(lead.priority || "N/A")}</dd></div>
          <div><dt>Follow-up</dt><dd>${escapeHtml(formatDisplayDate(lead.follow_up_date))}</dd></div>
          <div><dt>Next action</dt><dd>${escapeHtml(lead.next_action || "N/A")}</dd></div>
          <div><dt>Contact</dt><dd>${linkedContact ? `<a href="/contacts/${linkedContact.id}">${escapeHtml(linkedContact.display_name)}</a>` : "None linked"}</dd></div>
        </dl>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Notes</h2>
        </div>
        <div class="stack">${notesMarkup}</div>
        <form class="stack" method="post" action="/leads/${lead.id}/notes">
          <label class="field">
            <span>Add note</span>
            <textarea class="input" name="body" rows="4" required></textarea>
          </label>
          <div class="actions">
            <button class="button" type="submit">Save note</button>
          </div>
        </form>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Lead outreach</h2>
        </div>
        ${when(communicationError, `<p class="error-text">${escapeHtml(communicationError)}</p>`)}
        <div class="grid two">
          <form class="stack" method="post" action="/leads/${lead.id}/sms">
            <label class="field">
              <span>Send SMS</span>
              <textarea class="input" name="message" rows="4" required>${escapeHtml(smsDraft)}</textarea>
            </label>
            <div class="actions">
              <button class="button" type="submit">Send SMS</button>
            </div>
          </form>
          <form class="stack" method="post" action="/leads/${lead.id}/calls">
            <label class="field">
              <span>Log call duration (seconds)</span>
              <input class="input" type="number" min="0" name="duration" value="${escapeHtml(callDuration)}" />
            </label>
            <div class="actions">
              <button class="button secondary" type="submit">Log Call</button>
            </div>
          </form>
        </div>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Call history</h2>
        </div>
        <div class="stack">${callHistoryMarkup}</div>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Message history</h2>
        </div>
        <div class="stack">${messageHistoryMarkup}</div>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Activity timeline</h2>
        </div>
        <div class="stack">${activityTimeline}</div>
      </section>

      ${
        canAssign
          ? `
            <section class="panel stack">
              <div class="section-heading">
                <h2>Assign lead</h2>
              </div>
              ${when(assignmentError, `<p class="error-text">${escapeHtml(assignmentError)}</p>`)}
              <form class="stack" method="post" action="/leads/${lead.id}/assign">
                <label class="field">
                  <span>Assigned salesperson</span>
                  <select class="input" name="salesperson_id" required>
                    ${assigneeOptions}
                  </select>
                </label>
                <div class="actions">
                  <button class="button" type="submit">Assign lead</button>
                </div>
              </form>
            </section>
          `
          : ""
      }
    `,
  });
}

module.exports = {
  renderLeadDetailPage,
  renderLeadForm,
  renderLeadsListPage,
};
