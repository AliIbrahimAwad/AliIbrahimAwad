const { getAiConfig } = require("./leadStatusAutomation");

function buildVehicleLabel(lead = {}) {
  return (
    [
      lead.inventory?.year || lead.vehicle_year || lead.vehicleYear,
      lead.inventory?.make || lead.vehicle_make || lead.vehicleMake,
      lead.inventory?.model || lead.vehicle_model || lead.vehicleModel,
      lead.inventory?.trim || lead.vehicle_trim || lead.vehicleTrim,
    ]
      .filter(Boolean)
      .join(" ") ||
    lead.vehicle_interest ||
    lead.vehicleInterest ||
    "the vehicle"
  );
}

function normalizeGoal(goal = "") {
  const normalized = String(goal || "").trim().toLowerCase();
  return normalized || "follow_up";
}

function trimSmsMessage(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function createHeuristicSmsSuggestion(lead = {}, options = {}) {
  const goal = normalizeGoal(options.goal);
  const firstName = String(lead.first_name || lead.firstName || lead.customer_name || lead.customerName || "")
    .trim()
    .split(/\s+/)[0];
  const introName = firstName && firstName.toLowerCase() !== "nn" ? ` ${firstName}` : "";
  const vehicle = buildVehicleLabel(lead);
  const dealershipName = options.dealershipName || "LooLoo Auto";

  let message = `Hi${introName}, it's ${dealershipName}. Just checking in about ${vehicle}. Let me know if you'd like pricing, payment options, or to set up a visit.`;

  if (goal === "appointment") {
    message = `Hi${introName}, it's ${dealershipName}. ${vehicle} is still available. Want me to lock in a time for you to see it or take it for a drive?`;
  } else if (goal === "price_drop") {
    message = `Hi${introName}, it's ${dealershipName}. Quick update on ${vehicle}: I can help with the latest pricing and availability if you want the details.`;
  } else if (goal === "missed_call") {
    message = `Hi${introName}, it's ${dealershipName}. Sorry we missed you. I’m here to help with ${vehicle} whenever you’re free.`;
  } else if (goal === "follow_up") {
    message = `Hi${introName}, it's ${dealershipName}. Just following up on ${vehicle}. If you want more info, pricing, or to book a visit, I can help.`;
  }

  return {
    goal,
    source: "heuristic",
    confidence: 0.64,
    reasoning: "Fallback dealership SMS template based on lead stage and vehicle context.",
    message: trimSmsMessage(message),
  };
}

function summarizeRecentMessages(messages = []) {
  const ordered = [...messages]
    .sort(
      (left, right) =>
        new Date(left.received_at || left.sent_at || left.created_at || 0).getTime() -
        new Date(right.received_at || right.sent_at || right.created_at || 0).getTime()
    )
    .slice(-6);

  return ordered
    .map((item) => `${String(item.direction || "unknown").toUpperCase()}: ${String(item.body_text || "").trim()}`)
    .filter(Boolean)
    .join("\n");
}

async function generateLeadSmsSuggestion({ lead = {}, messages = [], goal = "follow_up", extraContext = "" } = {}) {
  const normalizedGoal = normalizeGoal(goal);
  const config = getAiConfig();

  if (!config.enabled) {
    return createHeuristicSmsSuggestion(lead, { goal: normalizedGoal });
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      message: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasoning: { type: "string" },
      tone: { type: "string" },
      objective: { type: "string" },
    },
    required: ["message", "confidence", "reasoning", "tone", "objective"],
  };

  const prompt = [
    `Goal: ${normalizedGoal}`,
    `Lead source: ${lead.source || "unknown"}`,
    `Lead status: ${lead.status || "new"}`,
    `Customer name: ${lead.customer_name || lead.customerName || "Unknown"}`,
    `Vehicle: ${buildVehicleLabel(lead)}`,
    `Stock number: ${lead.stock_number || lead.stockNumber || "Unknown"}`,
    `Customer message: ${lead.message || "No customer message captured."}`,
    messages.length ? `Recent SMS thread:\n${summarizeRecentMessages(messages)}` : "Recent SMS thread: none",
    extraContext ? `Extra context: ${extraContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch(`${config.apiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXTING_MODEL || config.analysisModel || "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You write concise dealership SMS replies. Return JSON only. Keep the SMS natural, short, human, and under 320 characters. Do not invent facts, pricing, or promises. Mention the vehicle only if relevant. Never use markdown, bullets, or quotation marks around the final SMS.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "dealership_sms_suggestion",
          schema,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    return createHeuristicSmsSuggestion(lead, { goal: normalizedGoal });
  }

  const payload = await response.json();
  let parsed = null;
  try {
    parsed = JSON.parse(payload.output_text || "{}");
  } catch (_error) {
    parsed = null;
  }

  if (!parsed?.message) {
    return createHeuristicSmsSuggestion(lead, { goal: normalizedGoal });
  }

  return {
    goal: normalizedGoal,
    source: "openai",
    confidence: Number(parsed.confidence || 0) || 0.72,
    reasoning: String(parsed.reasoning || "AI-generated dealership SMS suggestion."),
    tone: String(parsed.tone || "professional"),
    objective: String(parsed.objective || normalizedGoal),
    message: trimSmsMessage(parsed.message),
  };
}

async function runAutomaticTexting({ db, ringcentral, limit = 20 } = {}) {
  const settings = await db.getExecutionSettings();
  if (!Number(settings.auto_sms_enabled)) {
    return {
      enabled: false,
      candidates: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const leads = await db.listLeadsEligibleForAutoText({
    delayMinutes: settings.auto_sms_delay_minutes,
    limit,
  });

  const summary = {
    enabled: true,
    candidates: leads.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const lead of leads) {
    try {
      const connection =
        lead.assigned_to != null ? await ringcentral.getActiveConnectionForUser(Number(lead.assigned_to)) : null;

      if (!connection && !ringcentral.config?.staticAccessToken) {
        await db.createLeadAutoTextRun({
          dealership_id: lead.dealership_id,
          lead_id: lead.id,
          automation_key: "new_lead_follow_up",
          automation_type: "auto_sms",
          status: "skipped_no_connection",
          assigned_user_id: lead.assigned_to,
          metadata: { reason: "no_ringcentral_connection" },
        });
        summary.skipped += 1;
        continue;
      }

      const messages = ringcentral.store ? await ringcentral.store.listLeadMessages(Number(lead.id), 6) : [];
      const suggestion = await generateLeadSmsSuggestion({
        lead,
        messages,
        goal: "follow_up",
        extraContext:
          "This will be sent automatically as the first text follow-up. Keep it warm, low-pressure, and action-oriented.",
      });

      const response = await ringcentral.sendSMS(lead.phone, suggestion.message, {
        crmUserId: lead.assigned_to || null,
      });

      if (ringcentral.store) {
        await ringcentral.store.upsertLeadMessage({
          lead_id: Number(lead.id),
          dealership_id: Number(lead.dealership_id),
          provider: "ringcentral",
          provider_message_id: String(response?.id || `auto-text-${lead.id}-${Date.now()}`),
          thread_id: response?.conversation?.id || response?.conversationId || null,
          direction: "outbound",
          from_number: response?.from?.phoneNumber || null,
          to_number: lead.phone,
          external_number: lead.phone,
          body_text: suggestion.message,
          message_status: response?.messageStatus || "Queued",
          sent_at: response?.creationTime || new Date().toISOString(),
          crm_user_id: lead.assigned_to || null,
          provider_extension_id: connection?.ringcentral_extension_id || null,
          raw: {
            response,
            automation_key: "new_lead_follow_up",
            auto_generated: true,
            suggestion,
          },
        });
      }

      await db.recordLeadActivity({
        lead_id: Number(lead.id),
        user_id: lead.assigned_to || null,
        type: "sms",
        content: suggestion.message,
      });

      await db.createLeadAutoTextRun({
        dealership_id: lead.dealership_id,
        lead_id: lead.id,
        automation_key: "new_lead_follow_up",
        automation_type: "auto_sms",
        status: "sent",
        assigned_user_id: lead.assigned_to,
        message_body: suggestion.message,
        metadata: {
          source: suggestion.source,
          confidence: suggestion.confidence,
          goal: suggestion.goal,
        },
      });

      if (lead.assigned_to) {
        await db.createNotification({
          user_id: Number(lead.assigned_to),
          lead_id: Number(lead.id),
          type: "auto_sms_sent",
          title: "Automatic text sent",
          body: "A first follow-up SMS was sent automatically.",
          unique_key: `auto-sms:${lead.id}:new_lead_follow_up`,
          metadata: {
            automation_key: "new_lead_follow_up",
            source: suggestion.source,
          },
        });
      }

      summary.sent += 1;
    } catch (error) {
      await db.createLeadAutoTextRun({
        dealership_id: lead.dealership_id,
        lead_id: lead.id,
        automation_key: "new_lead_follow_up",
        automation_type: "auto_sms",
        status: "failed",
        assigned_user_id: lead.assigned_to,
        metadata: { error: String(error?.message || error) },
      });
      summary.failed += 1;
    }
  }

  return summary;
}

module.exports = {
  createHeuristicSmsSuggestion,
  generateLeadSmsSuggestion,
  runAutomaticTexting,
};
