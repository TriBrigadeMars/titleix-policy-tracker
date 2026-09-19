"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HeatmapSummary } from "@/types";

/**
 * Grid positions for a tile-based US map.
 * Each state code maps to { row, col } in a 12-column × 8-row grid.
 * Federal (US) goes in the top-left corner.
 */
const STATE_GRID_POSITIONS: Record<string, { row: number; col: number }> = {
  US: { row: 0, col: 0 },
  AK: { row: 0, col: 1 },
  ME: { row: 0, col: 11 },
  WI: { row: 1, col: 6 },
  VT: { row: 1, col: 10 },
  NH: { row: 1, col: 11 },
  WA: { row: 2, col: 1 },
  ID: { row: 2, col: 2 },
  MT: { row: 2, col: 3 },
  ND: { row: 2, col: 4 },
  MN: { row: 2, col: 5 },
  IL: { row: 2, col: 6 },
  MI: { row: 2, col: 7 },
  NY: { row: 2, col: 9 },
  MA: { row: 2, col: 10 },
  CT: { row: 2, col: 11 },
  OR: { row: 3, col: 1 },
  NV: { row: 3, col: 2 },
  WY: { row: 3, col: 3 },
  SD: { row: 3, col: 4 },
  IA: { row: 3, col: 5 },
  IN: { row: 3, col: 6 },
  OH: { row: 3, col: 7 },
  PA: { row: 3, col: 8 },
  NJ: { row: 3, col: 9 },
  RI: { row: 3, col: 10 },
  CA: { row: 4, col: 1 },
  UT: { row: 4, col: 2 },
  CO: { row: 4, col: 3 },
  NE: { row: 4, col: 4 },
  MO: { row: 4, col: 5 },
  KY: { row: 4, col: 6 },
  WV: { row: 4, col: 7 },
  VA: { row: 4, col: 8 },
  MD: { row: 4, col: 9 },
  DE: { row: 4, col: 10 },
  AZ: { row: 5, col: 2 },
  NM: { row: 5, col: 3 },
  KS: { row: 5, col: 4 },
  AR: { row: 5, col: 5 },
  TN: { row: 5, col: 6 },
  NC: { row: 5, col: 7 },
  SC: { row: 5, col: 8 },
  DC: { row: 5, col: 9 },
  OK: { row: 6, col: 4 },
  LA: { row: 6, col: 5 },
  MS: { row: 6, col: 6 },
  AL: { row: 6, col: 7 },
  GA: { row: 6, col: 8 },
  HI: { row: 7, col: 1 },
  TX: { row: 7, col: 4 },
  FL: { row: 7, col: 9 },
};

/** Maximum number of grid columns in the layout */
const GRID_COLS = 12;
/** Maximum number of grid rows in the layout */
const GRID_ROWS = 8;

/**
 * Returns an HSL background color that interpolates from cool gray (0 count)
 * through warm amber to red (high count).
 */
function heatColor(count: number, maxCount: number): string {
  if (count === 0) return "hsl(220, 10%, 94%)";
  // Normalize to 0..1, clamped
  const t = Math.min(count / Math.max(maxCount, 1), 1);
  // Hue: 45 (amber) → 0 (red) as intensity increases
  const hue = 45 - t * 45;
  // Saturation: 55% → 85%
  const sat = 55 + t * 30;
  // Lightness: 75% → 45%
  const light = 75 - t * 30;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function tileTextColor(count: number, maxCount: number): string {
  if (count === 0) return "hsl(220, 10%, 40%)";
  const t = Math.min(count / Math.max(maxCount, 1), 1);
  return t > 0.5 ? "hsl(0, 0%, 100%)" : "hsl(0, 0%, 15%)";
}

interface StateTileProps {
  summary: HeatmapSummary;
  maxCount: number;
  onHover: (summary: HeatmapSummary | null) => void;
}

function StateTile({ summary, maxCount, onHover }: StateTileProps) {
  const pos = STATE_GRID_POSITIONS[summary.jurisdiction.code];
  if (!pos) return null;

  const bg = heatColor(summary.relevantCount, maxCount);
  const fg = tileTextColor(summary.relevantCount, maxCount);
  const isFederal = summary.jurisdiction.level === "FEDERAL";
  const compareUrl =
    summary.jurisdiction.code === "US"
      ? "/?j=US,CA"
      : `/?j=US,${summary.jurisdiction.code}`;

  return (
    <Link
      href={compareUrl}
      className="group block"
      style={{
        gridRow: pos.row + 1,
        gridColumn: pos.col + 1,
      }}
      onMouseEnter={() => onHover(summary)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(summary)}
      onBlur={() => onHover(null)}
    >
      <div
        className={`
          relative flex flex-col items-center justify-center
          rounded-md aspect-square p-1
          transition-all duration-200 ease-out
          group-hover:scale-110 group-hover:shadow-lg group-hover:z-10
          ${isFederal ? "ring-2 ring-primary/50" : ""}
        `}
        style={{ backgroundColor: bg, color: fg }}
      >
        <span className="text-xs font-bold leading-none">
          {summary.jurisdiction.code}
        </span>
        {summary.relevantCount > 0 && (
          <span className="text-[10px] leading-none mt-0.5 opacity-80">
            {summary.relevantCount}
          </span>
        )}
      </div>
    </Link>
  );
}

interface TooltipPanelProps {
  summary: HeatmapSummary | null;
}

function TooltipPanel({ summary }: TooltipPanelProps) {
  if (!summary) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Hover over a state to see details
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="font-semibold text-sm">
        {summary.jurisdiction.name}
        {summary.jurisdiction.level === "FEDERAL" && (
          <span className="ml-2 text-xs text-muted-foreground">(Federal)</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm">
        <div className="text-muted-foreground">Relevant instruments</div>
        <div className="font-medium">{summary.relevantCount}</div>
        <div className="text-muted-foreground">Pending (proposed)</div>
        <div className="font-medium">{summary.pendingCount}</div>
        <div className="text-muted-foreground">Issue areas covered</div>
                <div className="font-medium">
                  {summary.issueTagCount} of {summary.totalIssueTags}
                </div>
        <div className="text-muted-foreground">Editor notes</div>
        <div className="font-medium">{summary.cellNoteCount}</div>
      </div>
    </div>
  );
}

interface LegendProps {
  maxCount: number;
}

function Legend({ maxCount }: LegendProps) {
  const steps = 5;
  const labels = Array.from({ length: steps + 1 }, (_, i) =>
    Math.round((maxCount * i) / steps)
  );

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>0</span>
      <div className="flex h-3 rounded-sm overflow-hidden">
        {labels.slice(0, -1).map((val, i) => (
          <div
            key={i}
            className="w-8 h-full"
            style={{ backgroundColor: heatColor(val, maxCount) }}
          />
        ))}
      </div>
      <span>{maxCount > 0 ? `${maxCount}+` : "0"}</span>
      <span className="ml-1">relevant instruments</span>
    </div>
  );
}

export function StateHeatmap({
  summaries,
}: {
  summaries: HeatmapSummary[];
}) {
  const [hovered, setHovered] = useState<HeatmapSummary | null>(null);

  const maxCount = useMemo(
    () => Math.max(...summaries.map((s) => s.relevantCount), 1),
    [summaries]
  );

  // Only render tiles that have a grid position
  const positioned = summaries.filter(
    (s) => STATE_GRID_POSITIONS[s.jurisdiction.code] != null
  );

  return (
    <main className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-2">National Heatmap</h1>
      <p className="text-muted-foreground mb-8">
        Title IX legislative activity across all 50 states and the federal
        government. Click any state to compare it with federal policy.
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent className="pt-6">
            <div
              className="grid gap-1 mx-auto"
              style={{
                gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
                maxWidth: "720px",
              }}
            >
              {positioned.map((summary) => (
                <StateTile
                  key={summary.jurisdictionId}
                  summary={summary}
                  maxCount={maxCount}
                  onHover={setHovered}
                />
              ))}
            </div>

            <div className="mt-6 flex justify-center">
              <Legend maxCount={maxCount} />
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">State Details</CardTitle>
          </CardHeader>
          <CardContent>
            <TooltipPanel summary={hovered} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
