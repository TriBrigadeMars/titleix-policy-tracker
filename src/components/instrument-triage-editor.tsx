"use client";

import { useCallback, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeFetchError } from "@/lib/fetch-error";
import { formatDate } from "@/lib/format-date";
import { INSTRUMENT_NOTE_MAX_LENGTH } from "@/lib/validation";
import type { Instrument, InstrumentNote, IssueTag } from "@/types";

interface InstrumentTriageEditorProps {
  instrument: Instrument;
  issueTags: IssueTag[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: (updated: Instrument) => void;
}

export function InstrumentTriageEditor({
  instrument,
  issueTags,
  isOpen,
  onClose,
  onSaved,
}: InstrumentTriageEditorProps) {
  const [isRelevant, setIsRelevant] = useState(instrument.isTitleIXRelevant);
  const [confidence, setConfidence] = useState<number | "">(
    instrument.relevanceConfidence ?? ""
  );
  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(instrument.issueTags.map((t) => t.issueTag.id))
  );
  const [notes, setNotes] = useState<InstrumentNote[]>(
    instrument.notes ?? []
  );

  const [newNoteBody, setNewNoteBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  /**
   * Build the instrument payload reflecting the in-progress edits (relevance,
   * confidence, tags) plus the supplied notes. Extracted because save, add-note,
   * and delete-note all need to push the same parent state upstream.
   */
  const deriveUpdatedInstrument = useCallback(
    (nextNotes: InstrumentNote[]): Instrument => ({
      ...instrument,
      isTitleIXRelevant: isRelevant,
      relevanceConfidence: confidence === "" ? null : Number(confidence),
      issueTags: issueTags
        .filter((tag) => selectedTags.has(tag.id))
        .map((tag) => ({ issueTag: tag })),
      notes: nextNotes,
    }),
    [instrument, isRelevant, confidence, issueTags, selectedTags]
  );

  function toggleTag(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleSaveTriage() {
    setIsSaving(true);
    setError(null);

    const relevanceConfidence =
      confidence === "" ? null : Number(confidence);

    try {
      const response = await fetch(`/api/instruments/${instrument.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isTitleIXRelevant: isRelevant,
          relevanceConfidence,
          issueTagIds: Array.from(selectedTags),
        }),
      });

      if (!response.ok) {
        setError(await describeFetchError(response));
        return;
      }

      const updated: Instrument = await response.json();
      // Keep notes in sync
      updated.notes = notes;
      onSaved(updated);
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddNote() {
    if (!newNoteBody.trim()) return;
    setIsAddingNote(true);
    setNoteError(null);

    try {
      const response = await fetch("/api/instrument-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrumentId: instrument.id,
          body: newNoteBody.trim(),
        }),
      });

      if (!response.ok) {
        setNoteError(await describeFetchError(response));
        return;
      }

      const createdNote: InstrumentNote = await response.json();
      const updatedNotes = [createdNote, ...notes];
      setNotes(updatedNotes);
      setNewNoteBody("");

      // Update parent instrument state with new notes
      onSaved(deriveUpdatedInstrument(updatedNotes));
    } catch {
      setNoteError("Could not reach the server.");
    } finally {
      setIsAddingNote(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    setDeletingNoteId(noteId);
    setNoteError(null);

    try {
      const response = await fetch(`/api/instrument-notes?id=${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 404) {
        setNoteError(await describeFetchError(response));
        return;
      }

      const updatedNotes = notes.filter((n) => n.id !== noteId);
      setNotes(updatedNotes);

      onSaved(deriveUpdatedInstrument(updatedNotes));
    } catch {
      setNoteError("Could not reach the server.");
    } finally {
      setDeletingNoteId(null);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{instrument.jurisdiction.code}</Badge>
            <Badge variant="secondary">{instrument.status}</Badge>
            <span className="font-mono text-sm font-semibold">
              {instrument.identifier}
            </span>
          </div>
          <DialogTitle className="text-xl mt-1">{instrument.title}</DialogTitle>
          <DialogDescription>
            {instrument.sourceUrl && (
              <a
                href={instrument.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs mt-1"
              >
                Official Source <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </DialogDescription>
        </DialogHeader>

        {instrument.rawSummary && (
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap">
            <span className="font-semibold text-foreground block mb-1">
              Raw Summary:
            </span>
            {instrument.rawSummary}
          </div>
        )}

        <div className="space-y-6 py-2">
          {/* Title IX Relevance & Confidence */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border rounded-md p-4 bg-card">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Title IX Relevance</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={isRelevant ? "default" : "outline"}
                  onClick={() => setIsRelevant(true)}
                  className={isRelevant ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                >
                  Relevant
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!isRelevant ? "default" : "outline"}
                  onClick={() => setIsRelevant(false)}
                  className={!isRelevant ? "bg-zinc-700 hover:bg-zinc-800" : ""}
                >
                  Not Relevant
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Determines if this instrument appears in Title IX comparison views.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confidence-input" className="text-sm font-semibold">
                Confidence (0-100%)
              </Label>
              <div className="flex items-center gap-2">
                <input
                  id="confidence-input"
                  type="number"
                  min="0"
                  max="100"
                  value={confidence}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") setConfidence("");
                    else {
                      const num = Math.min(100, Math.max(0, parseInt(val, 10) || 0));
                      setConfidence(num);
                    }
                  }}
                  className="flex h-9 w-24 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="e.g. 90"
                />
                <div className="flex gap-1">
                  {[100, 80, 50].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setConfidence(preset)}
                    >
                      {preset}%
                    </Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Editorial certainty in the relevance determination.
              </p>
            </div>
          </div>

          {/* Issue Tags */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Applicable Issue Tags</Label>
            <p className="text-xs text-muted-foreground">
              Select all matrix issue categories that this instrument impacts:
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {issueTags.map((tag) => {
                const checked = selectedTags.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      checked
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-input hover:bg-muted"
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive font-medium">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveTriage}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Triage Status"}
            </Button>
          </div>

          {/* Instrument Notes Section */}
          <div className="pt-4 border-t space-y-4">
            <div>
              <h4 className="text-sm font-semibold">Instrument Notes & Editorial Log</h4>
              <p className="text-xs text-muted-foreground">
                Triage rationales, verification observations, or research notes.
              </p>
            </div>

            {noteError && (
              <div className="text-xs text-destructive font-medium">{noteError}</div>
            )}

            <div className="space-y-2">
              <Textarea
                placeholder="Add an editorial note about this instrument..."
                value={newNoteBody}
                onChange={(e) => setNewNoteBody(e.target.value)}
                maxLength={INSTRUMENT_NOTE_MAX_LENGTH}
                rows={3}
                className="text-sm"
              />
              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span>
                  {newNoteBody.length} / {INSTRUMENT_NOTE_MAX_LENGTH}
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddNote}
                  disabled={!newNoteBody.trim() || isAddingNote}
                  className="h-8 gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {isAddingNote ? "Adding..." : "Add Note"}
                </Button>
              </div>
            </div>

            {notes.length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="p-3 border rounded-md bg-muted/40 text-xs space-y-1 relative group"
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-foreground">
                        {note.author.name ?? "An editor"}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {formatDate(note.createdAt)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteNote(note.id)}
                          disabled={deletingNoteId === note.id}
                          aria-label="Delete note"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="whitespace-pre-wrap text-foreground">
                      {note.body}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No notes logged for this instrument yet.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
