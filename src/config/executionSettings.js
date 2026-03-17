const DEFAULT_EXECUTION_SETTINGS = {
  inactivity_threshold_hours: 24,
  follow_up_task_hours: 24,
  ai_task_due_hours: 4,
  appointment_task_due_hours: 2,
  missed_call_task_due_minutes: 30,
};

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeExecutionSettings(input = {}) {
  return {
    inactivity_threshold_hours: normalizePositiveNumber(
      input.inactivity_threshold_hours,
      DEFAULT_EXECUTION_SETTINGS.inactivity_threshold_hours
    ),
    follow_up_task_hours: normalizePositiveNumber(
      input.follow_up_task_hours,
      DEFAULT_EXECUTION_SETTINGS.follow_up_task_hours
    ),
    ai_task_due_hours: normalizePositiveNumber(
      input.ai_task_due_hours,
      DEFAULT_EXECUTION_SETTINGS.ai_task_due_hours
    ),
    appointment_task_due_hours: normalizePositiveNumber(
      input.appointment_task_due_hours,
      DEFAULT_EXECUTION_SETTINGS.appointment_task_due_hours
    ),
    missed_call_task_due_minutes: normalizePositiveNumber(
      input.missed_call_task_due_minutes,
      DEFAULT_EXECUTION_SETTINGS.missed_call_task_due_minutes
    ),
  };
}

module.exports = {
  DEFAULT_EXECUTION_SETTINGS,
  normalizeExecutionSettings,
};
