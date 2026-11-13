# 05 — LegiScan API: what the vendor docs say

> **Status: from vendor docs, not yet confirmed by a captured response.**
> This is input for task 05 Part B. It does not replace Part A: the capture
> (`npm run ingest:legiscan-capture`) still has to run against the live API
> before any mapping change. Where the docs and a capture disagree, the
> capture wins.

Researched 2026-11-12. No API key was used; nothing here came from a live
response.

## Sources

| Ref | Source | Notes |
|-----|--------|-------|
| **[M]** | LegiScan API User Manual, <https://api.legiscan.com/dl/LegiScan_API_User_Manual.pdf> | 43 pages, PDF metadata dated 2025-06-05. Page numbers below are PDF pages. |
| **[C]** | LegiScan API Client 1.4.1, <https://api.legiscan.com/dl/legiscan-1.4.1.tar.gz> | Official PHP client, linked from the manual (p.5) and from <https://api.legiscan.com/dl/>. `legiscan-current.tar.gz` is byte-identical (same SHA-256). ChangeLog top entry is 2022-01-14. |

<https://legiscan.com/gaits/documentation/legiscan> returned HTTP 403 to an
automated fetch, so it was not read.

## 1. `getMasterList` bill rows

Request forms ([M] p.9):

```
https://api.legiscan.com/?key=APIKEY&op=getMasterList&id=SESSION_ID
https://api.legiscan.com/?key=APIKEY&op=getMasterList&state=STATE   ("current" session; "use with caution")
```

The manual's example row ([M] p.9, quoted as printed):

```json
"0": {
   "bill_id": 1132030,
   "number": "AB1",
   "change_hash": "d72444d8f2026219e38cb2179dcc67a0",
   "url": "https://legiscan.com/CA/bill/AB1/2019",
   "status_date": "2018-12-03",
   "status": "1",
   "last_action_date": "2018-12-04",
   "last_action": "From printer. May be heard in committee January 3.",
   "title": "Youth athletics: California Youth Football Act.",
   "description": "An act to add Article 2.7 to the Health and Safety"
}
```

Documented row fields: `bill_id`, `number`, `change_hash`, `url`,
`status_date`, `status`, `last_action_date`, `last_action`, `title`,
`description`.

- **No `state` or `state_id` field on rows.** Neither example row has one.
  The manual has no data-dictionary entry for master-list rows. The only
  dictionary that lists `state` / `state_id` is `bill - getBill` ([M] p.34),
  which is the full bill detail payload, not the master list. The getBill
  example has `"state": "MD"` and `"state_id": 20` ([M] p.12).
- **Contrast:** operations whose rows can span several states do include
  `state`. `getSearch` rows ([M] p.21) have `"state": "IN"`, and
  `getMonitorList` / `getMonitorListRaw` rows ([M] pp.31–32) have
  `"state": "CA"`, **for the same bill (`bill_id` 1132030, AB1) that the
  getMasterList example shows without it**. The manual therefore puts
  `state` on multi-state lists and leaves it off the per-session master
  list. The hand-written fixture rows in `legiscan.test.ts` look like
  monitor-list rows.
- The row `url` does carry the state abbreviation in its path
  (`legiscan.com/CA/bill/...`). That is a URL convention, not a documented
  field.
- `status` is a **string** in the master-list example (`"1"`) and an integer
  in `getBill` ([M] p.11, p.34). `state.ts` already handles both.

`getMasterListRaw` ([M] p.10) returns only `bill_id`, `number`,
`change_hash` per row.

## 2. The `session` object

### Inside `getMasterList`

The manual's `getMasterList` example ([M] p.9) **does not show a `session`
entry** in `masterlist`. It starts at `"0"`.

The official client does expect one. `LegiScan::processMasterList()` ([C]
`LegiScan.php` lines 2237–2247) removes the first `masterlist` element before
looping over bills:

```php
$session = array_shift($payload['masterlist']);

foreach ($payload['masterlist'] as $bill)
```

So the vendor's own client treats the first masterlist entry as session
metadata. It never reads any field from `$session`, so the client does not
tell us which fields that object has. **Whether `masterlist.session` carries
`state_id` is not documented anywhere. This is the main question Part A has
to answer.**

### Session objects elsewhere in the API

Every documented session object outside the master list includes a numeric
`state_id` and no two-letter abbreviation:

`getSessionList` ([M] p.8, quoted as printed, typographic quotes included):

```json
{
   "session_id": 1791,
   "state_id": 5,
   "year_start": 2021,
   "year_end": 2022,
   "prefile": 0,
   "sine_die": 0,
   "prior”: 0,
   "special": 0,
   "session_tag": "Regular Session",
   "session_title": "2021-2022 Regular Session",
   "session_name": "2021-2022 Session",
   "dataset_hash": "ead44c3c2a0055a7ecbc5c13ebd71f70"
}
```

`getBill` → `bill.session` ([M] pp.11–12):

```json
"session": {
   "session_id": 1636,
   "state_id": 20,
   "year_start": 2019,
   "year_end": 2019,
   "prefile": 0,
   "sine_die": 1,
   "prior": 1,
   "special": 0,
   "session_tag": "Regular Session",
   "session_title": "2019 Regular Session",
   "session_name": "2019 Regular Session"
}
```

`getSessionPeople` → `sessionpeople.session` ([M] p.28) also has
`"state_id": 5`.

The `session - getSessionList` data dictionary ([M] p.39) lists
`session_id`, `state_id`, `year_start`, `year_end`, `special`, `prefile`,
`prior`, `sine_die`, `session_name` ("State specific session name") and
`session_title` ("Normalized session title with year(s) and Regular/Nth
Special Session"). It does not list `session_tag`, although every example
includes it. The client schema stores it: `ls_session.session_tag
varchar(32) NOT NULL` ([C] `schema-pgsql.sql` line 426).

## 3. `session_tag` and the session labels

- Every `session_tag` value in the manual is **`"Regular Session"`**:
  getSessionList ×2 (p.8, sessions 1791 and 1624, which are different
  bienniums) and getBill (pp.11–12). It is a **label, not a year**, and the same
  value appears in different sessions of the same state.
- The year sits in `year_start` / `year_end` (integers) and in
  `session_title`.
- The label fields are not even consistent across operations. In
  `getDatasetList` ([M] p.25) `session_name` is `"2019-2020 Regular Session"`
  and `session_title` is `"Regular Session"`, the reverse of getSessionList.
  In `getSessionPeople` ([M] p.28) `session_name` is `"Regular Session"` and
  the long form is in a field called `name`.
- `session_id` is documented as the globally unique identifier for the
  session ([M] p.7, "Internal Identifiers": "Each data payload uses a unique
  positive integer value to globally identify the object").

Conclusion from the docs: the only stable, unique per-session value is
`session_id`. That matches task 05 step 7. No free-text label
(`session_tag`, `session_title`, `session_name`) should go into the
identifier.

## 4. `state_id` → two-letter code

The manual has no state table. Its Static Values section ([M] pp.40–43)
covers bill types, events, MIME types, parties, reasons, roles, SAST types,
sponsor types, stance, status, supplement types, text types and votes, but
not states.

The table is in the official client's schema: `ls_state` in
[C] `schema-pgsql.sql` lines 1049–1101 (same rows in `schema-mysql.sql`).
Source: <https://api.legiscan.com/dl/legiscan-1.4.1.tar.gz>.

| id | code | name | | id | code | name |
|---:|------|------|-|---:|------|------|
| 1 | AL | Alabama | | 27 | NE | Nebraska |
| 2 | AK | Alaska | | 28 | NV | Nevada |
| 3 | AZ | Arizona | | 29 | NH | New Hampshire |
| 4 | AR | Arkansas | | 30 | NJ | New Jersey |
| 5 | CA | California | | 31 | NM | New Mexico |
| 6 | CO | Colorado | | 32 | NY | New York |
| 7 | CT | Connecticut | | 33 | NC | North Carolina |
| 8 | DE | Delaware | | 34 | ND | North Dakota |
| 9 | FL | Florida | | 35 | OH | Ohio |
| 10 | GA | Georgia | | 36 | OK | Oklahoma |
| 11 | HI | Hawaii | | 37 | OR | Oregon |
| 12 | ID | Idaho | | 38 | PA | Pennsylvania |
| 13 | IL | Illinois | | 39 | RI | Rhode Island |
| 14 | IN | Indiana | | 40 | SC | South Carolina |
| 15 | IA | Iowa | | 41 | SD | South Dakota |
| 16 | KS | Kansas | | 42 | TN | Tennessee |
| 17 | KY | Kentucky | | 43 | TX | Texas |
| 18 | LA | Louisiana | | 44 | UT | Utah |
| 19 | ME | Maine | | 45 | VT | Vermont |
| 20 | MD | Maryland | | 46 | VA | Virginia |
| 21 | MA | Massachusetts | | 47 | WA | Washington |
| 22 | MI | Michigan | | 48 | WV | West Virginia |
| 23 | MN | Minnesota | | 49 | WI | Wisconsin |
| 24 | MS | Mississippi | | 50 | WY | Wyoming |
| 25 | MO | Missouri | | 51 | DC | Washington D.C. |
| 26 | MT | Montana | | 52 | US | US Congress |

The ids are alphabetical by state name for 1–50, then DC = 51 and US
Congress = 52. No territories are listed. The one manual example that pairs
a code with an id agrees with this table: the getBill payload has
`"state": "MD"` and `"state_id": 20` ([M] p.12).

For task 05 step 5 (`LEGISCAN_STATE_IDS`): ids 1–51 are the 50 states plus
DC. Id 52 (`US`) is Congress. The step's test expects 50 + DC, so 52 should
be left out or handled on purpose, since federal bills come from the
Congress.gov adapter.

## 5. What this means for the two suspected problems

| Suspicion (task 05) | Vendor docs | Still needs capture? |
|---|---|---|
| 1. `getMasterList` rows have no `state` field, so ingest by session id skips every row (`legiscan.ts:146-147`). | **Supported.** The documented rows have no `state` / `state_id` ([M] p.9), while search rows ([M] p.21) and monitor-list rows for the same bill ([M] pp.31–32) do. If that holds, `mapLegiScanMasterListBatches` skips every row when no `state` option is passed, which is exactly what the scheduled path does (`schedule.ts` passes only `id`). | Yes. The capture must confirm the row keys, and above all whether `masterlist.session` has `state_id` (undocumented, see §2). |
| 2. `session_tag` is a label like "Regular Session", not a year. | **Supported.** Every documented `session_tag` is `"Regular Session"` across different bienniums ([M] pp.8, 11–12). The year is in `year_start` / `year_end`. `session_id` is the unique key. | Yes, to confirm the value inside `masterlist.session`. The existing fallback to `session_name` is no better: in some operations that field is also just "Regular Session" (§3). |

The hand-written fixtures in `legiscan.test.ts` (`state: "CA"` on rows,
`session_tag: "20232024"`) match neither the documented row shape nor any
documented `session_tag` value.

## 6. Other doc facts relevant to Part B

- **Status codes 7–12 never appear in `status`.** The Status / Progress table
  ([M] p.42) marks 7 Override, 8 Chaptered, 9 Refer, 10 Report Pass,
  11 Report DNP and 12 Draft as "Progress array only". A master-list
  `status` is therefore 0–6, so `EFFECTIVE_CODES` (7, 8) in `state.ts` can
  never match a master-list row. Enacted bills will show as `PASSED` (4). Not
  in task 05's scope. Noted for a follow-up.
- Errors come back as `{"status":"ERROR","alert":{"message":"..."}}` ([M]
  p.6). The adapter already handles this.
- Keys, operations, state abbreviations and bill numbers are
  case-insensitive ([M] p.6).
- Public keys are limited to 30,000 queries per month ([M] p.5).
  `getMasterList` refreshes at most hourly, and getSessionList daily ([M]
  p.7). The capture script uses 1 query (`--session`) or 2 (`--state`).
- The manual suggests `getMasterListRaw` plus `change_hash` comparison as the
  update workflow ([M] p.6). The adapter ignores `change_hash`. Out of scope;
  noted only.
