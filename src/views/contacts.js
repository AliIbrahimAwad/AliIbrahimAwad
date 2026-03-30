const { formatDisplayDate } = require("../utils/dates");
const { escapeHtml, fieldClass, when } = require("./helpers");
const { renderDocument } = require("./layout");

function contactLabel(contact) {
  const name = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
  return name || contact.company || contact.email || contact.phone || `Contact #${contact.id}`;
}

function renderContactForm({
  title,
  action,
  formData,
  errors = {},
  activePath = "/contacts",
  submitLabel = "Save contact",
  currentUser,
}) {
  return renderDocument({
    title,
    activePath,
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <h1>${escapeHtml(title)}</h1>
          <a href="/contacts">Back to contacts</a>
        </div>
        <form class="stack" method="post" action="${action}">
          <div class="grid two">
            <label class="field">
              <span>First name</span>
              <input class="${fieldClass(errors, "first_name")}" type="text" name="first_name" value="${escapeHtml(formData.first_name)}" />
            </label>
            <label class="field">
              <span>Last name</span>
              <input class="${fieldClass(errors, "last_name")}" type="text" name="last_name" value="${escapeHtml(formData.last_name)}" />
            </label>
          </div>
          ${when(errors.contact, `<p class="error-text">${escapeHtml(errors.contact)}</p>`)}
          <div class="grid two">
            <label class="field">
              <span>Email</span>
              <input class="${fieldClass(errors, "email")}" type="email" name="email" value="${escapeHtml(formData.email)}" />
            </label>
            <label class="field">
              <span>Phone</span>
              <input class="${fieldClass(errors, "phone")}" type="text" name="phone" value="${escapeHtml(formData.phone)}" />
            </label>
          </div>
          <div class="grid two">
            <label class="field">
              <span>Company</span>
              <input class="${fieldClass(errors, "company")}" type="text" name="company" value="${escapeHtml(formData.company)}" />
            </label>
            <label class="field">
              <span>Job title</span>
              <input class="${fieldClass(errors, "job_title")}" type="text" name="job_title" value="${escapeHtml(formData.job_title)}" />
            </label>
          </div>
          <div class="actions">
            <button class="button" type="submit">${escapeHtml(submitLabel)}</button>
            <a class="button secondary" href="/contacts">Cancel</a>
          </div>
        </form>
      </section>
    `,
  });
}

function renderContactsListPage({ contacts, activePath = "/contacts", currentUser }) {
  const rows = contacts.length
    ? contacts
        .map(
          (contact) => `
            <tr>
              <td><a href="/contacts/${contact.id}">${escapeHtml(contactLabel(contact))}</a></td>
              <td>${escapeHtml(contact.assigned_rep_name || "Unassigned")}</td>
              <td>${escapeHtml(contact.email || "N/A")}</td>
              <td>${escapeHtml(contact.phone || "N/A")}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No contacts available for this user yet.</td></tr>`;

  return renderDocument({
    title: "Contacts",
    activePath,
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Directory</p>
            <h1>Contacts</h1>
          </div>
          <a class="button" href="/contacts/new">New contact</a>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Assigned rep</th>
              <th>Email</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
}

function renderContactDetailPage({ contact, leads, activePath = "/contacts", currentUser }) {
  const leadRows = leads.length
    ? leads
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
    : `<tr><td colspan="4" class="empty">No visible leads are linked to this contact yet.</td></tr>`;

  return renderDocument({
    title: contactLabel(contact),
    activePath,
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Contact record</p>
            <h1>${escapeHtml(contactLabel(contact))}</h1>
          </div>
          <div class="actions">
            <a class="button" href="/contacts/${contact.id}/edit">Edit</a>
            <form method="post" action="/contacts/${contact.id}/delete">
              <button class="button danger" type="submit">Delete</button>
            </form>
          </div>
        </div>
        <dl class="details-grid">
          <div><dt>Email</dt><dd>${escapeHtml(contact.email || "N/A")}</dd></div>
          <div><dt>Phone</dt><dd>${escapeHtml(contact.phone || "N/A")}</dd></div>
          <div><dt>Assigned rep</dt><dd>${escapeHtml(contact.assigned_rep_name || "Unassigned")}</dd></div>
          <div><dt>Assignment method</dt><dd>${escapeHtml(contact.assignment_method || "N/A")}</dd></div>
          <div><dt>Company</dt><dd>${escapeHtml(contact.company || "N/A")}</dd></div>
          <div><dt>Job title</dt><dd>${escapeHtml(contact.job_title || "N/A")}</dd></div>
        </dl>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Linked leads</h2>
          <a href="/leads/new">Create lead</a>
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
          <tbody>${leadRows}</tbody>
        </table>
      </section>
    `,
  });
}

module.exports = {
  renderContactDetailPage,
  renderContactForm,
  renderContactsListPage,
};
