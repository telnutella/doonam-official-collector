import {createHash} from "node:crypto";
import {XMLParser, XMLValidator} from "fast-xml-parser";
import {z} from "zod";
import {AlertSchema,BatchSchema,provinceCodes,type Alert,type Batch} from "./model";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function xmlDocument(xml: string): Record<string, any> {
  if (Buffer.byteLength(xml) > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsafe XML");
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid XML");
  return new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    removeNSPrefix: true,
  }).parse(xml);
}
const array = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
export function capLinks(xml: string): string[] {
  const channel = xmlDocument(xml).rss?.channel;
  if (!channel) throw new Error("Invalid CAP feed");
  const items = array<any>(channel.item);
  if (items.length > 50)
    throw new Error(
      "CAP feed exceeds processing limit; preserve previous batch",
    );
  return [
    ...new Set(
      items.map((item: any) => {
        const url = new URL(item.link);
        if (
          url.origin !== "https://www.tmd.go.th" ||
          !/^\/uploads\/CAP\/[\w.-]+\.xml$/.test(url.pathname) ||
          url.search
        )
          throw new Error("Unexpected CAP URL");
        return url.href;
      }),
    ),
  ];
}
export function parseCapDocuments(
  documents: { xml: string; url: string }[],
  fetchedAt: string,
  options: { skipExpired?: boolean } = {},
): Batch {
  const records = documents.map(({ xml, url }) => {
    const a = xmlDocument(xml).alert;
    if (!a || !a.identifier || !a.sent) throw new Error("Invalid CAP envelope");
    const refs = String(a.references ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s.split(",")[1])
      .filter(Boolean);
    if (a.status !== "Actual" || a.scope !== "Public")
      return { alert: null, refs: [] };
    if (!["Alert", "Update", "Cancel"].includes(a.msgType))
      throw new Error("Unsupported CAP message");
    if (a.msgType !== "Alert" && !refs.length)
      throw new Error("CAP revision missing references");
    if (a.msgType === "Cancel") return { alert: null, refs };
    const info = array<any>(a.info).find((i) => i.language === "th-TH");
    if (!info) throw new Error("Missing Thai CAP info");
    // Old items remain in the RSS feed, including some with obsolete area codes
    // or inconsistent validity intervals. Explicitly expired items cannot be
    // published; retain their references so revisions still suppress ancestors.
    const expiry = z
      .string()
      .datetime({ offset: true })
      .safeParse(info.expires);
    if (
      options.skipExpired &&
      expiry.success &&
      Date.parse(expiry.data) <= Date.parse(fetchedAt)
    )
      return { alert: null, refs };
    const codes = [
      ...new Set(
        array<any>(info.area).flatMap((area) =>
          array<any>(area.geocode)
            .filter((g) => g.valueName === "ISO3166-2")
            .map((g) => String(g.value).replace(/^TH-/, "")),
        ),
      ),
    ];
    if (!codes.length || codes.some((c) => !provinceCodes.has(c)))
      throw new Error("Uncertain CAP area");
    const severity = (
      {
        Minor: "information",
        Moderate: "watch",
        Severe: "warning",
        Extreme: "critical",
      } as const
    )[info.severity as "Minor"];
    if (!severity) throw new Error("Unknown CAP severity");
    const alert = AlertSchema.parse({
      id: `tmd-cap:${a.identifier}`,
      sourceId: "tmd-cap",
      sourceAlertId: a.identifier,
      revision: digest(a),
      title: info.headline ?? info.event,
      body: [info.description, info.instruction].filter(Boolean).join("\n\n"),
      provinceCodes: codes,
      areaCertain: true,
      issuedAt: a.sent,
      updatedAt: a.sent,
      effectiveAt: info.effective ?? a.sent,
      expiresAt: info.expires,
      fetchedAt,
      officialSeverity: severity,
      sourceSeverity: info.severity,
      sourceUrl: url,
    });
    return { alert, refs };
  });
  const superseded = new Set(records.flatMap((r) => r.refs));
  const alerts = new Map<string, Alert>();
  for (const r of records)
    if (r.alert && !superseded.has(r.alert.sourceAlertId))
      alerts.set(r.alert.id, r.alert);
  return BatchSchema.parse({
    sourceId: "tmd-cap",
    stations: [],
    observations: [],
    alerts: [...alerts.values()],
  });
}
