import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        (session.user as unknown as Record<string, unknown>).id = user.id;
        (session.user as unknown as Record<string, unknown>).role =
          (user as unknown as Record<string, unknown>).role;
      }
      return session;
    },
  },
});
