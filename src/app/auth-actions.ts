"use server";

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { isLocalMode } from "@/lib/local-mode";

// Server actions stay callable by direct POST even when no button renders
// them, so the local-mode guard lives here and not only in the UI.

/**
 * End the current session. A no-op in local mode: the desktop shell keeps
 * sending the one session cookie it was given at boot, and deleting that
 * session row would drop the user to the public view until a restart.
 */
export async function signOutAction(): Promise<void> {
  if (isLocalMode()) {
    return;
  }
  await signOut({ redirectTo: "/sign-in" });
}

/**
 * Start Google sign-in. A no-op in local mode, where the shell provides the
 * session and Google OAuth is not configured.
 */
export async function signInWithGoogle(): Promise<void> {
  if (isLocalMode()) {
    return;
  }
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
    redirect("/sign-in?error=Configuration");
  }
  await signIn("google", { redirectTo: "/" });
}
