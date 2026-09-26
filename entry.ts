import { chromium } from "playwright";
import { createHmac, randomUUID } from "node:crypto";
import { capLinks, parseCapDocuments } from "./lib/cap";
import { BatchSchema, type Batch } from "./lib/model";
import {
  parseDdpmEntry,
  thaiDate,
  officialDdpmUrl,
  waterHazards,
  type DdpmEntry,
} from "./lib/ddpm";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
const stamp = () => new Date().toISOString();
async function read(url: string) {
  let r: Response;
  try {
    r = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    throw new Error(
      /CERT|TLS|SSL|LEAF_SIGNATURE/.test(
        String((e as Error & { cause?: unknown }).cause),
      )
        ? "TLS"
        : "NETWORK",
    );
  }
  if (!r.ok) throw new Error("HTTP");
  const reader = r.body!.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error("HTTP");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts).toString("utf8");
}
async function tmd() {
  const rss = await read("https://www.tmd.go.th/api/xml/CAP");
  let links: string[];
  try {
    links = capLinks(rss);
  } catch {
    throw new Error("RSS");
  }
  const docs: { url: string; xml: string }[] = [];
  for (let i = 0; i < links.length; i += 4)
    docs.push(
      ...(await Promise.all(
        links
          .slice(i, i + 4)
          .map(async (url) => ({ url, xml: await read(url) })),
      )),
    );
  try {
    return parseCapDocuments(docs, stamp(), { skipExpired: true });
  } catch {
    throw new Error("CAP");
  }
}
async function pdfText(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error("HTTP");
  const reader = r.body!.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5_000_000) throw new Error("HTTP");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks);
  // Extract transiently via stdin. No PDF or full document content is retained.
  return await new Promise((resolve, reject) => {
    const child = execFile(
      process.env.DOONAM_PYTHON ?? "python3",
      [
        "-c",
        "import sys,io;from pypdf import PdfReader;p=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print('\\n'.join(x.extract_text() for x in p.pages[:30]))",
      ],
      { timeout: 20000, maxBuffer: 1_000_000 },
      (err, out) => (err ? reject(new Error("DOM")) : resolve(out)),
    );
    child.stdin!.end(bytes);
  });
}
async function ddpm() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.DOONAM_CHROMIUM,
  });
  const context = await browser.newContext();
  context.on("requestfailed", (r) => {
    if (["xhr", "fetch", "script"].includes(r.resourceType()))
      console.warn(
        "DDPM network",
        new URL(r.url()).origin + new URL(r.url()).pathname,
        r.failure()?.errorText,
      );
  });
  // Use a normal isolated browser context. Do not block image resources:
  // legacy minisites depend on their completion before rendering article content.
  // Never copy credentials or disable TLS/mixed-content protections.
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  try {
    const entries: DdpmEntry[] = [];
    for (const [path, kind, agency] of [
      ["disaster_news", "situation", "ปภ. · ศูนย์อำนวยการบรรเทาสาธารณภัย"],
      ["disaster_alert_report", "warning", "ปภ. · ศูนย์เตือนภัยพิบัติแห่งชาติ"],
    ] as const) {
      await page.goto("https://www.disaster.go.th/contents/" + path, {
        waitUntil: "domcontentloaded",
        timeout: 40000,
      });
      const cards = page.locator('main a[href*="/cms/"]');
      await cards.first().waitFor();
      const rows = await cards.evaluateAll((anchors) =>
        anchors.map((a) => ({
          url: (a as HTMLAnchorElement).href,
          paragraphs: Array.from(a.querySelectorAll("p")).map(
            (p) => p.textContent?.trim() ?? "",
          ),
        })),
      );
      if (!rows.length) throw new Error("DOM");
      console.log("DDPM list", path, rows.length);
      for (const r of rows) {
        if (!officialDdpmUrl(r.url)) throw new Error("DOM");
        const dateText = r.paragraphs.find((p) => p.startsWith("วันที่")) ?? "";
        const published = thaiDate(dateText);
        if (Date.parse(published.iso) < Date.now() - 7 * 86400000) continue;
        entries.push({
          title: r.paragraphs[0].replace(/\s+/g, " ").trim(),
          url: r.url,
          dateText,
          agency,
          kind,
        });
      }
    }
    entries.sort(
      (a, b) =>
        Number(b.url.includes("ndwc.")) - Number(a.url.includes("ndwc.")),
    );
    const detailContexts = new Map(await Promise.all([...new Set(entries.map(e=>new URL(e.url).origin))].map(async origin=>[origin,await browser.newContext()] as const)));
    const deadline=Date.now()+7*60000;
    const bulletins = [];
    let detailFailures = 0;
    for (let start = 0; start < entries.length; start += 3) {
      if(Date.now()>deadline){detailFailures+=entries.length-start;break;}
      const parts = await Promise.all(
        entries.slice(start, start + 3).map(async (row) => {
          const detailContext = detailContexts.get(new URL(row.url).origin)!;
          const detail = await detailContext.newPage();
          detail.setDefaultTimeout(60000);
          try {
            await detail.goto(row.url, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
            await detail
              .locator("h1,h2,h3")
              .filter({ hasText: row.title })
              .first()
              .waitFor();
            row.detailText = await detail.locator("main").innerText();
            // Some NDWC reports are images with descriptive public filenames. Use those
            // descriptions only to classify hazard, never infer location or expiry.
            const imageDescriptions = await detail
              .locator('main img[src*="/upload/userfiles/"]')
              .evaluateAll((imgs) =>
                imgs
                  .map((img) =>
                    decodeURIComponent(img.getAttribute("src") ?? ""),
                  )
                  .join(" "),
              );
            row.detailText += " " + imageDescriptions;
            row.attachments = await detail
              .locator("a[href]")
              .evaluateAll((as) =>
                as
                  .map((a) => (a as HTMLAnchorElement).href)
                  .filter((u) => /\.pdf(?:$|\?)|\/download\?/.test(u)),
              );
            if (
              !waterHazards(row.title + " " + row.detailText).length &&
              row.attachments.length
            ) {
              const url = row.attachments.find(officialDdpmUrl);
              if (url) row.detailText += " " + (await pdfText(url));
            }
            // Daily warning-centre summaries are situation reports, not new alert issues.
            if (/รายงานแจ้งข่าวแจ้งเตือน|รายงานสถานการณ์/.test(row.title))
              row.kind = "situation";
            return parseDdpmEntry(row, stamp());
          } catch (error) {
            console.warn(
              "DDPM headings",
              await detail.locator("h1,h2,h3").allTextContents(),
            );
            detailFailures++;
            console.warn(
              "DDPM article unavailable",
              row.url,
              (error as Error).message.split("\n")[0],
            );
            return null;
          } finally {
            await detail.close();
          }
        }),
      );
      console.log("DDPM inspected", start + parts.length, "of", entries.length);
      bulletins.push(
        ...parts.filter((b): b is NonNullable<typeof b> => b !== null),
      );
    }
    if (detailFailures && !bulletins.length) throw new Error("DOM");
    return BatchSchema.parse({
      coverage: {
        partial: detailFailures > 0,
        returned: entries.length - detailFailures,
        total: entries.length,
        windowStart: new Date(Date.now() - 7 * 86400000).toISOString(),
        windowEnd: stamp(),
        timezoneAssumption:
          "Asia/Bangkok; published dates may have day precision",
      },
      sourceId: "ddpm",
      stations: [],
      observations: [],
      alerts: [],
      bulletins: [...new Map(bulletins.map((b) => [b.id, b])).values()],
    });
  } finally {
    await browser.close();
  }
}
async function send(sourceId: string, batch?: Batch, error?: string) {
  const item = {
    sourceId,
    fetchedAt: stamp(),
    ...(batch ? { batch } : { error }),
  };
  if (process.env.DOONAM_DRY_RUN === "1") {
    await writeFile(`/tmp/doonam-${sourceId}.json`, JSON.stringify(item));
    console.log(
      sourceId,
      batch
        ? {
            alerts: batch.alerts.length,
            bulletins: batch.bulletins?.length ?? 0,
          }
        : error,
    );
    return;
  }
  const url = process.env.DOONAM_INGEST_URL,
    secret = process.env.DOONAM_INGEST_SECRET;
  if (!url || !secret || !url.startsWith("https://"))
    throw new Error("Missing collector configuration");
  const body = JSON.stringify(item),
    timestamp = String(Date.now()),
    nonce = randomUUID();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");
  const r = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      "x-doonam-time": timestamp,
      "x-doonam-nonce": nonce,
      "x-doonam-signature": signature,
    },
    body,
  });
  if (!r.ok) throw new Error(`Ingest HTTP ${r.status}`);
  console.log(
    sourceId,
    "accepted",
    item.fetchedAt,
    batch
      ? { alerts: batch.alerts.length, bulletins: batch.bulletins?.length ?? 0 }
      : { error },
  );
}
let failed = false;
for (const [id, collect] of [
  ["tmd-cap", tmd],
  ["ddpm", ddpm],
] as const) {
  try {
    const batch = await collect();
    await send(id, batch);
  } catch (e) {
    failed = true;
    const raw = (e as Error).message;
    const code = ["TLS", "HTTP", "RSS", "CAP", "DATE"].includes(raw)
      ? raw
      : id === "ddpm"
        ? "DOM"
        : "NETWORK";
    console.error(id, code, raw.slice(0, 500));
    try {
      await send(id, undefined, code);
    } catch {
      console.error(id, "Unable to deliver failure status");
    }
  }
}
if (failed) process.exitCode = 1;
