# Shade data schema

Single source of truth for how the four workstreams share data.

- `schema.sql`: Neon Postgres tables and enums
- `types.ts`: TypeScript types mirroring the tables and tool inputs/outputs
- `contracts.md`: who writes and reads what, shared tool signatures, conventions

Workstreams (plans in `docs/`):

| | Area | Plan |
|---|---|---|
| M1 | Frontend / ops dashboard | `docs/M1.md` |
| M2 | Scraper / web / data | `docs/M2.md` |
| M3 | Voice / inbound | `docs/M3.md` |
| M4 | Text / outbound | `docs/M4.md` |

Rule: build however you like inside your area, but anything that crosses a boundary goes through this schema. If you need a change, update `schema.sql` and `types.ts` together and tell the others.
