const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { initializeDatabase } = require("../src/data");
const { createRingCentralService } = require("../services/ringcentral");

async function main() {
  const db = await initializeDatabase();
  const ringcentral = await createRingCentralService({}, { db });
  const hoursBack = Number(process.env.RINGCENTRAL_RECONCILE_HOURS || 24);
  const results = await ringcentral.reconcileConnectedAccounts({ hoursBack });
  console.log(JSON.stringify({ reconciled_accounts: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
