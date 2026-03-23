function getTimeZoneOffsetMinutes(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const zonePart = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT+0";
  const match = zonePart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function getTodayCutoffIso(timeZone = process.env.LEAD_IMPORT_TIMEZONE || "America/Toronto") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value || 0);
  const month = Number(parts.find((part) => part.type === "month")?.value || 1);
  const day = Number(parts.find((part) => part.type === "day")?.value || 1);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcMidnight, timeZone);

  return new Date(utcMidnight.getTime() - offsetMinutes * 60_000).toISOString();
}

function buildGraphService(config = {}) {
  const tenantId = config.tenantId || process.env.MICROSOFT_TENANT_ID || "";
  const clientId = config.clientId || process.env.MICROSOFT_CLIENT_ID || "";
  const clientSecret = config.clientSecret || process.env.MICROSOFT_CLIENT_SECRET || "";
  const userId = config.userId || process.env.MICROSOFT_GRAPH_USER || "";
  const folderName = config.folderName || process.env.LEAD_IMPORT_FOLDER || "Inbox";
  const processedFolderName = config.processedFolderName || process.env.LEAD_IMPORT_PROCESSED_FOLDER || "";
  const cutoff = config.cutoff || process.env.LEAD_IMPORT_CUTOFF || getTodayCutoffIso();

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
