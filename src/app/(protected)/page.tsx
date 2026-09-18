import { auth } from "@/lib/auth";
import { DEFAULT_ROLE, hasRole } from "@/lib/roles";
import { Dashboard } from "@/components/dashboard";

export default async function Home() {
  const session = await auth();
  const role = session?.user?.role ?? DEFAULT_ROLE;

  return <Dashboard canEdit={hasRole(role, "EDITOR")} />;
}
