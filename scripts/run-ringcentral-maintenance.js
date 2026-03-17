const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { initializeDatabase } = require("../src/data");
const { createRingCentralService } = require("../services/ringcentral");

async function main() {
  const db = await initializeDatabase();
  const ringcentral = await createRingCentralService({}, { db });
  const hoursBack = Number(process.env.RINGCENTRAL_RECONCILE_HOURS || 24);
  const batchSize = Number(process.env.RINGCENTRAL_JOB_BATCH_SIZE || 10);
  const passes = Math.max(1, Number(process.env.RINGCENTRAL_MAINTENANCE_PASSES || 3));

  const reconciliation = await ringcentral.reconcileConnectedAccounts({ hoursBack });
  const processing = [];

  for (let index = 0; index < passes; index += 1) {
    const results = await ringcentral.processPendingJobs({ limit: batchSize });
    processing.push(...results);
    if (results.length < batchSize) {
      break;
    }
  }

  console.log(
    JSON.stringify(
      {
        reconciled_accounts: reconciliation.length,
        reconciliation,
        processed_jobs: processing.length,
        processing,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
