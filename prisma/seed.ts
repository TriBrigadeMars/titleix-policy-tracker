import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const JURISDICTIONS = [
  { code: "US", name: "United States", level: "FEDERAL" },
  { code: "AL", name: "Alabama", level: "STATE" },
  { code: "AK", name: "Alaska", level: "STATE" },
  { code: "AZ", name: "Arizona", level: "STATE" },
  { code: "AR", name: "Arkansas", level: "STATE" },
  { code: "CA", name: "California", level: "STATE" },
  { code: "CO", name: "Colorado", level: "STATE" },
  { code: "CT", name: "Connecticut", level: "STATE" },
  { code: "DE", name: "Delaware", level: "STATE" },
  { code: "DC", name: "District of Columbia", level: "STATE" },
  { code: "FL", name: "Florida", level: "STATE" },
  { code: "GA", name: "Georgia", level: "STATE" },
  { code: "HI", name: "Hawaii", level: "STATE" },
  { code: "ID", name: "Idaho", level: "STATE" },
  { code: "IL", name: "Illinois", level: "STATE" },
  { code: "IN", name: "Indiana", level: "STATE" },
  { code: "IA", name: "Iowa", level: "STATE" },
  { code: "KS", name: "Kansas", level: "STATE" },
  { code: "KY", name: "Kentucky", level: "STATE" },
  { code: "LA", name: "Louisiana", level: "STATE" },
  { code: "ME", name: "Maine", level: "STATE" },
  { code: "MD", name: "Maryland", level: "STATE" },
  { code: "MA", name: "Massachusetts", level: "STATE" },
  { code: "MI", name: "Michigan", level: "STATE" },
  { code: "MN", name: "Minnesota", level: "STATE" },
  { code: "MS", name: "Mississippi", level: "STATE" },
  { code: "MO", name: "Missouri", level: "STATE" },
  { code: "MT", name: "Montana", level: "STATE" },
  { code: "NE", name: "Nebraska", level: "STATE" },
  { code: "NV", name: "Nevada", level: "STATE" },
  { code: "NH", name: "New Hampshire", level: "STATE" },
  { code: "NJ", name: "New Jersey", level: "STATE" },
  { code: "NM", name: "New Mexico", level: "STATE" },
  { code: "NY", name: "New York", level: "STATE" },
  { code: "NC", name: "North Carolina", level: "STATE" },
  { code: "ND", name: "North Dakota", level: "STATE" },
  { code: "OH", name: "Ohio", level: "STATE" },
  { code: "OK", name: "Oklahoma", level: "STATE" },
  { code: "OR", name: "Oregon", level: "STATE" },
  { code: "PA", name: "Pennsylvania", level: "STATE" },
  { code: "RI", name: "Rhode Island", level: "STATE" },
  { code: "SC", name: "South Carolina", level: "STATE" },
  { code: "SD", name: "South Dakota", level: "STATE" },
  { code: "TN", name: "Tennessee", level: "STATE" },
  { code: "TX", name: "Texas", level: "STATE" },
  { code: "UT", name: "Utah", level: "STATE" },
  { code: "VT", name: "Vermont", level: "STATE" },
  { code: "VA", name: "Virginia", level: "STATE" },
  { code: "WA", name: "Washington", level: "STATE" },
  { code: "WV", name: "West Virginia", level: "STATE" },
  { code: "WI", name: "Wisconsin", level: "STATE" },
  { code: "WY", name: "Wyoming", level: "STATE" },
] as const;

const ISSUE_TAGS = [
  {
    slug: "coverage",
    label: "Who is covered — sex, sexual orientation, gender identity",
    sortOrder: 1,
    description:
      "Which categories of people are protected under Title IX or related state law.",
  },
  {
    slug: "athletics",
    label: "Athletics eligibility",
    sortOrder: 2,
    description:
      "Rules governing participation in sex-separated athletics programs.",
  },
  {
    slug: "facilities",
    label: "Facilities & housing — bathrooms, lockers, dorms",
    sortOrder: 3,
    description:
      "Access to restrooms, locker rooms, and student housing.",
  },
  {
    slug: "harassment",
    label: "Harassment standard — what conduct is covered",
    sortOrder: 4,
    description:
      "Definitions and thresholds for sexual harassment and misconduct.",
  },
  {
    slug: "grievance",
    label: "Grievance / due process — notice, hearings, evidence, advisors",
    sortOrder: 5,
    description:
      "Procedural requirements for investigating complaints and adjudicating cases.",
  },
  {
    slug: "pregnancy",
    label: "Pregnancy & parental status",
    sortOrder: 6,
    description:
      "Protections for pregnant and parenting students and employees.",
  },
  {
    slug: "exemptions",
    label: "Religious and statutory exemptions",
    sortOrder: 7,
    description:
      "Exemptions from Title IX requirements for religious institutions or other specified entities.",
  },
  {
    slug: "reporting",
    label: "Reporting duties & retaliation",
    sortOrder: 8,
    description:
      "Mandatory reporting requirements and anti-retaliation protections.",
  },
] as const;

interface FixtureInstrument {
  jurisdictionCode: string;
  type: "BILL" | "STATUTE" | "REGULATION";
  identifier: string;
  title: string;
  status:
    | "PROPOSED"
    | "PASSED"
    | "EFFECTIVE"
    | "ENJOINED"
    | "FAILED"
    | "VETOED"
    | "REPEALED";
  triageStatus: "UNREVIEWED" | "RELEVANT" | "NOT_RELEVANT";
  relevanceConfidence: number | null;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  rawSummary: string | null;
  issueTagSlugs: string[];
}

interface FixtureCellNote {
  jurisdictionCode: string;
  issueTagSlug: string;
  body: string;
}

interface DemoCorpus {
  checkedAt: string;
  instruments: FixtureInstrument[];
  cellNotes: FixtureCellNote[];
}

function loadDemoCorpus(): DemoCorpus {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "fixtures", "demo-corpus.json"), "utf8");
  return JSON.parse(raw) as DemoCorpus;
}

async function seedDemoCorpus() {
  const corpus = loadDemoCorpus();
  const checkedAt = new Date(corpus.checkedAt);

  const jurisdictions = await prisma.jurisdiction.findMany({
    select: { id: true, code: true },
  });
  const codeToId = new Map(jurisdictions.map((j) => [j.code, j.id]));

  const issueTags = await prisma.issueTag.findMany({
    select: { id: true, slug: true },
  });
  const slugToId = new Map(issueTags.map((t) => [t.slug, t.id]));

  for (const row of corpus.instruments) {
    const jurisdictionId = codeToId.get(row.jurisdictionCode);
    if (!jurisdictionId) {
      throw new Error(`Fixture jurisdiction missing: ${row.jurisdictionCode}`);
    }

    const instrument = await prisma.instrument.upsert({
      where: {
        jurisdictionId_type_identifier: {
          jurisdictionId,
          type: row.type,
          identifier: row.identifier,
        },
      },
      create: {
        jurisdictionId,
        type: row.type,
        identifier: row.identifier,
        title: row.title,
        status: row.status,
        triageStatus: row.triageStatus,
        relevanceConfidence: row.relevanceConfidence,
        source: row.source,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        rawSummary: row.rawSummary,
        lastCheckedAt: checkedAt,
      },
      update: {
        title: row.title,
        status: row.status,
        triageStatus: row.triageStatus,
        relevanceConfidence: row.relevanceConfidence,
        source: row.source,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        rawSummary: row.rawSummary,
        lastCheckedAt: checkedAt,
      },
    });

    await prisma.instrumentIssueTag.deleteMany({
      where: { instrumentId: instrument.id },
    });
    const tagIds = row.issueTagSlugs.map((slug) => {
      const id = slugToId.get(slug);
      if (!id) throw new Error(`Fixture issue tag missing: ${slug}`);
      return id;
    });
    if (tagIds.length > 0) {
      await prisma.instrumentIssueTag.createMany({
        data: tagIds.map((issueTagId) => ({
          instrumentId: instrument.id,
          issueTagId,
        })),
      });
    }
  }

  for (const note of corpus.cellNotes) {
    const jurisdictionId = codeToId.get(note.jurisdictionCode);
    const issueTagId = slugToId.get(note.issueTagSlug);
    if (!jurisdictionId || !issueTagId) {
      throw new Error(
        `Fixture cell note missing keys: ${note.jurisdictionCode}/${note.issueTagSlug}`
      );
    }
    await prisma.cellNote.upsert({
      where: {
        jurisdictionId_issueTagId: { jurisdictionId, issueTagId },
      },
      create: {
        jurisdictionId,
        issueTagId,
        body: note.body,
      },
      update: { body: note.body },
    });
  }

  await prisma.ingestRun.create({
    data: {
      source: "fixture",
      status: "SUCCESS",
      startedAt: checkedAt,
      finishedAt: checkedAt,
      upserted: corpus.instruments.length,
      skipped: 0,
      dropped: 0,
    },
  });

  console.log(
    `Seeded demo corpus: ${corpus.instruments.length} reviewed instruments, ${corpus.cellNotes.length} cell notes.`
  );
}

async function main() {
  await Promise.all(
    JURISDICTIONS.map((j) =>
      prisma.jurisdiction.upsert({
        where: { code: j.code },
        update: {},
        create: j,
      })
    )
  );

  await Promise.all(
    ISSUE_TAGS.map((tag) =>
      prisma.issueTag.upsert({
        where: { slug: tag.slug },
        update: {},
        create: tag,
      })
    )
  );

  console.log(`Seeded ${JURISDICTIONS.length} jurisdictions and ${ISSUE_TAGS.length} issue tags.`);

  await seedDemoCorpus();
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
