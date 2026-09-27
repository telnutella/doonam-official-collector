// A bounded trial must stop without relying on another scheduler run or a user visit.
export function rainScheduleEnabled(
  env: Record<string, string | undefined>,
  now = Date.now(),
) {
  if (env.DOONAM_RAIN_SCHEDULED !== "1") return false;
  const until = env.DOONAM_RAIN_SCHEDULED_UNTIL;
  if (!until) return true;
  const end = Date.parse(until);
  return Number.isFinite(end) && end > now;
}
