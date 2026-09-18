import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminUserTable } from "@/components/admin-user-table";
import { getUsers } from "@/lib/queries";
import { hasRole } from "@/lib/roles";
import { parseUserListQuery } from "@/lib/search-params";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    role?: string;
    limit?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    redirect("/");
  }

  const params = await searchParams;
  const urlParams = new URLSearchParams();
  if (params.search) urlParams.set("search", params.search);
  if (params.role) urlParams.set("role", params.role);
  if (params.limit) urlParams.set("limit", params.limit);

  const filters = parseUserListQuery(urlParams);
  const users = await getUsers(filters);

  return (
    <AdminUserTable
      users={users}
      currentUserId={session.user.id}
      filters={filters}
    />
  );
}
