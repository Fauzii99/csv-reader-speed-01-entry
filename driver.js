// csv-reader-speed-01-entry — v9: string-output byte path in driver.js,
// loaded by the tiny main.ts shim (which sets the V8 flags first, so they
// apply before driver.js is compiled).
//
// Same semantics as v8 (byte-identical output on the practice set): the
// case text is scanned straight out of the raw cases.json bytes as a
// latin1 string — no JSON.parse of the file, no per-field JS strings, no
// JSON.stringify of the answers. Fields are emitted as string fragments
// (raw inner slices) and joined per record, which beats v8's scratch
// arrays + Buffer copies: the doubled-quote / embedded-break walk now
// builds the field as a string directly instead of decode + JSON.stringify
// + Buffer.from. solve.js (the v7 parser) is untouched: it stays the
// correctness oracle and the fallback for any case the byte path cannot
// take (a \u escape bails the case to solve.js; any other failure bails
// the file to the v7 driver). A clean-record bulk path was tried and
// REJECTED (its per-record indexOf checks cost more than the field loop
// they skip), and a whole-case bulk transform was analysed and NOT built:
// quote_junk + stray_cr appear in every case, so it would need full
// error-ordering bookkeeping for a ~#240 rank at best — not top 10,
// and top 10 (cpu_us 0) is a measurement artifact of the control netting,
// unreachable by honest compute on a 10 MB job.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { run } = (await import(new URL('./solve.js', import.meta.url).href));

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

class Bail extends Error {}
class FileBail extends Error {}

let buf = Buffer.alloc(0);
let str = '';

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// Reused per-record fragment array: inner contents (no quotes) of fields.
const frags = [];
let firstQuoted = false;

function errText(code, recordLine, recordRow, extra) {
  return `{"code":"${code}","line":${recordLine},"row":${recordRow === null ? 'null' : recordRow}${extra ?? ''}}`;
}

function decAt(p) {
  if (p >= buf.length) return null;
  const b = buf[p];
  if (b === 34) return null;
  if (b === 92) {
    const e = buf[p + 1];
    if (e === 34) return ['"', p + 2];
    if (e === 92) return ['\\', p + 2];
    if (e === 47) return ['/', p + 2];
    if (e === 98) return ['\b', p + 2];
    if (e === 102) return ['\f', p + 2];
    if (e === 110) return ['\n', p + 2];
    if (e === 114) return ['\r', p + 2];
    if (e === 116) return ['\t', p + 2];
    if (e === 117) return [String.fromCharCode(parseInt(buf.toString('latin1', p + 2, p + 6), 16)), p + 6];
    return ['?', p + 2];
  }
  const len = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
  return [buf.toString('utf8', p, p + len), p + len];
}

function readUnquotedSlow(p, line, value, recordLine, recordRow, errs) {
  const parts = value === '' ? [] : [value];
  let added = 0;
  while (true) {
    const d = decAt(p);
    if (d === null) return { value: parts.join(''), ended: END, added, p, line };
    const c = d[0];
    const np = d[1];
    if (c === ',') return { value: parts.join(''), ended: COMMA, added, p: np, line };
    if (c === '\n') return { value: parts.join(''), ended: LINE_BREAK, added, p: np, line: line + 1 };
    if (c === '\r') {
      const d2 = decAt(np);
      if (d2 !== null && d2[0] === '\n') return { value: parts.join(''), ended: LINE_BREAK, added, p: d2[1], line: line + 1 };
      errs.push(errText('stray_cr', recordLine, recordRow));
      p = np;
      continue;
    }
    parts.push(c);
    added += 1;
    p = np;
  }
}

function readQuotedSlow(p, line, recordLine, recordRow, errs) {
  const open = p;
  const openLine = line;
  const parts = [];
  p += 2;
  let closed = false;
  while (true) {
    const d = decAt(p);
    if (d === null) break;
    const c = d[0];
    const np = d[1];
    if (c === '"') {
      const d2 = decAt(np);
      if (d2 !== null && d2[0] === '"') { parts.push('"'); p = d2[1]; continue; }
      p = np; closed = true; break;
    }
    if (c === '\r') {
      parts.push('\n'); line += 1;
      const d2 = decAt(np);
      p = d2 !== null && d2[0] === '\n' ? d2[1] : np;
      continue;
    }
    if (c === '\n') line += 1;
    parts.push(c);
    p = np;
  }
  if (!closed) {
    errs.push(errText('unterminated_quote', recordLine, recordRow));
    const r = readUnquotedSlow(open + 2, openLine, '"', recordLine, recordRow, errs);
    return { value: r.value, ended: r.ended, p: r.p, line: r.line };
  }
  const value = parts.join('');
  const d = decAt(p);
  if (d === null) return { value, ended: END, p, line };
  if (d[0] === ',') return { value, ended: COMMA, p: d[1], line };
  if (d[0] === '\n') return { value, ended: LINE_BREAK, p: d[1], line: line + 1 };
  if (d[0] === '\r') {
    const d2 = decAt(d[1]);
    if (d2 !== null && d2[0] === '\n') return { value, ended: LINE_BREAK, p: d2[1], line: line + 1 };
  }
  const r = readUnquotedSlow(p, line, value, recordLine, recordRow, errs);
  if (r.added > 0) errs.push(errText('quote_junk', recordLine, recordRow));
  return { value: r.value, ended: r.ended, p: r.p, line: r.line };
}

/** Decodes a raw span to the CSV text it stands for (JSON escapes decoded; doubled quotes collapsed and CR/CRLF read as LF when `quoted`). */
function decodeSpan(s, e, quoted) {
  const parts = [];
  let q = s;
  while (true) {
    const b = buf.indexOf(92, q);
    if (b === -1 || b >= e) { parts.push(buf.toString('utf8', q, e)); break; }
    parts.push(buf.toString('utf8', q, b));
    const ec = buf[b + 1];
    if (ec === 34) {
      if (quoted && buf[b + 2] === 92 && buf[b + 3] === 34) { parts.push('"'); q = b + 4; }
      else { parts.push('"'); q = b + 2; }
    } else if (ec === 92) { parts.push('\\'); q = b + 2; }
    else if (ec === 110) { parts.push('\n'); q = b + 2; }
    else if (ec === 114) {
      if (quoted) { parts.push('\n'); q = buf[b + 2] === 92 && buf[b + 3] === 110 ? b + 4 : b + 2; }
      else { parts.push('\r'); q = b + 2; }
    } else if (ec === 116) { parts.push('\t'); q = b + 2; }
    else if (ec === 98) { parts.push('\b'); q = b + 2; }
    else if (ec === 102) { parts.push('\f'); q = b + 2; }
    else if (ec === 47) { parts.push('/'); q = b + 2; }
    else if (ec === 117) { parts.push(String.fromCharCode(parseInt(buf.toString('latin1', b + 2, b + 6), 16))); q = b + 6; }
    else { parts.push('?'); q = b + 2; }
  }
  return parts.join('');
}
/** Inner JSON-escaped content of a span needing the walk (doubled/breaks), as
 * byte-form latin1 chars: doubled quotes collapse, CR/CRLF read as LF, every
 * other escape copies verbatim (same logic as v8's emitSpan, as a string). */
function walkInner(s, e) {
  const parts = [];
  let q = s, scan = s;
  while (true) {
    const b = str.indexOf('\\', scan);
    if (b === -1 || b >= e) { parts.push(str.slice(q, e)); break; }
    const ec = str.charCodeAt(b + 1);
    if (ec === 34 && str.charCodeAt(b + 2) === 92 && str.charCodeAt(b + 3) === 34) {
      parts.push(str.slice(q, b)); parts.push('\\"'); q = b + 4; scan = b + 4;
    } else if (ec === 114) {
      parts.push(str.slice(q, b)); parts.push('\\n');
      q = str.charCodeAt(b + 2) === 92 && str.charCodeAt(b + 3) === 110 ? b + 4 : b + 2;
      scan = q;
    } else { scan = b + 2; }
  }
  return parts.join('');
}
function pushDecoded(v) {
  frags.push(Buffer.from(JSON.stringify(v), 'utf8').toString('latin1').slice(1, -1));
}

function parseCase(ts, te, header) {
  // One \u scan per case (not per record: \u never occurs in practice, so a
  // per-record indexOf would rescan to the end of the file every time).
  const uCase = str.indexOf('\\u', ts);
  if (uCase !== -1 && uCase < te) throw new Bail();
  let p = ts;
  let line = 1;
  if (str.charCodeAt(p) === 0xef && str.charCodeAt(p + 1) === 0xbb && str.charCodeAt(p + 2) === 0xbf) p += 3;
  const errs = [];
  const rowsOut = [];
  let width = -1;
  let started = false;
  let rowCount = 0;
  let columnsOut = '';

  while (true) {
    while (p < te) {
      if (str.charCodeAt(p) === 92 && str.charCodeAt(p + 1) === 110) { p += 2; line += 1; continue; }
      if (str.charCodeAt(p) === 92 && str.charCodeAt(p + 1) === 114 && str.charCodeAt(p + 2) === 92 && str.charCodeAt(p + 3) === 110) { p += 4; line += 1; continue; }
      if (str.charCodeAt(p) === 92 && str.charCodeAt(p + 1) === 117) throw new Bail();
      break;
    }
    if (p >= te) break;
    const recordLine = line;
    const recordIsHeader = header && !started;
    const recordRow = recordIsHeader ? null : rowCount;

    frags.length = 0;
    firstQuoted = false;
    let fcount = 0;
    let fend = END;
    do {
      const fstart = p;
      fend = END;
      if (str.charCodeAt(p) === 92 && str.charCodeAt(p + 1) === 34) {
        if (fcount === 0) firstQuoted = true;
        const spanStart = p + 2;
        let q = spanStart;
        let doubled = false;
        let breaks = 0;
        let close = -1;
        while (true) {
          const b = str.indexOf('\\', q);
          if (b === -1 || b >= te) break;
          const ec = str.charCodeAt(b + 1);
          if (ec === 34) {
            if (str.charCodeAt(b + 2) === 92 && str.charCodeAt(b + 3) === 34) { doubled = true; q = b + 4; continue; }
            close = b; break;
          }
          if (ec === 110) { breaks += 1; q = b + 2; continue; }
          if (ec === 114) { breaks += 1; q = str.charCodeAt(b + 2) === 92 && str.charCodeAt(b + 3) === 110 ? b + 4 : b + 2; continue; }
          if (ec === 117) throw new Bail();
          q = b + 2;
        }
        if (close === -1) {
          const r = readQuotedSlow(fstart, line, recordLine, recordRow, errs);
          pushDecoded(r.value);
          fend = r.ended; p = r.p; line = r.line;
        } else {
          const a = close + 2;
          const walk = doubled || breaks > 0;
          if (walk) frags.push(walkInner(spanStart, close));
          else frags.push(str.slice(spanStart, close));
          if (a >= te) { fend = END; p = a; line += breaks; }
          else if (str.charCodeAt(a) === 44) { fend = COMMA; p = a + 1; line += breaks; }
          else if (str.charCodeAt(a) === 92 && str.charCodeAt(a + 1) === 110) { fend = LINE_BREAK; p = a + 2; line += breaks + 1; }
          else if (str.charCodeAt(a) === 92 && str.charCodeAt(a + 1) === 114 && str.charCodeAt(a + 2) === 92 && str.charCodeAt(a + 3) === 110) { fend = LINE_BREAK; p = a + 4; line += breaks + 1; }
          else if (str.charCodeAt(a) === 92 && str.charCodeAt(a + 1) === 117) throw new Bail();
          else {
            const r = readQuotedSlow(fstart, line, recordLine, recordRow, errs);
            frags.pop();
            pushDecoded(r.value);
            fend = r.ended; p = r.p; line = r.line;
          }
        }
      } else {
        let scan = p;
        while (true) {
          let c = str.indexOf(',', scan);
          if (c === -1 || c > te) c = -1;
          let b = str.indexOf('\\', scan);
          if (b === -1 || b >= te) b = -1;
          if (b === -1 && c === -1) { frags.push(str.slice(fstart, te)); fend = END; p = te; break; }
          if (c !== -1 && (b === -1 || c < b)) { frags.push(str.slice(fstart, c)); fend = COMMA; p = c + 1; break; }
          const ec = str.charCodeAt(b + 1);
          if (ec === 110) { frags.push(str.slice(fstart, b)); fend = LINE_BREAK; p = b + 2; line += 1; break; }
          if (ec === 114) {
            if (str.charCodeAt(b + 2) === 92 && str.charCodeAt(b + 3) === 110) { frags.push(str.slice(fstart, b)); fend = LINE_BREAK; p = b + 4; line += 1; break; }
            const r = readUnquotedSlow(fstart, line, '', recordLine, recordRow, errs);
            pushDecoded(r.value);
            fend = r.ended; p = r.p; line = r.line; break;
          }
          if (ec === 117) throw new Bail();
          scan = b + 2;
        }
      }
      fcount += 1;
    } while (fend === COMMA);

    if (fcount === 1 && frags[0] === '' && !firstQuoted) continue;

    if (!started) {
      started = true;
      width = fcount;
      if (recordIsHeader) {
        columnsOut = '["' + frags.join('","') + '"]';
      } else {
        columnsOut = 'null';
        rowsOut.push('["' + frags.join('","') + '"]');
        rowCount += 1;
      }
      continue;
    }
    if (fcount < width) {
      errs.push(errText('short_row', recordLine, recordRow, `,"fields":${fcount}`));
      for (let k = fcount; k < width; k++) frags.push('');
    } else if (fcount > width) {
      let extra = '[';
      for (let i = width; i < fcount; i++) {
        if (i > width) extra += ',';
        extra += '"' + frags[i] + '"';
      }
      extra += ']';
      errs.push(errText('long_row', recordLine, recordRow, `,"extra":${extra}`));
      frags.length = width;
    }
    rowsOut.push('["' + frags.join('","') + '"]');
    rowCount += 1;
  }

  if (!started) columnsOut = header ? '[]' : 'null';
  return '{"columns":' + columnsOut + ',"rows":[' + rowsOut.join(',') + '],"errors":[' + errs.join(',') + ']}';
}

function readBoolAt(i) {
  if (buf[i] === 116 && buf[i + 1] === 114 && buf[i + 2] === 117 && buf[i + 3] === 101) return true;
  if (buf[i] === 102 && buf[i + 1] === 97 && buf[i + 2] === 108 && buf[i + 3] === 115 && buf[i + 4] === 101) return false;
  throw new FileBail();
}
function findLiteralEnd(ts) {
  let q = ts;
  while (true) {
    const t = buf.indexOf(34, q);
    if (t === -1) throw new FileBail();
    let n = 0, i = t - 1;
    while (i >= ts && buf[i] === 92) { n += 1; i -= 1; }
    if (n % 2 === 0) return t;
    q = t + 1;
  }
}

function v7drive(b) {
  const cases = JSON.parse(b.toString('utf8'));
  run({ text: 'a,b,c\n"x","y","z"\n1,2,3\r\n', header: true });
  const answers = [];
  for (const c of cases) answers.push(run(c.input));
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
}

function drive(b) {
  buf = b;
  str = b.toString('latin1');
  if (b.length === 0 || b[0] !== 0x5b) throw new FileBail();
  const outCases = [];
  let pos = 1;
  while (true) {
    const ti = buf.indexOf('"text":"', pos);
    if (ti === -1) break;
    const ts = ti + 8;
    const nextTi = buf.indexOf('"text":"', ts);
    let header;
    let te;
    const h = buf.indexOf(',"header":', ts);
    if (h !== -1 && (nextTi === -1 || h < nextTi)) {
      header = readBoolAt(h + 10);
      te = h - 1;
    } else {
      const h2 = buf.indexOf('"header":', pos);
      if (h2 === -1 || h2 >= ti) throw new FileBail();
      header = readBoolAt(h2 + 9);
      te = findLiteralEnd(ts);
    }
    try {
      outCases.push(parseCase(ts, te, header));
    } catch (e) {
      if (!(e instanceof Bail)) console.error('v9: byte path failed on a case; solve.js fallback:', e);
      const text = JSON.parse(buf.toString('utf8', ts - 1, te + 1));
      // The fallback's JSON is a JS string with raw Unicode (emoji, Cyrillic,
      // ...); the byte path's output is a latin1 string where each char is
      // one byte, so the fallback must be re-encoded to its UTF-8 bytes as
      // latin1 chars first — otherwise the final 'latin1' write truncates
      // every non-latin1 char to its low byte (U+1F600 -> "=\\0").
      outCases.push(Buffer.from(JSON.stringify(run({ text, header })), 'utf8').toString('latin1'));
    }
    pos = te + 1;
  }
  return '[' + outCases.join(',') + ']';
}

const WARM_INPUT = { text: 'a,b\r\n"q""z",2\r\n3\r4,5\r\n"x"y,6\r\n"unterm,7\r\n', header: true };
const WARM_BUF = Buffer.from(JSON.stringify([{ id: 'w', input: WARM_INPUT }]), 'utf8');

const inBuf = readFileSync(join(INPUT_DIR, 'cases.json'));
try {
  const wOut = drive(WARM_BUF);
  const wExp = JSON.stringify([run(WARM_INPUT)]);
  if (JSON.stringify(JSON.parse(wOut)) !== wExp) throw new FileBail();
  const result = drive(inBuf);
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), result, 'latin1');
} catch (e) {
  if (!(e instanceof FileBail)) console.error('proto: byte path failed on the file; v7 driver fallback:', e);
  v7drive(inBuf);
}
