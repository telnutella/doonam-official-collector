import { createHash } from "node:crypto";
import { extractRoadName } from "./road-names";
import { z } from "zod";
import { provinces } from "./provinces";
import { preferReport, traffyCaseUrl } from "./reports";
import {
  BatchSchema,
  provinceCodes,
  ReportSchema,
  type Batch,
  type Station,
} from "./model";

export const pilotProvinces = new Map<string, string>(provinces);
export const candidateEndpoints = {
  water:
    "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load",
  rain: "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h",
  cap: "https://www.tmd.go.th/api/xml/CAP",
  reports: "https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v2",
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const thaiName = z.object({ th: z.string().trim().min(1) });
const nullableNumber = z
  .union([
    z.number().finite(),
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d+)?$/)
      .transform(Number),
  ])
  .nullable();
const geo = z.object({
  province_code: z.string(),
  province_name: thaiName,
  amphoe_name: thaiName,
  tumbon_name: thaiName,
});
const station = z.object({
  id: z.number().int(),
  tele_station_name: thaiName,
  tele_station_lat: z.number().nullable(),
  tele_station_long: z.number().nullable(),
});
const baseRow = z.object({
  station,
  geocode: geo,
  agency: z.object({ agency_name: thaiName }),
  basin: z
    .object({
      id: z
        .union([z.number().finite(), z.string().trim().min(1)])
        .nullish()
        .catch(null),
      basin_name: thaiName.nullish().catch(null),
    })
    .nullable()
    .optional()
    .catch(null),
});
const waterRow = baseRow.extend({
  station: station.extend({ min_bank: nullableNumber.optional() }),
  diff_wl_bank: nullableNumber.optional(),
  diff_wl_bank_text: z.string().nullable().optional(),
  waterlevel_datetime: z.string(),
  waterlevel_msl: nullableNumber,
  waterlevel_m: nullableNumber,
});
const rainRow = baseRow.extend({
  rainfall_datetime: z.string(),
  rain_24h: nullableNumber,
  rain_1h: nullableNumber.optional(),
});

// A caller must supply a confirmed timezone contract. Review exports pass an
// explicit assumption and label the entire export as non-live research data.
export function localTimestamp(
  value: string,
  offset: string | undefined,
): string {
  if (
    !offset ||
    !/^[+-]\d{2}:\d{2}$/.test(offset) ||
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value)
  )
    throw new Error("Unconfirmed local timestamp");
  const local = value.replace(" ", "T") + (value.length === 16 ? ":00" : "");
  const date = new Date(local + offset);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp");
  const offsetMinutes =
    (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) *
    (offset[0] === "-" ? -1 : 1);
  if (
    new Date(date.getTime() + offsetMinutes * 60000)
      .toISOString()
      .slice(0, 19) !== local
  )
    throw new Error("Invalid calendar date");
  return date.toISOString();
}
function metadata(row: z.infer<typeof baseRow>, sourceId: string): Station {
  return {
    id: `${sourceId}:${row.station.id}`,
    sourceId,
    sourceStationId: String(row.station.id),
    name: row.station.tele_station_name.th,
    provinceCode: provinceCodes.has(row.geocode.province_code)
      ? row.geocode.province_code
      : null,
    districtName: row.geocode.amphoe_name.th,
    subdistrictName: row.geocode.tumbon_name.th,
    latitude: row.station.tele_station_lat,
    longitude: row.station.tele_station_long,
    agencyName: row.agency.agency_name.th,
    basinId: row.basin?.id == null ? null : String(row.basin.id),
    basinName: row.basin?.basin_name?.th ?? null,
    sourceUrl: "https://www.thaiwater.net/",
  };
}
export function parseThaiWater(
  raw: unknown,
  kind: "water" | "rain",
  fetchedAt: string,
  offset?: string,
): Batch {
  const sourceId = `thaiwater-${kind}`;
  const outer =
    kind === "water"
      ? z
          .object({ waterlevel_data: z.object({ data: z.array(z.unknown()) }) })
          .parse(raw).waterlevel_data.data
      : z.object({ result: z.string(), data: z.array(z.unknown()) }).parse(raw)
          .data;
  if (!outer.length) throw new Error("Empty observation response");
  const stations: Station[] = [],
    observations: Batch["observations"] = [];
  for (const item of outer) {
    // Only the explicitly scoped provinces enter this pilot; validate their
    // entire row before writing anything. Out-of-scope stations are not coverage.
    const location = z
      .object({ geocode: z.object({ province_code: z.string() }) })
      .parse(item);
    if (!pilotProvinces.has(location.geocode.province_code)) continue;
    const row = (kind === "water" ? waterRow : rainRow).parse(item);
    const s = metadata(row, sourceId);
    stations.push(s);
    if ("waterlevel_datetime" in row) {
      // waterlevel_m has no confirmed reference datum; never relabel it as depth.
      observations.push({
        stationId: s.id,
        sourceId,
        metric: "waterLevel",
        value: row.waterlevel_msl,
        unit: "m",
        datum: "msl",
        accumulationMinutes: null,
        observedAt: localTimestamp(row.waterlevel_datetime, offset),
        fetchedAt,
        quality: row.waterlevel_msl === null ? "missing" : "unverified",
        sourceQuality: null,
        expectedIntervalMinutes: 15,
        // Source-provided difference and direction corroborates that this bank is on
        // the same MSL reference. Inconsistent or unknown metadata is omitted.
        ...(row.station.min_bank != null &&
        row.waterlevel_msl != null &&
        row.diff_wl_bank != null &&
        ((/ต่ำกว่าตลิ่ง/.test(row.diff_wl_bank_text ?? "") &&
          row.waterlevel_msl <= row.station.min_bank) ||
          (/ล้นตลิ่ง|สูงกว่าตลิ่ง/.test(row.diff_wl_bank_text ?? "") &&
            row.waterlevel_msl >= row.station.min_bank)) &&
        Math.abs(
          Math.abs(row.waterlevel_msl - row.station.min_bank) -
            row.diff_wl_bank,
        ) < 0.03
          ? { bankLevelMsl: row.station.min_bank }
          : {}),
      });
    } else {
      for (const [field, minutes] of [
        ["rain_24h", 1440],
        ["rain_1h", 60],
      ] as const) {
        if (!(field in row)) continue;
        const value = row[field] ?? null;
        observations.push({
          stationId: s.id,
          sourceId,
          metric: "rainfall",
          value,
          unit: "mm",
          datum: "none",
          accumulationMinutes: minutes,
          observedAt: localTimestamp(row.rainfall_datetime, offset),
          fetchedAt,
          quality: value === null ? "missing" : "unverified",
          sourceQuality: null,
          expectedIntervalMinutes: 60,
        });
      }
    }
  }
  return BatchSchema.parse({ sourceId, stations, observations, alerts: [] });
}

export function parseTraffy(
  raw: unknown,
  fetchedAt: string,
  offset?: string,
): { batch: Batch; total: number; returned: number; partial: boolean } {
  const body = z
    .object({
      status: z.literal("success"),
      total: z.number().int().nonnegative(),
      features: z.array(
        z.object({
          geometry: z
            .object({
              type: z.literal("Point"),
              coordinates: z.tuple([z.number(), z.number()]),
            })
            .nullable(),
          properties: z.object({
            ticket_id: z.union([z.string(), z.number()]),
            timestamp: z.string(),
            province: z.string(),
            district: z.string(),
            subdistrict: z.string(),
            type: z.string(),
            state: z.string(),
            state_type_latest: z.string().nullable().optional(),
            last_activity: z.unknown().optional(),
            photo_url: z.unknown().optional(),
            address: z.unknown().optional(),
            description: z.unknown().optional(),
            after_photo: z.unknown().optional(),
          }),
        }),
      ),
    })
    .parse(raw);
  const reports = new Map<string, z.infer<typeof ReportSchema>>();
  for (const f of body.features) {
    const p = f.properties,
      code = [...pilotProvinces].find(([, name]) => name === p.province)?.[0];
    if (
      !code ||
      p.type !== "น้ำท่วม" ||
      !p.district.trim() ||
      !p.subdistrict.trim()
    )
      continue;
    const sourceReportId = String(p.ticket_id),
      id = `traffy:${digest(sourceReportId).slice(0, 32)}`;
    const statusMap: Record<string, string> = {
      start: "reported",
      inprogress: "inProgress",
      finish: "resolved",
      irrelevant: "withdrawn",
      forward: "inProgress",
      follow: "inProgress",
    };
    const status = statusMap[p.state_type_latest ?? ""] ?? "unknown";
    let lastActivityAt: string | null = null;
    if (typeof p.last_activity === "string") {
      try {
        const parsed = localTimestamp(p.last_activity, offset);
        if (Date.parse(parsed) <= Date.parse(fetchedAt))
          lastActivityAt = parsed;
      } catch {
        /* Optional metadata must not discard a valid report. */
      }
    }
    const publicPhoto = (v: unknown) =>
      typeof v === "string" && /^https:\/\//.test(v);
    const hasAfterPhoto = Array.isArray(p.after_photo)
      ? p.after_photo.some(publicPhoto)
      : publicPhoto(p.after_photo);
    const publicFields = {
      road: extractRoadName(
        [p.address, p.description]
          .filter((v): v is string => typeof v === "string")
          .join(" "),
      ),
      id,
      sourceId: "traffy-bkk",
      sourceReportId,
      provinceCode: code,
      districtName: p.district.trim(),
      subdistrictName: p.subdistrict.trim(),
      // Do not expose a house-level citizen pin before consent/reuse terms are
      // confirmed. Area metadata still supports the requested district filters.
      latitude: null,
      longitude: null,
      reportedAt: localTimestamp(p.timestamp, offset),
      occurredAt: null,
      lastActivityAt,
      hasBeforePhoto: publicPhoto(p.photo_url),
      hasAfterPhoto,
      fetchedAt,
      sourceStatus: p.state,
      status,
      title: `รายงานน้ำท่วม • ${p.subdistrict.trim()}`,
      sourceUrl: traffyCaseUrl(sourceReportId),
      verification: "unverified",
    };
    reports.set(
      id,
      preferReport(
        ReportSchema.parse({
          ...publicFields,
          revision: digest({
            sourceReportId,
            road: publicFields.road,
            state: p.state,
            status,
            reportedAt: publicFields.reportedAt,
            lastActivityAt,
            hasBeforePhoto: publicFields.hasBeforePhoto,
            hasAfterPhoto,
          }),
        }),
        reports.get(id),
      ),
    );
  }
  return {
    batch: BatchSchema.parse({
      sourceId: "traffy-bkk",
      stations: [],
      observations: [],
      alerts: [],
      reports: [...reports.values()],
    }),
    total: body.total,
    returned: body.features.length,
    partial: body.features.length < body.total,
  };
}

export { capLinks, parseCapDocuments } from "./cap";
