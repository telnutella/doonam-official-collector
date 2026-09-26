import { z } from "zod";
export const reservoirEndpoint =
  "https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/dam";
export const reservoirSourceUrl =
  "https://www.thaiwater.net/water?sourceid=58843";
export const reservoirMediumLicenseUrl =
  "https://gdcatalog.go.th/dataset/gdpublish-reservoir1";
export const reservoirLicenseUrl = "https://data.go.th/dataset/big_dams_public";
const nullableVolume = z.number().finite().min(0).max(1e7).nullable();
export const DaySchema = z
  .string()
  .regex(/^20\d\d-\d\d-\d\d$/)
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
  });
export const ReservoirSchema = z
  .object({
    id: z.string().regex(/^tw-(large|medium|small)-[\w-]{1,80}$/),
    sourceId: z.literal("thaiwater-reservoirs"),
    sourceReservoirId: z.string().max(100),
    agencyId: z.number().int().nullable(),
    agencyName: z.string().max(300),
    name: z.string().min(1).max(300),
    size: z.enum(["large", "medium", "small"]),
    provinceCode: z
      .string()
      .regex(/^\d{2}$/)
      .nullable(),
    provinceName: z.string().max(150),
    basinId: z.string().max(50).nullable(),
    basinName: z.string().max(150).nullable(),
    latitude: z.number().min(5).max(21).nullable(),
    longitude: z.number().min(97).max(106).nullable(),
    normalCapacity: nullableVolume,
    maximumCapacity: nullableVolume,
    activeCapacity: nullableVolume,
    sourceUrl: z.literal(reservoirSourceUrl),
    licenseUrl: z.string().url().nullable(),
    publication: z.enum(["ready", "pending"]),
  })
  .strict();
export const ReservoirDaySchema = z
  .object({
    reservoirId: ReservoirSchema.shape.id,
    date: DaySchema,
    fetchedAt: z.string().datetime({ offset: true }),
    storage: nullableVolume,
    usable: nullableVolume,
    inflow: nullableVolume,
    released: nullableVolume,
    spilled: nullableVolume,
    losses: nullableVolume,
    evaporation: nullableVolume,
    quality: z.enum(["valid", "missing", "invalid"]),
    issues: z.array(z.string().max(180)).max(20),
    unit: z.literal("million_m3"),
    flowPeriod: z.literal("day"),
  })
  .strict();
export const ReservoirBatchSchema = z
  .object({
    reservoirs: z.array(ReservoirSchema).max(2500),
    days: z.array(ReservoirDaySchema).max(1000),
    pending: z.object({
      large: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      small: z.number().int().nonnegative(),
    }),
    kind: z.enum(["snapshot", "history"]),
    complete: z.boolean().default(true),
  })
  .strict();
export type Reservoir = z.infer<typeof ReservoirSchema>;
export type ReservoirDay = z.infer<typeof ReservoirDaySchema>;
export type ReservoirBatch = z.infer<typeof ReservoirBatchSchema>;
export type ReservoirData = {
  schemaVersion: 1;
  servedAt: string;
  lastSuccess: string | null;
  error: string | null;
  reservoirs: (Reservoir & {
    latest: ReservoirDay | null;
    changes: { day: number | null; week: number | null; month: number | null };
  })[];
  pending: ReservoirBatch["pending"];
  attribution: string;
};
export const thaiDay = (now = Date.now()) =>
  new Date(now + 7 * 3600000).toISOString().slice(0, 10);
export function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function dayState(
  day: ReservoirDay | null | undefined,
  now = Date.now(),
): "recent" | "stale" | "missing" {
  if (
    !day ||
    day.storage === null ||
    day.quality !== "valid" ||
    !DaySchema.safeParse(day.date).success ||
    day.date > thaiDay(now)
  )
    return "missing";
  return day.date >= shiftDay(thaiDay(now), -1) ? "recent" : "stale";
}
export function storagePercent(r: Reservoir, d: ReservoirDay | null) {
  return d?.storage !== null &&
    d?.storage !== undefined &&
    r.normalCapacity !== null &&
    r.normalCapacity > 0
    ? (d.storage / r.normalCapacity) * 100
    : null;
}
export function storageChange(history: ReservoirDay[], days: number) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date)),
    last = sorted.at(-1);
  if (!last || last.quality !== "valid" || last.storage === null) return null;
  const prior = sorted.find((x) => x.date === shiftDay(last.date, -days));
  return prior?.quality === "valid" && prior.storage !== null
    ? last.storage - prior.storage
    : null;
}
export function scenario(history: ReservoirDay[], now = Date.now()) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date)),
    last = sorted.at(-1);
  const unavailable = (reason: string) => ({
    reason,
    dailyChange: null,
    points: [] as { date: string; storage: number }[],
  });
  if (dayState(last, now) !== "recent")
    return unavailable("ต้องมีรายงานที่ผ่านการตรวจคุณภาพถึงวันนี้หรือเมื่อวาน");
  const window = Array.from({ length: 8 }, (_, i) =>
    sorted.find((x) => x.date === shiftDay(last!.date, i - 7)),
  );
  if (
    window.some((x) => !x || x.quality !== "valid" || x.storage === null) ||
    new Set(sorted.map((x) => x.date)).size !== sorted.length
  )
    return unavailable(
      "ต้องมีน้ำเก็บกัก 8 วันต่อเนื่อง โดยไม่มีข้อมูลขาดหรือซ้ำ",
    );
  const dailyChange = (last!.storage! - window[0]!.storage!) / 7;
  const points = Array.from({ length: 4 }, (_, i) => ({
    date: shiftDay(last!.date, i),
    storage: last!.storage! + dailyChange * i,
  }));
  if (points.some((p) => p.storage < 0))
    return unavailable(
      "แนวโน้มเชิงเส้นให้ปริมาตรติดลบ จึงไม่แสดงสถานการณ์สมมติ",
    );
  return { reason: null, dailyChange, points };
}
export const rateToDailyVolume = (cubicMetresPerSecond: number) =>
  cubicMetresPerSecond * 0.0864;
export function netFlow(d: ReservoirDay) {
  return d.quality === "valid" && d.inflow !== null && d.released !== null
    ? d.inflow - d.released
    : null;
}
export function historyCsv(r: Reservoir, days: ReservoirDay[]) {
  const escape = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [
      [
        "reservoir_id",
        "name",
        "report_date_Asia_Bangkok",
        "storage",
        "usable",
        "inflow_per_day",
        "released_per_day",
        "unit",
        "quality",
        "fetched_at",
        "agency",
        "source",
        "license",
      ],
      ...days.map((d) => [
        r.id,
        r.name,
        d.date,
        d.storage,
        d.usable,
        d.inflow,
        d.released,
        d.unit,
        d.quality,
        d.fetchedAt,
        r.agencyName,
        r.sourceUrl,
        r.licenseUrl,
      ]),
    ]
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
}
