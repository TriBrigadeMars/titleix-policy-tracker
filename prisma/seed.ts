import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  ISSUE_TAGS_CATALOG,
  JURISDICTIONS_CATALOG,
  seedCatalogAndCorpus,
  type DemoCorpus,
} from "../src/lib/seed-catalog";

const prisma = new PrismaClient();

function loadDemoCorpus(): DemoCorpus {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "fixtures", "demo-corpus.json"), "utf8");
  return JSON.parse(raw) as DemoCorpus;
}

async function main() {
  const corpus = loadDemoCorpus();
  const result = await seedCatalogAndCorpus(prisma, corpus);
  console.log(
    `Seeded ${JURISDICTIONS_CATALOG.length} jurisdictions, ${ISSUE_TAGS_CATALOG.length} issue tags, ${result.instruments} reviewed instruments, ${result.cellNotes} cell notes.`
  );
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
