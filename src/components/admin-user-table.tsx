"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Filter, Search, Shield, ShieldAlert, ShieldCheck, User as UserIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import type { UserRole } from "@/lib/roles";
import type { UserListQuery } from "@/lib/search-params";
import type { UserSummary } from "@/types";

interface AdminUserTableProps {
  users: UserSummary[];
  currentUserId: string;
  filters: UserListQuery;
}

const ROLE_BADGES: Record<
  UserRole,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  ADMIN: { label: "Admin", variant: "default" },
  EDITOR: { label: "Editor", variant: "secondary" },
  READER: { label: "Reader", variant: "outline" },
};

export function AdminUserTable({
  users: initialUsers,
  currentUserId,
  filters,
}: AdminUserTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [users, setUsers] = useState(initialUsers);
  const [searchVal, setSearchVal] = useState(filters.search ?? "");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  function updateFilters(updates: Partial<UserListQuery>) {
    const next: UserListQuery = { ...filters, ...updates };
    const params = new URLSearchParams();

    if (next.search) params.set("search", next.search);
    if (next.role) params.set("role", next.role);
    if (next.limit && next.limit !== 50) params.set("limit", String(next.limit));

    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/admin?${qs}` : "/admin");
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateFilters({ search: searchVal.trim() || undefined });
  }

  function handleClearFilters() {
    setSearchVal("");
    startTransition(() => {
      router.replace("/admin");
    });
  }

  async function handleRoleChange(userId: string, newRole: UserRole) {
    setUpdatingUserId(userId);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update role (${res.status})`);
      }

      const updatedUser: UserSummary = await res.json();
      setUsers((prev) =>
        prev.map((u) => (u.id === updatedUser.id ? updatedUser : u))
      );
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setUpdatingUserId(null);
    }
  }

  const hasActiveFilters = Boolean(filters.search || filters.role);

  return (
    <main className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Administration</h1>
          <p className="text-muted-foreground mt-1">
            Manage user roles and permissions across Reader, Editor, and Admin tiers.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-md bg-destructive/15 p-4 text-destructive text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setErrorMessage(null)}
            className="h-auto p-0 text-destructive hover:bg-transparent"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Filter Toolbar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filter Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
            <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search by name or email..."
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
                Search
              </Button>
            </form>

            <div className="flex items-center gap-2">
              <Select
                value={filters.role ?? "ALL"}
                onValueChange={(val) =>
                  updateFilters({
                    role: val === "ALL" ? undefined : (val as UserRole),
                  })
                }
              >
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Roles</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="READER">Reader</SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-9 text-muted-foreground"
                >
                  <X className="h-4 w-4 mr-1" /> Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Users ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Current Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Change Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-32 text-center text-muted-foreground"
                  >
                    No users found matching current filters.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const isCurrentUser = user.id === currentUserId;
                  const isUpdating = updatingUserId === user.id;
                  const badgeInfo = ROLE_BADGES[user.role] ?? {
                    label: user.role,
                    variant: "outline" as const,
                  };

                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs font-medium uppercase">
                            {user.name ? (
                              user.name.charAt(0)
                            ) : (
                              <UserIcon className="h-4 w-4" />
                            )}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-medium flex items-center gap-1.5">
                              {user.name ?? "Unnamed"}
                              {isCurrentUser && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">
                                  You
                                </Badge>
                              )}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {user.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeInfo.variant} className="gap-1">
                          {user.role === "ADMIN" && <ShieldAlert className="h-3 w-3" />}
                          {user.role === "EDITOR" && <ShieldCheck className="h-3 w-3" />}
                          {user.role === "READER" && <Shield className="h-3 w-3" />}
                          {badgeInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(user.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isCurrentUser ? (
                            <span className="text-xs text-muted-foreground italic">
                              Cannot demote self
                            </span>
                          ) : (
                            <Select
                              value={user.role}
                              disabled={isUpdating || isPending}
                              onValueChange={(val) =>
                                handleRoleChange(user.id, val as UserRole)
                              }
                            >
                              <SelectTrigger className="w-[120px] h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="end">
                                <SelectItem value="READER">Reader</SelectItem>
                                <SelectItem value="EDITOR">Editor</SelectItem>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
