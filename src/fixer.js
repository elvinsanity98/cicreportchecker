// Auto-fixer for CIC Submission Data Files. Produces a corrected copy of the
// file plus a log of every change, so nothing is altered silently.
//
// Only repairs that need no guessing are made: a value is rewritten when there
// is exactly one thing it can mean. Missing values, wrong codes and duplicates
// are left for a person to decide.
//
//   var fx = createFixer({ options: { symbols: true } });
//   feedBytes(fx, bytes);            // or fx.line(text) / fx.row(cells, n)
//   var out = fx.finish();           // out.lines, out.changes, out.counts
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./checker.js'), require('./domains.js'));
  } else {
    root.CIC_FIXER = factory(root.CIC_CHECKER, root.CIC_DOMAINS);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CHECKER, DOM) {
  'use strict';

  // Each kind can be switched off, except `encoding`: the output is always
  // written as UTF-8 without BOM. `optional` kinds change the data itself and
  // are off unless asked for; `off` kinds are harmless but rarely wanted.
  var KINDS = [
    { id: 'encoding', always: true, label: 'Save as UTF-8 without BOM', detail: 'Keeps Ñ and accented letters readable when the file was saved as ANSI, and repairs garbled sequences such as Ã\u2018.' },
    { id: 'structure', label: 'Remove label rows, empty lines and lines with no record type', detail: 'Empty lines include rows of separators only, which an Excel export writes for a blank row.' },
    { id: 'fieldcount', off: true, label: 'Make every record exactly as long as its layout', detail: 'Adds or drops separators at the end of a record, such as a | after the footer count. Leave off unless CIC rejects the file for its structure.' },
    { id: 'delimiter', label: 'Turn comma-delimited lines into pipe-delimited' },
    { id: 'spaces', label: 'Trim values and collapse double spaces', detail: 'Also replaces tabs, line breaks and non-breaking spaces with a plain space.' },
    { id: 'punctuation', label: 'Remove quotes added by Excel; straighten curly quotes and long dashes' },
    { id: 'codes', label: 'Upper-case codes and swap a description for its code', detail: 'For example m → M, PHILIPPINES → PH.' },
    { id: 'dates', label: 'Rewrite dates as DDMMYYYY when there is only one way to read them', detail: 'Restores a leading zero dropped by Excel, reorders 2026-06-30 or 06302026, converts Excel date numbers.' },
    { id: 'numbers', label: 'Clean numbers', detail: 'Removes thousands separators, spaces, a peso sign and a trailing .00.' },
    { id: 'tin', label: 'TIN: keep the digits only', detail: 'Removes dashes and spaces from a TIN.' },
    { id: 'header', label: 'Header version 1 → 1.0; recount the footer' },
    { id: 'enye', optional: true, label: 'Replace Ñ and accented letters with plain letters', detail: 'Ñ → N, é → e, in names, addresses and trade names. Leave off to keep Ñ; CIC accepts it in a UTF-8 file.' },
    { id: 'symbols', optional: true, label: 'Remove symbols from names, addresses and trade names', detail: 'Keeps letters, digits and spaces. Periods, commas, hyphens and # become a space, apostrophes are dropped, & becomes AND.' }
  ];
  var KIND_LABEL = {};
  KINDS.forEach(function (k) { KIND_LABEL[k.id] = k.label; });

  function defaultOptions() {
    var o = {};
    KINDS.forEach(function (k) { o[k.id] = !(k.optional || k.off); });
    return o;
  }

  // Printable ASCII with single inner spaces, no space at either end and no
  // leading quote: nothing for the character-level fixes to do.
  var PLAIN = /^[!#-~](?:[!-~]| (?=[!-~]))*$/;
  // Blank, or nothing but separators (an empty Excel row).
  var NOT_A_LINE = /^[|\s]*$/;
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;
  var ODD_SPACE = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g;
  var ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;
  var CURLY_SINGLE = /[\u2018\u2019\u201a\u201b\u2032\u00b4]/g;
  var CURLY_DOUBLE = /[\u201c\u201d\u201e\u201f\u2033]/g;
  var LONG_DASH = /[\u2010-\u2015\u2212]/g;
  var NON_ASCII = /[^\u0000-\u007f]/;

  // Windows-1252 code points for bytes 0x80-0x9F, to turn text back into bytes.
  var CP1252 = [0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178];
  var CP1252_BYTE = {};
  CP1252.forEach(function (cp, i) { CP1252_BYTE[cp] = 0x80 + i; });

  var utf8Strict = new TextDecoder('utf-8', { fatal: true });
  var utf8Loose = new TextDecoder('utf-8');
  var ansi = null;
  function ansiDecoder() {
    if (!ansi) ansi = new TextDecoder('windows-1252');
    return ansi;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ddmmyyyy(y, m, d) { return pad2(d) + pad2(m) + ('000' + y).slice(-4); }
  function plausibleYear(y) { return y >= 1900 && y <= 2100; }

  // "PEÃ\u2018A" -> "PEÑA": re-read the characters as the bytes they came from.
  function repairGarbled(s) {
    if (!CHECKER.GARBLED.test(s)) return s;
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      var b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252_BYTE[c];
      if (b === undefined) return s;
      bytes[i] = b;
    }
    try {
      var fixed = utf8Strict.decode(bytes);
      return fixed.length < s.length ? fixed : s;
    } catch (e) {
      return s;
    }
  }

  // Returns the DDMMYYYY form, or null when the value is fine or ambiguous.
  function fixDate(s) {
    if (CHECKER.parseDate(s).ok) return null;
    var valid = CHECKER.validYMD;
    var t = s.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?( ?[AaPp][Mm])?$/, '');
    var m;
    if (t !== s && CHECKER.parseDate(t).ok) return t;
    if (/^\d{7}$/.test(t)) {
      var padded = '0' + t;
      return CHECKER.parseDate(padded).ok && plausibleYear(+padded.slice(4)) ? padded : null;
    }
    if (/^\d{8}$/.test(t)) {
      var iso = valid(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6)) && plausibleYear(+t.slice(0, 4));
      var us = valid(+t.slice(4), +t.slice(0, 2), +t.slice(2, 4)) && plausibleYear(+t.slice(4));
      if (iso && !us) return t.slice(6) + t.slice(4, 6) + t.slice(0, 4);
      if (us && !iso) return t.slice(2, 4) + t.slice(0, 2) + t.slice(4);
      return null;
    }
    if (/^\d{5}$/.test(t) && +t > 10000 && +t < 80000) {
      // Excel serial date: days since 30 Dec 1899.
      var day = new Date(Date.UTC(1899, 11, 30) + +t * 86400000);
      return ddmmyyyy(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    }
    if ((m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(t))) {
      return valid(+m[1], +m[2], +m[3]) && plausibleYear(+m[1]) ? ddmmyyyy(+m[1], +m[2], +m[3]) : null;
    }
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(t))) {
      var y = +m[3], a = +m[1], b = +m[2];
      if (!plausibleYear(y)) return null;
      var dayFirst = valid(y, b, a), monthFirst = valid(y, a, b);
      if (dayFirst && (!monthFirst || a === b)) return ddmmyyyy(y, b, a);
      if (monthFirst && !dayFirst) return ddmmyyyy(y, a, b);
      return null;
    }
    if ((m = /^(\d{1,2})[\-\s.]([A-Za-z]{3,9})[\-\s.,]+(\d{4})$/.exec(t)) || (m = /^()([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t))) {
      var dd = m[1] ? +m[1] : +m[3];
      var yy = m[1] ? +m[3] : +m[4];
      var mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mm && valid(yy, mm, dd) && plausibleYear(yy) ? ddmmyyyy(yy, mm, dd) : null;
    }
    return null;
  }

  // Returns the cleaned number, or null when nothing can safely change.
  function fixNumber(s) {
    if (/^\d+$/.test(s)) return null;
    var t = s.replace(/^(php|₱|p)\s*(?=\d)/i, '').replace(/\s+/g, '');
    // Commas are dropped only when they group thousands: "12,5" may be a decimal comma.
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
    t = t.replace(/^(\d+)\.0+$/, '$1');
    return t !== s && /^\d+(\.\d+)?$/.test(t) ? t : null;
  }

  function fixTin(s) {
    if (CHECKER.TIN_RE.test(s) || /[^\d\s.\-]/.test(s)) return null;
    var t = s.replace(/\D/g, '');
    return CHECKER.TIN_RE.test(t) ? t : null;
  }

  function stripAccents(s) {
    return NON_ASCII.test(s) ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  }

  function stripSymbols(s) {
    return s.replace(/&/g, ' AND ').replace(/['\u2019]/g, '').replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ').replace(/ {2,}/g, ' ').trim();
  }

  // Description -> code, per code table. A description shared by two codes maps to nothing.
  var byDescription = {};
  function codeForDescription(def, value) {
    var key = value.toUpperCase().replace(/\s+/g, ' ');
    var found = null;
    for (var i = 0; i < def.doms.length; i++) {
      var name = def.doms[i].name;
      var map = byDescription[name];
      if (!map) {
        map = byDescription[name] = {};
        var table = DOM.DOMAINS[name];
        Object.keys(table).forEach(function (code) {
          var d = table[code].toUpperCase().replace(/\s+/g, ' ');
          map[d] = d in map ? null : code;
        });
      }
      if (map[key]) {
        if (found && found !== map[key]) return null;
        found = map[key];
      }
    }
    return found;
  }

  // RFC 4180 style split of one comma-delimited line.
  function splitCsv(line) {
    var out = [], cur = '', quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else quoted = false;
        } else cur += ch;
      } else if (ch === '"' && cur === '') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return quoted ? null : out;
  }

  function createFixer(opts) {
    opts = opts || {};
    var on = defaultOptions();
    for (var key in opts.options || {}) if (key in on) on[key] = !!opts.options[key];
    on.encoding = true;
    var excel = opts.mode === 'excel';
    var maxChanges = opts.maxChanges || 20000;

    var st = {
      lines: [], changes: [], counts: {}, total: 0, changed: {}, changedLines: 0, truncated: false,
      lineNo: 0, footerAt: -1, footerFields: null, provider: '', removed: 0
    };
    KINDS.forEach(function (k) { st.counts[k.id] = 0; });

    function log(kind, line, rec, pos, field, before, after, note) {
      st.counts[kind]++;
      st.total++;
      if (line && !st.changed[line]) { st.changed[line] = true; st.changedLines++; }
      if (st.changes.length >= maxChanges) { st.truncated = true; return; }
      st.changes.push({ kind: kind, line: line, rec: rec || '', pos: pos || 0, field: field || '', before: before, after: after, note: note || '' });
    }

    // Fixes that apply to any value, whatever the field.
    function generic(value, line, rec, pos, name) {
      var v = value, next;
      if (on.encoding) {
        next = repairGarbled(v);
        if (next !== v) { log('encoding', line, rec, pos, name, v, next, 'Garbled characters repaired'); v = next; }
      }
      if (on.punctuation && v.length > 1 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
        next = v.slice(1, -1).replace(/""/g, '"');
        log('punctuation', line, rec, pos, name, v, next, 'Excel quotes removed');
        v = next;
      }
      if (on.spaces) {
        next = v.replace(CONTROL, ' ').replace(ODD_SPACE, ' ').replace(ZERO_WIDTH, '').trim().replace(/ {2,}/g, ' ');
        if (next !== v) { log('spaces', line, rec, pos, name, v, next, 'Spaces tidied'); v = next; }
      }
      if (on.punctuation) {
        next = v.replace(CURLY_SINGLE, "'").replace(CURLY_DOUBLE, '"').replace(LONG_DASH, '-').replace(/\u2026/g, '...');
        if (next !== v) { log('punctuation', line, rec, pos, name, v, next, 'Curly quotes or long dashes straightened'); v = next; }
      }
      return v;
    }

    function typed(def, value, line, rec, pos) {
      var v = value, next;
      if (!v) return v;
      if (def.type === 'D') {
        if (on.dates && (next = fixDate(v))) { log('dates', line, rec, pos, def.name, v, next, 'Rewritten as DDMMYYYY'); v = next; }
      } else if (def.numeric) {
        var isCode = def.doms.length && CHECKER.domainMatch(def, v) === 'ok';
        if (on.numbers && !isCode && (next = fixNumber(v))) { log('numbers', line, rec, pos, def.name, v, next, 'Number cleaned'); v = next; }
      } else if (def.strictDom) {
        if (on.codes) {
          var match = CHECKER.domainMatch(def, v);
          next = null;
          if (match === 'case') next = v.toUpperCase();
          else if (match === 'no') {
            var bare = CHECKER.stripZeros(v.replace(/\.0+$/, ''));
            if (bare !== v && CHECKER.domainMatch(def, bare) === 'ok') next = bare;
            else next = codeForDescription(def, v);
          }
          if (next && next !== v) { log('codes', line, rec, pos, def.name, v, next, match === 'case' ? 'Upper-cased' : 'Replaced by its code'); v = next; }
        }
      } else if (def.text) {
        if (on.enye && (next = stripAccents(v)) !== v) { log('enye', line, rec, pos, def.name, v, next, 'Accents removed'); v = next; }
        if (on.symbols && (next = stripSymbols(v)) !== v) { log('symbols', line, rec, pos, def.name, v, next, 'Symbols removed'); v = next; }
      }
      return v;
    }

    function record(fields, line) {
      var rawType = (fields[0] || '').trim();
      var type = rawType;
      var defs = CHECKER.fieldDefs[type];
      if (!defs && on.codes && CHECKER.fieldDefs[rawType.toUpperCase()]) {
        type = rawType.toUpperCase();
        defs = CHECKER.fieldDefs[type];
        log('codes', line, type, 1, 'Record Type', fields[0], type, 'Upper-cased');
        fields[0] = type;
      }
      var i;
      for (i = 0; i < fields.length; i++) {
        var raw = fields[i];
        // Most fields are empty and most values are already plain, so skip
        // the character-level passes for those.
        if (raw === undefined || raw === '') { fields[i] = ''; continue; }
        var def = defs && defs[i];
        var v = PLAIN.test(raw) ? raw : generic(raw, line, type, i + 1, def ? def.name : '');
        fields[i] = def ? typed(def, v, line, type, i + 1) : v;
      }
      if (!defs) { st.lines.push(fields.join('|')); return; }

      if (on.tin && CHECKER.TIN_FIELDS[type]) {
        var spec = CHECKER.TIN_FIELDS[type];
        var targets = spec.plain.slice();
        spec.pairs.forEach(function (pair) { if (fields[pair[0]] === '10') targets.push(pair[1]); });
        targets.forEach(function (idx) {
          var fixed = fields[idx] ? fixTin(fields[idx]) : null;
          if (fixed) { log('tin', line, type, idx + 1, defs[idx].name, fields[idx], fixed, 'Digits only'); fields[idx] = fixed; }
        });
      }
      if (type === 'HD') {
        if (on.header && fields[3] && fields[3] !== '1.0' && Number(fields[3].replace(',', '.')) === 1) {
          log('header', line, 'HD', 4, 'Version', fields[3], '1.0', 'Version restored');
          fields[3] = '1.0';
        }
        if (!st.provider) st.provider = fields[1] || '';
      }

      if (fields.length !== defs.length && (on.fieldcount || excel)) {
        var extra = false;
        for (i = defs.length; i < fields.length; i++) if (fields[i]) { extra = true; break; }
        if (!extra) {
          // Excel rows are always shorter or longer than the layout; evening
          // them out is how the text file is built, not a correction.
          if (!excel) log('fieldcount', line, type, 0, '', fields.length + ' fields', defs.length + ' fields', fields.length < defs.length ? 'Empty fields added at the end' : 'Extra empty fields removed');
          while (fields.length < defs.length) fields.push('');
          fields.length = defs.length;
        }
      }
      if (type === 'FT' && st.footerAt < 0) {
        st.footerAt = st.lines.length;
        st.footerFields = fields;
        st.footerLine = line;
      }
      st.lines.push(fields.join('|'));
    }

    return {
      // One decoded line of the text file. `reencoded` is true when the line
      // was not valid UTF-8 and had to be read as ANSI.
      line: function (text, reencoded) {
        var n = ++st.lineNo;
        if (text.charCodeAt(text.length - 1) === 13) text = text.slice(0, -1);
        if (n === 1 && text.charCodeAt(0) === 0xfeff) {
          text = text.slice(1);
          log('encoding', 1, '', 0, '', 'UTF-8 with BOM', 'UTF-8', 'Byte-order mark removed');
        }
        if (reencoded) log('encoding', n, '', 0, '', 'ANSI', 'UTF-8', 'Line re-saved as UTF-8');
        if (NOT_A_LINE.test(text)) {
          var bare = text.indexOf('|') >= 0;
          if (on.structure) log('structure', n, '', 0, '', bare ? '(separators only)' : '(blank line)', '(removed)', bare ? 'Line of separators removed' : 'Blank line removed');
          else st.lines.push(text);
          return;
        }
        var fields;
        if (text.indexOf('|') < 0) {
          fields = on.delimiter && /^"?[A-Za-z]{2}"?,/.test(text) ? splitCsv(text) : null;
          if (!fields) { st.lines.push(text); return; }
          for (var i = 0; i < fields.length; i++) fields[i] = fields[i].replace(/\|/g, ' ');
          log('delimiter', n, '', 0, '', 'comma-delimited', 'pipe-delimited', 'Delimiter changed');
        } else {
          fields = text.split('|');
        }
        if (/^record type$/i.test(fields[0].trim()) && on.structure) {
          log('structure', n, '', 0, '', fields.slice(0, 3).join('|') + '\u2026', '(removed)', 'Label row removed');
          return;
        }
        if (!fields[0].trim() && on.structure) {
          var content = fields.filter(function (f) { return f && f.trim(); }).join(' | ').slice(0, 60);
          log('structure', n, '', 0, '', content, '(removed)', 'Line with no record type removed');
          return;
        }
        record(fields, n);
      },

      // One row of the Excel sheet. Label rows and rows without a record type
      // are left out: they are not part of the submission file.
      row: function (cells, rowNumber) {
        st.lineNo = rowNumber;
        var first = (cells[0] || '').trim();
        var has = false;
        for (var i = 0; i < cells.length; i++) if (cells[i] && cells[i].trim()) { has = true; break; }
        if (!has) return;
        if (!first || /^record type$/i.test(first)) { st.removed++; return; }
        var end = cells.length;
        while (end > 0 && !(cells[end - 1] && cells[end - 1].trim())) end--;
        var fields = cells.slice(0, end);
        for (var k = 0; k < fields.length; k++) {
          if (fields[k] === undefined) fields[k] = '';
          else if (fields[k].indexOf('|') >= 0) {
            var clean = fields[k].replace(/\|/g, ' ');
            log('structure', rowNumber, first, k + 1, '', fields[k], clean, 'Pipe inside a cell replaced by a space');
            fields[k] = clean;
          }
        }
        record(fields, rowNumber);
      },

      finish: function () {
        // Same count as the checker: empty lines, label rows and lines with
        // no record type are not records.
        var records = 0;
        for (var i = 0; i < st.lines.length; i++) {
          var text = st.lines[i];
          if (NOT_A_LINE.test(text)) continue;
          var bar = text.indexOf('|');
          var first = (bar < 0 ? text : text.slice(0, bar)).trim();
          if (first && !/^record type$/i.test(first)) records++;
        }
        if (on.header && st.footerFields && st.footerFields[3] !== String(records)) {
          log('header', st.footerLine, 'FT', 4, 'No. of records', st.footerFields[3], String(records), 'Footer recounted');
          st.footerFields[3] = String(records);
          st.lines[st.footerAt] = st.footerFields.join('|');
        }
        return {
          lines: st.lines, records: records, changes: st.changes, counts: st.counts, total: st.total,
          changedLines: st.changedLines, truncated: st.truncated, provider: st.provider,
          skippedRows: st.removed, options: on, mode: excel ? 'excel' : 'text'
        };
      }
    };
  }

  // Walks the raw bytes of a text file line by line. Lines that are not valid
  // UTF-8 are read as Windows-1252 (ANSI), which is what Excel and Notepad
  // write by default. Call run(n) until it returns false.
  function byteLines(bytes, fixer) {
    var pos = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    var first = pos === 3;
    var len = bytes.length;
    return {
      total: len,
      position: function () { return pos; },
      run: function (count) {
        while (count-- > 0 && pos < len) {
          var end = bytes.indexOf(10, pos);
          if (end < 0) end = len;
          var high = false;
          for (var i = pos; i < end; i++) if (bytes[i] > 127) { high = true; break; }
          var slice = bytes.subarray(pos, end);
          var text, reencoded = false;
          if (!high) text = utf8Loose.decode(slice);
          else {
            try { text = utf8Strict.decode(slice); } catch (e) { text = ansiDecoder().decode(slice); reencoded = true; }
          }
          if (first) { text = '\ufeff' + text; first = false; }
          fixer.line(text, reencoded);
          pos = end + 1;
        }
        return pos < len;
      }
    };
  }

  function feedBytes(fixer, bytes) {
    var it = byteLines(bytes, fixer);
    while (it.run(100000)) { /* keep going */ }
  }

  // <ProviderCode>_CSDF_<now>.txt. A corrected file is a new file, so it gets
  // a new timestamp, which also keeps the browser from renaming a duplicate.
  function suggestName(provider, originalName, now) {
    var m = CHECKER.FILE_NAME_RE.exec(originalName || '');
    var code = /^[A-Za-z0-9]{8}$/.test(provider || '') ? provider : m ? m[1] : '';
    if (!code) return (originalName || 'file').replace(/\.[^.]+$/, '') + '_fixed.txt';
    now = now || new Date();
    return code + '_CSDF_' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
      pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds()) + '.txt';
  }

  return {
    KINDS: KINDS,
    KIND_LABEL: KIND_LABEL,
    defaultOptions: defaultOptions,
    createFixer: createFixer,
    byteLines: byteLines,
    feedBytes: feedBytes,
    suggestName: suggestName,
    fixDate: fixDate,
    fixNumber: fixNumber,
    fixTin: fixTin,
    repairGarbled: repairGarbled,
    stripSymbols: stripSymbols,
    stripAccents: stripAccents
  };
});
