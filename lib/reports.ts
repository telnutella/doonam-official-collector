import type { Batch, FieldReport } from "./model";
export const traffyCaseUrl = (id: string) =>
  "https://bangkok.traffy.in.th/detail?" +
  new URLSearchParams({ ticketID: id });
export function recentReports(reports: FieldReport[], now: number, hours = 24) {
  return reports
    .filter((r) => {
      const t = Date.parse(r.reportedAt);
      return (
        Number.isFinite(t) &&
        t <= now &&
        t >= now - hours * 3600000 &&
        r.status !== "withdrawn"
      );
    })
    .sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
}
export function reportDays(now: number) {
  return [now - 86400000, now].map((t) =>
    new Date(t + 7 * 3600000).toISOString().slice(0, 10),
  );
}
export function preferReport(candidate: FieldReport, previous?: FieldReport) {
  if (!previous) return candidate;
  const delta =
    Date.parse(candidate.lastActivityAt ?? candidate.reportedAt) -
    Date.parse(previous.lastActivityAt ?? previous.reportedAt);
  return delta > 0 ||
    (delta === 0 &&
      Date.parse(candidate.fetchedAt) >= Date.parse(previous.fetchedAt))
    ? candidate
    : previous;
}
export function combineReportDays(
  parts: { batch: Batch; total: number; returned: number; partial: boolean }[],
  days: string[],
  now: number,
): Batch {
  const byId = new Map<string, FieldReport>();
  for (const part of parts)
    for (const report of part.batch.reports ?? []) {
      byId.set(report.id, preferReport(report, byId.get(report.id)));
    }
  return {
    sourceId: "traffy-bkk",
    stations: [],
    observations: [],
    alerts: [],
    reports: recentReports([...byId.values()], now),
    coverage: {
      partial: parts.some((p) => p.partial),
      returned: parts.reduce((n, p) => n + p.returned, 0),
      total: parts.reduce((n, p) => n + p.total, 0),
      windowStart: days[0]!,
      windowEnd: days[1]!,
      timezoneAssumption: "Asia/Bangkok (+07:00)",
    },
  };
}
