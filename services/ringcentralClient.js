const { logStructured } = require("./structuredLogger");

const DEFAULT_SERVER_URL = "https://platform.ringcentral.com";
const DEFAULT_EVENT_FILTERS = [
  "/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS",
  "/restapi/v1.0/account/~/extension/~/telephony/sessions",
];

function buildUrl(base, pathname, query = {}) {
  const url = new URL(pathname, base);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function nowIso() {
  return new Date().toISOString();
}

function plusSeconds(seconds) {
  const next = new Date();
  next.setSeconds(next.getSeconds() + Number(seconds || 0));
  return next.toISOString();
}

class RingCentralApiClient {
  constructor({
    serverUrl = process.env.RINGCENTRAL_SERVER_URL || DEFAULT_SERVER_URL,
    clientId = process.env.RINGCENTRAL_CLIENT_ID || "",
    clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET || "",
    redirectUri = process.env.RINGCENTRAL_REDIRECT_URI || "",
    webhookUrl = process.env.RINGCENTRAL_WEBHOOK_URL || "",
    validationToken = process.env.RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN || "",
    scopes = process.env.RINGCENTRAL_SCOPES || "",
    fetchImpl = fetch,
  } = {}) {
    this.serverUrl = serverUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.webhookUrl = webhookUrl;
    this.validationToken = validationToken;
    this.scopes = scopes;
    this.fetch = fetchImpl;
  }

  buildAuthorizationUrl(state) {
    return buildUrl(`${this.serverUrl}/restapi/oauth/authorize`, "", {
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
    });
  }

  buildBasicAuthHeader() {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
  }

  async exchangeCodeForTokens(code) {
    const response = await this.fetch(`${this.serverUrl}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: this.buildBasicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RingCentral token exchange failed: ${body || response.statusText}`);
    }

    return response.json();
  }

  async refreshToken(refreshToken) {
    const response = await this.fetch(`${this.serverUrl}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: this.buildBasicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RingCentral token refresh failed: ${body || response.statusText}`);
    }

    return response.json();
  }

  async request({ accessToken, url, method = "GET", headers = {}, body, raw = false } = {}) {
    const response = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...headers,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`RingCentral API request failed (${response.status}): ${text || response.statusText}`);
      error.status = response.status;
      throw error;
    }

    if (raw) {
      return response;
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async requestWithRefresh(connection, store, options = {}) {
    try {
      return await this.request({
        accessToken: connection.access_token,
        ...options,
      });
    } catch (error) {
      if (error.status !== 401 || !connection.refresh_token) {
        throw error;
      }

      const refreshed = await this.refreshToken(connection.refresh_token);
      const saved = await store.upsertConnection({
        user_id: connection.user_id,
        ringcentral_account_id: connection.ringcentral_account_id,
        ringcentral_extension_id: connection.ringcentral_extension_id,
        server_url: connection.server_url || this.serverUrl,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || connection.refresh_token,
        token_type: refreshed.token_type || connection.token_type,
        scope: refreshed.scope || connection.scope,
        expires_at: refreshed.expires_in ? plusSeconds(refreshed.expires_in) : connection.expires_at,
        refresh_expires_at: refreshed.refresh_token_expires_in
          ? plusSeconds(refreshed.refresh_token_expires_in)
          : connection.refresh_expires_at,
        webhook_address: connection.webhook_address,
        status: "active",
      });
      return this.request({
        accessToken: saved.access_token,
        ...options,
      });
    }
  }

  async getExtensionInfo(accessToken) {
    return this.request({
      accessToken,
      url: buildUrl(this.serverUrl, "/restapi/v1.0/account/~/extension/~"),
    });
  }

  async createSubscription(connection, store, eventFilters = DEFAULT_EVENT_FILTERS) {
    if (!this.webhookUrl) {
      throw new Error("RINGCENTRAL_WEBHOOK_URL is required before creating subscriptions.");
    }

    const payload = {
      eventFilters,
      deliveryMode: {
        transportType: "WebHook",
        address: this.webhookUrl,
      },
    };

    if (this.validationToken) {
      payload.deliveryMode.verificationToken = this.validationToken;
    }

    const response = await this.requestWithRefresh(connection, store, {
      url: buildUrl(this.serverUrl, "/restapi/v1.0/subscription"),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return store.saveSubscription({
      connection_id: connection.id,
      subscription_id: response.id,
      event_filters: response.eventFilters || eventFilters,
      delivery_mode: response.deliveryMode?.transportType || "WebHook",
      expires_at: response.expirationTime || null,
      status: "active",
    });
  }

  async getMessageById(connection, store, messageId) {
    return this.requestWithRefresh(connection, store, {
      url: buildUrl(this.serverUrl, `/restapi/v1.0/account/~/extension/~/message-store/${messageId}`),
    });
  }

  async listCallLogs(connection, store, params = {}) {
    return this.requestWithRefresh(connection, store, {
      url: buildUrl(this.serverUrl, "/restapi/v1.0/account/~/extension/~/call-log", {
        view: "Detailed",
        page: 1,
        perPage: 100,
        ...params,
      }),
    });
  }

  async downloadRecording(connection, store, url) {
    return this.requestWithRefresh(connection, store, {
      url,
      raw: true,
    });
  }

  logScopeWarning() {
    logStructured("info", "ringcentral_required_scopes", {
      scopes: this.scopes.split(/\s+/).filter(Boolean),
      checked_at: nowIso(),
    });
  }
}

module.exports = {
  DEFAULT_EVENT_FILTERS,
  DEFAULT_SERVER_URL,
  RingCentralApiClient,
  buildUrl,
};
