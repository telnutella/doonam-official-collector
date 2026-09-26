import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseReservoirs, parseStorageHistory } from "./lib/reservoir-adapter";
import {
  reservoirEndpoint,
  ReservoirBatchSchema,
  thaiDay,
  shiftDay,
  type ReservoirBatch,
} from "./lib/reservoirs";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function read(url: string) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error(`Upstream HTTP ${r.status}`);
  const reader = r.body!.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const x = await reader.read();
      if (x.done) break;
      bytes += x.value.length;
      if (bytes > 8_000_000) throw Error("Response too large");
      chunks.push(x.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const dry = process.env.DOONAM_DRY_RUN === "1";
async function send(body: unknown) {
  if (dry) return;
  const url = process.env.DOONAM_INGEST_URL,
    secret = process.env.DOONAM_INGEST_SECRET;
  if (!url || !secret) throw Error("Collector not configured");
  if (new URL(url).origin !== "https://doonam-bangkok.korawit-srt.chatgpt.site")
    throw Error("Unexpected ingestion destination");
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > 950_000) throw Error("Payload too large");
  for (let attempt = 0; attempt < 3; attempt++) {
    const timestamp = String(Date.now()),
      nonce = randomUUID(),
      signature = createHmac("sha256", secret)
        .update(`${timestamp}.${nonce}.${text}`)
        .digest("hex");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-doonam-time": timestamp,
          "x-doonam-nonce": nonce,
          "x-doonam-signature": signature,
        },
        body: text,
        redirect: "error",
        signal: AbortSignal.timeout(45000),
      });
      if (response.ok) return;
      if (response.status < 500)
        throw Error(`Ingest rejected ${response.status}`);
    } catch (e) {
      if (String(e).includes("rejected")) throw e;
      if (attempt === 2) throw e;
    }
    await sleep(1500 * (attempt + 1));
  }
  throw Error("Ingest unavailable");
}
async function publish(batch: ReservoirBatch) {
  const fetchedAt = new Date().toISOString();
  const fresh = {
    ...batch,
    days: batch.days.map((d) => ({ ...d, fetchedAt })),
  };
  ReservoirBatchSchema.parse(fresh);
  await send({
    sourceId: "thaiwater-reservoirs",
    fetchedAt,
    reservoirs: fresh,
  });
}
const stamp = new Date().toISOString();
let batch: ReservoirBatch;
try {
  batch = parseReservoirs(await read(reservoirEndpoint), stamp);
  if (!batch.reservoirs.length) throw Error("Empty source");
  for (let i = 0; i < batch.reservoirs.length; i += 20) {
    const reservoirs = batch.reservoirs.slice(i, i + 20),
      ids = new Set(reservoirs.map((r) => r.id));
    await publish({
      ...batch,
      reservoirs,
      days: batch.days.filter((d) => ids.has(d.reservoirId)),
      complete: i + 20 >= batch.reservoirs.length,
    });
  }
  console.log(
    JSON.stringify({
      stage: "snapshot",
      fetchedAt: stamp,
      reservoirs: batch.reservoirs.length,
      days: batch.days.length,
      pending: batch.pending,
      dryRun: dry,
    }),
  );
} catch (e) {
  await send({
    sourceId: "thaiwater-reservoirs",
    fetchedAt: new Date().toISOString(),
    error: "NETWORK",
  }).catch(() => {});
  throw e;
}
if (process.env.DOONAM_SNAPSHOT_OUTPUT)
  await writeFile(process.env.DOONAM_SNAPSHOT_OUTPUT, JSON.stringify(batch));
const sorted = [...batch.reservoirs].sort((a, b) => a.id.localeCompare(b.id));
const limit = Math.max(
    0,
    Math.min(50, Number(process.env.DOONAM_BACKFILL_LIMIT ?? 6)),
  ),
  slot = Math.floor(Date.now() / (8 * 3600000));
const offset = Number(
  process.env.DOONAM_BACKFILL_OFFSET || (slot * 6) % sorted.length,
);
const cutoff = shiftDay(thaiDay(), -364),
  years = [Number(cutoff.slice(0, 4)), Number(thaiDay().slice(0, 4))].filter(
    (x, i, a) => a.indexOf(x) === i,
  );
const started = Date.now();
let success = 0,
  failed = 0;
const allHistory: ReservoirBatch[] = [];
for (let i = 0; i < Math.min(limit, sorted.length); i++) {
  if (Date.now() - started > 9 * 60000) {
    console.log(
      "Backfill time limit; remaining reservoirs resume in later scheduled runs",
    );
    break;
  }
  const r = sorted[(offset + i) % sorted.length];
  let okay = true;
  for (const year of years) {
    try {
      await sleep(1000);
      const path =
        r.size === "large"
          ? `dam_yearly_graph?data_type=dam_storage&dam_id=${r.sourceReservoirId}&year=${year}`
          : `dam_medium_graph?data_type=mediumdam_storage&medium_id=${r.sourceReservoirId}&year=${year}`;
      const days = parseStorageHistory(
        await read(
          "https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/" + path,
        ),
        r,
        new Date().toISOString(),
      ).filter((d) => d.date >= cutoff);
      for (let j = 0; j < days.length; j += 50) {
        const piece = {
          kind: "history" as const,
          complete: true,
          reservoirs: [r],
          days: days.slice(j, j + 50),
          pending: batch.pending,
        };
        await publish(piece);
        if (process.env.DOONAM_HISTORY_OUTPUT) allHistory.push(piece);
      }
    } catch (e) {
      okay = false;
      console.log(
        JSON.stringify({
          stage: "history-unavailable",
          reservoirId: r.id,
          year,
          error: String(e).slice(0, 180),
        }),
      );
    }
  }
  if (okay) success++;
  else failed++;
}
if (process.env.DOONAM_HISTORY_OUTPUT)
  await writeFile(
    process.env.DOONAM_HISTORY_OUTPUT,
    JSON.stringify(allHistory),
  );
console.log(
  JSON.stringify({
    stage: "history",
    offset,
    requested: limit,
    success,
    failed,
  }),
);
