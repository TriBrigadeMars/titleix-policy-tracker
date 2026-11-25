import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicDataFreshness } from "@/components/public-data-freshness";
import { PublicReadOnlyNote } from "@/components/public-readonly-note";
import { auth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { statusLabel, typeLabel } from "@/lib/instrument-meta";
import { publicCellHref } from "@/lib/public-cell";
import { getInstrumentDetail, getPublicFreshness } from "@/lib/queries";
import { canEditRole } from "@/lib/roles";
import { sourceLabel } from "@/lib/sources";
import { STATUS_COLORS } from "@/lib/status-colors";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const instrument = await getInstrumentDetail(id);
  if (!instrument) {
    return { title: "Instrument not found — Title IX Policy Tracker" };
  }
  return {
    title: `${instrument.identifier} — Title IX Policy Tracker`,
    description:
      instrument.rawSummary ??
      `${instrument.jurisdiction.name} ${typeLabel(instrument.type).toLowerCase()} affecting Title IX.`,
  };
}

function DateRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {value ? formatDate(value) : "Not recorded"}
      </dd>
    </div>
  );
}

export default async function InstrumentPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  const canEdit = canEditRole(session);

  const instrument = await getInstrumentDetail(id);
  if (!instrument) notFound();

  const freshness = await getPublicFreshness();
  const jurisdictionCode = instrument.jurisdiction.code;
  const source = sourceLabel(instrument.source);
  const notes = instrument.notes ?? [];

  return (
    <>
      {!session?.user && <PublicReadOnlyNote />}
      <main className="container mx-auto py-8 px-4">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm">
          <ol className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <li>
              <Link href="/bills" className="hover:text-foreground underline-offset-4 hover:underline">
                Bills &amp; Regulations
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href={`/bills?jurisdiction=${jurisdictionCode}`}
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                {instrument.jurisdiction.name}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="font-mono text-foreground">
              {instrument.identifier}
            </li>
          </ol>
        </nav>

        <header className="mb-8 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-semibold">
              {jurisdictionCode}
            </Badge>
            <Badge variant="secondary" className={STATUS_COLORS[instrument.status]}>
              {statusLabel(instrument.status)}
            </Badge>
            <Badge variant="secondary">{typeLabel(instrument.type)}</Badge>
            <span className="font-mono text-sm text-muted-foreground">
              {instrument.identifier}
            </span>
          </div>
          <h1 className="text-3xl font-bold leading-tight">
            {instrument.title}
          </h1>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {instrument.rawSummary ? (
                  <>
                    <p className="text-sm leading-relaxed">
                      {instrument.rawSummary}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Summary supplied by the ingest source. It has not been
                      verified by an editor.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No summary was supplied by the source.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Key dates</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <DateRow label="Introduced" value={instrument.introducedAt} />
                  <DateRow label="Passed" value={instrument.passedAt} />
                  <DateRow label="Effective" value={instrument.effectiveAt} />
                </dl>
                {!instrument.introducedAt &&
                  !instrument.passedAt &&
                  !instrument.effectiveAt && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Legislative dates are not recorded for this instrument.
                    </p>
                  )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Issue areas</CardTitle>
              </CardHeader>
              <CardContent>
                {instrument.issueTags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No issue area has been assigned yet.
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {instrument.issueTags.map(({ issueTag }) => (
                      <li key={issueTag.id}>
                        <Link
                          href={publicCellHref(jurisdictionCode, issueTag.slug)}
                          className="inline-flex"
                        >
                          <Badge variant="outline" className="bg-muted/50">
                            {issueTag.label}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Issue badges link to the comparison matrix cell for{" "}
                  {instrument.jurisdiction.name}.
                </p>
              </CardContent>
            </Card>

            {canEdit && notes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Editor notes ({notes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {notes.map((note) => (
                    <div key={note.id} className="border-l-2 pl-3">
                      <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {note.author?.name ?? "An editor"} ·{" "}
                        {formatDateTime(note.updatedAt)}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source &amp; provenance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      Ingest source
                    </dt>
                    <dd>{source ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      Source record id
                    </dt>
                    <dd className="break-all font-mono text-xs">
                      {instrument.sourceId ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      Last checked
                    </dt>
                    <dd>
                      {instrument.lastCheckedAt
                        ? formatDateTime(instrument.lastCheckedAt)
                        : "Not recorded"}
                    </dd>
                  </div>
                </dl>
                {instrument.sourceUrl ? (
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a
                      href={instrument.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open primary source
                      <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No primary-source link was recorded for this instrument.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Keep exploring</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <Link
                    href={`/bills?jurisdiction=${jurisdictionCode}`}
                    className="underline underline-offset-4"
                  >
                    All instruments for {instrument.jurisdiction.name}
                  </Link>
                </p>
                <p>
                  <Link
                    href={publicCellHref(jurisdictionCode)}
                    className="underline underline-offset-4"
                  >
                    Compare {instrument.jurisdiction.code} in the matrix
                  </Link>
                </p>
                <p>
                  <Link href="/heatmap" className="underline underline-offset-4">
                    See activity across every state
                  </Link>
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>

        <PublicDataFreshness freshness={freshness} />
      </main>
    </>
  );
}
