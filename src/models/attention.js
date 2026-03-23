const { normalizeLeadStatus } = require("./leadStatus");

const ATTENTION_REASON_PRIORITY = {
  overdue_task: 100,
  missed_call: 90,
  new_lead: 80,
  ai_follow_up: 70,
  no_recent_activity: 60,
  pending_task: 50,
};

function hoursBetween(laterDate, earlierDate) {
  return (laterDate.getTime() - earlierDate.getTime()) / 3600000;
}

function formatAttentionReason(code, task = null) {
  switch (code) {
    case "overdue_task":
      return task?.title || "Task overdue";
    case "missed_call":
      return "Missed call with no follow-up";
    case "new_lead":
      return "New lead not contacted";
    case "ai_follow_up":
      return "AI suggested next action";
    case "no_recent_activity":
      return "No recent activity";
    case "pending_task":
      return task?.title || "Pending task";
    default:
      return "Needs attention";
  }
}

function choosePrimaryReason(reasons = []) {
  return [...reasons].sort((left, right) => {
    const leftPriority = ATTENTION_REASON_PRIORITY[left.code] || 0;
    const rightPriority = ATTENTION_REASON_PRIORITY[right.code] || 0;
    return rightPriority - leftPriority;
  })[0] || null;
}

function categorizeOrganizedLead(lead, latestAnalysis, lastActivityAt, settings, now = new Date()) {
  const status = normalizeLeadStatus(lead.status);

  if (status === "sold" || status === "lost" || status === "appointment" || status === "negotiation") {
    return status;
  }

  return "contacted";
}

function evaluateLeadAttention({
  lead,
  tasks = [],
  latestAnalysis = null,
  latestActivityAt = null,
  lastMissedCallAt = null,
  lastFollowUpAt = null,
  settings,
  now = new Date(),
}) {
  const reasons = [];
  const status = normalizeLeadStatus(lead.status);

  const overdueTask = tasks.find((task) => task.status === "overdue");
  if (overdueTask) {
    reasons.push({ code: "overdue_task", task: overdueTask });
  }

  if (status === "new") {
    reasons.push({ code: "new_lead" });
  }

  const pendingTask = tasks.find((task) => task.status === "pending");
  if (pendingTask) {
    reasons.push({ code: "pending_task", task: pendingTask });
  }

  if (lastMissedCallAt && (!lastFollowUpAt || lastFollowUpAt.getTime() < lastMissedCallAt.getTime())) {
    reasons.push({ code: "missed_call" });
  }

  if (latestAnalysis?.next_task) {
    reasons.push({ code: "ai_follow_up" });
  }

  if (status !== "new" && latestActivityAt) {
    const idleHours = hoursBetween(now, latestActivityAt);
    if (idleHours >= settings.inactivity_threshold_hours) {
      reasons.push({ code: "no_recent_activity" });
    }
  }

  const primaryReason = choosePrimaryReason(reasons);
  return {
    needs_attention: Boolean(primaryReason),
    reasons: reasons.map((reason) => ({
      code: reason.code,
      label: formatAttentionReason(reason.code, reason.task),
    })),
    primary_reason: primaryReason
      ? {
          code: primaryReason.code,
          label: formatAttentionReason(primaryReason.code, primaryReason.task),
        }
      : null,
    urgency_score: primaryReason ? ATTENTION_REASON_PRIORITY[primaryReason.code] || 0 : 0,
  };
}

module.exports = {
  ATTENTION_REASON_PRIORITY,
  categorizeOrganizedLead,
  evaluateLeadAttention,
};
