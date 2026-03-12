const { escapeHtml } = require("./helpers");

function navigationLink(pathname, label, activePath) {
  const current = activePath === pathname || (pathname !== "/" && activePath.startsWith(pathname));
  return `<a class="${current ? "nav-link active" : "nav-link"}" href="${pathname}">${label}</a>`;
}

function renderUserMenu(currentUser) {
  if (!currentUser) {
    return `<a class="button secondary" href="/login">Login</a>`;
  }

  return `
    <div class="user-menu">
      <div class="user-badge">
        <strong>${escapeHtml(currentUser.name)}</strong>
        <span>${escapeHtml(currentUser.role)}</span>
      </div>
      <form method="post" action="/logout">
        <button class="button secondary" type="submit">Logout</button>
      </form>
    </div>
  `;
}

function renderNavigation(currentUser, activePath) {
  if (!currentUser) {
    return `<nav class="nav">${navigationLink("/login", "Login", activePath)}</nav>`;
  }

  const links = [
    navigationLink("/", "Dashboard", activePath),
    navigationLink("/contacts", "Contacts", activePath),
    navigationLink("/leads", "Leads", activePath),
  ];

  if (currentUser.role === "admin") {
    links.push(navigationLink("/users", "Users", activePath));
  }

  return `<nav class="nav">${links.join("")}</nav>`;
}

function renderDocument({ title, content, activePath = "/", currentUser = null }) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)} | CRM</title>
      <link rel="stylesheet" href="/public/styles.css" />
    </head>
    <body>
      <div class="shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Local-first CRM</p>
            <a class="brand" href="/">Ali CRM</a>
          </div>
          <div class="topbar-side">
            ${renderNavigation(currentUser, activePath)}
            ${renderUserMenu(currentUser)}
          </div>
        </header>
        <main class="content">${content}</main>
      </div>
    </body>
  </html>`;
}

module.exports = {
  renderDocument,
};
