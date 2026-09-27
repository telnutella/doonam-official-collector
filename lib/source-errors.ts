export class SourceError extends Error {
  constructor(
    public stage: string,
    cause: unknown,
  ) {
    super(
      `${stage}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
export function sourceError(error: unknown) {
  if (error instanceof SourceError)
    return `ดึงข้อมูลไม่สำเร็จ [${error.stage}]`;
  return transportStage(error) === "TLS"
    ? "ดึงข้อมูลไม่สำเร็จ [TLS]"
    : "ติดต่อแหล่งข้อมูลไม่สำเร็จ [NETWORK]";
}

export function transportStage(error: unknown): "TLS" | "NETWORK" {
  const parts: string[] = [];
  let current = error;
  for (let i = 0; current && i < 5; i++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    parts.push(String(e.code ?? ""), String(e.message ?? current));
    current = e.cause;
  }
  return /CERT|TLS|SSL|LEAF_SIGNATURE/i.test(parts.join(" "))
    ? "TLS"
    : "NETWORK";
}
