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

    throw new Error(message);
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

export function getDashboardMetrics() {
  return request("/api/dashboard/metrics");
}
