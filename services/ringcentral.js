function createRingCentralService(config = {}) {
  const serverUrl = config.serverUrl || process.env.RINGCENTRAL_SERVER_URL || "https://platform.ringcentral.com";
  const accessToken = config.accessToken || process.env.RINGCENTRAL_ACCESS_TOKEN || "";
  const fromPhoneNumber = config.fromPhoneNumber || process.env.RINGCENTRAL_FROM_NUMBER || "";
  const webhookValidationToken =
    config.webhookValidationToken || process.env.RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN || "";

  async function sendSMS(phone, message) {
    if (!phone || !message) {
      throw new Error("Phone number and message are required.");
    }

    // Fall back to a mock response in local environments without RingCentral credentials.
    if (!accessToken || !fromPhoneNumber) {
      return {
        id: `mock-sms-${Date.now()}`,
        mock: true,
        phone,
        message,
        queuedAt: new Date().toISOString(),
      };
    }

    const response = await fetch(`${serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: {
          phoneNumber: fromPhoneNumber,
        },
        to: [
          {
            phoneNumber: phone,
          },
        ],
        text: message,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RingCentral SMS failed: ${body || response.statusText}`);
    }

    return response.json();
  }

  function logCall(phone, duration = 0) {
    return {
      id: `call-${Date.now()}`,
      phone,
      duration: Number(duration) || 0,
      createdAt: new Date().toISOString(),
    };
  }

  function isValidWebhookRequest(headers) {
    if (!webhookValidationToken) {
      return true;
    }

    return headers["validation-token"] === webhookValidationToken;
  }

  return {
    isValidWebhookRequest,
    logCall,
    sendSMS,
  };
}

module.exports = {
  createRingCentralService,
};
