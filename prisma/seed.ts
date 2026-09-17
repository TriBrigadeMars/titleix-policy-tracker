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
