import { createHash } from "node:crypto";
import { BulletinSchema, type Bulletin } from "./model";
import { provinces } from "./provinces";
const months = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
const short = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
export function thaiDate(text: string): {
  iso: string;
  precision: "day" | "minute";
} {
  text = text.replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 3664));
  const names = [...months, ...short]
    .map((s) => s.replaceAll(".", "\\."))
    .join("|");
  const m = text.match(
    new RegExp(
      `(\\d{1,2})\\s*(${names})\\s*(\\d{2,4})(?:\\s*(?:เวลา\\s*:?\\s*)?(\\d{1,2})[:.](\\d{2})\\s*น)?`,
    ),
  );
  if (!m) throw new Error("DATE");
  let year = Number(m[3]);
  if (year < 100) year += 2500;
  if (year > 2400) year -= 543;
  const month =
    (months.includes(m[2]) ? months.indexOf(m[2]) : short.indexOf(m[2])) + 1;
  const day = Number(m[1]),
    h = Number(m[4] ?? 0),
    min = Number(m[5] ?? 0);
  if (
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    h > 23 ||
    min > 59
  )
    throw new Error("DATE");
  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+07:00`,
    precision: m[4] ? "minute" : "day",
  };
}
export function waterHazards(text: string): Bulletin["hazards"] {
  const out: Bulletin["hazards"] = [];
  if (/น้ำท่วม|อุทกภัย|น้ำล้นตลิ่ง/.test(text)) out.push("flood");
  if (/ฝนตกหนัก|ฝนหนัก/.test(text)) out.push("heavyRain");
  if (/น้ำป่า|น้ำหลาก|น้ำท่วมฉับพลัน/.test(text)) out.push("flashFlood");
  if (/ดินถล่ม|ดินโคลนถล่ม/.test(text)) out.push("landslide");
  return out;
}
export type DdpmEntry = {
  title: string;
  url: string;
  dateText: string;
  agency: string;
  detailText?: string;
  attachments?: string[];
  kind: "warning" | "situation";
};
export function officialDdpmUrl(url: string) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      (u.hostname === "disaster.go.th" ||
        u.hostname.endsWith(".disaster.go.th"))
    );
  } catch {
    return false;
  }
}
export function parseDdpmEntry(
  row: DdpmEntry,
  fetchedAt: string,
): Bulletin | null {
  if (!officialDdpmUrl(row.url)) throw new Error("Unexpected DDPM URL");
  const published = thaiDate(row.dateText),
    now = Date.parse(fetchedAt);
  if (
    Date.parse(published.iso) > now ||
    Date.parse(published.iso) < now - 7 * 86400000
  )
    return null;
  const hazards = waterHazards(row.title + " " + (row.detailText ?? ""));
  if (!hazards.length) return null;
  // Assign only explicit province names in the headline. Article body may mention
  // background areas, office addresses or unrelated incidents. Keep these general.
  const area = provinces
    .filter(
      ([code, name]) =>
        row.title.includes(name) ||
        (code === "10" && /กทม\.|กรุงเทพฯ/.test(row.title)),
    )
    .map(([code]) => code);
  let reportAt: string | null = null;
  try {
    const parsed = thaiDate(row.title);
    if (parsed.precision === "minute") reportAt = parsed.iso;
  } catch {}
  const publicFields = {
    title: row.title,
    agency: row.agency,
    kind: row.kind,
    hazards,
    publishedAt: published.iso,
    datePrecision: published.precision,
    reportAt,
    expiresAt: null,
    provinceCodes: area,
    areaText: area.length
      ? "จังหวัดที่ระบุในหัวข้อ"
      : "ยังไม่ระบุพื้นที่แน่นอน",
    sourceUrl: row.url,
    attachmentUrls: [...new Set(row.attachments ?? [])]
      .filter(officialDdpmUrl)
      .slice(0, 20),
  };
  return BulletinSchema.parse({
    ...publicFields,
    id:
      "ddpm:" + createHash("sha256").update(row.url).digest("hex").slice(0, 32),
    sourceId: "ddpm",
    revision: createHash("sha256")
      .update(JSON.stringify(publicFields))
      .digest("hex"),
    fetchedAt,
  });
}
