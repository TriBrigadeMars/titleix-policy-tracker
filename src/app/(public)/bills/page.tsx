import type { Metadata } from "next";
import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  billFilterParams,
  billPageHref,
  hasBillFilters,
  parseBillQuery,
} from "@/lib/bill-query";
import { formatDate } from "@/lib/format-date";
import {
  INSTRUMENT_STATUSES,
  INSTRUMENT_TYPES,
  statusLabel,
  typeLabel,
} from "@/lib/instrument-meta";
import {
  getInstrumentListing,
  getJurisdictions,
  getPublicFreshness,
} from "@/lib/queries";
import { PublicDataFreshness } from "@/components/public-data-freshness";
import { PublicReadOnlyNote } from "@/components/public-readonly-note";
import { STATUS_COLORS } from "@/lib/status-colors";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bills — Title IX Policy Tracker",
  description:
    "Search and filter proposed and passed state and federal laws, regulations, and statutes affecting Title IX.",
};

/**
 * Next hands `searchParams` as string | string[]. Join repeated keys with
 * commas so `?jurisdiction=CA&jurisdiction=TX` behaves like the canonical
 * `?jurisdiction=CA,TX` form.
 */
function toSearchParams(
  params: Record<string, string | string[] | undefined>
): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
    else if (Array.isArray(value) && value.length > 0) {
      search.set(key, value.join(","));
    }
  }
  return search;
}

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const query = parseBillQuery(toSearchParams(await searchParams));

  const [jurisdictions, listing, freshness] = await Promise.all([
    getJurisdictions(),
    getInstrumentListing(query),
    getPublicFreshness(),
  ]);

  const filtered = hasBillFilters(query);
  const start =
    listing.total > 0 ? (listing.page - 1) * listing.pageSize + 1 : 0;
  const end = Math.min(listing.page * listing.pageSize, listing.total);
  const pageOutOfRange = listing.total > 0 && listing.instruments.length === 0;

  const exportParams = billFilterParams(query);
  if (query.sort !== "newest") exportParams.set("sort", query.sort);
  const exportSuffix = exportParams.toString();
  const csvHref = `/api/export/instruments?format=csv${exportSuffix ? `&${exportSuffix}` : ""}`;
  const jsonHref = `/api/export/instruments?format=json${exportSuffix ? `&${exportSuffix}` : ""}`;

  return (
    <>
      {!session?.user && <PublicReadOnlyNote />}
      <main className="container mx-auto py-8 px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Bills &amp; Regulations</h1>
          <p className="text-muted-foreground">
            Every instrument an editor has marked relevant to Title IX. Filter
            by jurisdiction, legislative status, or type, and search titles,
            summaries, and bill numbers.
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Search &amp; filters</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              method="get"
              action="/bills"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="bill-q"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Search title, summary, or bill number
                </label>
                <input
                  id="bill-q"
                  name="q"
                  type="search"
                  defaultValue={query.q}
                  maxLength={100}
                  placeholder="e.g. athletics, harassment, SB 15"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="bill-jurisdiction"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Jurisdiction
                </label>
                <select
                  id="bill-jurisdiction"
                  name="jurisdiction"
                  defaultValue={query.jurisdictionCodes[0] ?? ""}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">All jurisdictions</option>
                  {jurisdictions.map((jurisdiction) => (
                    <option key={jurisdiction.id} value={jurisdiction.code}>
                      {jurisdiction.code} — {jurisdiction.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="bill-status"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Status
                </label>
                <select
                  id="bill-status"
                  name="status"
                  defaultValue={query.status ?? ""}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">All statuses</option>
                  {INSTRUMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="bill-type"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Type
                </label>
                <select
                  id="bill-type"
                  name="type"
                  defaultValue={query.type ?? ""}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">All types</option>
                  {INSTRUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(type)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="bill-sort"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Sort by
                </label>
                <select
                  id="bill-sort"
                  name="sort"
                  defaultValue={query.sort}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="status">Status</option>
                  <option value="state">Jurisdiction A–Z</option>
                </select>
              </div>

              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <Button type="submit">Apply filters</Button>
                {filtered && (
                  <Button asChild variant="ghost">
                    <Link href="/bills">Clear filters</Link>
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {listing.total === 0 ? (
              "No matching instruments"
            ) : (
              <>
                Showing{" "}
                <strong className="text-foreground">
                  {start}–{end}
                </strong>{" "}
                of{" "}
                <strong className="text-foreground">{listing.total}</strong>{" "}
                instrument{listing.total === 1 ? "" : "s"}
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button asChild variant="outline" size="sm">
              <a href={csvHref} download>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download CSV
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={jsonHref} download>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download JSON
              </a>
            </Button>
          </div>
        </div>

        {listing.instruments.length > 0 ? (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableCaption className="sr-only">
                  Published Title IX instruments matching the current filters
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Jurisdiction</TableHead>
                    <TableHead>Instrument</TableHead>
                    <TableHead className="w-[110px]">Status</TableHead>
                    <TableHead className="w-[110px]">Type</TableHead>
                    <TableHead className="w-[120px]">Introduced</TableHead>
                    <TableHead className="w-[70px]">
                      <span className="sr-only">Source</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listing.instruments.map((instrument) => (
                    <TableRow key={instrument.id}>
                      <TableCell className="align-top font-medium">
                        {instrument.jurisdiction.code}
                      </TableCell>
                      <TableCell className="align-top">
                        <Link
                          href={`/instruments/${instrument.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {instrument.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-mono">
                            {instrument.identifier}
                          </span>
                          {instrument.issueTags.length > 0 && (
                            <span>
                              {instrument.issueTags
                                .map((link) => link.issueTag.label)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge
                          variant="secondary"
                          className={STATUS_COLORS[instrument.status]}
                        >
                          {statusLabel(instrument.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {typeLabel(instrument.type)}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {instrument.introducedAt
                          ? formatDate(instrument.introducedAt)
                          : "Not recorded"}
                      </TableCell>
                      <TableCell className="align-top">
                        {instrument.sourceUrl && (
                          <a
                            href={instrument.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                          >
                            Source
                            <span className="sr-only"> (opens in a new tab)</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Card className="py-10">
            <CardContent className="text-center">
              {pageOutOfRange ? (
                <>
                  <p className="font-medium">
                    This page is past the end of the results.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <Link href={billPageHref(query, 1)} className="underline">
                      Go to the first page
                    </Link>
                    .
                  </p>
                </>
              ) : filtered ? (
                <>
                  <p className="font-medium">
                    No instruments match these filters.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Try a broader search, another jurisdiction, or{" "}
                    <Link href="/bills" className="underline">
                      clear all filters
                    </Link>
                    .
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">
                    No instruments have been published yet.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xl mx-auto">
                    This tracker has no relevant instruments in its database.
                    If you are running it locally, load the demo corpus
                    (<code className="font-mono text-xs">
                      npm run db:seed:demo
                    </code>
                    ) or run an ingest adapter. The heatmap and comparison
                    views read the same data.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {listing.totalPages > 1 && !pageOutOfRange && (
          <nav
            aria-label="Bill list pages"
            className="mt-4 flex items-center justify-between gap-3 text-sm"
          >
            <div>
              {listing.page > 1 ? (
                <Link
                  href={billPageHref(query, listing.page - 1)}
                  className="underline underline-offset-4"
                >
                  ← Previous
                </Link>
              ) : (
                <span className="text-muted-foreground">← Previous</span>
              )}
            </div>
            <span className="text-muted-foreground">
              Page {listing.page} of {listing.totalPages}
            </span>
            <div>
              {listing.page < listing.totalPages ? (
                <Link
                  href={billPageHref(query, listing.page + 1)}
                  className="underline underline-offset-4"
                >
                  Next →
                </Link>
              ) : (
                <span className="text-muted-foreground">Next →</span>
              )}
            </div>
          </nav>
        )}

        <PublicDataFreshness freshness={freshness} />
      </main>
    </>
  );
}
