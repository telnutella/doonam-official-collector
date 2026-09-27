import { z } from "zod";

export const monitoredSources = ["tmd-cap", "thaiwater-rain"] as const;
export type MonitoredSource = (typeof monitoredSources)[number];
export const periodMs = 15 * 60_000;
export const recoveryAfterMs = 2 * periodMs;
export const retentionMs = 7 * 86_400_000;
export const MonitorRunSchema = z
  .object({
    id: z.string().uuid(),
    startedAt: z.string().datetime({ offset: true }),
    trigger: z.enum(["schedule", "manual", "recovery"]).default("schedule"),
    requests: z.number().int().min(0).max(200).default(0),
    bytes: z.number().int().min(0).max(100_000_000).default(0),
  })
  .strict();
export type MonitorRun = z.infer<typeof MonitorRunSchema>;
export type FailureStage = "fetch" | "parse" | "store" | "heartbeat";
export const failureLabels: Record<FailureStage, string> = {
  fetch: "ติดต่อแหล่งข้อมูลไม่สำเร็จ",
  parse: "ตรวจรูปแบบข้อมูลไม่สำเร็จ",
  store: "บันทึกข้อมูลไม่สำเร็จ",
  heartbeat: "ส่งสัญญาณให้ตัวเฝ้าดูไม่สำเร็จ",
};
export const isMonitored = (id: string): id is MonitoredSource =>
  monitoredSources.includes(id as MonitoredSource);
export function updateState(lastSuccess: number | null, now: number) {
  if (!lastSuccess || lastSuccess > now) return "unknown" as const;
  return now - lastSuccess > recoveryAfterMs
    ? ("overdue" as const)
    : now - lastSuccess > periodMs
      ? ("late" as const)
      : ("onTime" as const);
}
export function thaiDateKey(now: number) {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
}
export type SourceHealth = {
  sourceId: MonitoredSource;
  enabled: boolean;
  recoveryEnabled: boolean;
  recoveryTokenExpiresAt?: string | null;
  lastSuccess: string | null;
  state: ReturnType<typeof updateState>;
  lastRun: null | {
    startedAt: string;
    finishedAt: string | null;
    outcome: string;
    stage: FailureStage | null;
    code: string | null;
  };
  heartbeat: {
    configured: boolean;
    lastDelivered: string | null;
    error: string | null;
  };
  measurements: null | {
    checkedAt: string;
    latestObservedAt: string | null;
    fresh: number;
    stale: number;
    missing: number;
  };
  recovery: null | {
    openedAt: string;
    status: string;
    resolvedAt: string | null;
  };
  audit: {
    since: string | null;
    hours: number;
    expectedSlots: number;
    successfulSlots: number;
    failedRuns: number;
    longestGapMinutes: number;
    requests: number;
    bytes: number;
    rowsRead: number;
    rowsWritten: number;
  };
};
export type SourceHealthResponse = {
  schemaVersion: 1;
  checkedAt: string;
  sources: SourceHealth[];
};
