import { z } from "zod";
import {
  DaySchema,
  ReservoirSchema,
  ReservoirDaySchema,
  reservoirSourceUrl,
  reservoirLicenseUrl,
  reservoirMediumLicenseUrl,
  thaiDay,
  type Reservoir,
  type ReservoirDay,
  type ReservoirBatch,
} from "./reservoirs";
const rowSchema = z
  .object({
    dam: z.record(z.unknown()),
    agency: z.record(z.unknown()).nullable().optional(),
    geocode: z.record(z.unknown()).nullable().optional(),
    basin: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();
// Reviewed ThaiWater agency/source IDs. No fuzzy-name matching.
export const reservoirCrosswalk: Record<string, string> = {
  "8:43": "tw-large-1",
  "8:52": "tw-large-12",
  "8:53": "tw-large-23",
  "8:54": "tw-large-14",
  "8:56": "tw-large-15",
  "8:57": "tw-large-13",
  "8:59": "tw-large-2",
  "8:44": "tw-large-3",
  "8:45": "tw-large-4",
  "8:46": "tw-large-8",
  "8:49": "tw-large-25",
  "8:50": "tw-large-26",
};
export function canonicalReservoirId(
  size: string,
  agencyId: number | null,
  sourceId: string,
) {
  return size === "large"
    ? (reservoirCrosswalk[`${agencyId}:${sourceId}`] ?? `tw-large-${sourceId}`)
    : `tw-${size}-${sourceId}`;
}
const capacity = (v: unknown) => {
  const n = number(v);
  return n !== null && n > 0 ? n : null;
};
const name = (v: unknown): string =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && "th" in v
      ? String(v.th ?? "")
      : "";
const number = (v: unknown): number | null =>
  (typeof v === "number" ||
    (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))) &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0 &&
  Number(v) < 1e7
    ? Number(v)
    : null;
// Publication evidence is dataset-specific; being accessible is not itself a reuse licence.
export function publicationReady(r: Reservoir) {
  return (
    r.agencyId === 12 &&
    r.publication === "ready" &&
    ((r.size === "large" && r.licenseUrl === reservoirLicenseUrl) ||
      (r.size === "medium" && r.licenseUrl === reservoirMediumLicenseUrl))
  );
}
export function parseReservoirs(
  raw: unknown,
  fetchedAt: string,
  publicOnly = true,
): ReservoirBatch {
  const source = z
    .object({
      result: z.literal("OK"),
      data: z.object({
        dam_daily: z.array(z.unknown()).min(1),
        dam_medium: z.array(z.unknown()).min(1),
        dam_small_tele: z.array(z.unknown()).min(1),
      }),
    })
    .parse(raw).data;
  const reservoirs: Reservoir[] = [],
    days: ReservoirDay[] = [],
    pending = { large: 0, medium: 0, small: 0 };
  for (const [key, size] of [
    ["dam_daily", "large"],
    ["dam_medium", "medium"],
    ["dam_small_tele", "small"],
  ] as const) {
    for (const rawRow of source[key]) {
      const p = rowSchema.safeParse(rawRow);
      if (!p.success) throw Error(`Invalid ${size} metadata`);
      const row = p.data,
        dam = row.dam,
        agency = row.agency ?? {},
        geo = row.geocode ?? {},
        basin = row.basin ?? {};
      const agencyId = number(agency.id),
        sourceId = String(size === "small" ? dam.tele_station_oldcode : dam.id);
      if (!/^[\w-]{1,80}$/.test(sourceId) || sourceId === "undefined")
        throw Error("Invalid stable reservoir id");
      const ready = (size === "large" || size === "medium") && agencyId === 12;
      if (!ready) pending[size]++;
      if (publicOnly && !ready) continue;
      const lat = number(size === "small" ? dam.tele_station_lat : dam.dam_lat),
        lon = number(size === "small" ? dam.tele_station_long : dam.dam_long);
      const r = ReservoirSchema.parse({
        id: canonicalReservoirId(size, agencyId, sourceId),
        sourceId: "thaiwater-reservoirs",
        sourceReservoirId: sourceId,
        agencyId,
        agencyName: name(agency.agency_name) || "ไม่ระบุหน่วยงาน",
        name: name(size === "small" ? dam.smalldam_name : dam.dam_name),
        size,
        provinceCode: /^\d{2}$/.test(String(geo.province_code))
          ? String(geo.province_code)
          : null,
        provinceName: name(geo.province_name) || "ไม่ระบุจังหวัด",
        basinId: basin.id == null ? null : String(basin.id),
        basinName: name(basin.basin_name) || null,
        latitude: lat !== null && lat >= 5 && lat <= 21 ? lat : null,
        longitude: lon !== null && lon >= 97 && lon <= 106 ? lon : null,
        normalCapacity: capacity(dam.normal_storage),
        maximumCapacity: capacity(dam.max_storage),
        activeCapacity: capacity(dam.uses_water),
        sourceUrl: reservoirSourceUrl,
        licenseUrl: ready
          ? size === "large"
            ? reservoirLicenseUrl
            : reservoirMediumLicenseUrl
          : null,
        publication: ready ? "ready" : "pending",
      });
      if (reservoirs.some((x) => x.id === r.id))
        throw Error("Duplicate source reservoir");
      reservoirs.push(r);
      const date = String(
        size === "small" ? row.smalldam_datetime : row.dam_date,
      ).slice(0, 10);
      if (
        !DaySchema.safeParse(date).success ||
        date > thaiDay(Date.parse(fetchedAt))
      )
        continue;
      const issues: string[] = [];
      const read = (field: string) => {
        const v = number(row[field]);
        if (row[field] != null && v === null)
          issues.push(`ค่าผิดรูปแบบ: ${field}`);
        return v;
      };
      const storage = read(size === "small" ? "volume" : "dam_storage");
      const d = ReservoirDaySchema.parse({
        reservoirId: r.id,
        date,
        fetchedAt,
        storage,
        usable: size === "small" ? null : read("dam_uses_water"),
        inflow: size === "small" ? null : read("dam_inflow"),
        released: size === "small" ? null : read("dam_released"),
        spilled: read("dam_spilled"),
        losses: read("dam_losses"),
        evaporation: read("dam_evap"),
        quality: "valid",
        issues,
        unit: "million_m3",
        flowPeriod: "day",
      });
      if (d.usable !== null && storage !== null && d.usable > storage + 0.05)
        issues.push("น้ำใช้การได้มากกว่าน้ำเก็บกัก");
      if (
        r.maximumCapacity !== null &&
        storage !== null &&
        storage > r.maximumCapacity + 0.05
      )
        issues.push("น้ำเก็บกักสูงกว่าความจุสูงสุดที่ระบุ");
      d.quality = issues.length
        ? "invalid"
        : storage === null
          ? "missing"
          : "valid";
      d.issues = issues;
      days.push(d);
    }
  }
  return { reservoirs, days, pending, kind: "snapshot", complete: true };
}
export function parseStorageHistory(
  raw: unknown,
  r: Reservoir,
  fetchedAt: string,
): ReservoirDay[] {
  const data = z
    .object({
      result: z.literal("OK"),
      data: z.object({
        graph_data: z.array(
          z.object({
            data: z.array(
              z.object({
                date: z.string(),
                value: z.union([z.number(), z.string(), z.null()]),
              }),
            ),
          }),
        ),
      }),
    })
    .parse(raw);
  const rows = new Map<string, ReservoirDay>();
  for (const series of data.data.graph_data)
    for (const point of series.data) {
      const date = point.date.slice(0, 10);
      if (
        !DaySchema.safeParse(date).success ||
        date > thaiDay(Date.parse(fetchedAt))
      )
        continue;
      const value = number(point.value);
      if (rows.has(date)) throw Error("Duplicate historical date");
      rows.set(date, {
        reservoirId: r.id,
        date,
        fetchedAt,
        storage: value,
        usable: null,
        inflow: null,
        released: null,
        spilled: null,
        losses: null,
        evaporation: null,
        quality: value === null ? "missing" : "valid",
        issues: [],
        unit: "million_m3",
        flowPeriod: "day",
      });
    }
  return [...rows.values()];
}
