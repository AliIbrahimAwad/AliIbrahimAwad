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

export function getDashboardWorklist() {
  return request("/api/dashboard/worklist");
}

export function getConversations(limit = 50) {
  return request(`/api/conversations?limit=${limit}`);
}

export function getInventory(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString();
  return request(`/api/inventory${suffix ? `?${suffix}` : ""}`);
}

export function getInventoryById(id) {
  return request(`/api/inventory/${id}`);
}

export function importInventory(payload) {
  return request("/api/inventory/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getInventoryImportRuns(limit = 20) {
  return request(`/api/inventory/import-runs?limit=${limit}`);
}

export function linkLeadInventory(id, inventoryId) {
  return request(`/api/leads/${id}/link-inventory`, {
    method: "POST",
    body: JSON.stringify({ inventory_id: inventoryId }),
  });
}

export function getUnmatchedCommunications(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString();
  return request(`/api/unmatched${suffix ? `?${suffix}` : ""}`);
}

export function assignUnmatchedCommunication(id, leadId) {
  return request(`/api/unmatched/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ lead_id: leadId }),
  });
}

export function createLeadFromUnmatched(id, payload = {}) {
  return request(`/api/unmatched/${id}/create-lead`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function dismissUnmatchedCommunication(id) {
  return request(`/api/unmatched/${id}/dismiss`, {
    method: "POST",
  });
}

export function sendLeadSms(id, message) {
  return request(`/api/leads/${id}/sms`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function logLeadCall(id) {
  return request(`/api/leads/${id}/call`, {
    method: "POST",
  });
}

export function holdLeadVehicle(id) {
  return request(`/api/leads/${id}/hold`, {
    method: "POST",
  });
}

export function completeTask(id) {
  return request(`/api/tasks/${id}/complete`, {
    method: "PATCH",
  });
}

export function getNotifications(limit = 20) {
  return request(`/api/notifications?limit=${limit}`);
}

export function markNotificationRead(id) {
  return request(`/api/notifications/${id}/read`, {
    method: "PATCH",
  });
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
