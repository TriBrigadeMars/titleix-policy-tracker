import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export async function SiteHeader() {
  const session = await auth();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <header className="border-b">
      <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-semibold">
          Title IX Policy Tracker
        </Link>

        {session?.user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {session.user.name ?? session.user.email}
            </span>
            <Badge variant="outline">{session.user.role}</Badge>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}