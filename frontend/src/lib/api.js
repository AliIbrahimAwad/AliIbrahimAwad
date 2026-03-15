async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = await response.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch (_error) {
      // Ignore JSON parse failures and use the default message.
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function getLeads(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  return request(`/api/leads?${query.toString()}`);
}

export function getLead(id) {
  return request(`/api/leads/${id}`);
}

export function updateLeadStatus(id, status) {
  return request(`/api/leads/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function assignLead(id, assignedTo) {
  return request(`/api/leads/${id}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assigned_to: assignedTo }),
  });
}

export function getDashboardMetrics() {
  return request("/api/dashboard/metrics");
}

export function getUsers() {
  return request("/api/users");
}

export function getAssignableUsers() {
  return request("/api/users/assignable");
}

export function createUser(payload) {
  return request("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteUser(id) {
  return request(`/api/users/${id}`, {
    method: "DELETE",
  });
}

export function getSession() {
  return request("/api/auth/session");
}

export function login(email, password) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return request("/api/auth/logout", {
    method: "POST",
  });
}
