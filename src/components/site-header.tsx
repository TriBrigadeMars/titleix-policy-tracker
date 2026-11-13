import Link from "next/link";
import { signOutAction } from "@/app/auth-actions";
import { auth } from "@/lib/auth";
import { isLocalMode } from "@/lib/local-mode";
import { hasRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export async function SiteHeader() {
  const session = await auth();
  const isEditor = session?.user?.role ? hasRole(session.user.role, "EDITOR") : false;
  const isAdmin = session?.user?.role ? hasRole(session.user.role, "ADMIN") : false;
  const localMode = isLocalMode();

  return (
    <header className="border-b">
      <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold text-lg tracking-tight">
            Title IX Policy Tracker
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Comparison
            </Link>
            <Link
              href="/heatmap"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Heatmap
            </Link>
            {/* Only linked when authorized: these routes redirect signed-out
                visitors to sign-in, so showing them would be misleading. */}
            {isEditor && (
              <Link
                href="/triage"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Triage
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Admin
              </Link>
            )}
          </nav>
        </div>

        {localMode ? (
          // The desktop shell owns the session in local mode: there is one
          // user and no way back in after signing out, so offer neither.
          <div className="flex items-center gap-3">
            {session?.user && (
              <span className="text-sm text-muted-foreground">
                {session.user.name ?? session.user.email}
              </span>
            )}
            <Badge variant="outline">Local mode</Badge>
          </div>
        ) : session?.user ? (
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
        ) : (
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}