const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { initializeDatabase } = require("../src/data");
const { createLeadInboxService } = require("../services/leadInbox");
const { buildGraphService } = require("../services/microsoftGraph");

async function main() {
  const limit = Math.max(1, Math.min(100, Number(process.env.LEAD_IMPORT_MAX_MESSAGES) || 25));
  const db = await initializeDatabase({});
  const graph = buildGraphService({});
  const importer = await createLeadInboxService({ db, graph });
  const results = await importer.importUnreadLeads({ limit });

  const summary = results.reduce(
    (acc, result) => {
      if (result.imported) {
        acc.imported += 1;
      } else if (result.duplicate) {
        acc.duplicates += 1;
      } else {
        acc.skipped += 1;
      }
      return acc;
    },
    { imported: 0, duplicates: 0, skipped: 0 }
  );

  console.log("Lead import finished.");
  console.log(`Imported: ${summary.imported}`);
  console.log(`Duplicates: ${summary.duplicates}`);
  console.log(`Skipped: ${summary.skipped}`);

  results.forEach((result, index) => {
    if (result.imported) {
      console.log(`${index + 1}. Imported lead #${result.lead.id} (${result.lead.customer_name})`);
      return;
    }

    if (result.duplicate) {
      console.log(`${index + 1}. Duplicate matched lead #${result.lead.id} by ${result.reason}`);
      return;
    }

    console.log(`${index + 1}. Skipped (${result.reason})`);
  });

  if (typeof db.close === "function") {
    await db.close();
  }
}

main().catch((error) => {
  console.error("Lead import failed.");
  console.error(error);
  process.exit(1);
});
