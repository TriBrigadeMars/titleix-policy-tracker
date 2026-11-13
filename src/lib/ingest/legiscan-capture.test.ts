import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FIXTURE_PATH,
  assertNoSecret,
  extractFindings,
  main,
  parseCaptureArgs,
  pickSession,
  runCapture,
  trimMasterList,
  type FetchJson,
} from "./legiscan-capture";

// ---------------------------------------------------------------------------
// MOCK DATA — hand-written for these unit tests only.
//
// This is NOT a captured LegiScan response and must never be copied into
// src/lib/ingest/__fixtures__/. Field names follow the LegiScan API User
// Manual examples so the extraction logic has something realistic to read,
// but the capture script exists precisely because nobody has confirmed the
// real shape yet. Values are fake.
// ---------------------------------------------------------------------------
const FAKE_KEY = "MOCKKEY0123456789abcdef";

const MOCK_SESSION_LIST = {
  status: "OK",
  sessions: [
    {
      session_id: 900,
      state_id: 8,
      year_start: 2023,
      year_end: 2024,
      special: 0,
      session_tag: "Regular Session",
      session_title: "2023-2024 Regular Session",
      session_name: "152nd General Assembly",
    },
    {
      session_id: 950,
      state_id: 8,
      year_start: 2025,
      year_end: 2026,
      special: 1,
      session_tag: "1st Special Session",
      session_title: "2025 1st Special Session",
      session_name: "153rd General Assembly Special",
    },
    {
      session_id: 940,
      state_id: 8,
      year_start: 2025,
      year_end: 2026,
      special: 0,
      session_tag: "Regular Session",
      session_title: "2025-2026 Regular Session",
      session_name: "153rd General Assembly",
    },
  ],
};

function mockRow(i: number) {
  return {
    bill_id: 1000 + i,
    number: `HB${i}`,
    change_hash: `mockhash${i}`,
    url: `https://legiscan.com/DE/bill/HB${i}/2025`,
    status_date: "2025-01-10",
    status: "1",
    last_action_date: "2025-01-10",
    last_action: "Mock action",
    title: `Mock bill ${i}`,
    description: `Mock description ${i}`,
  };
}

const MOCK_MASTER_LIST = {
  status: "OK",
  masterlist: {
    session: {
      session_id: 940,
      state_id: 8,
      year_start: 2025,
      year_end: 2026,
      prefile: 0,
      sine_die: 0,
      prior: 0,
      special: 0,
      session_tag: "Regular Session",
      session_title: "2025-2026 Regular Session",
      session_name: "153rd General Assembly",
    },
    "0": mockRow(0),
    "1": mockRow(1),
    "2": mockRow(2),
    "3": mockRow(3),
    "4": mockRow(4),
  },
};

function mockFetch(responses: Record<string, unknown>) {
  const urls: URL[] = [];
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    const op = url.searchParams.get("op") ?? "";
    if (!(op in responses)) throw new Error(`unexpected op ${op}`);
    return structuredClone(responses[op]);
  };
  return { fetchJson, urls };
}

function harness(
  argv: string[],
  responses: Record<string, unknown> = {
    getSessionList: MOCK_SESSION_LIST,
    getMasterList: MOCK_MASTER_LIST,
  },
  env: Record<string, string | undefined> = { LEGISCAN_API_KEY: FAKE_KEY }
) {
  const { fetchJson, urls } = mockFetch(responses);
  const output: string[] = [];
  const writes: { path: string; contents: string }[] = [];
  const deps = {
    env,
    argv,
    fetchJson,
    writeFile: vi.fn(async (path: string, contents: string) => {
      writes.push({ path, contents });
    }),
    log: (line: string) => output.push(line),
    error: (line: string) => output.push(line),
  };
  return { deps, urls, output, writes };
}

describe("runCapture (mocked HTTP)", () => {
  it("picks the most recent regular session for --state and fetches its master list", async () => {
    const h = harness(["--state", "de"]);
    await runCapture(h.deps);

    expect(h.urls.map((u) => u.searchParams.get("op"))).toEqual([
      "getSessionList",
      "getMasterList",
    ]);
    expect(h.urls[0].searchParams.get("state")).toBe("DE");
    // 950 is newer but special; 940 is the most recent regular session.
    expect(h.urls[1].searchParams.get("id")).toBe("940");
    // The key does go to the API...
    expect(h.urls[1].searchParams.get("key")).toBe(FAKE_KEY);
    // ...and the choice is printed.
    expect(h.output.join("\n")).toContain("Chose session_id 940");
  });

  it("uses --session directly with a single request", async () => {
    const h = harness(["--session", "2172"]);
    await runCapture(h.deps);
    expect(h.urls).toHaveLength(1);
    expect(h.urls[0].searchParams.get("op")).toBe("getMasterList");
    expect(h.urls[0].searchParams.get("id")).toBe("2172");
  });

  it("never prints the key or a key= fragment, and never writes it", async () => {
    const h = harness(["--state", "DE"]);
    await runCapture(h.deps);
    const printed = h.output.join("\n");
    expect(printed).not.toContain(FAKE_KEY);
    expect(printed).not.toMatch(/key=/i);
    expect(printed).not.toContain("api.legiscan.com");
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].contents).not.toContain(FAKE_KEY);
    expect(h.writes[0].contents).not.toMatch(/key=/i);
  });

  it("writes the session object plus exactly 3 rows to the default fixture path", async () => {
    const h = harness(["--session", "940"]);
    await runCapture(h.deps);
    expect(h.writes[0].path).toBe(DEFAULT_FIXTURE_PATH);
    const written = JSON.parse(h.writes[0].contents);
    expect(Object.keys(written.masterlist).sort()).toEqual([
      "0",
      "1",
      "2",
      "session",
    ]);
    expect(written.masterlist.session).toEqual(MOCK_MASTER_LIST.masterlist.session);
    expect(written.masterlist["0"]).toEqual(MOCK_MASTER_LIST.masterlist["0"]);
    expect(written.status).toBe("OK");
  });

  it("honours --out", async () => {
    const h = harness(["--session", "940", "--out", "elsewhere.json"]);
    await runCapture(h.deps);
    expect(h.writes[0].path).toBe("elsewhere.json");
  });

  it("refuses to write when the response itself contains the key", async () => {
    const leaky = structuredClone(MOCK_MASTER_LIST);
    (leaky.masterlist["0"] as Record<string, unknown>).description =
      `echoed ${FAKE_KEY}`;
    const h = harness(["--session", "940"], { getMasterList: leaky });
    await expect(runCapture(h.deps)).rejects.toThrow(/Refusing to write/);
    expect(h.deps.writeFile).not.toHaveBeenCalled();
  });

  it("redacts the key from a transport error that quotes the URL", async () => {
    const h = harness(["--session", "940"]);
    h.deps.fetchJson = async (url) => {
      throw new Error(`fetch failed for ${url.toString()}`);
    };
    const code = await main(h.deps);
    expect(code).toBe(1);
    const printed = h.output.join("\n");
    expect(printed).toContain("getMasterList request failed");
    expect(printed).not.toContain(FAKE_KEY);
    expect(printed).not.toMatch(/key=/i);
  });

  it("surfaces a LegiScan ERROR status with its alert message", async () => {
    const h = harness(["--session", "940"], {
      getMasterList: { status: "ERROR", alert: { message: "Unknown session id" } },
    });
    await expect(runCapture(h.deps)).rejects.toThrow(
      "LegiScan getMasterList returned an error: Unknown session id"
    );
  });
});

describe("missing or misplaced key", () => {
  it("exits 1 with a clear message and makes no request when LEGISCAN_API_KEY is unset", async () => {
    const h = harness(["--state", "DE"], undefined, {});
    const code = await main(h.deps);
    expect(code).toBe(1);
    expect(h.output.join("\n")).toMatch(/LEGISCAN_API_KEY is not set/);
    expect(h.urls).toHaveLength(0);
    expect(h.deps.writeFile).not.toHaveBeenCalled();
  });

  it("treats a blank LEGISCAN_API_KEY as unset", async () => {
    const h = harness(["--state", "DE"], undefined, { LEGISCAN_API_KEY: "  " });
    await expect(runCapture(h.deps)).rejects.toThrow(/LEGISCAN_API_KEY is not set/);
  });

  it("refuses a key passed on argv without echoing it", () => {
    for (const argv of [
      ["--key", "abc"],
      ["--api-key=abc"],
      ["--state", "DE", `key=${FAKE_KEY}`],
      ["--session", FAKE_KEY],
    ]) {
      let message = "";
      try {
        parseCaptureArgs(argv, FAKE_KEY);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/set LEGISCAN_API_KEY in the environment/);
      expect(message).not.toContain(FAKE_KEY);
    }
  });
});

describe("parseCaptureArgs", () => {
  it("requires exactly one of --state or --session", () => {
    expect(() => parseCaptureArgs([], FAKE_KEY)).toThrow(/exactly one/);
    expect(() =>
      parseCaptureArgs(["--state", "DE", "--session", "1"], FAKE_KEY)
    ).toThrow(/exactly one/);
  });

  it("validates the state code and session id", () => {
    expect(() => parseCaptureArgs(["--state", "Delaware"], FAKE_KEY)).toThrow(
      /two-letter/
    );
    expect(() => parseCaptureArgs(["--session", "abc"], FAKE_KEY)).toThrow(
      /positive integer/
    );
    expect(parseCaptureArgs(["--state=de"], FAKE_KEY)).toMatchObject({
      state: "DE",
    });
  });
});

describe("extractFindings (mock data)", () => {
  it("reports row keys, the session object, and where (if anywhere) the state is", () => {
    const findings = extractFindings(MOCK_MASTER_LIST);
    expect(findings.rowCount).toBe(5);
    expect(findings.sampleRowKey).toBe("0");
    expect(findings.sampleRowKeys).toEqual(Object.keys(mockRow(0)));
    expect(findings.session).toEqual(MOCK_MASTER_LIST.masterlist.session);
    expect(findings.rowStateFields).toEqual([]);
    expect(findings.rowTwoLetterValues).toEqual([]);
    expect(findings.rowUrlState).toBe("DE");
    expect(findings.sessionStateId).toBe(8);
    expect(findings.sessionStateFields).toEqual([{ field: "state_id", value: 8 }]);
    expect(findings.sessionTag).toBe("Regular Session");
    expect(findings.sessionTagLooksLikeYear).toBe(false);
  });

  it("detects a state field on rows and a year-shaped session_tag when present", () => {
    const body = {
      status: "OK",
      masterlist: {
        session: { session_id: 1, session_tag: "20232024" },
        "0": { ...mockRow(0), state: "CA" },
      },
    };
    const findings = extractFindings(body);
    expect(findings.rowStateFields).toEqual([{ field: "state", value: "CA" }]);
    expect(findings.rowTwoLetterValues).toEqual([{ field: "state", value: "CA" }]);
    expect(findings.sessionStateId).toBeNull();
    expect(findings.sessionTagLooksLikeYear).toBe(true);
  });

  it("handles a master list with no session key", () => {
    const findings = extractFindings({ status: "OK", masterlist: { "0": mockRow(0) } });
    expect(findings.session).toBeNull();
    expect(findings.sessionTag).toBeUndefined();
  });
});

describe("trimMasterList", () => {
  it("keeps status, session and the first 3 rows unchanged, adding nothing", () => {
    const trimmed = trimMasterList(MOCK_MASTER_LIST) as {
      status: string;
      masterlist: Record<string, unknown>;
    };
    expect(trimmed).toEqual({
      status: "OK",
      masterlist: {
        session: MOCK_MASTER_LIST.masterlist.session,
        "0": MOCK_MASTER_LIST.masterlist["0"],
        "1": MOCK_MASTER_LIST.masterlist["1"],
        "2": MOCK_MASTER_LIST.masterlist["2"],
      },
    });
  });
});

describe("pickSession", () => {
  it("falls back to the newest session when every session is special", () => {
    const { chosen } = pickSession({
      sessions: [
        { session_id: 1, year_start: 2020, year_end: 2020, special: 1 },
        { session_id: 2, year_start: 2024, year_end: 2024, special: 1 },
      ],
    });
    expect(chosen.session_id).toBe(2);
  });

  it("throws when there are no usable sessions", () => {
    expect(() => pickSession({ sessions: [] })).toThrow(/no sessions/);
  });
});

describe("assertNoSecret", () => {
  it("throws on the key or a key= fragment without echoing the key", () => {
    expect(() => assertNoSecret(`x ${FAKE_KEY} y`, FAKE_KEY)).toThrow(
      /contains the LegiScan API key/
    );
    expect(() => assertNoSecret("https://x/?KEY=abc", FAKE_KEY)).toThrow(/key=/);
    expect(() => assertNoSecret('{"ok": true}', FAKE_KEY)).not.toThrow();
  });
});
