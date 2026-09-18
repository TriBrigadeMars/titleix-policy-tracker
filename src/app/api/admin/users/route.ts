import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { getUsers } from "@/lib/queries";
import { parseUserListQuery } from "@/lib/search-params";

export async function GET(request: Request) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = parseUserListQuery(url.searchParams);
  const users = await getUsers(query);

  return NextResponse.json(users);
}
