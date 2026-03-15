function buildGraphService(config = {}) {
  const tenantId = config.tenantId || process.env.MICROSOFT_TENANT_ID || "";
  const clientId = config.clientId || process.env.MICROSOFT_CLIENT_ID || "";
  const clientSecret = config.clientSecret || process.env.MICROSOFT_CLIENT_SECRET || "";
  const userId = config.userId || process.env.MICROSOFT_GRAPH_USER || "";
  const folderName = config.folderName || process.env.LEAD_IMPORT_FOLDER || "Inbox";
  const processedFolderName = config.processedFolderName || process.env.LEAD_IMPORT_PROCESSED_FOLDER || "";
  const cutoff = config.cutoff || process.env.LEAD_IMPORT_CUTOFF || "";

  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  async function getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) {
      return cachedToken;
    }

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error("Microsoft Graph credentials are missing.");
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Microsoft token request failed: ${await response.text()}`);
    }

    const payload = await response.json();
    cachedToken = payload.access_token;
    cachedTokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
    return cachedToken;
  }

  async function graphRequest(path, options = {}) {
    const token = await getAccessToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Microsoft Graph request failed: ${await response.text()}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async function getFolderIdByName(displayName) {
    if (!displayName || displayName.toLowerCase() === "inbox") {
      return "inbox";
    }

    const result = await graphRequest(
      `/users/${encodeURIComponent(userId)}/mailFolders?$top=200&$select=id,displayName`
    );
    const folder = (result.value || []).find(
      (item) => String(item.displayName || "").trim().toLowerCase() === String(displayName).trim().toLowerCase()
    );

    if (!folder) {
      throw new Error(`Mail folder not found: ${displayName}`);
    }

    return folder.id;
  }

  async function listMessages({ limit = 25 } = {}) {
    if (!userId) {
      throw new Error("MICROSOFT_GRAPH_USER is required.");
    }

    const folderId = await getFolderIdByName(folderName);
    const filters = ["isRead eq false"];

    if (cutoff) {
      filters.push(`receivedDateTime ge ${new Date(cutoff).toISOString()}`);
    }

    const params = new URLSearchParams({
      $top: String(limit),
      $orderby: "receivedDateTime asc",
      $select: "id,internetMessageId,subject,receivedDateTime,isRead,body,bodyPreview,from",
      $filter: filters.join(" and "),
    });

    const result = await graphRequest(
      `/users/${encodeURIComponent(userId)}/mailFolders/${encodeURIComponent(folderId)}/messages?${params.toString()}`
    );

    return result.value || [];
  }

  async function markProcessed(message) {
    if (processedFolderName) {
      const destinationId = await getFolderIdByName(processedFolderName);
      await graphRequest(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(message.id)}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId }),
      });
      return;
    }

    await graphRequest(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(message.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true }),
    });
  }

  return {
    listMessages,
    markProcessed,
  };
}

module.exports = {
  buildGraphService,
};
