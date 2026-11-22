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
- `main.ts` — the harness driver. v9 is a 3-line shim: it sets the
  cold-tuned V8 flags, then dynamically imports `driver.js` (so the
  flags apply before the driver is compiled, and the ~0.12 s
  TypeScript transform is paid only for 3 lines, not the whole
  driver). `driver.js` parses each case's CSV text straight out of
  the raw `cases.json` bytes (a latin1 string scan: no `JSON.parse`
  of the file, no per-field JS strings, no `JSON.stringify` of the
  answers) and emits fields as string fragments joined per record;
  `solve.js` stays as the correctness oracle and the fallback for
  any case the byte path cannot take. A clean-record bulk path and
  a whole-case bulk transform were tried/analysed and rejected on
  measurement (see `driver.js` header). Local practice-set CPU:
  v8 0.617 s mean / 0.606 s median vs v9 0.563 s / 0.554 s
  (9 interleaved cold runs). Verified 6/6 practice cases with the
  kit scorer, 6/6 on a freshly generated instance from a different
  seed, and 12,000 differential fuzz inputs vs vendor `readCsv`
  with 0 mismatches.

## Bounty

[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
— $100 pot, top 10 get $10 each. Deadline: Mon 2026-11-23 09:42 WIB
(2026-11-23T02:42:00Z). Places go by CPU time on the scored set, least
first, among entries whose answers match `csv-reader` 1.0.0 on every case.

## License

MIT. See [LICENSE](LICENSE).
