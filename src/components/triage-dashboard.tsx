"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, ExternalLink, FileText, Filter, HelpCircle, Pencil, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InstrumentTriageEditor } from "@/components/instrument-triage-editor";
import { formatDate } from "@/lib/format-date";
import type { TriageQuery } from "@/lib/search-params";
import { triageStatus } from "@/lib/triage";
import { STATUS_COLORS } from "@/lib/status-colors";
import type { Instrument, IssueTag, Jurisdiction } from "@/types";

interface TriageDashboardProps {
  jurisdictions: Jurisdiction[];
  issueTags: IssueTag[];
  initialInstruments: Instrument[];
  filters: TriageQuery;
}

export function TriageDashboard({
  jurisdictions,
  issueTags,
  initialInstruments,
  filters,
}: TriageDashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [instruments, setInstruments] = useState(initialInstruments);
  const [editingInstrument, setEditingInstrument] = useState<Instrument | null>(null);

  useEffect(() => {
    setInstruments(initialInstruments);
  }, [initialInstruments]);

  function updateFilter(updates: Partial<TriageQuery>) {
    const next: TriageQuery = { ...filters, ...updates };
    const params = new URLSearchParams();

    if (next.jurisdictionCode) params.set("jurisdiction", next.jurisdictionCode);
    if (next.status) params.set("status", next.status);
    if (next.relevance && next.relevance !== "unreviewed") {
      params.set("relevance", next.relevance);
    }
    if (next.limit && next.limit !== 50) params.set("limit", String(next.limit));

    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/triage?${qs}` : "/triage");
    });
  }

  function handleInstrumentSaved(updated: Instrument) {
    setInstruments((prev) =>
      prev.map((inst) => (inst.id === updated.id ? updated : inst))
    );
    router.refresh();
  }

  return (
    <main className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Editor Triage</h1>
          <p className="text-muted-foreground mt-1">
            Review ingested legislation and regulations, tag Title IX relevance, and assign matrix issue tags.
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filter Instruments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Relevance Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Relevance Status
              </label>
              <Select
                value={filters.relevance}
                onValueChange={(val) =>
                  updateFilter({ relevance: val as TriageQuery["relevance"] })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select relevance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unreviewed">Unreviewed (Needs Triage)</SelectItem>
                  <SelectItem value="relevant">Title IX Relevant</SelectItem>
                  <SelectItem value="not_relevant">Not Relevant</SelectItem>
                  <SelectItem value="all">All Instruments</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Jurisdiction Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Jurisdiction
              </label>
              <Select
                value={filters.jurisdictionCode ?? "ALL"}
                onValueChange={(val) =>
                  updateFilter({
                    jurisdictionCode: val === "ALL" ? undefined : val,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Jurisdictions" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="ALL">All Jurisdictions</SelectItem>
                  {jurisdictions.map((j) => (
                    <SelectItem key={j.id} value={j.code}>
                      {j.code} — {j.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Legislative Status
              </label>
              <Select
                value={filters.status ?? "ALL"}
                onValueChange={(val) =>
                  updateFilter({
                    status:
                      val === "ALL"
                        ? undefined
                        : (val as TriageQuery["status"]),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PROPOSED">PROPOSED</SelectItem>
                  <SelectItem value="PASSED">PASSED</SelectItem>
                  <SelectItem value="EFFECTIVE">EFFECTIVE</SelectItem>
                  <SelectItem value="ENJOINED">ENJOINED</SelectItem>
                  <SelectItem value="REPEALED">REPEALED</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Instruments List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{instruments.length}</strong> instruments
            {isPending && <span className="ml-2 italic">(Updating...)</span>}
          </span>
        </div>

        {instruments.length === 0 ? (
          <Card className="py-12 text-center text-muted-foreground">
            <CardContent>
              <p className="text-base font-medium">No instruments match the selected filters.</p>
              <p className="text-sm mt-1">
                Try switching the relevance filter or jurisdiction to view other items.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {instruments.map((inst) => {
              const hasNotes = (inst.notes?.length ?? 0) > 0;
              const status = triageStatus(
                inst.triageStatus ?? inst.isTitleIXRelevant,
                inst.relevanceConfidence
              );

              return (
                <Card
                  key={inst.id}
                  className="transition-colors hover:border-foreground/30"
                >
                  <CardContent className="p-5 flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      {/* Badges line */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-semibold">
                          {inst.jurisdiction.code}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className={STATUS_COLORS[inst.status]}
                        >
                          {inst.status}
                        </Badge>
                        <Badge variant="secondary">{inst.type}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">
                          {inst.identifier}
                        </span>

                        {/* Relevance badge */}
                        {status === "UNREVIEWED" ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 text-amber-600 dark:text-amber-400 gap-1"
                          >
                            <HelpCircle className="h-3 w-3" /> Unreviewed
                          </Badge>
                        ) : status === "RELEVANT" ? (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 gap-1"
                          >
                            <CheckCircle className="h-3 w-3" /> Title IX Relevant
                            {inst.relevanceConfidence !== null &&
                              ` (${inst.relevanceConfidence}%)`}
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 gap-1"
                          >
                            <XCircle className="h-3 w-3" /> Not Relevant
                            {inst.relevanceConfidence !== null &&
                              ` (${inst.relevanceConfidence}%)`}
                          </Badge>
                        )}

                        {hasNotes && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-auto sm:ml-0">
                            <FileText className="h-3.5 w-3.5" />
                            {inst.notes?.length} note{inst.notes?.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h3 className="font-semibold text-base leading-snug">
                        {inst.title}
                      </h3>

                      {/* Raw Summary if available */}
                      {inst.rawSummary && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {inst.rawSummary}
                        </p>
                      )}

                      {/* Issue Tags & Meta */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {inst.issueTags.length > 0 ? (
                          inst.issueTags.map(({ issueTag }) => (
                            <Badge
                              key={issueTag.id}
                              variant="outline"
                              className="text-xs bg-muted/50"
                            >
                              {issueTag.label}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            No issue tags assigned
                          </span>
                        )}

                        {inst.introducedAt && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            Introduced {formatDate(inst.introducedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 self-end sm:self-start">
                      <Button
                        size="sm"
                        onClick={() => setEditingInstrument(inst)}
                        className="gap-1.5"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Triage
                      </Button>
                      {inst.sourceUrl && (
                        <a
                          href={inst.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          Source <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {editingInstrument && (
        <InstrumentTriageEditor
          key={editingInstrument.id}
          instrument={editingInstrument}
          issueTags={issueTags}
          isOpen={true}
          onClose={() => setEditingInstrument(null)}
          onSaved={(updated) => {
            handleInstrumentSaved(updated);
            setEditingInstrument(updated);
          }}
        />
      )}
    </main>
  );
}
