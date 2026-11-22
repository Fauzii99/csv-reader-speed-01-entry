// csv-reader 1.0.0, the house entry, make.fun's own reference program: the harness runs `node /bot/main.ts` (node22). It reads every case from /input/cases.json (a JSON
// array of {id, input}), answers each one alone with run() from solve.js, and writes /output/answers.json: a JSON
// array of the answers, one per case and in the cases' order. An entry keeps this driver and replaces solve.js with a
// faster module whose run(input) returns the same answer for every input. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its work runs under it (the rules: the house
// baseline runs with --no-incremental-marking, and an entry may tune V8's flags too).
// --no-opt as well: the harness runs each entry once per timed round in a fresh container, so every timed run is cold,
// and TurboFan's compile of the parser (~0.12 s of CPU across several OSR rounds, measured) costs more than its code
// saves on a single pass; Maglev/Sparkplug code without it is faster cold (run() 0.33 s vs 0.47 s on the practice set).
// Independently re-measured total process CPU on the practice set, 7 runs: baseline 1.942 s mean vs v6.1 0.707 s mean.
// v7 flag matrix (full `node main.ts` process CPU, 7 cold runs each, v6.1 solve.js): --no-opt alone 0.712 s mean /
// 0.698 s median; TurboFan on 0.866 / 0.889 (worse); --jitless 0.842 / 0.830 (worse); --no-maglev 0.899 / 0.874
// (worse); adding --no-compilation-cache 0.657 / 0.652; --single-threaded 0.675 / 0.683; --max-semi-space-size=16
// 0.666 / 0.670; --max-old-space-size=512 0.669 / 0.662; all combined (this line) 0.661 / 0.644 — the best median.
// The 512 MB old-space cap keeps ~4x headroom over the live set (~120-150 MB on an 11.8 MB scored set), so it cannot
// OOM a legal run; --no-compilation-cache wins because a fresh container pays the cache write on every run.
setFlagsFromString('--no-incremental-marking --no-opt --no-compilation-cache --single-threaded --max-semi-space-size=16 --max-old-space-size=512');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];

// JIT warmup: one tiny parse before the real cases, so the parser's
// Sparkplug->Maglev tier-up and inline-cache warmup happen here (a few ms)
// instead of mid-way through the first real case. Measured in interleaved
// cold runs (15 each): without warmup 0.683 s mean / 0.671 s median, with
// warmup 0.667 / 0.658 — a small (~1-2%) but consistent win, and it cuts
// the worst case (max 0.849 s -> 0.704 s). The warmup's answer is discarded.
run({ text: 'a,b,c\n"x","y","z"\n1,2,3\r\n', header: true });

const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
