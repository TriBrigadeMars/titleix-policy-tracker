"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
