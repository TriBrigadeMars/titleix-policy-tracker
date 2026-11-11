import { runScheduledIngest, scheduledIngestConfigFromEnv } from "@/lib/ingest/schedule";

async function main() {
  const config = scheduledIngestConfigFromEnv();
  const results = await runScheduledIngest(config);
  for (const result of results) {
    if (result.ok && result.result) {
      console.log(
        `${result.source}: upserted=${result.result.upserted} skipped=${result.result.skipped} dropped=${result.result.dropped} total=${result.result.total}`
      );
    } else {
      console.error(
        `${result.source}: failed (${result.errorClass ?? "Unknown"})`
      );
    }
  }
  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[ingest:scheduled] failed", error);
  process.exit(1);
});
