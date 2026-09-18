import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That account is not permitted to sign in.",
  Configuration: "Sign-in is misconfigured. Contact an administrator.",
  Verification: "That sign-in link has expired. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { error } = await searchParams;

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Title IX Policy Tracker requires an account to view tracking data.
            Sign in with your Google account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again."}
            </p>
          )}

          <form action={signInWithGoogle}>
            <Button type="submit" className="w-full">
              Continue with Google
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">
            New accounts start with read-only access. Editor and admin roles are
            granted by an administrator.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}