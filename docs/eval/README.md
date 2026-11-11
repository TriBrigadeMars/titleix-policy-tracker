# Evaluation artifacts (Phase 0 baseline)

This folder holds **machine-generated** census output from `npm run db:census` (see [PRODUCT-BASELINE.md](../PRODUCT-BASELINE.md)).

| File | Meaning |
|------|--------|
| [census-seeded.md](./census-seeded.md) | Postgres after `prisma migrate deploy` + `npm run db:seed` (52 jurisdictions, 8 issue tags). Captured against `127.0.0.1:54330/titleix_test` on 2026-11-06. |
| [census-empty.md](./census-empty.md) | Postgres after `prisma migrate deploy` only—no seed (0 jurisdictions, 0 issue tags). Captured against `127.0.0.1:54331/titleix_empty` on 2026-11-06. |

**Heatmap interpretation**: With **0** RELEVANT instruments everywhere, every state tile shows the cool gray zero color (`state-heatmap.tsx` → `heatColor(0, …)`). The census “distinct issue tags on RELEVANT instruments” stays 0 until editors or ingest create triaged, tagged rows.

Regenerate (example):

```bash
export DATABASE_URL="postgresql://USER:PASS@localhost:5432/DB"
npx prisma migrate deploy
npm run db:seed   # omit for empty catalog counts
npm run db:census > docs/eval/census-seeded.md
```
