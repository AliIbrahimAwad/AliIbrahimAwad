const { escapeHtml, fieldClass, when } = require("./helpers");
const { renderDocument } = require("./layout");

function renderLoginPage({ formData, errors = {}, demoUsers = [] }) {
  const demoRows = demoUsers
    .map(
      (user) => `
        <tr>
          <td>${escapeHtml(user.role)}</td>
          <td>${escapeHtml(user.email)}</td>
          <td>${escapeHtml(user.password)}</td>
        </tr>
      `
    )
    .join("");

  return renderDocument({
    title: "Login",
    activePath: "/login",
    content: `
      <section class="panel auth-panel stack">
        <div>
          <p class="eyebrow">Secure access</p>
          <h1>Sign in to the CRM</h1>
          <p>Managers and admins can see all leads. Sales users only see leads assigned to them.</p>
        </div>
        ${when(errors.form, `<p class="error-text">${escapeHtml(errors.form)}</p>`)}
        <form class="stack" method="post" action="/login">
          <label class="field">
            <span>Email</span>
            <input class="${fieldClass(errors, "email")}" type="email" name="email" value="${escapeHtml(formData.email)}" required />
          </label>
          <label class="field">
            <span>Password</span>
            <input class="${fieldClass(errors, "password")}" type="password" name="password" required />
          </label>
          <div class="actions">
            <button class="button" type="submit">Login</button>
          </div>
        </form>
      </section>

      <section class="panel stack">
        <div class="section-heading">
          <h2>Seeded local users</h2>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Email</th>
              <th>Password</th>
            </tr>
          </thead>
          <tbody>${demoRows}</tbody>
        </table>
      </section>
    `,
  });
}

module.exports = {
  renderLoginPage,
};
