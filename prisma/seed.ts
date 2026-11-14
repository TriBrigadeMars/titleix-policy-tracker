import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  ISSUE_TAGS_CATALOG,
  JURISDICTIONS_CATALOG,
  seedCatalog,
  seedDemoCorpus,
  type DemoCorpus,
} from "../src/lib/seed-catalog";

const prisma = new PrismaClient();

function loadDemoCorpus(): DemoCorpus {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "fixtures", "demo-corpus.json"), "utf8");
  return JSON.parse(raw) as DemoCorpus;
}

async function main() {
  await seedCatalog(prisma);
  console.log(
    `Seeded ${JURISDICTIONS_CATALOG.length} jurisdictions, ${ISSUE_TAGS_CATALOG.length} issue tags.`
  );
  if (process.env.SEED_DEMO === "1" || process.env.NODE_ENV !== "production") {
    const result = await seedDemoCorpus(prisma, loadDemoCorpus());
    console.log(`Demo corpus: ${result.instruments} instruments, ${result.cellNotes} cell notes (existing rows preserved).`);
  } else {
    console.log("Demo corpus skipped in production; set SEED_DEMO=1 to install it.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
