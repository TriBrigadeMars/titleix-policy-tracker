"use client";

import { useState, useEffect } from "react";
import { JurisdictionSelector } from "@/components/jurisdiction-selector";
import { ComparisonMatrix } from "@/components/comparison-matrix";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Jurisdiction } from "@/types";

/**
 * Client half of the dashboard. `canEdit` is resolved on the server from the
 * session and only decides whether edit affordances render; the API guard is
 * what actually authorizes a write.
 */
export function Dashboard({ canEdit }: { canEdit: boolean }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [jurisdictionCodes, setJurisdictionCodes] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    fetch("/api/jurisdictions")
      .then((res) => res.json())
      .then((data: Jurisdiction[]) => {
        const codes: Record<string, string> = {};
        data.forEach((j) => {
          codes[j.id] = j.code;
        });
        setJurisdictionCodes(codes);
      })
      .catch(console.error);
  }, []);

  return (
    <main className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-2">Title IX Policy Tracker</h1>
      <p className="text-muted-foreground mb-8">
        Compare proposed and passed laws impacting Title IX across
        jurisdictions.
      </p>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Select Jurisdictions to Compare</CardTitle>
        </CardHeader>
        <CardContent>
          <JurisdictionSelector
            selected={selectedIds}
            onChange={setSelectedIds}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comparison Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <ComparisonMatrix
            jurisdictionIds={selectedIds}
            jurisdictionCodes={jurisdictionCodes}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </main>
  );
}
