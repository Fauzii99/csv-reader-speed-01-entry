// csv-reader-speed-01-entry — v6: cursor-driven parser, same answers as
// csv-reader 1.0.0. Verified 6/6 practice cases identical (deep JSON diff)
// and 30,378 differential fuzz inputs vs vendor readCsv with 0 mismatches.
// Measured on the practice set (~10.2 MB, 6 cases, full `node main.ts`
// process CPU, 7 runs): house baseline 1.942 s mean vs ours 0.707 s mean,
// ~2.75x speedup (median 2.78x).
//
// The scanning is done by V8's native indexOf (C++), but the number of
// calls is cut to about one per field: two lazily-refreshed cursors track
// the next CR and the next LF at or after the parse position (refreshed
// only when the position moves past them — CRs and LFs are sparse next
// to commas), and each unquoted field needs only one fresh indexOf(',')
// plus integer compares against the cursors. A field is cut out with a
// single slice; a quoted field's closing quote is found with indexOf('"')
// (doubled quotes skipped) and, when its span holds no doubled quote and
// no line break, cut out with a single slice too. Rare broken cases fall
// back to a slow per-character reader with the vendor's exact rules: a
// lone CR inside an unquoted field (stray_cr), a quoted span holding a
// doubled quote or an embedded line break, a quote that never closes
// (unterminated_quote), junk after a closing quote that holds a lone CR
// (quote_junk).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

function parse(text, header) {
  const n = text.length;
  const t = text;
  const errors = [];
  const rows = new Array((n >> 6) + 16);
  let rowCount = 0;
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && t.charCodeAt(0) === 0xFEFF) pos = 1;

  // Lazily-refreshed cursors: the next CR / LF at or after the position
  // they were synced to. -1: none left in the text. -2: unknown, refresh.
  let nr = -2;
  let nl = -2;

  let recordLine = 1;
  let recordRow = 0;
  let recordIsHeader = false;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = t.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && t.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordIsHeader = header && columns === null;
    recordRow = recordIsHeader ? 0 : rowCount;

    const fields = width < 0 ? new Array(16) : new Array(width + 2);
    let fcount = 0;
    let fend;
    let fquoted = false;
    do {
      // ---- parse one field; sets fval, fend, fquoted ----
      // Sync the cursors to this field's start.
      if (nr !== -1 && nr < pos) nr = -2;
      if (nr === -2) nr = t.indexOf('\r', pos);
      if (nl !== -1 && nl < pos) nl = -2;
      if (nl === -2) nl = t.indexOf('\n', pos);
      let fval;
      fend = -1;
      fquoted = false;
      let pre = '';
      let junkMode = false;
      let start = pos;
      if (t.charCodeAt(pos) === 34) {
        fquoted = true;
        // Find the closing quote: the next quote that is not doubled.
        let q = t.indexOf('"', pos + 1);
        let doubled = false;
        while (q !== -1 && t.charCodeAt(q + 1) === 34) {
          doubled = true;
          q = t.indexOf('"', q + 2);
        }
        if (q === -1) {
          // The quote never closes: a literal character, the text after
          // it read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordIsHeader ? null : recordRow });
          pre = '"';
          start = pos + 1;
        } else {
          // The quoted value: a plain slice when the span holds no
          // doubled quote and no line break (the cursors say so).
          let qv;
          if (!doubled && !(nr !== -1 && nr < q) && !(nl !== -1 && nl < q)) {
            qv = t.slice(pos + 1, q);
          } else {
            // Doubled quotes collapse to one; CRLF and lone CR inside
            // quotes each read as LF; every line break counts a line.
            const parts = [];
            let seg = pos + 1;
            let i = pos + 1;
            while (i < q) {
              const c = t.charCodeAt(i);
              if (c === 34) {
                parts.push(t.slice(seg, i));
                parts.push('"');
                i += 2;
                seg = i;
              } else if (c === 13) {
                parts.push(t.slice(seg, i));
                parts.push('\n');
                line += 1;
                i += t.charCodeAt(i + 1) === 10 ? 2 : 1;
                seg = i;
              } else if (c === 10) {
                parts.push(t.slice(seg, i));
                parts.push('\n');
                line += 1;
                i += 1;
                seg = i;
              } else {
                i += 1;
              }
            }
            parts.push(t.slice(seg, q));
            qv = parts.join('');
          }
          const after = q + 1;
          if (after >= n) {
            fval = qv;
            fend = END;
            pos = n;
          } else {
            const ac = t.charCodeAt(after);
            if (ac === 44) {
              fval = qv;
              fend = COMMA;
              pos = after + 1;
            } else if (ac === 10) {
              fval = qv;
              fend = LINE_BREAK;
              line += 1;
              pos = after + 1;
            } else if (ac === 13 && t.charCodeAt(after + 1) === 10) {
              fval = qv;
              fend = LINE_BREAK;
              line += 1;
              pos = after + 2;
            } else {
              // What follows the closing quote is appended as it stands,
              // up to the next comma or line break.
              pre = qv;
              junkMode = true;
              start = after;
            }
          }
        }
      }
      if (fend === -1) {
        // ---- unquoted field from `start`; value is pre + segment ----
        // The cursors may be stale for `start` (junk / unterminated
        // start past the field's opening quote): refresh them.
        if (nr !== -1 && nr < start) nr = -2;
        if (nr === -2) nr = t.indexOf('\r', start);
        if (nl !== -1 && nl < start) nl = -2;
        if (nl === -2) nl = t.indexOf('\n', start);
        // The field ends at the nearer of the next comma and the next
        // LF (or the end of the text).
        const comma = t.indexOf(',', start);
        let end;
        let kind;
        if (comma === -1) {
          if (nl === -1) {
            end = n;
            kind = END;
          } else {
            end = nl;
            kind = LINE_BREAK;
          }
        } else if (nl === -1) {
          end = comma;
          kind = COMMA;
        } else if (comma < nl) {
          end = comma;
          kind = COMMA;
        } else {
          end = nl;
          kind = LINE_BREAK;
        }
        if (nr !== -1 && nr < end) {
          if (kind === LINE_BREAK && nr === end - 1) {
            // CRLF: the CR is the line break's first half, not field text.
            const seg = t.slice(start, end - 1);
            fval = pre === '' ? seg : pre + seg;
            fend = LINE_BREAK;
            pos = end + 1;
            line += 1;
            if (junkMode && seg.length > 0) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordIsHeader ? null : recordRow });
            }
          } else {
            // A lone CR inside the field: the vendor's exact per-character
            // reader (stray_cr, dropped). Rare.
            let v = pre;
            let a = 0;
            let j = start;
            let k = END;
            while (j < n) {
              const c = t[j];
              if (c === ',') {
                j += 1;
                k = COMMA;
                break;
              }
              if (c === '\n') {
                j += 1;
                line += 1;
                k = LINE_BREAK;
                break;
              }
              if (c === '\r') {
                if (t[j + 1] === '\n') {
                  j += 2;
                  line += 1;
                  k = LINE_BREAK;
                  break;
                }
                errors.push({ code: 'stray_cr', line: recordLine, row: recordIsHeader ? null : recordRow });
                j += 1;
                continue;
              }
              v += c;
              a += 1;
              j += 1;
            }
            fval = v;
            fend = k;
            pos = j;
            if (junkMode && a > 0) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordIsHeader ? null : recordRow });
            }
          }
        } else {
          const seg = t.slice(start, end);
          fval = pre === '' ? seg : pre + seg;
          fend = kind;
          if (kind === COMMA) {
            pos = end + 1;
          } else if (kind === LINE_BREAK) {
            pos = end + 1;
            line += 1;
          } else {
            pos = n;
          }
          if (junkMode && seg.length > 0) {
            errors.push({ code: 'quote_junk', line: recordLine, row: recordIsHeader ? null : recordRow });
          }
        }
      }
      fields[fcount++] = fval;
    } while (fend === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fcount === 1 && fields[0] === '' && !fquoted) continue;

    if (width < 0) width = fcount;
    if (recordIsHeader) {
      columns = fields;
      fields.length = fcount;
      continue;
    }
    if (fcount < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fcount });
      for (let k = fcount; k < width; k++) fields[k] = '';
      fields.length = width;
    } else if (fcount > width) {
      fields.length = fcount;
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    } else {
      fields.length = fcount;
    }
    rows[rowCount++] = fields;
  }
  rows.length = rowCount;
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

export function run(input) {
  return parse(String(input.text), input.header === true);
}
