import { DefaultSession } from "next-auth";

type UserRole = "READER" | "EDITOR" | "ADMIN";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role?: UserRole;
  }
}
