import Link from "next/link";

/**
 * Shown on the anonymously readable pages (`/`, `/heatmap`) when there is no
 * session, so signed-out visitors know the tracker is public but read-only.
 */
export function PublicReadOnlyNote() {
  return (
    <div className="container mx-auto px-4 pt-8">
      <p className="rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground">
        You are viewing the public read-only tracker.{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>{" "}
        to triage instruments or edit comparison notes.
      </p>
    </div>
  );
}
