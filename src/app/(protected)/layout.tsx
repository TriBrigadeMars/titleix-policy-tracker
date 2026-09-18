import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Route-group layout for everything that requires a signed-in user.
 *
 * This is the authoritative gate for page rendering. The edge middleware in
 * `src/middleware.ts` only does a fast cookie-presence check; this layout
 * validates the actual session against the database.
 */
export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  if (!session?.user) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}