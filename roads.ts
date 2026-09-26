import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseItic, ITIC_FEED } from "./lib/incidents";
import { collectRoadTraffy } from "./lib/road-collection";
import { RoadImportSchema, type RoadImport } from "./lib/roads-model";
import { thaiDay, shiftDay } from "./lib/reservoirs";
const dry = process.env.DOONAM_DRY_RUN === "1",
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function read(
  url: string,
  text = false,
  budget?: { remaining: number; used: number },
) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      if (budget) {
        if (budget.remaining <= 0) throw Error("Request budget exhausted");
        budget.remaining--;
        budget.used++;
      }
      const r = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        if ([429, 500, 502, 503, 504].includes(r.status) && attempt < 2) {
          const retry = r.headers.get("retry-after");
          const delay = retry
            ? Number.isFinite(Number(retry))
              ? Number(retry) * 1000
              : Date.parse(retry) - Date.now()
            : 1500 * (attempt + 1);
          if (delay > 60000)
            throw Error(
              "Upstream Retry-After exceeds this run; defer to next schedule",
            );
          await sleep(Math.max(1500, delay));
          continue;
        }
        throw Error(`Upstream HTTP ${r.status}`);
      }
      const reader = r.body!.getReader(),
        chunks: Uint8Array[] = [];
      let n = 0;
      try {
        for (;;) {
          const x = await reader.read();
          if (x.done) break;
          n += x.value.length;
          if (n > 12_000_000) throw Error("Response too large");
          chunks.push(x.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return text ? body : JSON.parse(body);
    } catch (e) {
      if (
        String(e).includes("Retry-After exceeds") ||
        String(e).includes("Request budget exhausted")
      )
        throw e;
      last = e;
      if (attempt < 2) await sleep(1500 * (attempt + 1));
    }
  throw last;
}
async function send(body: unknown) {
  if (dry) return 0;
  const url = process.env.DOONAM_INGEST_URL,
    secret = process.env.DOONAM_INGEST_SECRET;
  if (!url || !secret) throw Error("Collector not configured");
  if (
    url !==
    "https://doonam-bangkok.korawit-srt.chatgpt.site/api/internal/ingest"
  )
    throw Error("Unexpected destination");
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > 950000) throw Error("Payload too large");
  for (let i = 0; i < 3; i++) {
    const timestamp = String(Date.now()),
      nonce = randomUUID(),
      signature = createHmac("sha256", secret)
        .update(`${timestamp}.${nonce}.${text}`)
        .digest("hex");
    try {
      const r = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(45000),
        headers: {
          "content-type": "application/json",
          "x-doonam-time": timestamp,
          "x-doonam-nonce": nonce,
          "x-doonam-signature": signature,
        },
        body: text,
      });
      if (r.status === 409) return 0;
      if (r.ok) {
        const result = (await r.json()) as { rowsWritten?: number };
        return result.rowsWritten ?? 0;
      }
      if (r.status < 500) throw Error(`Rejected ${r.status}`);
    } catch (e) {
      if (String(e).includes("Rejected") || i === 2) throw e;
    }
    await sleep(1500 * (i + 1));
  }
  throw Error("Ingest unavailable");
}
const snapshots: unknown[] = [];
let failures = 0;
for (const sourceId of ["itic", "traffy-bkk"] as const) {
  const started = Date.now(),
    stamp = new Date(started).toISOString(),
    budget = { remaining: sourceId === "itic" ? 3 : 10, used: 0 };
  try {
    let data: Pick<
      RoadImport,
      "batch" | "scopeDays" | "completeDays" | "requests" | "cursor"
    >;
    if (sourceId === "itic") {
      const batch = parseItic(
          (await read(ITIC_FEED, true, budget)) as string,
          stamp,
        ),
        scopeDays = Array.from({ length: 7 }, (_, i) =>
          shiftDay(thaiDay(started), -i),
        );
      batch.incidents = batch.incidents?.filter(
        (r) =>
          Date.parse(r.startedAt) >= started - 7 * 86400000 &&
          scopeDays.includes(thaiDay(Date.parse(r.publishedAt))),
      );
      data = {
        batch,
        scopeDays,
        completeDays: batch.coverage?.partial ? [] : scopeDays,
        requests: 1,
      };
    } else {
      const meta = (
        dry
          ? {}
          : await read(
              "https://doonam-bangkok.korawit-srt.chatgpt.site/api/roads?meta=1",
            )
      ) as { sources?: { sourceId: string; cursor: RoadImport["cursor"] }[] };
      data = await collectRoadTraffy(
        async (u) => {
          await sleep(700);
          return read(u, false, budget);
        },
        started,
        meta.sources?.find((s) => s.sourceId === sourceId)?.cursor,
      );
    }
    data.requests = budget.used;
    const records =
        sourceId === "itic"
          ? (data.batch.incidents ?? [])
          : (data.batch.reports ?? []),
      parts = Math.max(1, Math.ceil(records.length / 25)),
      runId = randomUUID();
    let bytes = 0,
      rowsWritten = 0;
    for (let part = 0; part < parts; part++) {
      const roads = RoadImportSchema.parse({
        ...data,
        runId,
        runStartedAt: stamp,
        part,
        parts,
        batch: {
          ...data.batch,
          incidents:
            sourceId === "itic"
              ? records.slice(part * 25, (part + 1) * 25)
              : undefined,
          reports:
            sourceId === "traffy-bkk"
              ? records.slice(part * 25, (part + 1) * 25)
              : undefined,
        },
      });
      const envelope = { sourceId, fetchedAt: new Date().toISOString(), roads };
      bytes += Buffer.byteLength(JSON.stringify(envelope));
      rowsWritten += await send(envelope);
      if (process.env.DOONAM_ROAD_OUTPUT) snapshots.push(envelope);
    }
    console.log(
      JSON.stringify({
        sourceId,
        stage: "success",
        fetchedAt: stamp,
        records: records.length,
        parts,
        bytes,
        requests: data.requests,
        rowsWritten,
        coverage: data.batch.coverage,
        completeDays: data.completeDays,
        elapsedMs: Date.now() - started,
        dryRun: dry,
      }),
    );
  } catch (e) {
    failures++;
    await send({
      sourceId,
      fetchedAt: new Date().toISOString(),
      error: "NETWORK",
    }).catch(() => {});
    console.log(
      JSON.stringify({
        sourceId,
        stage: "failed",
        requests: budget.used,
        error: String(e).slice(0, 200),
      }),
    );
  }
}
if (process.env.DOONAM_ROAD_OUTPUT)
  await writeFile(process.env.DOONAM_ROAD_OUTPUT, JSON.stringify(snapshots));
if (failures) process.exitCode = 1;
