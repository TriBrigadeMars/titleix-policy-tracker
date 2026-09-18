import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { DEFAULT_ROLE, isUserRole } from "./roles";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        // `role` comes from the Prisma User row via the adapter. Anything
        // unexpected (missing, or a value not in the enum) falls back to the
        // least-privileged role rather than failing open.
        session.user.role = isUserRole(user.role) ? user.role : DEFAULT_ROLE;
      }
      return session;
    },
  },
});
