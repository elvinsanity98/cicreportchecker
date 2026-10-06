// Validation engine for CIC Submission Data Files (CSDF).
// Runs in the browser (window.CIC_CHECKER) and in Node (require).
//
// Usage:
//   var c = createChecker({ fileName: 'BANK1234_CSDF_20260705093000.txt', mfi: false });
//   c.line('HD|BANK1234|30062026|1.0|0|');   // one call per line of the text file
//   var result = c.finish();
//
// Every rule lives in RULES below. `basis` says where the rule comes from:
//   manual   - stated in the CIC materials this tool was built from
//   practice - sanity check that is not spelled out in those materials
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./spec.js'), require('./domains.js'));
  } else {
    root.CIC_CHECKER = factory(root.CIC_SPEC, root.CIC_DOMAINS);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SPEC, DOM) {
  'use strict';

  var RULES = {
    'F-NAME':       { sev: 'error',   basis: 'manual',   title: 'File name must be <ProviderCode>_CSDF_<YYYYMMDDhhmmss>.txt' },
    'F-BOM':        { sev: 'error',   basis: 'manual',   title: 'File has a byte-order mark (must be UTF-8 without BOM)' },
    'F-UTF8':       { sev: 'error',   basis: 'manual',   title: 'Line is not valid UTF-8' },
    'F-EMPTY':      { sev: 'error',   basis: 'manual',   title: 'File has no records' },
    'F-CONTAINER':  { sev: 'error',   basis: 'manual',   title: 'Problem with the ZIP or Excel container' },
    'S-TYPE':       { sev: 'error',   basis: 'manual',   title: 'Unknown record type' },
    'S-LABEL':      { sev: 'error',   basis: 'manual',   title: 'Column label row left in the file' },
    'S-BLANK':      { sev: 'error',   basis: 'practice', title: 'Blank line' },
    'S-DELIM':      { sev: 'error',   basis: 'manual',   title: 'Line is not pipe-delimited' },
    'S-COUNT':      { sev: 'warning', basis: 'manual',   title: 'Field count differs from the record layout' },
    'S-EXTRA':      { sev: 'error',   basis: 'manual',   title: 'Data found beyond the last field of the layout' },
    'S-HD-FIRST':   { sev: 'error',   basis: 'manual',   title: 'Header (HD) must be the first record' },
    'S-HD-DUP':     { sev: 'error',   basis: 'manual',   title: 'More than one header (HD) record' },
    'S-HD-MISSING': { sev: 'error',   basis: 'manual',   title: 'Header (HD) record is missing' },
    'S-FT-LAST':    { sev: 'error',   basis: 'manual',   title: 'Record found after the footer (FT)' },
    'S-FT-DUP':     { sev: 'error',   basis: 'manual',   title: 'More than one footer (FT) record' },
    'S-FT-MISSING': { sev: 'error',   basis: 'manual',   title: 'Footer (FT) record is missing' },
    'S-NODATA':     { sev: 'warning', basis: 'practice', title: 'File has no subject or contract records' },
    'S-SKIPPED':    { sev: 'info',    basis: 'practice', title: 'Rows ignored in the Excel sheet' },
    'V-REQ':        { sev: 'error',   basis: 'manual',   title: 'Mandatory field is empty' },
    'V-EXP':        { sev: 'warning', basis: 'practice', title: 'Field is normally required by CIC but is empty' },
    'V-LEN':        { sev: 'error',   basis: 'manual',   title: 'Value is longer than the field allows' },
    'V-DATE':       { sev: 'error',   basis: 'manual',   title: 'Date is not a valid DDMMYYYY date' },
    'V-YEAR':       { sev: 'warning', basis: 'practice', title: 'Date has an unusual year' },
    'V-NUM':        { sev: 'error',   basis: 'practice', title: 'Value is not a plain number' },
    'V-DEC':        { sev: 'warning', basis: 'practice', title: 'Number has decimals or a sign' },
    'V-CODE':       { sev: 'error',   basis: 'manual',   title: 'Code is not in the CIC code table' },
    'V-CASE':       { sev: 'error',   basis: 'manual',   title: 'Code is not in upper case' },
    'V-SPACE':      { sev: 'warning', basis: 'practice', title: 'Value has leading or trailing spaces' },
    'V-CHAR':       { sev: 'error',   basis: 'practice', title: 'Value contains tab or control characters' },
    'V-QUOTE':      { sev: 'warning', basis: 'practice', title: 'Value is wrapped in double quotes' },
    'V-DSPACE':     { sev: 'warning', basis: 'practice', title: 'Value has double spaces' },
    'V-ODD':        { sev: 'warning', basis: 'practice', title: 'Value has non-standard or garbled characters' },
    'V-NAME':       { sev: 'warning', basis: 'practice', title: 'Name contains digits or symbols' },
    'H-VERSION':    { sev: 'error',   basis: 'manual',   title: 'Version must be 1.0' },
    'H-SUBTYPE':    { sev: 'error',   basis: 'manual',   title: 'Submission Type must be 0 or 1' },
    'H-PROV':       { sev: 'warning', basis: 'manual',   title: 'Provider Code is not 8 alphanumeric characters' },
    'H-FILEPROV':   { sev: 'error',   basis: 'practice', title: 'Provider Code differs from the one in the file name' },
    'H-FUTURE':     { sev: 'warning', basis: 'practice', title: 'File Reference Date is in the future' },
    'T-COUNT':      { sev: 'error',   basis: 'manual',   title: 'Footer record count does not match the file' },
    'T-DATE':       { sev: 'error',   basis: 'practice', title: 'Footer File Reference Date differs from the header' },
    'X-PROV':       { sev: 'error',   basis: 'practice', title: 'Provider Code differs from the header' },
    'X-REFDATE':    { sev: 'error',   basis: 'manual',   title: 'Reference date is later than the File Reference Date' },
    'X-DUPSUBJ':    { sev: 'error',   basis: 'manual',   title: 'Provider Subject No is used by more than one subject record' },
    'X-DUPCON':     { sev: 'error',   basis: 'manual',   title: 'Same contract reported twice for the same subject' },
    'X-CONTYPE':    { sev: 'warning', basis: 'practice', title: 'Provider Contract No appears under different record types' },
    'X-NOSUBJ':     { sev: 'info',    basis: 'practice', title: 'Subject is referenced but has no ID/BD record in this file' },
    'X-SELF':       { sev: 'error',   basis: 'practice', title: 'Subject is linked to itself' },
    'X-DUPLINK':    { sev: 'warning', basis: 'practice', title: 'Duplicate subject link' },
    'C-PAIR':       { sev: 'error',   basis: 'practice', title: 'Type and value must be filled together' },
    'C-DOB':        { sev: 'warning', basis: 'practice', title: 'Date of Birth looks wrong' },
    'C-ADDR':       { sev: 'warning', basis: 'practice', title: 'Address is missing or incomplete' },
    'C-IDENT':      { sev: 'warning', basis: 'practice', title: 'No identification number or ID document' },
    'C-CONTACT':    { sev: 'warning', basis: 'practice', title: 'No contact details' },
    'C-EMAIL':      { sev: 'warning', basis: 'practice', title: 'E-mail contact does not look like an e-mail address' },
    'C-TIN':        { sev: 'error',   basis: 'practice', title: 'TIN must be 9 to 12 digits' },
    'C-PHASE':      { sev: 'warning', basis: 'practice', title: 'Dates do not fit the Contract Phase' },
    'C-DATES':      { sev: 'warning', basis: 'practice', title: 'Dates are out of order' },
    'C-OVERDUE':    { sev: 'warning', basis: 'practice', title: 'Overdue number and overdue amount disagree' }
  };

  var SEV_RANK = { info: 0, warning: 1, error: 2 };
  var FILE_NAME_RE = /^([A-Za-z0-9]{8})_CSDF_(\d{14})\.txt$/;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var CONTRACT_TYPES = { CI: 1, CN: 1, CC: 1, CS: 1 };

  // Characters that look fine on screen but are not plain text: non-breaking
  // and other odd spaces, zero-width marks, curly quotes, long dashes.
  var ODD_CHARS = /[\u007f-\u00a0\u00ad\u1680\u2000-\u200d\u2010-\u2015\u2018-\u201f\u2026\u2028\u2029\u202f\u2032\u2033\u205f\u2060\u3000\ufeff]/g;
  // UTF-8 text that was opened as ANSI and saved again, e.g. "\u00c3\u2018" for "\u00d1".
  var GARBLED = /[\u00c2-\u00f4][\u0080-\u00bf\u2018-\u203a\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u20ac\u2122]/;
  // U+FFFD is left out: a line with broken bytes is already reported as F-UTF8.
  var NAME_SYMBOLS = /[^\p{L}\p{M} .'\-\ufffd]/gu;
  var ODD_NAMES = {
    '\u00a0': 'non-breaking space', '\u00ad': 'soft hyphen', '\u200b': 'zero-width space', '\ufeff': 'zero-width mark',
    '\u2018': 'curly quote', '\u2019': 'curly quote', '\u201c': 'curly double quote', '\u201d': 'curly double quote',
    '\u2013': 'long dash', '\u2014': 'long dash', '\u2026': 'ellipsis character'
  };
  // Identification fields as 0-based [type, number] index pairs, plus plain TIN fields.
  var TIN_FIELDS = {
    ID: { pairs: [[53, 54], [55, 56], [57, 58], [115, 116], [117, 118]], plain: [82] },
    BD: { pairs: [[41, 42], [43, 44]], plain: [] }
  };
  var TIN_RE = /^\d{9,12}$/;

  function describeOdd(val) {
    var seen = {}, out = [];
    (val.match(ODD_CHARS) || []).forEach(function (ch) {
      var label = ODD_NAMES[ch] || 'U+' + ('000' + ch.charCodeAt(0).toString(16).toUpperCase()).slice(-4);
      if (!seen[label]) { seen[label] = true; out.push(label); }
    });
    return out.join(', ');
  }

  // ---- helpers ---------------------------------------------------------

  function colLetter(n) {
    var s = '';
    while (n > 0) {
      n--;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  function daysInMonth(y, m) {
    if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
    return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
  }

  function validYMD(y, m, d) {
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }

  function ymdNumber(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  // Returns { ok, n, y, m, d } with n = yyyymmdd for comparisons, or { ok: false, hint }.
  function parseDate(s) {
    if (/^\d{8}$/.test(s)) {
      var d = +s.slice(0, 2), m = +s.slice(2, 4), y = +s.slice(4);
      if (validYMD(y, m, d)) return { ok: true, n: y * 10000 + m * 100 + d, y: y, m: m, d: d };
      var y2 = +s.slice(0, 4);
      if (y2 >= 1900 && y2 <= 2100 && validYMD(y2, +s.slice(4, 6), +s.slice(6))) {
        return { ok: false, hint: 'looks like YYYYMMDD; reorder to DDMMYYYY' };
      }
      if (validYMD(y, d, m)) return { ok: false, hint: 'looks like MMDDYYYY; reorder to DDMMYYYY' };
      return { ok: false, hint: 'not a real calendar date' };
    }
    if (/^\d{7}$/.test(s)) {
      return { ok: false, hint: '7 digits; a leading zero was probably dropped by Excel (format the cell as Text)' };
    }
    if (/^\d{5}$/.test(s) && +s > 10000 && +s < 80000) {
      return { ok: false, hint: 'looks like an Excel date serial number; type the date as text in DDMMYYYY' };
    }
    if (/[\/\-.]/.test(s)) return { ok: false, hint: 'remove the separators; use 8 digits DDMMYYYY' };
    return { ok: false, hint: 'use 8 digits DDMMYYYY' };
  }

  function formatDate(p) {
    return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }

  function stripZeros(s) {
    return s.replace(/^0+(?=\d)/, '');
  }

  // Compile the spec once: resolve code tables into Sets.
  var COMPILED = (function () {
    var cache = {};
    function domainSet(name) {
      if (cache[name]) return cache[name];
      var table = DOM.DOMAINS[name];
      if (!table) throw new Error('Unknown code table: ' + name);
      var codes = Object.keys(table);
      // Excel stored PSIC/PSOC as numbers, so leading zeros are unreliable.
      var loose = name === 'PSIC' || name === 'PSOC';
      var set = new Set(loose ? codes.map(stripZeros) : codes);
      var upper = new Set(codes.map(function (c) { return c.toUpperCase(); }));
      return (cache[name] = { name: name, set: set, upper: upper, loose: loose, size: codes.length, codes: codes });
    }
    var out = {};
    SPEC.ORDER.forEach(function (type) {
      out[type] = SPEC.RECORDS[type].fields.map(function (def) {
        var names = def.dom ? [].concat(def.dom) : def.orDom ? [def.orDom] : [];
        return {
          name: def.name, type: def.type, req: def.req || '', max: def.max || 0,
          soft: !!def.soft, refDate: !!def.refDate, numeric: def.type === 'N', text: def.text || '',
          strictDom: !!def.dom, doms: names.map(domainSet)
        };
      });
    });
    return out;
  })();

  function domainMatch(def, v) {
    var sawCase = false;
    for (var i = 0; i < def.doms.length; i++) {
      var dm = def.doms[i];
      if (dm.set.has(dm.loose ? stripZeros(v) : v)) return 'ok';
      if (dm.upper.has(v.toUpperCase())) sawCase = true;
    }
    return sawCase ? 'case' : 'no';
  }

  function allowedHint(def) {
    var names = def.doms.map(function (d) { return d.name; }).join(' / ');
    var total = def.doms.reduce(function (n, d) { return n + d.size; }, 0);
    if (total <= 14) {
      var codes = [];
      def.doms.forEach(function (d) { codes = codes.concat(d.codes); });
      return 'Allowed: ' + codes.join(', ') + ' (' + names + ')';
    }
    return 'See code table ' + names;
  }

  // ---- checker ---------------------------------------------------------

  function createChecker(opts) {
    opts = opts || {};
    var excel = opts.mode === 'excel';
    var mfi = !!opts.mfi;
    var today = opts.today || new Date();
    var todayN = ymdNumber(today);
    var maxPerRule = opts.maxPerRule || 1000;
    var maxDetail = opts.maxDetail || 4000;
    var where = excel ? 'Row' : 'Line';

    var st = {
      issues: [], totals: { error: 0, warning: 0, info: 0 }, groups: {}, groupList: [],
      counts: {}, records: 0, lineNo: 0, truncated: false,
      hd: null, ft: null,
      subjects: new Map(), contractTypes: new Map(), contractKeys: new Map(),
      subjRefs: new Map(), links: new Set(), blanks: [], detail: new Map(),
      skippedLabels: 0, skippedNoType: 0, fileName: null
    };
    SPEC.ORDER.forEach(function (t) { st.counts[t] = 0; });

    function add(code, o) {
      var rule = RULES[code];
      var sev = o.sev || rule.sev;
      var rec = o.rec || '';
      var pos = o.pos || 0;
      st.totals[sev]++;
      var key = code + '|' + rec + '|' + pos;
      var g = st.groups[key];
      if (!g) {
        var def = rec && pos && COMPILED[rec] ? COMPILED[rec][pos - 1] : null;
        g = st.groups[key] = {
          key: key, code: code, sev: sev, basis: rule.basis, title: rule.title, rec: rec, pos: pos,
          field: def ? def.name : '', col: pos ? colLetter(pos) : '', count: 0, kept: 0,
          firstLine: o.line || 0
        };
        st.groupList.push(g);
      }
      g.count++;
      if (SEV_RANK[sev] > SEV_RANK[g.sev]) g.sev = sev;
      if (g.kept >= maxPerRule) { st.truncated = true; return; }
      g.kept++;
      st.issues.push({
        sev: sev, code: code, group: key, line: o.line || 0, rec: rec, pos: pos, col: g.col,
        field: g.field, value: o.value == null ? '' : String(o.value), msg: o.msg, ref: o.ref || ''
      });
      if (o.fields && o.line && !st.detail.has(o.line) && st.detail.size < maxDetail) {
        st.detail.set(o.line, o.fields);
      }
    }

    function checkFileName(name) {
      st.fileName = name;
      var m = FILE_NAME_RE.exec(name);
      if (!m) {
        var why = /\.txt$/i.test(name) ? '' : ' The extension must be .txt.';
        add('F-NAME', {
          value: name,
          msg: 'Expected 8-character provider code, "_CSDF_", then a 14-digit timestamp, e.g. BANK1234_CSDF_20150130143010.txt.' + why
        });
        return;
      }
      var ts = m[2];
      var okDate = validYMD(+ts.slice(0, 4), +ts.slice(4, 6), +ts.slice(6, 8));
      var okTime = +ts.slice(8, 10) < 24 && +ts.slice(10, 12) < 60 && +ts.slice(12, 14) < 60;
      if (!okDate || !okTime) {
        add('F-NAME', { value: name, msg: 'Timestamp "' + ts + '" is not a valid YYYYMMDDhhmmss date and time (24-hour clock).' });
      }
      st.nameProvider = m[1];
    }

    if (opts.fileName && opts.checkFileName !== false) checkFileName(opts.fileName);

    // ---- per-record checks ------------------------------------------

    function checkFields(type, defs, fields, line) {
      var n = defs.length;
      var v = new Array(n);
      var dates = {};
      for (var i = 0; i < n; i++) {
        var raw = fields[i];
        var def = defs[i];
        if (raw === undefined || raw === '') {
          v[i] = '';
          if (def.req) {
            add(def.req === 'M' ? 'V-REQ' : 'V-EXP', { line: line, rec: type, pos: i + 1, fields: fields, msg: def.name + ' is empty.' });
          }
          continue;
        }
        var val = raw.trim();
        var pos = i + 1;
        if (val.length !== raw.length) {
          add('V-SPACE', {
            line: line, rec: type, pos: pos, value: raw, fields: fields,
            msg: val ? 'Remove the spaces around the value.' : 'Field holds only spaces; leave it empty instead.'
          });
        }
        v[i] = val;
        if (!val) {
          if (def.req) add(def.req === 'M' ? 'V-REQ' : 'V-EXP', { line: line, rec: type, pos: pos, fields: fields, msg: def.name + ' is empty.' });
          continue;
        }
        if (/[\u0000-\u001f]/.test(val)) {
          add('V-CHAR', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Remove tab, line-break or other control characters.' });
        }
        if (val.length > 1 && val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
          add('V-QUOTE', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Excel adds quotes when a cell contains a quote or the list separator. Remove them.' });
        }
        if (val.indexOf('  ') >= 0) {
          add('V-DSPACE', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Use a single space between words.' });
        }
        if (GARBLED.test(val)) {
          add('V-ODD', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Looks like damaged encoding, such as "\u00c3\u2018" where "\u00d1" was meant. Auto-fix can repair it.' });
        } else if (val.search(ODD_CHARS) >= 0) {
          add('V-ODD', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Contains ' + describeOdd(val) + '. Type plain spaces, quotes and hyphens instead.' });
        }
        if (def.text === 'name') {
          var odd = val.match(NAME_SYMBOLS);
          if (odd) {
            add('V-NAME', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Found ' + odd.filter(function (c, k) { return odd.indexOf(c) === k; }).join(' ') + '. Names normally hold only letters, spaces, hyphen, apostrophe and period.' });
          }
        }
        if (def.max && val.length > def.max) {
          add('V-LEN', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: val.length + ' characters; maximum is ' + def.max + '.' });
        }
        if (def.type === 'D') {
          var p = parseDate(val);
          if (!p.ok) {
            add('V-DATE', { sev: def.soft ? 'warning' : 'error', line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Not a valid date: ' + p.hint + '.' });
          } else {
            dates[i] = p;
            if (p.y < 1900 || p.y > 2100) {
              add('V-YEAR', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'Year ' + p.y + ' is outside 1900-2100. Check for a typing error.' });
            }
          }
        } else if (def.numeric) {
          if (!/^\d+$/.test(val) && !(def.doms.length && domainMatch(def, val) === 'ok')) {
            if (/^-?\d+(\.\d+)?$/.test(val)) {
              add('V-DEC', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'CIC number fields normally take whole, unsigned numbers. Confirm before submitting.' });
            } else {
              var hint = /e[+-]?\d+$/i.test(val) ? 'Excel wrote it in scientific notation; format the cell as Number with no decimals.'
                : /[, ]/.test(val) ? 'Remove thousands separators and spaces.'
                : 'Digits only; no currency symbols or letters.';
              add('V-NUM', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: hint });
            }
          }
        } else if (def.strictDom) {
          var match = domainMatch(def, val);
          if (match === 'case') {
            add('V-CASE', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: 'CIC codes are upper case: use ' + val.toUpperCase() + '.' });
          } else if (match === 'no') {
            add('V-CODE', { line: line, rec: type, pos: pos, value: val, fields: fields, msg: allowedHint(def) + '.' });
          }
        }
      }
      return { v: v, dates: dates };
    }

    // i, j are 0-based field indexes. Flags a..b order problems (a should not be after b).
    function dateOrder(type, line, fields, d, i, j, defs) {
      if (d[i] && d[j] && d[i].n > d[j].n) {
        add('C-DATES', {
          line: line, rec: type, pos: j + 1, value: fields[j], fields: fields,
          msg: defs[j].name + ' is earlier than ' + defs[i].name + ' (' + fields[i].trim() + ').'
        });
      }
    }

    function pairCheck(type, line, fields, v, iType, iValue, defs) {
      if (!!v[iType] === !!v[iValue]) return;
      var missing = v[iType] ? iValue : iType;
      add('C-PAIR', {
        line: line, rec: type, pos: missing + 1, fields: fields,
        msg: defs[missing].name + ' is empty but ' + defs[v[iType] ? iType : iValue].name + ' is filled.'
      });
    }

    function tinCheck(type, line, fields, v, defs) {
      var spec = TIN_FIELDS[type];
      var targets = spec.plain.slice();
      spec.pairs.forEach(function (pair) { if (v[pair[0]] === '10') targets.push(pair[1]); });
      targets.forEach(function (idx) {
        if (!v[idx] || TIN_RE.test(v[idx])) return;
        var digits = v[idx].replace(/\D/g, '').length;
        add('C-TIN', {
          line: line, rec: type, pos: idx + 1, value: v[idx], fields: fields,
          msg: defs[idx].name + ' holds a TIN: digits only, 9 to 12 of them, no dashes or spaces. Found ' + digits + ' digit(s)' + (digits === v[idx].length ? '.' : ' plus other characters.')
        });
      });
    }

    function blockFilled(v, start, len) {
      for (var i = start; i < start + len; i++) if (v[i]) return true;
      return false;
    }

    // Address block: 11 fields starting at 0-based index `s`.
    function addressCheck(type, line, fields, v, s, required) {
      if (!blockFilled(v, s, 11)) {
        if (required) add('C-ADDR', { line: line, rec: type, pos: s + 1, fields: fields, msg: 'No main address. CIC normally expects at least one address per subject.' });
        return;
      }
      if (!v[s]) add('C-ADDR', { line: line, rec: type, pos: s + 1, fields: fields, msg: 'Address is filled but Address Type is empty.' });
      if (!v[s + 1] && !v[s + 2] && !v[s + 4] && !v[s + 5] && !v[s + 6] && !v[s + 7]) {
        add('C-ADDR', { line: line, rec: type, pos: s + 2, fields: fields, msg: 'Fill FullAddress, or the street / barangay / city / province fields.' });
      }
    }

    function contactCheck(type, line, fields, v, s, count, defs) {
      for (var k = 0; k < count; k++) {
        var t = s + k * 2;
        pairCheck(type, line, fields, v, t, t + 1, defs);
        if ((v[t] === '7' || v[t] === '8') && v[t + 1] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v[t + 1])) {
          add('C-EMAIL', { line: line, rec: type, pos: t + 2, value: v[t + 1], fields: fields, msg: 'Contact Type ' + v[t] + ' is an e-mail address.' });
        }
      }
    }

    function registerSubject(type, line, fields, v) {
      var no = v[4];
      if (!no) return;
      var seen = st.subjects.get(no);
      if (seen) {
        add('X-DUPSUBJ', {
          line: line, rec: type, pos: 5, value: no, fields: fields, ref: no,
          msg: 'Already used by the ' + seen.rec + ' record on ' + where.toLowerCase() + ' ' + seen.line + '. Each subject needs its own unique number and one record per file.'
        });
      } else {
        st.subjects.set(no, { line: line, rec: type });
      }
    }

    function noteSubjectRef(no, line, type, pos) {
      if (!no) return;
      var r = st.subjRefs.get(no);
      if (r) r.count++;
      else st.subjRefs.set(no, { line: line, rec: type, pos: pos, count: 1 });
    }

    function checkID(line, fields, r, defs) {
      var v = r.v, d = r.dates;
      registerSubject('ID', line, fields, v);
      if (!mfi) {
        if (!v[14]) add('V-REQ', { line: line, rec: 'ID', pos: 15, fields: fields, msg: 'Place of Birth is mandatory unless the submitting entity is an MFI.' });
        if (!v[16]) add('V-REQ', { line: line, rec: 'ID', pos: 17, fields: fields, msg: 'Nationality is mandatory unless the submitting entity is an MFI.' });
      }
      var dob = d[13];
      if (dob) {
        var ref = d[3] ? d[3].n : todayN;
        var age = Math.floor((ref - dob.n) / 10000);
        if (dob.n > ref) add('C-DOB', { sev: 'error', line: line, rec: 'ID', pos: 14, value: v[13], fields: fields, msg: 'Date of Birth is after the reference date.' });
        else if (age < 18) add('C-DOB', { line: line, rec: 'ID', pos: 14, value: v[13], fields: fields, msg: 'Subject is ' + age + ' years old on the reference date.' });
        else if (age > 110) add('C-DOB', { line: line, rec: 'ID', pos: 14, value: v[13], fields: fields, msg: 'Subject is ' + age + ' years old on the reference date.' });
      }
      addressCheck('ID', line, fields, v, 31, true);
      addressCheck('ID', line, fields, v, 42, false);
      var k;
      for (k = 0; k < 3; k++) pairCheck('ID', line, fields, v, 53 + k * 2, 54 + k * 2, defs);
      for (k = 0; k < 3; k++) {
        var s = 59 + k * 6;
        pairCheck('ID', line, fields, v, s, s + 1, defs);
        dateOrder('ID', line, fields, d, s + 2, s + 4, defs);
      }
      if (!blockFilled(v, 53, 6) && !blockFilled(v, 59, 18)) {
        add('C-IDENT', { line: line, rec: 'ID', pos: 54, fields: fields, msg: 'Give at least one Identification (TIN, SSS, GSIS, UMID...) or ID document so CIC can match the subject.' });
      }
      contactCheck('ID', line, fields, v, 77, 2, defs);
      if (!blockFilled(v, 77, 4)) add('C-CONTACT', { line: line, rec: 'ID', pos: 78, fields: fields, msg: 'No phone number or e-mail given.' });
      dateOrder('ID', line, fields, d, 89, 90, defs);
      addressCheck('ID', line, fields, v, 93, false);
      addressCheck('ID', line, fields, v, 104, false);
      for (k = 0; k < 2; k++) pairCheck('ID', line, fields, v, 115 + k * 2, 116 + k * 2, defs);
      contactCheck('ID', line, fields, v, 119, 2, defs);
      tinCheck('ID', line, fields, v, defs);
    }

    function checkBD(line, fields, r, defs) {
      var v = r.v, d = r.dates;
      registerSubject('BD', line, fields, v);
      if (d[12] && d[3] && d[12].n > d[3].n) {
        add('C-DATES', { line: line, rec: 'BD', pos: 13, value: v[12], fields: fields, msg: 'Registration Date is after the Subject Reference Date.' });
      }
      addressCheck('BD', line, fields, v, 19, true);
      addressCheck('BD', line, fields, v, 30, false);
      for (var k = 0; k < 2; k++) pairCheck('BD', line, fields, v, 41 + k * 2, 42 + k * 2, defs);
      if (!blockFilled(v, 41, 4)) {
        add('C-IDENT', { line: line, rec: 'BD', pos: 42, fields: fields, msg: 'Give at least one Identification (TIN, SEC, DTI or CDA registration number).' });
      }
      contactCheck('BD', line, fields, v, 45, 2, defs);
      tinCheck('BD', line, fields, v, defs);
    }

    function checkContract(type, line, fields, r, defs) {
      var v = r.v, d = r.dates;
      var subj = v[4], contract = v[6], phase = v[8];
      noteSubjectRef(subj, line, type, 5);
      if (contract) {
        var other = st.contractTypes.get(contract);
        if (!other) st.contractTypes.set(contract, type);
        else if (other !== type) {
          add('X-CONTYPE', { line: line, rec: type, pos: 7, value: contract, fields: fields, ref: contract, msg: 'Also reported as a ' + other + ' record. A contract number identifies one credit facility.' });
        }
        if (subj) {
          var key = contract + '\u0001' + subj;
          var first = st.contractKeys.get(key);
          if (first) {
            add('X-DUPCON', { line: line, rec: type, pos: 7, value: contract, fields: fields, ref: contract, msg: 'Contract ' + contract + ' with subject ' + subj + ' is already on ' + where.toLowerCase() + ' ' + first + '.' });
          } else {
            st.contractKeys.set(key, line);
          }
        }
      }

      // Indexes 12-16: start, request, end planned, end actual, last payment.
      var open = phase === 'AC', closed = phase === 'CL' || phase === 'CA';
      var requested = phase === 'RQ' || phase === 'RN' || phase === 'RF';
      if ((open || closed) && !v[12]) add('C-PHASE', { line: line, rec: type, pos: 13, fields: fields, msg: 'Contract Start Date is empty but the phase is ' + phase + '.' });
      if (requested && !v[13]) add('C-PHASE', { line: line, rec: type, pos: 14, fields: fields, msg: 'Contract Request Date is empty but the phase is ' + phase + '.' });
      if (closed && !v[15]) add('C-PHASE', { line: line, rec: type, pos: 16, fields: fields, msg: 'Contract End Actual Date is empty but the phase is ' + phase + ' (closed).' });
      if (open && v[15]) add('C-PHASE', { line: line, rec: type, pos: 16, value: v[15], fields: fields, msg: 'Contract End Actual Date is filled but the phase is still AC (active).' });
      dateOrder(type, line, fields, d, 12, 14, defs);
      dateOrder(type, line, fields, d, 12, 15, defs);
      var ref = d[3];
      if (ref) {
        [[12, open || closed], [15, true], [16, true]].forEach(function (c) {
          var idx = c[0];
          if (c[1] && d[idx] && d[idx].n > ref.n) {
            add('C-DATES', { line: line, rec: type, pos: idx + 1, value: v[idx], fields: fields, msg: defs[idx].name + ' is after the Contract Reference Date (' + v[3] + ').' });
          }
        });
      }

      var odNumber = type === 'CI' ? 32 : type === 'CC' ? 29 : type === 'CS' ? 23 : -1;
      if (odNumber >= 0) {
        var num = v[odNumber], amt = v[odNumber + 1];
        if (/^\d+$/.test(num) && /^\d+$/.test(amt) && (+num > 0) !== (+amt > 0)) {
          add('C-OVERDUE', { line: line, rec: type, pos: odNumber + 1, value: num, fields: fields, msg: 'Overdue Payments Number is ' + num + ' but Overdue Payments Amount is ' + amt + '.' });
        }
      }

      // Guarantees (6 x 14 fields) and linked subjects (6 x 3 fields) close CI, CN and CC.
      if (type !== 'CS') {
        var g0 = defs.length - 102;
        for (var g = 0; g < 6; g++) {
          var s = g0 + g * 14;
          if (!blockFilled(v, s, 14)) continue;
          noteSubjectRef(v[s + 1], line, type, s + 2);
          dateOrder(type, line, fields, d, s + 5, s + 6, defs);
        }
        var l0 = defs.length - 18;
        for (var l = 0; l < 6; l++) {
          var t = l0 + l * 3;
          if (!blockFilled(v, t, 3)) continue;
          noteSubjectRef(v[t], line, type, t + 1);
          pairCheck(type, line, fields, v, t, t + 1, defs);
        }
      }
    }

    function checkNE(line, fields, r, defs) {
      var v = r.v, d = r.dates;
      noteSubjectRef(v[4], line, 'NE', 5);
      if (d[7] && d[3] && d[7].n > d[3].n) {
        add('C-DATES', { line: line, rec: 'NE', pos: 8, value: v[7], fields: fields, msg: 'Event Date is after the Negative Event Reference Date.' });
      }
      dateOrder('NE', line, fields, d, 7, 9, defs);
    }

    function checkSL(line, fields, r) {
      var v = r.v;
      noteSubjectRef(v[4], line, 'SL', 5);
      noteSubjectRef(v[6], line, 'SL', 7);
      if (v[4] && v[4] === v[6]) {
        add('X-SELF', { line: line, rec: 'SL', pos: 7, value: v[6], fields: fields, msg: 'Parent and child are the same Provider Subject No.' });
      }
      var key = v[4] + '\u0001' + v[5] + '\u0001' + v[6];
      if (st.links.has(key)) add('X-DUPLINK', { line: line, rec: 'SL', pos: 5, value: v[4], fields: fields, msg: 'The same parent, role and child were already reported.' });
      else st.links.add(key);
    }

    function checkHD(line, fields, r) {
      var v = r.v;
      if (st.hd) {
        add('S-HD-DUP', { line: line, rec: 'HD', fields: fields, msg: 'A header was already found on ' + where.toLowerCase() + ' ' + st.hd.line + '. A file has exactly one.' });
        return;
      }
      st.hd = { line: line, provider: v[1], refDate: r.dates[2] || null, refDateRaw: v[2], version: v[3], subType: v[4], comments: v[5] || '' };
      if (v[1] && !/^[A-Za-z0-9]{8}$/.test(v[1]) && v[1].length <= 8) {
        add('H-PROV', { line: line, rec: 'HD', pos: 2, value: v[1], fields: fields, msg: 'CIC provider codes are 8 letters and digits.' });
      }
      if (v[1] && st.nameProvider && v[1] !== st.nameProvider) {
        add('H-FILEPROV', { line: line, rec: 'HD', pos: 2, value: v[1], fields: fields, msg: 'The file name says ' + st.nameProvider + '.' });
      }
      if (v[3] && v[3] !== SPEC.FORMAT_VERSION) {
        var why = v[3] === '1' ? ' Excel turned 1.0 into 1; format the cell as Text.' : '';
        add('H-VERSION', { line: line, rec: 'HD', pos: 4, value: v[3], fields: fields, msg: 'Must be exactly 1.0.' + why });
      }
      if (v[4] && v[4] !== '0' && v[4] !== '1') {
        add('H-SUBTYPE', { line: line, rec: 'HD', pos: 5, value: v[4], fields: fields, msg: '0 = standard periodical contribution, 1 = correction / history contribution.' });
      }
      if (st.hd.refDate && st.hd.refDate.n > todayN) {
        add('H-FUTURE', { line: line, rec: 'HD', pos: 3, value: v[2], fields: fields, msg: 'It is normally the end of the month the data refers to.' });
      }
    }

    function checkFT(line, fields, r) {
      var v = r.v;
      if (st.ft) {
        add('S-FT-DUP', { line: line, rec: 'FT', fields: fields, msg: 'A footer was already found on ' + where.toLowerCase() + ' ' + st.ft.line + '. A file has exactly one.' });
        return;
      }
      st.ft = { line: line, count: v[3], fields: fields };
      if (st.hd && st.hd.refDateRaw && v[2] && v[2] !== st.hd.refDateRaw) {
        add('T-DATE', { line: line, rec: 'FT', pos: 3, value: v[2], fields: fields, msg: 'Header says ' + st.hd.refDateRaw + '.' });
      }
    }

    function record(fields, line) {
      st.records++;
      var rawType = fields[0] === undefined ? '' : fields[0];
      var type = rawType.trim();
      var defs = COMPILED[type];

      if (!defs) {
        if (/^record type$/i.test(type)) {
          add('S-LABEL', { line: line, value: fields.slice(0, 4).join('|'), fields: fields, msg: 'Remove the label rows before converting the sheet to a text file.' });
        } else {
          var known = COMPILED[type.toUpperCase()] ? ' Record types are upper case.' : '';
          add('S-TYPE', { line: line, value: rawType, fields: fields, msg: (type ? '"' + type + '" is not a record type.' : 'Record type is empty.') + ' Use HD, ID, BD, SL, NE, CI, CN, CC, CS or FT.' + known });
        }
        return;
      }
      st.counts[type]++;

      if (type !== 'HD' && st.records === 1) {
        add('S-HD-FIRST', { line: line, rec: type, fields: fields, msg: 'The file starts with a ' + type + ' record.' });
      }
      if (type === 'HD' && st.records !== 1 && !st.hd) {
        add('S-HD-FIRST', { line: line, rec: 'HD', fields: fields, msg: 'The header is on ' + where.toLowerCase() + ' ' + line + ', not at the top.' });
      }
      if (st.ft && type !== 'FT') {
        add('S-FT-LAST', { line: line, rec: type, fields: fields, msg: 'The footer on ' + where.toLowerCase() + ' ' + st.ft.line + ' must be the last record.' });
      }

      if (fields.length !== defs.length) {
        var extra = false;
        for (var i = defs.length; i < fields.length; i++) if (fields[i] && fields[i].trim()) { extra = true; break; }
        if (extra) {
          add('S-EXTRA', { line: line, rec: type, value: fields.slice(defs.length).join('|').slice(0, 80), fields: fields, msg: type + ' has ' + defs.length + ' fields but data continues to field ' + fields.length + '. A value may contain a pipe, or fields are shifted.' });
        } else if (!excel) {
          add('S-COUNT', {
            line: line, rec: type, value: fields.length + ' fields', fields: fields,
            msg: fields.length < defs.length
              ? type + ' has ' + defs.length + ' fields; found ' + fields.length + '. Missing trailing fields are read as empty here, but CIC checks file structure first.'
              : type + ' has ' + defs.length + ' fields; found ' + fields.length + ' (extra empty fields at the end, usually from an Excel export).'
          });
        }
      }

      var r = checkFields(type, defs, fields, line);
      var v = r.v;

      if (type === 'HD') { checkHD(line, fields, r); return; }
      if (st.hd) {
        if (v[1] && st.hd.provider && v[1] !== st.hd.provider) {
          add('X-PROV', { line: line, rec: type, pos: 2, value: v[1], fields: fields, msg: 'Header says ' + st.hd.provider + '.' });
        }
        var refIdx = type === 'FT' ? -1 : 3;
        if (refIdx >= 0 && r.dates[refIdx] && st.hd.refDate && r.dates[refIdx].n > st.hd.refDate.n) {
          add('X-REFDATE', { line: line, rec: type, pos: refIdx + 1, value: v[refIdx], fields: fields, msg: defs[refIdx].name + ' cannot be later than the File Reference Date in the header (' + st.hd.refDateRaw + ').' });
        }
      }

      if (type === 'ID') checkID(line, fields, r, defs);
      else if (type === 'BD') checkBD(line, fields, r, defs);
      else if (CONTRACT_TYPES[type]) checkContract(type, line, fields, r, defs);
      else if (type === 'NE') checkNE(line, fields, r, defs);
      else if (type === 'SL') checkSL(line, fields, r);
      else if (type === 'FT') checkFT(line, fields, r);
    }

    function flushBlanks(trailing) {
      if (!st.blanks.length) return;
      if (trailing) {
        add('S-BLANK', { sev: 'warning', line: st.blanks[0], msg: st.blanks.length + ' blank line(s) at the end of the file. Delete them.' });
      } else {
        st.blanks.forEach(function (n) { add('S-BLANK', { line: n, msg: 'Delete the empty line between records.' }); });
      }
      st.blanks = [];
    }

    // ---- public API --------------------------------------------------

    return {
      // One line of the text file, without its line ending.
      line: function (text) {
        var n = ++st.lineNo;
        if (text.charCodeAt(text.length - 1) === 13) text = text.slice(0, -1);
        if (n === 1 && text.charCodeAt(0) === 0xfeff) {
          add('F-BOM', { line: 1, msg: 'Save the file as "UTF-8" (not "UTF-8 with BOM" / "UTF-8 signature").' });
          text = text.slice(1);
        }
        if (!text.trim()) { st.blanks.push(n); return; }
        flushBlanks(false);
        if (text.indexOf('\ufffd') >= 0) {
          add('F-UTF8', { line: n, value: text.slice(0, 60), msg: 'Contains bytes that are not UTF-8, usually Ñ or accented letters from a file saved as ANSI. Re-save the text file with UTF-8 encoding.' });
        }
        if (text.indexOf('|') < 0) {
          var comma = /^"?[A-Za-z]{2}"?,/.test(text);
          add('S-DELIM', { line: n, value: text.slice(0, 60), msg: comma ? 'Fields are separated by commas. Set the Windows list separator to | (Control Panel > Region > Additional settings) and save the CSV again.' : 'No pipe (|) found on this line.' });
          st.records++;
          return;
        }
        record(text.split('|'), n);
      },

      // One row of an Excel sheet: array of cell texts starting at column A.
      row: function (cells, rowNumber) {
        st.lineNo = rowNumber;
        var has = false;
        for (var i = 0; i < cells.length; i++) if (cells[i] && cells[i].trim()) { has = true; break; }
        if (!has) return;
        var first = (cells[0] || '').trim();
        if (/^record type$/i.test(first)) { st.skippedLabels++; return; }
        if (!first) { st.skippedNoType++; return; }
        var end = cells.length;
        while (end > 0 && !(cells[end - 1] && cells[end - 1].trim())) end--;
        record(cells.slice(0, end), rowNumber);
      },

      // Problems found by the file reader before any record could be read.
      fileIssue: function (code, msg, value) { add(code, { msg: msg, value: value }); },
      setFileName: function (name) { checkFileName(name); },

      finish: function () {
        flushBlanks(true);
        if (excel && (st.skippedLabels || st.skippedNoType)) {
          var parts = [];
          if (st.skippedLabels) parts.push(st.skippedLabels + ' label row(s)');
          if (st.skippedNoType) parts.push(st.skippedNoType + ' row(s) with an empty Record Type in column A');
          add('S-SKIPPED', { msg: 'Ignored ' + parts.join(' and ') + '. They must not be in the exported text file.' });
        }
        if (st.records === 0) {
          add('F-EMPTY', { msg: 'Nothing to check.' });
        } else {
          if (!st.hd) add('S-HD-MISSING', { msg: 'No HD record found. Provider and date cross-checks were skipped.' });
          if (!st.ft) {
            add('S-FT-MISSING', { line: st.lineNo, msg: 'The last record must be FT|<ProviderCode>|<FileReferenceDate>|<number of records>.' });
          } else if (/^\d+$/.test(st.ft.count) && +st.ft.count !== st.records) {
            add('T-COUNT', {
              line: st.ft.line, rec: 'FT', pos: 4, value: st.ft.count, fields: st.ft.fields,
              msg: 'The file has ' + st.records + ' records (header and footer included); the footer says ' + st.ft.count + '.'
            });
          }
          var data = st.records - st.counts.HD - st.counts.FT;
          if (data <= 0) add('S-NODATA', { msg: 'Only header and footer were found.' });
        }
        st.subjRefs.forEach(function (r, no) {
          if (st.subjects.has(no)) return;
          add('X-NOSUBJ', {
            line: r.line, rec: r.rec, pos: r.pos, value: no, ref: no,
            msg: 'Referenced by ' + r.count + ' record(s). Fine if the subject was loaded in an earlier submission; otherwise add its ID or BD record.'
          });
        });

        var order = { error: 0, warning: 1, info: 2 };
        st.groupList.sort(function (a, b) {
          return order[a.sev] - order[b.sev] || b.count - a.count || a.firstLine - b.firstLine;
        });

        var hd = st.hd;
        var period = null;
        if (hd && hd.refDate) {
          var p = hd.refDate;
          var dueM = p.m === 12 ? 1 : p.m + 1, dueY = p.m === 12 ? p.y + 1 : p.y;
          var due = new Date(dueY, dueM - 1, 10);
          var start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          period = {
            label: MONTHS[p.m - 1] + ' ' + p.y,
            refDate: formatDate(p),
            due: '10 ' + MONTHS[dueM - 1] + ' ' + dueY,
            daysToDue: Math.round((due - start) / 86400000),
            monthsBehind: today.getFullYear() * 12 + today.getMonth() + 1 - (p.y * 12 + p.m)
          };
        }

        return {
          fileName: st.fileName || opts.fileName || '',
          mode: excel ? 'excel' : 'text',
          where: where,
          mfi: mfi,
          records: st.records,
          counts: st.counts,
          header: hd ? { provider: hd.provider, refDateRaw: hd.refDateRaw, version: hd.version, subType: hd.subType, comments: hd.comments } : null,
          footerCount: st.ft ? st.ft.count : null,
          period: period,
          subjects: st.subjects.size,
          contracts: st.contractTypes.size,
          transmittal: {
            individual: st.counts.ID, business: st.counts.BD, installment: st.counts.CI,
            nonInstallment: st.counts.CN, creditCard: st.counts.CC, utilities: st.counts.CS
          },
          totals: st.totals,
          groups: st.groupList,
          issues: st.issues,
          truncated: st.truncated,
          detail: st.detail
        };
      }
    };
  }

  // Splits a stream of decoded text chunks into lines.
  function createLineFeeder(checker) {
    var rest = '';
    return {
      push: function (chunk) {
        var data = rest + chunk;
        var start = 0, nl;
        while ((nl = data.indexOf('\n', start)) >= 0) {
          checker.line(data.slice(start, nl));
          start = nl + 1;
        }
        rest = data.slice(start);
      },
      end: function () {
        if (rest.length) checker.line(rest);
        rest = '';
      }
    };
  }

  return {
    createChecker: createChecker,
    createLineFeeder: createLineFeeder,
    RULES: RULES,
    colLetter: colLetter,
    parseDate: parseDate,
    // Shared with the auto-fixer.
    fieldDefs: COMPILED,
    domainMatch: domainMatch,
    stripZeros: stripZeros,
    validYMD: validYMD,
    GARBLED: GARBLED,
    TIN_FIELDS: TIN_FIELDS,
    TIN_RE: TIN_RE,
    FILE_NAME_RE: FILE_NAME_RE
  };
});
