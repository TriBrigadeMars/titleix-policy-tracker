import { AdminUserTable } from "@/components/admin-user-table";
import { getUsers } from "@/lib/queries";
import { requirePageRole } from "@/lib/auth-guards";
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
  const session = await requirePageRole("ADMIN");

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
