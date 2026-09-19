"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CellNoteEditor,
  type CellNoteTarget,
} from "@/components/cell-note-editor";
import { MatrixCell } from "@/components/matrix-cell";
import { STATUS_COLORS } from "@/lib/status-colors";
import type { CellNote, Instrument, IssueTag, Jurisdiction } from "@/types";

interface ComparisonMatrixProps {
  jurisdictions: Jurisdiction[];
  issueTags: IssueTag[];
  instruments: Instrument[];
  cellNotes: CellNote[];
  /** Resolved on the server from the session. Purely a display concern. */
  canEdit?: boolean;
  isPending?: boolean;
}

function cellKey(jurisdictionId: string, issueTagId: string) {
  return `${jurisdictionId}:${issueTagId}`;
}

export function ComparisonMatrix({
  jurisdictions,
  issueTags,
  instruments,
  cellNotes,
  canEdit = false,
  isPending = false,
}: ComparisonMatrixProps) {
  const router = useRouter();
  const [notes, setNotes] = useState(cellNotes);
  const [editing, setEditing] = useState<CellNoteTarget | null>(null);

  useEffect(() => {
    setNotes(cellNotes);
  }, [cellNotes]);

  const notesByCell = useMemo(() => {
    const map = new Map<string, CellNote>();
    for (const note of notes) {
      map.set(cellKey(note.jurisdictionId, note.issueTagId), note);
    }
    return map;
  }, [notes]);

  const instrumentsByCell = useMemo(() => {
    const map = new Map<string, Instrument[]>();
    for (const inst of instruments) {
      for (const link of inst.issueTags) {
        const key = cellKey(inst.jurisdictionId, link.issueTag.id);
        const list = map.get(key);
        if (list) list.push(inst);
        else map.set(key, [inst]);
      }
    }
    return map;
  }, [instruments]);

  const untaggedInstrumentsByJurisdiction = useMemo(() => {
    const map = new Map<string, Instrument[]>();
    for (const inst of instruments) {
      if (!inst.issueTags || inst.issueTags.length === 0) {
        const list = map.get(inst.jurisdictionId);
        if (list) list.push(inst);
        else map.set(inst.jurisdictionId, [inst]);
      }
    }
    return map;
  }, [instruments]);

  const hasUntagged = useMemo(() => {
    return instruments.some((inst) => !inst.issueTags || inst.issueTags.length === 0);
  }, [instruments]);

  function handleSaved(note: CellNote) {
    setNotes((prev) => [
      ...prev.filter(
        (n) =>
          n.id !== note.id &&
          !(
            n.jurisdictionId === note.jurisdictionId &&
            n.issueTagId === note.issueTagId
          )
      ),
      note,
    ]);
    router.refresh();
  }

  function handleDeleted(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    router.refresh();
  }

  if (jurisdictions.length < 2) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Select at least 2 jurisdictions to compare.
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading comparison data...
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px] sticky left-0 bg-background">
                Issue
              </TableHead>
              {jurisdictions.map((jurisdiction) => (
                <TableHead
                  key={jurisdiction.id}
                  className="min-w-[200px] text-center"
                >
                  {jurisdiction.code}
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
                {jurisdictions.map((jurisdiction) => {
                  const key = cellKey(jurisdiction.id, tag.id);
                  return (
                    <TableCell
                      key={`${jurisdiction.id}-${tag.id}`}
                      className="align-top"
                    >
                      <MatrixCell
                        jurisdiction={jurisdiction}
                        issueTag={tag}
                        note={notesByCell.get(key)}
                        instruments={instrumentsByCell.get(key) ?? []}
                        canEdit={canEdit}
                        onEdit={setEditing}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {hasUntagged && (
              <TableRow className="bg-muted/20">
                <TableCell className="font-medium sticky left-0 bg-background">
                  <div className="font-semibold text-amber-700 dark:text-amber-400">
                    Untagged
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Relevant instruments without an assigned issue tag
                  </div>
                </TableCell>
                {jurisdictions.map((jurisdiction) => {
                  const untaggedList =
                    untaggedInstrumentsByJurisdiction.get(jurisdiction.id) ?? [];
                  return (
                    <TableCell
                      key={`${jurisdiction.id}-untagged`}
                      className="align-top"
                    >
                      {untaggedList.length > 0 ? (
                        <div className="space-y-1">
                          {untaggedList.map((inst) => (
                            <div
                              key={inst.id}
                              className="text-xs border rounded p-1.5 bg-background"
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
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          No data
                        </span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <CellNoteEditor
          key={`${editing.jurisdictionId}-${editing.issueTagId}`}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}
