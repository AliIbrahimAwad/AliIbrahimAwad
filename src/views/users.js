const { escapeHtml, fieldClass, when } = require("./helpers");
const { renderDocument } = require("./layout");

function renderUsersListPage({ users, currentUser }) {
  const rows = users.length
    ? users
        .map(
          (user) => `
            <tr>
              <td><a href="/users/${user.id}/edit">${escapeHtml(user.name)}</a></td>
              <td>${escapeHtml(user.email)}</td>
              <td>${escapeHtml(user.role)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="3" class="empty">No users found.</td></tr>`;

  return renderDocument({
    title: "Users",
    activePath: "/users",
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Administration</p>
            <h1>User management</h1>
          </div>
          <a class="button" href="/users/new">New user</a>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
}

function renderUserForm({ title, action, formData, errors = {}, roles, currentUser, submitLabel }) {
  const roleOptions = roles
    .map(
      (role) => `
        <option value="${role}" ${formData.role === role ? "selected" : ""}>${escapeHtml(role)}</option>
      `
    )
    .join("");

  return renderDocument({
    title,
    activePath: "/users",
    currentUser,
    content: `
      <section class="panel stack">
        <div class="section-heading">
          <h1>${escapeHtml(title)}</h1>
          <a href="/users">Back to users</a>
        </div>
        ${when(errors.form, `<p class="error-text">${escapeHtml(errors.form)}</p>`)}
        <form class="stack" method="post" action="${action}">
          <label class="field">
            <span>Name</span>
            <input class="${fieldClass(errors, "name")}" type="text" name="name" value="${escapeHtml(formData.name)}" required />
          </label>
          <label class="field">
            <span>Email</span>
            <input class="${fieldClass(errors, "email")}" type="email" name="email" value="${escapeHtml(formData.email)}" required />
          </label>
          <label class="field">
            <span>Role</span>
            <select class="${fieldClass(errors, "role")}" name="role" required>
              ${roleOptions}
            </select>
          </label>
          <label class="field">
            <span>Password ${submitLabel === "Save user" ? "(leave blank to keep current password)" : ""}</span>
            <input class="${fieldClass(errors, "password")}" type="password" name="password" ${submitLabel === "Create user" ? "required" : ""} />
          </label>
          <div class="actions">
            <button class="button" type="submit">${escapeHtml(submitLabel)}</button>
            <a class="button secondary" href="/users">Cancel</a>
          </div>
        </form>
      </section>
    `,
  });
}

module.exports = {
  renderUserForm,
  renderUsersListPage,
};
