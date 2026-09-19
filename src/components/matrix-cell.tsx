"use client";

import { ExternalLink, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CellNoteTarget } from "@/components/cell-note-editor";
import { formatDate } from "@/lib/format-date";
import { STATUS_COLORS } from "@/lib/status-colors";
import type { CellNote, Instrument, IssueTag, Jurisdiction } from "@/types";

interface MatrixCellProps {
  jurisdiction: Jurisdiction;
  issueTag: IssueTag;
  note: CellNote | undefined;
  instruments: Instrument[];
  canEdit: boolean;
  onEdit: (target: CellNoteTarget) => void;
}

export function MatrixCell({
  jurisdiction,
  issueTag,
  note,
  instruments,
  canEdit,
  onEdit,
}: MatrixCellProps) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-2">
        {note && (
          <div>
            <div className="text-sm whitespace-pre-wrap">{note.body}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {note.author?.name ?? "An editor"}
              {note.updatedAt
                ? ` - last edited ${formatDate(note.updatedAt)}`
                : ""}
            </div>
          </div>
        )}

        {instruments.length > 0 && (
          <div className="space-y-1">
            {instruments.map((inst) => (
              <div key={inst.id} className="text-xs border rounded p-1.5">
                <div className="flex items-center gap-1">
                  <Badge
                    variant="secondary"
                    className={STATUS_COLORS[inst.status]}
                  >
                    {inst.status}
                  </Badge>
                  <span className="font-mono text-xs">{inst.identifier}</span>
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

        {!note && instruments.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No data</span>
        )}
      </div>

      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          aria-label={
            note
              ? `Edit note for ${issueTag.label} in ${jurisdiction.code}`
              : `Add note for ${issueTag.label} in ${jurisdiction.code}`
          }
          onClick={() =>
            onEdit({
              jurisdictionId: jurisdiction.id,
              issueTagId: issueTag.id,
              jurisdictionLabel: jurisdiction.code,
              issueLabel: issueTag.label,
              note: note ?? null,
            })
          }
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
