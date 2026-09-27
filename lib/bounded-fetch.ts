// Retry only replay-safe operations. Callers must not use this for workflow dispatch.
export async function boundedFetch(
  url: string,
  init: RequestInit = {},
  options: {
    timeoutMs?: number;
    attempts?: number;
    fetcher?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let wait = 500 * 2 ** attempt;
    try {
      const response = await fetcher(url, {
        ...init,
        redirect: "manual",
        signal: init.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(options.timeoutMs ?? 10_000),
            ])
          : AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (
        ![408, 429, 500, 502, 503, 504].includes(response.status) ||
        attempt >= (options.attempts ?? 3) - 1
      )
        return response;
      const retry = response.headers.get("retry-after");
      if (retry) {
        const delay = /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now();
        // Do not retry earlier than requested when it exceeds our time budget.
        if (Number.isFinite(delay) && delay > 5000) return response;
        if (Number.isFinite(delay)) wait = Math.max(wait, delay);
      }
      await response.body?.cancel();
    } catch (error) {
      const text =
        String(error) +
        String((error as { cause?: { code?: string } })?.cause?.code ?? "");
      if (
        init.signal?.aborted ||
        /CERT|TLS|SSL|LEAF_SIGNATURE/i.test(text) ||
        attempt >= (options.attempts ?? 3) - 1
      )
        throw error;
    }
    await sleep(wait);
  }
}
