import { parseTraffy } from "./candidates";
import { preferReport } from "./reports";
import { thaiDay, shiftDay } from "./reservoirs";
import type { RoadImport } from "./roads-model";
import type { Batch, FieldReport } from "./model";
export async function collectRoadTraffy(
  read: (url: string) => Promise<unknown>,
  now: number,
  cursor?: RoadImport["cursor"],
) {
  const today = thaiDay(now),
    days = Array.from({ length: 7 }, (_, i) => shiftDay(today, -i)),
    offsets = { ...cursor?.offsets };
  for (const d of Object.keys(offsets))
    if (!days.includes(d)) delete offsets[d];
  const olderIndex = cursor?.olderIndex ?? 0,
    order = [days[0]!, days[1]!, days[2 + olderIndex]!];
  const reports = new Map<string, FieldReport>(),
    completeDays: string[] = [],
    scopeDays: string[] = [];
  let requests = 0,
    returned = 0,
    total = 0,
    partial = false;
  for (let dayIndex = 0; dayIndex < order.length; dayIndex++) {
    const day = order[dayIndex]!,
      start = offsets[day] ?? 0;
    let offset = start,
      firstTotal: number | null = null,
      dayReturned = 0,
      done = false,
      unstable = false,
      repeated = false;
    const seen = new Set<string>(),
      pageKeys = new Set<string>();
    scopeDays.push(day);
    const budget = dayIndex < 2 ? Math.min(4, 10 - requests) : 10 - requests;
    for (let page = 0; page < budget; page++) {
      const u = new URL(
        "https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v2",
      );
      u.search = new URLSearchParams({
        problem_type: "น้ำท่วม",
        start: day,
        end: day,
        limit: "300",
        offset: String(offset),
      }).toString();
      const p = parseTraffy(
        await read(u.href),
        new Date(now).toISOString(),
        "+07:00",
      );
      requests++;
      if (firstTotal === null) {
        firstTotal = p.total;
        total += p.total;
      } else if (firstTotal !== p.total) unstable = true;
      const key = JSON.stringify(
        (p.batch.reports ?? []).map((r) => r.id).sort(),
      );
      if (p.returned && pageKeys.has(key)) {
        repeated = true;
        unstable = true;
        break;
      }
      pageKeys.add(key);
      for (const r of p.batch.reports ?? []) {
        if (seen.has(r.id)) unstable = true;
        seen.add(r.id);
        const t = Date.parse(r.occurredAt ?? r.reportedAt);
        if (t <= now && t >= now - 7 * 86400000)
          reports.set(r.id, preferReport(r, reports.get(r.id)));
      }
      offset += p.returned;
      dayReturned += p.returned;
      returned += p.returned;
      if (offset >= p.total || p.returned === 0) {
        done = true;
        break;
      }
    }
    offsets[day] = done || repeated ? 0 : offset;
    // Only a complete, stable scan beginning at zero proves absence in that day.
    if (done && start === 0 && !unstable && dayReturned === firstTotal)
      completeDays.push(day);
    else partial = true;
  }
  const batch: Batch = {
    sourceId: "traffy-bkk",
    stations: [],
    observations: [],
    alerts: [],
    reports: [...reports.values()],
    coverage: {
      partial,
      returned,
      total,
      windowStart: [...scopeDays].sort()[0]!,
      windowEnd: today,
      timezoneAssumption: "Asia/Bangkok (+07:00)",
    },
  };
  return {
    batch,
    scopeDays,
    completeDays,
    requests,
    cursor: { offsets, olderIndex: (olderIndex + 1) % 5 },
  };
}
