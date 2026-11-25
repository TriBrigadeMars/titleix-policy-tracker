import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container mx-auto py-16 px-4">
      <h1 className="text-3xl font-bold mb-2">Not found</h1>
      <p className="text-muted-foreground mb-6">
        That page does not exist, or the instrument has not been published to
        the public tracker.
      </p>
      <ul className="space-y-2 text-sm">
        <li>
          <Link href="/bills" className="underline underline-offset-4">
            Browse all published bills and regulations
          </Link>
        </li>
        <li>
          <Link href="/" className="underline underline-offset-4">
            Go to the comparison matrix
          </Link>
        </li>
        <li>
          <Link href="/heatmap" className="underline underline-offset-4">
            View the national heatmap
          </Link>
        </li>
      </ul>
    </main>
  );
}
