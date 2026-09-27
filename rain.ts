import { randomUUID } from "node:crypto";
import { signedPost } from "./client";
const run = {
  id: randomUUID(),
  startedAt: new Date().toISOString(),
  trigger: process.env.DOONAM_RECOVERY_ID
    ? "recovery"
    : process.env.GITHUB_EVENT_NAME === "schedule"
      ? "schedule"
      : "manual",
  requests: 0,
  bytes: 0,
};
if (process.env.DOONAM_DRY_RUN === "1") {
  console.log(
    "rain dry run: signed refresh is disabled; validate parser through local tests",
  );
} else {
  try {
    const result = await signedPost(
      "refresh",
      { sourceId: "thaiwater-rain", action: "rain", run },
      120000,
    );
    console.log("rain", result);
    if (!["success", "skipped"].includes(result.status ?? ""))
      process.exitCode = 1;
  } catch {
    console.error("rain import could not be confirmed; check source health");
    process.exitCode = 1;
  }
}
