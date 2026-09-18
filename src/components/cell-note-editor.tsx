"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeFetchError } from "@/lib/fetch-error";
import { formatDate } from "@/lib/format-date";
import { CELL_NOTE_MAX_LENGTH } from "@/lib/validation";
import type { CellNote } from "@/types";

export interface CellNoteTarget {
  jurisdictionId: string;
  issueTagId: string;
  jurisdictionLabel: string;
  issueLabel: string;
  note: CellNote | null;
}

interface CellNoteEditorProps {
  target: CellNoteTarget;
  onClose: () => void;
  onSaved: (note: CellNote) => void;
  onDeleted: (id: string) => void;
}

/**
 * Cell-note specific wording for shared fetch-error translation.
 */
function describeNoteError(response: Response): Promise<string> {
  return describeFetchError(response, {
    forbidden: "Your role does not allow editing notes.",
    notFound: "That note no longer exists.",
    fallback: "Something went wrong. Try again.",
  });
}

/**
 * Editor dialog for a single (jurisdiction, issue tag) cell note.
 *
 * Callers should pass a `key` that identifies the cell, so switching cells
 * remounts the component and re-seeds the textarea from the new note rather
 * than needing a reset effect.
 */
export function CellNoteEditor({
  target,
  onClose,
  onSaved,
  onDeleted,
}: CellNoteEditorProps) {
  const existing = target.note;
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = body.trim().length > 0 && !busy;

  async function handleSave() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/cell-notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jurisdictionId: target.jurisdictionId,
          issueTagId: target.issueTagId,
          body,
        }),
      });

      if (!response.ok) {
              setError(await describeNoteError(response));
        return;
      }

      onSaved(await response.json());
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/cell-notes?id=${encodeURIComponent(existing.id)}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
              setError(await describeNoteError(response));
        return;
      }

      onDeleted(existing.id);
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit note" : "Add note"}</DialogTitle>
          <DialogDescription>
            {target.issueLabel} in {target.jurisdictionLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="cell-note-body">Note</Label>
          <Textarea
            id="cell-note-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            maxLength={CELL_NOTE_MAX_LENGTH}
            disabled={busy}
            placeholder="What does this jurisdiction's law say on this issue?"
          />
          <div className="text-right text-xs text-muted-foreground">
            {body.length} / {CELL_NOTE_MAX_LENGTH}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {existing && (
            <p className="text-xs text-muted-foreground">
              Originally written by {existing.author.name ?? "an editor"}
              {existing.updatedAt &&
                ` - last edited ${formatDate(existing.updatedAt)}`}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {existing ? (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={busy}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canSave}>
              {busy ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
