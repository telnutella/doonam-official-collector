import { z } from "zod";

export const provinceCodes = new Set(
  "10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 67 70 71 72 73 74 75 76 77 80 81 82 83 84 85 86 90 91 92 93 94 95 96".split(
    " ",
  ),
);
const iso = z.string().datetime({ offset: true });
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w.:-]+$/);
const province = z
  .string()
  .refine((s) => provinceCodes.has(s), "Unknown province");
const https = z
  .string()
  .url()
  .refine((s) => s.startsWith("https://"));
export const StationSchema = z.object({
  id,
  sourceId: id,
  sourceStationId: id,
  name: z.string().min(1).max(300),
  provinceCode: province.nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  sourceUrl: https,
  districtName: z.string().min(1).max(150).nullable().optional(),
  subdistrictName: z.string().min(1).max(150).nullable().optional(),
  agencyName: z.string().max(300).optional(),
  basinId: z.string().max(50).nullable().optional(),
  basinName: z.string().max(150).nullable().optional(),
});
export const ObservationSchema = z
  .object({
    stationId: id,
    sourceId: id,
    metric: z.enum(["rainfall", "waterLevel"]),
    value: z.number().finite().nullable(),
    unit: z.enum(["mm", "m"]),
    datum: z.enum(["msl", "depth", "gauge", "none"]),
    // Rainfall periods must remain separate, e.g. 15-min vs 24-hour accumulations.
    accumulationMinutes: z.number().positive().nullable(),
    observedAt: iso,
    fetchedAt: iso,
    quality: z.enum(["valid", "unverified", "missing", "invalid"]),
    sourceQuality: z.string().nullable(),
    expectedIntervalMinutes: z.number().positive(),
    bankLevelMsl: z.number().finite().optional(),
    change: z
      .object({
        centimeters: z.number().finite(),
        minutes: z.number().positive(),
        fromAt: iso,
      })
      .optional(),
  })
  .superRefine((o, ctx) => {
    if (
      (o.metric === "rainfall" &&
        (o.unit !== "mm" ||
          o.datum !== "none" ||
          (o.value !== null && o.value < 0))) ||
      (o.metric === "waterLevel" &&
        (o.unit !== "m" ||
          o.datum === "none" ||
          o.accumulationMinutes !== null))
    ) {
      ctx.addIssue({ code: "custom", message: "Metric/unit/datum mismatch" });
    }
  });
export const AlertSchema = z
  .object({
    id,
    sourceId: id,
    sourceAlertId: z.string().min(1).max(300),
    revision: id,
    title: z.string().min(1).max(500),
    body: z.string().min(1).max(30000),
    provinceCodes: z.array(province).min(1).max(77),
    areaCertain: z.literal(true),
    issuedAt: iso,
    updatedAt: iso,
    expiresAt: iso,
    fetchedAt: iso,
    effectiveAt: iso.optional(),
    officialSeverity: z.enum(["information", "watch", "warning", "critical"]),
    sourceSeverity: z.string().min(1),
    sourceUrl: https,
  })
  .superRefine((a, ctx) => {
    if (
      Date.parse(a.issuedAt) > Date.parse(a.updatedAt) ||
      Date.parse(a.updatedAt) >= Date.parse(a.expiresAt)
    )
      ctx.addIssue({ code: "custom", message: "Invalid validity interval" });
  });
export const ReportSchema = z.object({
  road: z
    .object({ name: z.string().min(1).max(140), kind: z.enum(["road", "soi"]) })
    .nullable()
    .optional(),
  id,
  sourceId: id,
  revision: id,
  sourceReportId: z.string().min(1).max(160),
  provinceCode: province,
  districtName: z.string().min(1).max(150),
  subdistrictName: z.string().min(1).max(150),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  reportedAt: iso,
  occurredAt: iso.nullable(),
  lastActivityAt: iso.nullable().optional(),
  hasBeforePhoto: z.boolean().optional(),
  hasAfterPhoto: z.boolean().optional(),
  publicLocation: z.literal(true).optional(),
  fetchedAt: iso,
  sourceStatus: z.string().min(1).max(150),
  status: z.enum([
    "reported",
    "inProgress",
    "resolved",
    "withdrawn",
    "unknown",
  ]),
  title: z.string().min(1).max(300),
  sourceUrl: https,
  verification: z.literal("unverified"),
});
export type FieldReport = z.infer<typeof ReportSchema>;
export const BulletinSchema = z.object({
  id,
  sourceId: z.enum(["ddpm", "tmd-cap"]),
  revision: id,
  title: z.string().min(1).max(1000),
  agency: z.string().min(1).max(300),
  kind: z.enum(["warning", "situation"]),
  hazards: z
    .array(z.enum(["flood", "heavyRain", "flashFlood", "landslide"]))
    .min(1),
  publishedAt: iso,
  datePrecision: z.enum(["day", "minute"]),
  reportAt: iso.nullable(),
  fetchedAt: iso,
  expiresAt: iso.nullable(),
  provinceCodes: z.array(province).max(77),
  areaText: z.string().max(1000),
  sourceUrl: https,
  attachmentUrls: z.array(https).max(20),
});
export type Bulletin = z.infer<typeof BulletinSchema>;
export const IncidentSchema = z.object({
  id,
  sourceId: z.literal("itic"),
  sourceIncidentId: id,
  revision: id,
  title: z.string().min(1).max(1000),
  body: z.string().max(20000),
  kind: z.enum(["flood", "rain", "roadClosure"]),
  provinceCode: province.nullable(),
  districtName: z.string().max(150).nullable(),
  subdistrictName: z.string().max(150).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  startedAt: iso,
  publishedAt: iso,
  endsAt: iso,
  fetchedAt: iso,
  sourceUrl: https,
  imageCount: z.number().int().min(0).max(100),
  sourceStatus: z.string().max(20),
  attribution: z.string().max(200),
});
export type Incident = z.infer<typeof IncidentSchema>;
export const BatchSchema = z.object({
  sourceId: id,
  stations: z.array(StationSchema),
  observations: z.array(ObservationSchema),
  alerts: z.array(AlertSchema),
  reports: z.array(ReportSchema).optional(),
  incidents: z.array(IncidentSchema).max(5000).optional(),
  bulletins: z.array(BulletinSchema).max(300).optional(),
  coverage: z
    .object({
      partial: z.boolean(),
      returned: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      windowStart: z.string(),
      windowEnd: z.string(),
      timezoneAssumption: z.string(),
    })
    .optional(),
});
export type Station = z.infer<typeof StationSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type Batch = z.infer<typeof BatchSchema>;
export type Source = {
  id: string;
  agency: string;
  name: string;
  url: string;
  kind: "observations" | "alerts" | "reports";
  enabled: boolean;
  minimumIntervalMinutes: number;
  license: string | null;
  quotaConfirmed: boolean;
  timezoneConfirmed: boolean;
  areaMappingConfirmed: boolean;
  attribution: string;
  blockers: string[];
};
export type SourceHealth = {
  sourceId: string;
  lastAttempt: string;
  lastSuccess: string | null;
  error: string | null;
};
export type Snapshot = {
  schemaVersion: 1;
  fetchedAt: string | null;
  stations: Station[];
  observations: Observation[];
  alerts: Alert[];
  reports?: FieldReport[];
  sources: (Source &
    Partial<SourceHealth> & { coverage?: Batch["coverage"] })[];
};

export function freshness(
  o: Observation | undefined,
  now = Date.now(),
): "fresh" | "stale" | "missing" | "invalid" {
  if (!o || o.value === null || o.quality === "missing") return "missing";
  const age = now - Date.parse(o.observedAt);
  if (!Number.isFinite(age) || age < 0 || o.quality === "invalid")
    return "invalid";
  return age <= 3600000 ? "fresh" : "stale";
}
export const seriesKey = (o: Observation) =>
  `${o.stationId}|${o.metric}|${o.unit}|${o.datum}|${o.accumulationMinutes}`;
export const observationKey = (o: Observation) =>
  `${seriesKey(o)}|${o.observedAt}`;
export function mergeHistory(
  existing: Observation[],
  incoming: Observation[],
  now: number,
): Observation[] {
  const rows = new Map<string, Observation>();
  for (const o of [...existing, ...incoming]) {
    const time = Date.parse(o.observedAt);
    if (time < now - 7 * 86400000 || time > now) continue;
    const key = observationKey(o),
      previous = rows.get(key);
    // A missing/invalid correction must not destroy a known good value at the same timestamp.
    if (
      previous?.value !== null &&
      previous &&
      previous.quality !== "invalid" &&
      (o.value === null || o.quality === "invalid")
    )
      continue;
    rows.set(key, o);
  }
  return [...rows.values()].sort((a, b) =>
    a.observedAt.localeCompare(b.observedAt),
  );
}
export function latestObservations(rows: Observation[]): Observation[] {
  const latest = new Map<string, Observation>();
  for (const o of rows) {
    const key = seriesKey(o),
      previous = latest.get(key);
    if (!previous || Date.parse(o.observedAt) > Date.parse(previous.observedAt))
      latest.set(key, o);
  }
  return [...latest.values()];
}
export function activeAlert(a: Alert, now: number): boolean {
  return (
    Date.parse(a.issuedAt) <= now &&
    Date.parse(a.updatedAt) <= now &&
    Date.parse(a.effectiveAt ?? a.issuedAt) <= now &&
    Date.parse(a.expiresAt) > now
  );
}
