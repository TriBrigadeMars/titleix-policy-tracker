"use client";

import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { IssueTag, Instrument, CellNote } from "@/types";

interface ComparisonMatrixProps {
  jurisdictionIds: string[];
  jurisdictionCodes: Record<string, string>;
}

const STATUS_COLORS: Record<string, string> = {
  PROPOSED: "bg-blue-100 text-blue-800",
  PASSED: "bg-green-100 text-green-800",
  EFFECTIVE: "bg-emerald-100 text-emerald-800",
  ENJOINED: "bg-yellow-100 text-yellow-800",
  REPEALED: "bg-gray-100 text-gray-800",
};

export function ComparisonMatrix({
  jurisdictionIds,
  jurisdictionCodes,
}: ComparisonMatrixProps) {
  const [issueTags, setIssueTags] = useState<IssueTag[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [cellNotes, setCellNotes] = useState<CellNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (jurisdictionIds.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams({
      jurisdictionIds: jurisdictionIds.join(","),
    });

    Promise.all([
      fetch("/api/issue-tags").then((r) => r.json()),
      fetch(`/api/instruments?${params}`).then((r) => r.json()),
      fetch(`/api/cell-notes?${params}`).then((r) => r.json()),
    ])
      .then(([tags, insts, notes]) => {
        setIssueTags(tags);
        setInstruments(insts);
        setCellNotes(notes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [jurisdictionIds]);

  if (jurisdictionIds.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Select at least 2 jurisdictions to compare.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading comparison data...
      </div>
    );
  }

  const getInstrumentsForCell = (
    jurisdictionId: string,
    issueTagId: string
  ) => {
    return instruments.filter(
      (inst) =>
        inst.jurisdictionId === jurisdictionId &&
        inst.issueTags.some((t) => t.issueTag.id === issueTagId)
    );
  };

  const getCellNote = (jurisdictionId: string, issueTagId: string) => {
    return cellNotes.find(
      (n) => n.jurisdictionId === jurisdictionId && n.issueTagId === issueTagId
    );
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px] sticky left-0 bg-background">
              Issue
            </TableHead>
            {jurisdictionIds.map((jId) => (
              <TableHead key={jId} className="min-w-[200px] text-center">
                {jurisdictionCodes[jId] ?? jId}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {issueTags.map((tag) => (
            <TableRow key={tag.id}>
              <TableCell className="font-medium sticky left-0 bg-background">
                <div>{tag.label}</div>
                {tag.description && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {tag.description}
                  </div>
                )}
              </TableCell>
              {jurisdictionIds.map((jId) => {
                const cellInstruments = getInstrumentsForCell(jId, tag.id);
                const note = getCellNote(jId, tag.id);

                return (
                  <TableCell key={`${jId}-${tag.id}`} className="align-top">
                    {note && (
                      <div className="text-sm mb-2 whitespace-pre-wrap">
                        {note.body}
                      </div>
                    )}

                    {cellInstruments.length > 0 && (
                      <div className="space-y-1">
                        {cellInstruments.map((inst) => (
                          <div
                            key={inst.id}
                            className="text-xs border rounded p-1.5"
                          >
                            <div className="flex items-center gap-1">
                              <Badge
                                variant="secondary"
                                className={STATUS_COLORS[inst.status]}
                              >
                                {inst.status}
                              </Badge>
                              <span className="font-mono text-xs">
                                {inst.identifier}
                              </span>
                            </div>
                            <div className="mt-1 font-medium">{inst.title}</div>
                            {inst.sourceUrl && (
                              <a
                                href={inst.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline flex items-center gap-1 mt-1"
                              >
                                Source <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {!note && cellInstruments.length === 0 && (
                      <span className="text-xs text-muted-foreground italic">
                        No data
                      </span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}