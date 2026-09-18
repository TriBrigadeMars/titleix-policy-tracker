"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { JurisdictionSelector } from "@/components/jurisdiction-selector";
import { ComparisonMatrix } from "@/components/comparison-matrix";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CellNote, Instrument, IssueTag, Jurisdiction } from "@/types";

/**
 * Client half of the dashboard. Selection is mirrored into `?j=` so the server
 * page can load comparison data. `canEdit` only decides whether edit
 * affordances render; the API guard authorizes writes.
 */
export function Dashboard({
  canEdit,
  jurisdictions,
  selectedCodes,
  issueTags,
  instruments,
  cellNotes,
}: {
  canEdit: boolean;
  jurisdictions: Jurisdiction[];
  selectedCodes: string[];
  issueTags: IssueTag[];
  instruments: Instrument[];
  cellNotes: CellNote[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState(selectedCodes);

  useEffect(() => {
    setSelected(selectedCodes);
  }, [selectedCodes]);

  function onChange(codes: string[]) {
    setSelected(codes);
    startTransition(() => {
      router.replace(codes.length > 0 ? `/?j=${codes.join(",")}` : "/");
    });
  }

  const selectedJurisdictions = selected
    .map((code) => jurisdictions.find((j) => j.code === code))
    .filter((j): j is Jurisdiction => j != null);

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
            jurisdictions={jurisdictions}
            selected={selected}
            onChange={onChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comparison Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <ComparisonMatrix
            jurisdictions={selectedJurisdictions}
            issueTags={issueTags}
            instruments={instruments}
            cellNotes={cellNotes}
            canEdit={canEdit}
            isPending={isPending}
          />
        </CardContent>
      </Card>
    </main>
  );
}
