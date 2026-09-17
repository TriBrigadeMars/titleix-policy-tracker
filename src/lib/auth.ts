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
        (session.user as { id: string; role: string }).id = user.id;
        (session.user as { id: string; role: string }).role =
          (user as { role: string }).role;
      }
      return session;
    },
  },
});
