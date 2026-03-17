const fs = require("fs");

const { canTransitionLeadStatus } = require("../src/models/leadStatus");
const { logStructured } = require("./structuredLogger");

const STATUS_CANONICAL_VALUES = [
  "new_lead",
  "contacted",
  "no_answer",
  "engaged",
  "appointment_set",
  "follow_up_needed",
  "negotiating",
  "sold",
  "lost",
  "do_not_contact",
];

const DEFAULT_STATUS_MAPPING = {
  new_lead: "new",
  contacted: "contacted",
  no_answer: "contacted",
  engaged: "contacted",
  appointment_set: "appointment",
  follow_up_needed: "contacted",
  negotiating: "negotiation",
  sold: "sold",
  lost: "lost",
  do_not_contact: "lost",
};

function boolToFlag(value) {
  return value ? 1 : 0;
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function getAiConfig() {
  return {
    enabled: Boolean(process.env.OPENAI_API_KEY),
    apiKey: process.env.OPENAI_API_KEY || "",
    apiBaseUrl: process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1",
    analysisModel: process.env.OPENAI_ANALYSIS_MODEL || "gpt-5-mini",
    transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    autoStatusUpdates: process.env.RINGCENTRAL_AUTO_STATUS_UPDATES !== "false",
    confidenceThreshold: Number(process.env.RINGCENTRAL_AI_CONFIDENCE_THRESHOLD || 0.78),
  };
}

function createEmptyRecommendation(source, transcriptText = "") {
  return {
    transcript_text: transcriptText || null,
    summary: "",
    intent: "unknown",
    objections: "",
    appointment_intent: false,
    trade_in_mention: false,
    financing_mention: false,
    hot_lead_score: 0,
    suggested_status: "contacted",
    confidence: 0.5,
    reasoning_summary: `No confident ${source} recommendation was produced.`,
    next_task: "Review communication manually.",
    escalation_flag: false,
    raw: null,
  };
}

function heuristicAnalyzeText(sourceType, text) {
  const haystack = String(text || "").toLowerCase();
  const recommendation = createEmptyRecommendation(sourceType, sourceType === "call" ? text : null);

  const contains = (pattern) => pattern.test(haystack);

  const appointment = contains(/\b(test drive|appointment|come in|coming in|book(ed)?|schedule(d)?)\b/);
  const tradeIn = contains(/\b(trade[- ]?in|sell my car|appraisal)\b/);
  const financing = contains(/\b(finance|financing|payment|lease|credit)\b/);
  const objectionTerms = [];

  if (contains(/\b(price|too expensive|higher than|discount)\b/)) {
    objectionTerms.push("pricing");
  }
  if (contains(/\b(carfax|accident|accidents|history report)\b/)) {
    objectionTerms.push("vehicle history");
  }
  if (contains(/\b(rate|interest rate|apr)\b/)) {
    objectionTerms.push("financing");
  }

  let suggested = "contacted";
  let confidence = 0.68;
  let summary = "Customer has engaged with the dealership.";
  let nextTask = "Follow up with the customer.";
  let intent = "general_inquiry";
  let escalation = false;

  if (contains(/\b(stop|unsubscribe|do not contact|don't text|remove me)\b/)) {
    suggested = "do_not_contact";
    confidence = 0.96;
    summary = "Customer explicitly requested no further contact.";
    nextTask = "Mark the lead as do not contact and stop outreach.";
    intent = "opt_out";
  } else if (contains(/\b(bought elsewhere|not interested|stop looking|sold my car)\b/)) {
    suggested = "lost";
    confidence = 0.87;
    summary = "Customer indicated the opportunity is no longer active.";
    nextTask = "Close the lead and document the reason.";
    intent = "lost_opportunity";
  } else if (contains(/\b(deposit|paperwork|delivery|pickup tomorrow|picked up)\b/)) {
    suggested = "sold";
    confidence = 0.9;
    summary = "Conversation suggests a completed or nearly completed sale.";
    nextTask = "Confirm the deal status and finalize delivery steps.";
    intent = "purchase_complete";
  } else if (contains(/\b(counter offer|numbers|monthly payment|deal|trade value)\b/)) {
    suggested = "negotiating";
    confidence = 0.84;
    summary = "Customer is discussing numbers or deal structure.";
    nextTask = "Prepare the next negotiation step and follow up quickly.";
    intent = "negotiation";
  } else if (appointment) {
    suggested = "appointment_set";
    confidence = 0.9;
    summary = "Customer is ready to schedule or confirm a visit.";
    nextTask = "Confirm the appointment details with the customer.";
    intent = "appointment";
  } else if (contains(/\b(called back|interested|available|still available|send more info|carfax|details)\b/)) {
    suggested = "engaged";
    confidence = 0.8;
    summary = "Customer is actively engaging and asking for more information.";
    nextTask = "Respond with the requested details and keep momentum.";
    intent = "engaged";
  } else if (contains(/\b(voicemail|left a message|no answer|not answering)\b/)) {
    suggested = "no_answer";
    confidence = 0.79;
    summary = "The outreach did not connect with the customer yet.";
    nextTask = "Try another call or send a text follow-up.";
    intent = "no_answer";
  }

  if (contains(/\b(asap|urgent|today|right away|tonight)\b/)) {
    escalation = true;
  }

  recommendation.summary = summary;
  recommendation.intent = intent;
  recommendation.objections = objectionTerms.join(", ");
  recommendation.appointment_intent = appointment;
  recommendation.trade_in_mention = tradeIn;
  recommendation.financing_mention = financing;
  recommendation.hot_lead_score = Math.min(
    100,
    Math.max(
      5,
      Math.round(
        confidence * 100 +
          (appointment ? 8 : 0) +
          (tradeIn ? 4 : 0) +
          (financing ? 4 : 0) +
          (escalation ? 6 : 0)
      )
    )
  );
  recommendation.suggested_status = suggested;
  recommendation.confidence = confidence;
  recommendation.reasoning_summary = summary;
  recommendation.next_task = nextTask;
  recommendation.escalation_flag = escalation;
  recommendation.transcript_text = sourceType === "call" ? text : null;
  return recommendation;
}

async function transcribeAudioFile(filePath, config = getAiConfig()) {
  if (!config.enabled) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("model", config.transcriptionModel);
  form.append("file", new Blob([buffer]), "recording.mp3");

  const response = await fetch(`${config.apiBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI transcription failed: ${body || response.statusText}`);
  }

  const payload = await response.json();
  return payload.text || "";
}

async function analyzeWithOpenAi(sourceType, content, config = getAiConfig()) {
  if (!config.enabled) {
    return heuristicAnalyzeText(sourceType, content);
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      intent: { type: "string" },
      objections: { type: "string" },
      appointment_intent: { type: "boolean" },
      trade_in_mention: { type: "boolean" },
      financing_mention: { type: "boolean" },
      hot_lead_score: { type: "integer", minimum: 0, maximum: 100 },
      suggested_status: { type: "string", enum: STATUS_CANONICAL_VALUES },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasoning_summary: { type: "string" },
      next_task: { type: "string" },
      escalation_flag: { type: "boolean" },
    },
    required: [
      "summary",
      "intent",
      "objections",
      "appointment_intent",
      "trade_in_mention",
      "financing_mention",
      "hot_lead_score",
      "suggested_status",
      "confidence",
      "reasoning_summary",
      "next_task",
      "escalation_flag",
    ],
  };

  const inputText =
    sourceType === "call"
      ? `Analyze this dealership sales call transcript:\n\n${content}`
      : `Analyze this dealership SMS thread:\n\n${content}`;

  const response = await fetch(`${config.apiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.analysisModel,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You analyze dealership lead conversations. Return structured JSON only. Map the conversation into dealership CRM follow-up guidance.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: inputText }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "lead_communication_analysis",
          schema,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI analysis failed: ${body || response.statusText}`);
  }

  const payload = await response.json();
  const textOutput = payload.output_text || "";
  const parsed = parseJson(textOutput);
  if (!parsed) {
    throw new Error("OpenAI analysis did not return valid JSON.");
  }

  return {
    transcript_text: sourceType === "call" ? content : null,
    summary: parsed.summary,
    intent: parsed.intent,
    objections: parsed.objections,
    appointment_intent: normalizeBoolean(parsed.appointment_intent),
    trade_in_mention: normalizeBoolean(parsed.trade_in_mention),
    financing_mention: normalizeBoolean(parsed.financing_mention),
    hot_lead_score: Number(parsed.hot_lead_score) || 0,
    suggested_status: parsed.suggested_status,
    confidence: Number(parsed.confidence) || 0,
    reasoning_summary: parsed.reasoning_summary,
    next_task: parsed.next_task,
    escalation_flag: normalizeBoolean(parsed.escalation_flag),
    raw: payload,
  };
}

function mapCanonicalStatusToCrmStatus(canonicalStatus, mapping = DEFAULT_STATUS_MAPPING) {
  return mapping[canonicalStatus] || "contacted";
}

function buildAuditDecision(currentStatus, recommendation, config = getAiConfig()) {
  const mappedStatus = mapCanonicalStatusToCrmStatus(recommendation.suggested_status);
  const confidence = Number(recommendation.confidence) || 0;
  const autoAllowed = config.autoStatusUpdates && confidence >= config.confidenceThreshold;
  const transitionAllowed = canTransitionLeadStatus(currentStatus, mappedStatus);

  if (!autoAllowed) {
    return {
      autoApply: false,
      recommendationOnly: true,
      previous_status: currentStatus,
      new_status: mappedStatus,
      confidence,
      reasoning_summary: recommendation.reasoning_summary || recommendation.summary || "",
    };
  }

  if (!transitionAllowed) {
    return {
      autoApply: false,
      recommendationOnly: true,
      previous_status: currentStatus,
      new_status: mappedStatus,
      confidence,
      reasoning_summary: `Blocked invalid transition ${currentStatus} -> ${mappedStatus}. ${
        recommendation.reasoning_summary || recommendation.summary || ""
      }`.trim(),
    };
  }

  if (mappedStatus === currentStatus) {
    return {
      autoApply: false,
      recommendationOnly: false,
      previous_status: currentStatus,
      new_status: mappedStatus,
      confidence,
      reasoning_summary: recommendation.reasoning_summary || recommendation.summary || "",
    };
  }

  return {
    autoApply: true,
    recommendationOnly: false,
    previous_status: currentStatus,
    new_status: mappedStatus,
    confidence,
    reasoning_summary: recommendation.reasoning_summary || recommendation.summary || "",
  };
}

async function applyAiLeadStatusDecision({
  db,
  lead,
  recommendation,
  source,
  store,
  config = getAiConfig(),
}) {
  const decision = buildAuditDecision(lead.status, recommendation, config);
  const audit = {
    lead_id: Number(lead.id),
    previous_status: decision.previous_status,
    new_status: decision.new_status,
    confidence: decision.confidence,
    reasoning_summary: decision.reasoning_summary,
    source,
    auto_applied: boolToFlag(decision.autoApply),
    recommendation_only: boolToFlag(decision.recommendationOnly),
  };

  await store.createLeadStatusAudit(audit);

  if (!decision.autoApply) {
    await db.createActivity({
      lead_id: Number(lead.id),
      type: "note_added",
      content: `AI recommended ${decision.new_status} (${Math.round(decision.confidence * 100)}% confidence). ${decision.reasoning_summary}`,
    });
    return audit;
  }

  try {
    await db.updateApiLeadStatus(Number(lead.id), decision.new_status);
    await db.createActivity({
      lead_id: Number(lead.id),
      type: "status_changed",
      content: `AI updated status ${decision.previous_status} -> ${decision.new_status} (${Math.round(
        decision.confidence * 100
      )}% confidence). ${decision.reasoning_summary}`,
    });
    return audit;
  } catch (error) {
    logStructured("error", "ai_status_update_failed", {
      lead_id: Number(lead.id),
      error: error.message,
      source,
    });
    throw error;
  }
}

module.exports = {
  STATUS_CANONICAL_VALUES,
  DEFAULT_STATUS_MAPPING,
  analyzeWithOpenAi,
  applyAiLeadStatusDecision,
  buildAuditDecision,
  getAiConfig,
  heuristicAnalyzeText,
  mapCanonicalStatusToCrmStatus,
  transcribeAudioFile,
};
