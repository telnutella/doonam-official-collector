import { z } from "zod";
import { BatchSchema } from "./model";
export const roadSources = ["itic", "traffy-bkk"] as const;
export type RoadSource = (typeof roadSources)[number];
export const RoadNameSchema = z.object({
  name: z.string().min(1).max(140),
  kind: z.enum(["road", "soi"]),
});
export const RoadImportSchema = z
  .object({
    runId: z.string().uuid(),
    runStartedAt: z.string().datetime(),
    part: z.number().int().min(0).max(499),
    parts: z.number().int().min(1).max(500),
    scopeDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(7),
    completeDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(7),
    cursor: z
      .object({
        offsets: z.record(z.number().int().nonnegative().max(1000000)),
        olderIndex: z.number().int().min(0).max(4),
      })
      .optional(),
    requests: z.number().int().min(0).max(12),
    batch: BatchSchema,
  })
  .strict()
  .refine(
    (x) =>
      x.part < x.parts && x.completeDays.every((d) => x.scopeDays.includes(d)),
    "Invalid import sequence",
  );
export type RoadImport = z.infer<typeof RoadImportSchema>;
export type RoadReport = {
  id: string;
  sourceId: RoadSource;
  sourceReportId: string;
  revision: string;
  groupId: string;
  individualId?: string;
  roadName: string | null;
  roadKind: "road" | "soi" | null;
  provinceCode: string | null;
  districtName: string | null;
  subdistrictName: string | null;
  kind: "flood" | "rain" | "roadClosure";
  title: string;
  body: string;
  sourceStatus: string;
  occurredAt: string | null;
  reportedAt: string;
  updatedAt: string | null;
  endsAt: string | null;
  fetchedAt: string;
  latitude: number | null;
  longitude: number | null;
  sourceUrl: string;
  hasPhoto: boolean;
};
export type StoredRoadReport = RoadReport & {
  firstSeenAt: string;
  lastSeenAt: string;
  changedAt: string;
  missingSince: string | null;
};
export type RoadHealth = {
  sourceId: RoadSource;
  lastAttempt: string | null;
  lastSuccess: string | null;
  error: string | null;
  partial: boolean;
  returned: number;
  total: number;
  scopeDays: string[];
  completeDays: string[];
  requests: number;
  writes: number;
  cursor?: RoadImport["cursor"];
};
export type RoadGroup = {
  id: string;
  name: string;
  assigned: boolean;
  provinceCode: string | null;
  districtName: string | null;
  subdistrictName: string | null;
  lastReportAt: string;
  changedAt: string;
  count: number;
  sourceCounts: Partial<Record<RoadSource, number>>;
  kinds: string[];
  mapped: number;
  hasPhoto: boolean;
  reports: StoredRoadReport[];
};
export type RoadList = {
  schemaVersion: 1;
  servedAt: string;
  collectionStartedAt: string | null;
  groups: RoadGroup[];
  total: number;
  offset: number;
  limit: number;
  partial: boolean;
  reportCount: number;
  unmapped: number;
  sources: RoadHealth[];
  error?: string;
};
export type RoadHistory = {
  partial?: boolean;
  reportId: string;
  startedAt: string | null;
  entries: { at: string; revision: string; payload: RoadReport }[];
};
export const roadSourceName = (s: string) =>
  s === "itic" ? "รายงานผ่าน iTIC" : "เรื่องร้องเรียน Traffy";
export const roadKindName = (k: string) =>
  ({
    flood: "มีรายงานน้ำท่วม",
    rain: "มีรายงานฝนตก",
    roadClosure: "ต้นทางรายงานปิดถนน",
  })[k] ?? k;
export function reportTime(r: RoadReport) {
  return r.occurredAt ?? r.reportedAt;
}
export function roadAgeState(r: RoadReport, now: number) {
  const age = now - Date.parse(reportTime(r));
  return age < 0 ? "invalid" : age <= 3600000 ? "recent" : "older";
}
export function sourceDelayed(s: RoadHealth, now: number) {
  return (
    !!s.error || !s.lastSuccess || now - Date.parse(s.lastSuccess) > 15 * 60000
  );
}
export function groupReports(rows: StoredRoadReport[]): RoadGroup[] {
  const groups = new Map<string, RoadGroup>();
  for (const r of rows) {
    let g = groups.get(r.groupId);
    if (!g) {
      g = {
        id: r.groupId,
        name: r.roadName ?? r.title,
        assigned: !!r.roadName && !!r.provinceCode && !!r.districtName,
        provinceCode: r.provinceCode,
        districtName: r.districtName,
        subdistrictName: r.subdistrictName,
        lastReportAt: reportTime(r),
        changedAt: r.changedAt,
        count: 0,
        sourceCounts: {},
        kinds: [],
        mapped: 0,
        hasPhoto: false,
        reports: [],
      };
      groups.set(g.id, g);
    }
    g.count++;
    g.sourceCounts[r.sourceId] = (g.sourceCounts[r.sourceId] ?? 0) + 1;
    if (!g.kinds.includes(r.kind)) g.kinds.push(r.kind);
    if (r.latitude != null && r.longitude != null) g.mapped++;
    g.hasPhoto ||= r.hasPhoto;
    g.lastReportAt = [g.lastReportAt, reportTime(r)].sort().at(-1)!;
    g.changedAt = [g.changedAt, r.changedAt].sort().at(-1)!;
    g.reports.push(r);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      reports: g.reports.sort((a, b) =>
        reportTime(b).localeCompare(reportTime(a)),
      ),
    }))
    .sort(
      (a, b) =>
        b.lastReportAt.localeCompare(a.lastReportAt) ||
        a.id.localeCompare(b.id),
    );
}
export function normalizeText(s: string) {
  return s
    .normalize("NFKC")
    .replace(/\u0e4d\u0e32/g, "ำ")
    .replace(/[๐-๙]/g, (c) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(c)))
    .replace(/\s+/g, " ")
    .trim();
}
export function toggleFavorite(ids: string[], id: string) {
  return ids.includes(id)
    ? ids.filter((x) => x !== id)
    : ids.length < 20
      ? [...ids, id]
      : ids;
}
export function safeFavoriteIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (x): x is string =>
              typeof x === "string" && /^(road|report)-[a-f0-9]{24}$/.test(x),
          ),
        ),
      ].slice(0, 20)
    : [];
}

export function normalizeRoadQuery(q: string) {
  const original = normalizeText(q);
  return (
    original
      .replace(/^(?:ถนน|ถ\.|ซอย|ซ\.|เขต|แขวง|อำเภอ|ตำบล|อ\.|ต\.)\s*/, "")
      .replace(/([ก-๙A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)\s*แยก\s*/g, "$1 แยก ") || original
  );
}
