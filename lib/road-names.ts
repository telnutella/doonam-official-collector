import { normalizeText, type RoadReport } from "./roads-model";
// Extract only explicit public road labels; never retain the surrounding address.
export function extractRoadName(
  raw: string,
): { name: string; kind: "road" | "soi" } | null {
  const s = normalizeText(raw)
    .replace(/ถนน\s*/g, "ถ.")
    .replace(/ซอย\s*/g, "ซ.")
    .replace(/([ก-๙A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)\s*แยก\s*/g, "$1 แยก ")
    .replace(/\bSoi\s+/gi, "ซ.");
  if (/ซ\.\s*\d/.test(s)) return null;
  const candidates = [
    ...s.matchAll(
      /(?:ถ\.|ซ\.)\s*([ก-๙A-Za-z][ก-๙A-Za-z0-9]*(?:\s+\d+(?:\/\d+)?(?:\s*แยก\s*\d+(?:-\d+)*)?)?)/g,
    ),
  ].map((m) => ({
    name:
      (m[0].startsWith("ซ.") ? "ซอย" : "ถนน") +
      m[1]!.replace(/\s+/g, " ").trim(),
    kind: m[0].startsWith("ซ.") ? ("soi" as const) : ("road" as const),
  }));
  const unique = [...new Map(candidates.map((x) => [x.name, x])).values()];
  if (unique.length !== 1) return null;
  const x = unique[0]!;
  if (x.kind === "soi" && !/\d/.test(x.name)) return null;
  const label = x.name.replace(/^(ถนน|ซอย)/, "");
  if (
    label.length < 3 ||
    /^(?:ใน|เขต|แขวง|ตำบล|ดังกล่าว|ของ|ตรง|หน้า|หลัง|ช่วง|ที่|มี|เป็น|ให้|เลย|ลึก|ระดับ|เอว|ทาง|ทั้ง|กลาง|แถว)/.test(
      label,
    ) ||
    /(?:ค่ะ|ครับ|แล้ว|หน่อย|ขัง|คอนโด|หมู่บ้าน|ร$|ซ$|ถ$)/.test(label)
  )
    return null;
  // Generic descriptions are not public road names. Prefer leaving a report ungrouped.
  if (
    /(?:น้ํา|น้ำ|ท่วม|ฝนตก|เส้นทาง|บริเวณ|สาธารณะ|หน้าบ้าน|หน้าซอย|ชำรุด|ทางเข้า|ทางออก|รถผ่าน|ไม่สามารถ|ทั้งหมด)/.test(
      x.name,
    )
  )
    return null;
  // A soi and its explicit parent road can only be grouped after a reviewed alias exists.
  if (/(?:หมู่บ้าน|บ้านเลขที่|ห้องเลขที่)/.test(x.name) || x.name.length > 140)
    return null;
  return x;
}
export function scrubPublicText(raw: string) {
  return normalizeText(
    normalizeText(raw)
      .replace(/<[^>]*>/g, " ")
      .replace(/รายงานโดย[\s\S]*$/u, "")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[ปกปิดอีเมล]")
      .replace(
        /(?:โทร(?:ศัพท์)?|เบอร์|ติดต่อ|ไลน์|line\s*id)\s*[:：]?\s*\S+/gi,
        "[ปกปิดข้อมูลติดต่อ]",
      )
      .replace(/\b0\d[\d -]{7,}\d\b/g, "[ปกปิดเบอร์]")
      .replace(
        /(?:บ้านเลขที่|เลขที่|ห้องเลขที่)\s*\d+[\d/ -]*/g,
        "[ปกปิดที่อยู่]",
      ),
  ).slice(0, 2000);
}
export function safeReportUrl(r: Pick<RoadReport, "sourceId" | "sourceUrl">) {
  try {
    const u = new URL(r.sourceUrl);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      (r.sourceId === "itic"
        ? u.hostname === "traffic.longdo.com" && /^\/e\/A\d+$/.test(u.pathname)
        : u.hostname === "bangkok.traffy.in.th" &&
          u.pathname === "/detail" &&
          !!u.searchParams.get("ticketID"))
    );
  } catch {
    return false;
  }
}
