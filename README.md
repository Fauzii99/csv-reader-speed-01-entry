[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Fauzii99/csv-reader-speed-01-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Fauzii99/csv-reader-speed-01-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-entry

A faster drop-in for make.fun's own `csv-reader` 1.0.0: `solve.js` answers
exactly as `csv-reader` does on every case (`{columns, rows, errors}` for
`{text, header}`), including all of its broken-CSV quirks (BOM, stray CR,
unterminated quotes, quote junk, short/long rows) — but much faster.

- `solve.js` — ES module, exports `run(input)`. Pure JavaScript, no
  dependencies, no WebAssembly, no native addons.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json`. Keeps V8's incremental
  marking off, as the house baseline does.

## Bounty

[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
— $100 pot, top 10 get $10 each. Deadline: Mon 2026-11-23 09:42 WIB
(2026-11-23T02:42:00Z). Places go by CPU time on the scored set, least
first, among entries whose answers match `csv-reader` 1.0.0 on every case.

## License

MIT. See [LICENSE](LICENSE).
