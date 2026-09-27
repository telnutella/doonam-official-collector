import { scrubPublicText } from "./road-names";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import {
  BatchSchema,
  IncidentSchema,
  type Incident,
  type Batch,
} from "./model";
import { provinces } from "./provinces";

export const ITIC_FEED = "https://event.longdo.com/feed";
const clean = (s: unknown) => scrubPublicText(String(s ?? ""));
const date = (epoch: unknown) => {
  const n = Number(epoch);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid incident time");
  return new Date(n * 1000).toISOString();
};
export function parseItic(xml: string, fetchedAt: string): Batch {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error("Invalid iTIC RSS");
  const doc = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
  }).parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel || !String(channel.title).includes("Longdo"))
    throw new Error("Unexpected iTIC feed");
  const items = channel.item
    ? Array.isArray(channel.item)
      ? channel.item
      : [channel.item]
    : [];
  if (items.length > 5000) throw new Error("Too many incidents");
  const incidents = new Map<string, Incident>();
  let rejected = 0;
  for (const row of items) {
    try {
      const title = clean(row.title);
      const kind =
        String(row.type) === "6"
          ? "flood"
          : String(row.type) === "5"
            ? "rain"
            : /ปิดถนน|ปิดการจราจร|ผ่านไม่ได้/.test(title)
              ? "roadClosure"
              : null;
      if (!kind) continue;
      const eid = String(row.eid);
      if (!/^\d+$/.test(eid)) throw new Error("Invalid incident id");
      const sourceUrl = new URL(String(row.link));
      if (
        sourceUrl.protocol !== "https:" ||
        sourceUrl.hostname !== "traffic.longdo.com" ||
        !/^\/e\/A\d+$/.test(sourceUrl.pathname)
      )
        throw new Error("Invalid incident link");
      const body = clean(row.description);
      const text = `${title} ${body}`;
      // Accept only canonical provinces. Never infer administrative areas from a
      // nearby station or from coordinates alone.
      const explicitProvinces = [
        ...body.matchAll(/(?:จังหวัด|จ\.)\s*([^\s,;]+)/gu),
      ].map((m) => m[1]!);
      if (
        explicitProvinces.length &&
        explicitProvinces.every(
          (p) => !provinces.some(([, name]) => name === p),
        )
      )
        continue;
      // A road named Phetchaburi or Ayutthaya is not that province.
      // Bangkok's full administrative name is accepted only in the body.
      const matched = provinces.filter(
        ([, name]) =>
          explicitProvinces.includes(name) ||
          (name === "กรุงเทพมหานคร" &&
            /(?:^|\s)กรุงเทพมหานคร(?:\s|$|[,;])/.test(body)),
      );
      const provinceCode = matched.length === 1 ? matched[0]![0] : null;
      const districtName =
        text.match(/(?:เขต|อำเภอ|อ\.)\s*([^\s,;]+)/u)?.[1] ?? null;
      const subdistrictName =
        text.match(/(?:แขวง|ตำบล|ต\.)\s*([^\s,;]+)/u)?.[1] ?? null;
      const startedAt = date(row.starttimestamp),
        endsAt = date(row.stoptimestamp);
      if (Date.parse(endsAt) <= Date.parse(startedAt))
        throw new Error("Invalid incident interval");
      const published = Date.parse(String(row.pubDate));
      if (!Number.isFinite(published))
        throw new Error("Invalid publication time");
      const stamp = new Date(published).toISOString();
      if (
        Date.parse(startedAt) > Date.parse(fetchedAt) ||
        published > Date.parse(fetchedAt) + 60000
      )
        continue;
      if (
        Math.max(published, Date.parse(startedAt)) <
        Date.parse(fetchedAt) - 7 * 86400000
      )
        continue;
      const coord = (v: unknown, bound: number) =>
        v === "" ||
        v == null ||
        !Number.isFinite(Number(v)) ||
        Math.abs(Number(v)) > bound
          ? null
          : Number(v);
      const incident = IncidentSchema.parse({
        id: `itic:${eid}`,
        sourceId: "itic",
        sourceIncidentId: eid,
        revision: createHash("sha256")
          .update(JSON.stringify(row))
          .digest("hex"),
        title,
        body,
        kind,
        provinceCode,
        districtName: provinceCode ? districtName : null,
        subdistrictName: provinceCode && districtName ? subdistrictName : null,
        latitude: coord(row.latitude, 90),
        longitude: coord(row.longitude, 180),
        startedAt,
        publishedAt: stamp,
        endsAt,
        fetchedAt,
        sourceUrl: sourceUrl.href,
        imageCount: Math.max(0, Math.min(100, Number(row.imagecount) || 0)),
        sourceStatus: String(row.status ?? ""),
        attribution: "iTIC / Longdo Traffic · CC BY 4.0",
      });
      incidents.set(incident.id, incident);
    } catch {
      rejected++;
    }
  }
  if (rejected && !incidents.size)
    throw new Error("No usable iTIC incident records");
  return BatchSchema.parse({
    sourceId: "itic",
    stations: [],
    observations: [],
    alerts: [],
    incidents: [...incidents.values()],
    coverage: {
      partial: rejected > 0,
      returned: items.length - rejected,
      total: items.length,
      windowStart: fetchedAt.slice(0, 10),
      windowEnd: fetchedAt.slice(0, 10),
      timezoneAssumption: "Epoch from RSS; publication time +07:00",
    },
  });
}
