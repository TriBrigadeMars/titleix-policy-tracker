import { NextResponse } from "next/server";
import { parseBillQuery } from "@/lib/bill-query";
import {
  formatInstrumentCsv,
  toExportPayload,
} from "@/lib/instrument-export";
import { getInstrumentExportRows } from "@/lib/queries";

export const dynamic = "force-dynamic";

const EXPORT_FORMATS: Record<string, true> = { csv: true, json: true };

function filename(extension: "csv" | "json", now: Date): string {
  return `titleix-instruments-${now.toISOString().slice(0, 10)}.${extension}`;
}

/**
 * Public dataset download.
 *
 * Same predicate as `/bills` (relevant instruments only) and the same filters.
 * `getInstrumentExportRows` caps the read at `MAX_EXPORT_ROWS`, so this never
 * issues an unbounded query; `truncated` says whether the cap cut the result.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "csv").trim().toLowerCase();

  if (EXPORT_FORMATS[format] !== true) {
    return NextResponse.json(
      { error: "format must be csv or json" },
      { status: 400 }
    );
  }

  const query = parseBillQuery(url.searchParams);
  const { instruments, total } = await getInstrumentExportRows(query);
  const truncated = total > instruments.length;
  const now = new Date();

  const headers = {
    "Cache-Control": "no-store",
    "X-Total-Count": String(total),
    "X-Result-Truncated": String(truncated),
  };

  if (format === "json") {
    return NextResponse.json(
      toExportPayload(instruments, now.toISOString(), truncated),
      {
        headers: {
          ...headers,
          "Content-Disposition": `attachment; filename="${filename("json", now)}"`,
        },
      }
    );
  }

  return new NextResponse(formatInstrumentCsv(instruments), {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename("csv", now)}"`,
    },
  });
}
