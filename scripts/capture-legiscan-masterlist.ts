/**
 * Hardening task 05, Part A: capture one real LegiScan getMasterList response.
 *
 * The API key comes from the environment only. Set it without leaving it in
 * shell history, then run:
 *
 *   bash/zsh:  read -rs LEGISCAN_API_KEY && export LEGISCAN_API_KEY
 *   fish:      read -s -x LEGISCAN_API_KEY
 *
 *   npm run ingest:legiscan-capture -- --state DE
 *   npm run ingest:legiscan-capture -- --session <session_id>
 *
 * Prints the Part A findings (row keys, full session object, whether any field
 * gives the two-letter state, what session_tag holds) and writes a trimmed
 * fixture (session + 3 rows) to src/lib/ingest/__fixtures__/legiscan-masterlist.json.
 * The request URL is never printed, and the fixture is refused if it contains
 * the key. Uses 1 query with --session, 2 with --state.
 */
import { main } from "@/lib/ingest/legiscan-capture";

main({ env: process.env, argv: process.argv.slice(2) }).then((code) => {
  process.exitCode = code;
});
