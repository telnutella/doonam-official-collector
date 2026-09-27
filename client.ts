import { createHmac, randomUUID } from "node:crypto";
import { boundedFetch } from "./lib/bounded-fetch";
export class DeliveryError extends Error {}
export async function signedPost(
  path: "ingest" | "refresh",
  item: unknown,
  timeoutMs = 30000,
) {
  const raw = process.env.DOONAM_INGEST_URL,
    secret = process.env.DOONAM_INGEST_SECRET;
  if (!raw || !secret)
    throw new DeliveryError("Collector configuration missing");
  const url = new URL(raw);
  const localVerification =
    process.env.DOONAM_LOCAL_VERIFY === "1" &&
    url.origin === "http://localhost:5173";
  if (url.protocol !== "https:" && !localVerification)
    throw new DeliveryError("HTTPS required");
  if (
    url.pathname !== "/api/internal/ingest" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new DeliveryError("Invalid collector URL");
  url.pathname = `/api/internal/${path}`;
  const body = JSON.stringify(item);
  try {
    const response = await boundedFetch(
      url.href,
      { method: "POST", body },
      {
        timeoutMs,
        fetcher: async (input, init) => {
          const timestamp = String(Date.now()),
            nonce = randomUUID();
          return fetch(input, {
            ...init,
            headers: {
              "Content-Type": "application/json",
              "x-doonam-time": timestamp,
              "x-doonam-nonce": nonce,
              "x-doonam-signature": createHmac("sha256", secret)
                .update(`${timestamp}.${nonce}.${body}`)
                .digest("hex"),
            },
          });
        },
      },
    );
    if (!response.ok)
      throw new DeliveryError(`Delivery HTTP ${response.status}`);
    return (await response.json()) as {
      accepted?: boolean;
      claimed?: boolean;
      status?: string;
      rowsRead?: number;
      rowsWritten?: number;
    };
  } catch (error) {
    throw error instanceof DeliveryError
      ? error
      : new DeliveryError("Delivery unavailable");
  }
}
