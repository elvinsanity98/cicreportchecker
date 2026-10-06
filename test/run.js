// Run: node test/run.js
const assert = require('assert');
const { createChecker, createLineFeeder, parseDate, colLetter } = require('../src/checker.js');
const SPEC = require('../src/spec.js');
const fx = require('./fixtures.js');
const zlib = require('zlib');

// The readers are browser code; Node 20 has the same File, stream and
// DecompressionStream APIs, so they run here once the globals are in place.
globalThis.CIC_CHECKER = require('../src/checker.js');
require('../src/readers.js');
const { checkFile } = globalThis.CIC_READERS;

const TODAY = new Date(2026, 6, 5);
const NAME = 'BANK1234_CSDF_20260705093000.txt';

function check(lines, opts) {
  const c = createChecker(Object.assign({ fileName: NAME, today: TODAY }, opts));
  lines.forEach((l) => c.line(l));
  return c.finish();
}
const codes = (r, sev) => r.issues.filter((i) => !sev || i.sev === sev).map((i) => i.code + (i.pos ? ':' + i.rec + i.pos : ''));
const has = (r, code) => codes(r).includes(code);

// Replace one record of the clean file and return the result.
function withLine(index, line, opts) {
  const lines = fx.cleanLines();
  lines[index] = line;
  return check(lines, opts);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('field counts match the CIC overview slide', () => {
  const expected = { HD: 6, ID: 123, BD: 49, SL: 7, NE: 10, CI: 143, CN: 127, CC: 143, CS: 29, FT: 4 };
  for (const [type, n] of Object.entries(expected)) assert.strictEqual(SPEC.RECORDS[type].fields.length, n, type);
});

test('field positions match the template columns', () => {
  const at = (type, col) => SPEC.RECORDS[type].fields.findIndex((f, i) => colLetter(i + 1) === col);
  assert.strictEqual(SPEC.RECORDS.ID.fields[at('ID', 'O')].name, 'Place of Birth');
  assert.strictEqual(SPEC.RECORDS.ID.fields[at('ID', 'AF')].name, 'Address 1: Address Type');
  assert.strictEqual(SPEC.RECORDS.ID.fields[at('ID', 'DS')].name, 'Sole Trader Contact 2: Value');
  assert.strictEqual(SPEC.RECORDS.CI.fields[at('CI', 'AP')].name, 'Guarantee 1: Provider Guarantee No');
  assert.strictEqual(SPEC.RECORDS.CN.fields[at('CN', 'DF')].name, 'Linked Subject 1: Provider Subject No');
  assert.strictEqual(SPEC.RECORDS.CC.fields[at('CC', 'AO')].name, 'Cancellation Date');
});

test('clean file has no findings', () => {
  const r = check(fx.cleanLines());
  assert.deepStrictEqual(codes(r), []);
  assert.strictEqual(r.records, 13);
  assert.deepStrictEqual(r.transmittal, { individual: 3, business: 1, installment: 2, nonInstallment: 1, creditCard: 1, utilities: 1 });
  assert.strictEqual(r.period.label, 'June 2026');
  assert.strictEqual(r.period.due, '10 July 2026');
  assert.strictEqual(r.period.daysToDue, 5);
});

test('date parsing', () => {
  assert.strictEqual(parseDate('29022024').ok, true);
  assert.strictEqual(parseDate('29022023').ok, false);
  assert.match(parseDate('20260630').hint, /YYYYMMDD/);
  assert.match(parseDate('06302026').hint, /MMDDYYYY/);
  assert.match(parseDate('1052014').hint, /leading zero/);
  assert.match(parseDate('46203').hint, /serial/);
  assert.match(parseDate('30/06/2026').hint, /separators/);
});

test('file name rules', () => {
  const bad = ['bank_CSDF_20260705093000.txt', 'BANK1234_CSDF_20260705.txt', 'BANK1234_CSDF_20261305093000.txt',
    'BANK1234_CSDF_20260705253000.txt', 'BANK1234_CSDF_20260705093000.csv', 'BANK1234-CSDF-20260705093000.txt'];
  for (const name of bad) assert.ok(has(check(fx.cleanLines(), { fileName: name }), 'F-NAME'), name);
  assert.ok(has(check(fx.cleanLines(), { fileName: 'BANK9999_CSDF_20260705093000.txt' }), 'H-FILEPROV:HD2'));
});

test('BOM, encoding and delimiter', () => {
  const lines = fx.cleanLines();
  assert.ok(has(check(['\ufeff' + lines[0]].concat(lines.slice(1))), 'F-BOM'));
  assert.ok(has(withLine(1, fx.individual('IND-0001', 'JUAN', 'PE\ufffdA')), 'F-UTF8'));
  assert.ok(has(withLine(1, 'ID,BANK1234,B0001,30062026,IND-0001'), 'S-DELIM'));
});

test('header rules', () => {
  assert.ok(has(withLine(0, 'HD|BANK1234|30062026|2.0|0|'), 'H-VERSION:HD4'));
  assert.ok(has(withLine(0, 'HD|BANK1234|30062026|1.0|3|'), 'H-SUBTYPE:HD5'));
  assert.ok(has(withLine(0, 'HD|BANK1234|31072026|1.0|0|'), 'H-FUTURE:HD3'));
  assert.ok(has(withLine(0, 'HD|BANK1234||1.0|0|'), 'V-REQ:HD3'));
  assert.ok(has(withLine(0, 'HD|BANK1234|30062026|1.0|0|' + 'X'.repeat(101)), 'V-LEN:HD6'));
  const noHeader = check(fx.cleanLines().slice(1));
  assert.ok(has(noHeader, 'S-HD-FIRST') && has(noHeader, 'S-HD-MISSING'));
});

test('footer rules', () => {
  const lines = fx.cleanLines();
  assert.ok(has(withLine(12, 'FT|BANK1234|30062026|12'), 'T-COUNT:FT4'));
  assert.ok(has(withLine(12, 'FT|BANK1234|31052026|13'), 'T-DATE:FT3'));
  assert.ok(has(check(lines.slice(0, 12)), 'S-FT-MISSING'));
  assert.ok(has(check(lines.concat([lines[1].replace('IND-0001', 'IND-0009')])), 'S-FT-LAST'));
});

test('structure rules', () => {
  assert.ok(has(withLine(1, 'XX|BANK1234|B0001|30062026|IND-0001'), 'S-TYPE'));
  assert.ok(has(withLine(1, 'Record Type|Provider Code|Branch Code'), 'S-LABEL'));
  const lines = fx.cleanLines();
  lines.splice(3, 0, '');
  const blank = check(lines);
  assert.ok(blank.issues.some((i) => i.code === 'S-BLANK' && i.sev === 'error' && i.line === 4));
  const trailing = check(fx.cleanLines().concat(['', '']));
  assert.ok(trailing.issues.some((i) => i.code === 'S-BLANK' && i.sev === 'warning'));
  assert.strictEqual(trailing.totals.error, 0);
  // Short and padded rows are warnings; real data past the layout is an error.
  assert.deepStrictEqual(codes(withLine(0, 'HD|BANK1234|30062026|1.0|0')), ['S-COUNT']);
  assert.deepStrictEqual(codes(withLine(0, 'HD|BANK1234|30062026|1.0|0|||||')), ['S-COUNT']);
  assert.ok(has(withLine(0, 'HD|BANK1234|30062026|1.0|0|NOTE|EXTRA'), 'S-EXTRA'));
});

test('MFI switch controls Place of Birth and Nationality', () => {
  const line = fx.individual('IND-0001', 'JUAN', 'DELA CRUZ', { 'Place of Birth': '', 'Nationality': '' });
  assert.deepStrictEqual(codes(withLine(1, line)).sort(), ['V-REQ:ID15', 'V-REQ:ID17']);
  assert.deepStrictEqual(codes(withLine(1, line, { mfi: true })), []);
});

test('subject rules', () => {
  const dup = check(fx.cleanLines().slice(0, 2).concat([fx.individual('IND-0001', 'ANA', 'LIM'), 'FT|BANK1234|30062026|4']));
  assert.ok(has(dup, 'X-DUPSUBJ:ID5'));
  assert.ok(has(withLine(1, fx.individual('IND-0001', 'JUAN', 'DELA CRUZ', { 'Date of Birth': '01012020' })), 'C-DOB:ID14'));
  assert.ok(has(withLine(1, fx.individual('IND-0001', 'JUAN', 'DELA CRUZ', { 'Provider Subject No': 'X'.repeat(39) })), 'V-LEN:ID5'));
  assert.ok(has(withLine(1, fx.individual('IND-0001', 'JUAN', 'DELA CRUZ', { 'Address 1: Address Type': 'MT' })), 'V-CODE:ID32'));
  assert.ok(has(withLine(1, fx.individual('IND-0001', 'JUAN', 'DELA CRUZ', { 'Identification 1: Type': '', 'Identification 1: Number': '' })), 'C-IDENT:ID54'));
  assert.ok(has(withLine(4, fx.business('COM-0001', 'ACME', { 'Address 1: Address Type': 'MI' })), 'V-CODE:BD20'));
  // PSIC codes lose their leading zero in Excel; both spellings pass.
  assert.deepStrictEqual(codes(withLine(4, fx.business('COM-0001', 'ACME', { 'PSIC': '01111' }))), []);
  assert.deepStrictEqual(codes(withLine(4, fx.business('COM-0001', 'ACME', { 'PSIC': '1111' }))), []);
  assert.ok(has(withLine(4, fx.business('COM-0001', 'ACME', { 'PSIC': '00007' })), 'V-CODE:BD12'));
});

test('contract rules', () => {
  const ci = (extra) => withLine(6, fx.installment('IND-0001', 'LN-2024-000101', extra));
  assert.ok(has(ci({ 'Contract Type': '40' }), 'V-CODE:CI8'));
  assert.ok(has(ci({ 'Role': '' }), 'V-REQ:CI6'));
  assert.ok(has(ci({ 'Financed Amount': '100,000' }), 'V-NUM:CI20'));
  assert.ok(has(ci({ 'Financed Amount': '1E+05' }), 'V-NUM:CI20'));
  assert.ok(has(ci({ 'Financed Amount': '100000.50' }), 'V-DEC:CI20'));
  assert.ok(has(ci({ 'Contract Phase': 'CL' }), 'C-PHASE:CI16'));
  assert.ok(has(ci({ 'Contract Reference Date': '31072026' }), 'X-REFDATE:CI4'));
  assert.ok(has(ci({ 'Provider Subject No': 'NOBODY' }), 'X-NOSUBJ:CI5'));
  assert.deepStrictEqual(codes(ci({ 'Overdue Days': 'N' })), []);
  assert.ok(has(ci({ 'Guarantee 1: Guarantee Type': '999' }), 'V-CODE:CI49'));
  assert.ok(has(ci({ 'Linked Subject 1: Provider Subject No': 'IND-0002' }), 'C-PAIR:CI127'));
  // Same contract for a co-borrower is fine; the same subject twice is not.
  const lines = fx.cleanLines();
  lines.splice(7, 0, fx.installment('IND-0003', 'LN-2024-000101', { 'Role': 'C' }));
  lines[lines.length - 1] = 'FT|BANK1234|30062026|14';
  assert.deepStrictEqual(codes(check(lines)), []);
  lines.splice(7, 0, fx.installment('IND-0001', 'LN-2024-000101'));
  lines[lines.length - 1] = 'FT|BANK1234|30062026|15';
  assert.ok(has(check(lines), 'X-DUPCON:CI7'));
});

test('excel rows: labels and helper rows are skipped, short rows accepted', () => {
  const c = createChecker({ mode: 'excel', today: TODAY });
  const rows = fx.cleanLines().map((l) => l.split('|'));
  c.row(['Record Type', 'Provider Code'], 1);
  c.row(rows[0], 2);
  c.row(['', '', '', 'DDMMYYYY'], 3);
  rows.slice(1).forEach((cells, i) => c.row(cells, i + 4));
  const r = c.finish();
  assert.deepStrictEqual(codes(r), ['S-SKIPPED']);
  assert.strictEqual(r.records, 13);
  assert.strictEqual(r.totals.error, 0);
});

test('line feeder handles chunk boundaries and CRLF', () => {
  const c = createChecker({ fileName: NAME, today: TODAY });
  const feeder = createLineFeeder(c);
  const text = fx.cleanLines().join('\r\n') + '\r\n';
  for (let i = 0; i < text.length; i += 37) feeder.push(text.slice(i, i + 37));
  feeder.end();
  assert.deepStrictEqual(codes(c.finish()), []);
});

test('broken sample trips the expected rules', () => {
  const r = check(fx.brokenLines(), { fileName: 'BANK1234_CSDF_20260705101500.txt' });
  for (const code of ['S-LABEL', 'S-HD-FIRST', 'H-VERSION:HD4', 'H-SUBTYPE:HD5', 'V-DATE:ID14', 'V-CASE:ID13',
    'V-REQ:ID8', 'X-DUPSUBJ:ID5', 'X-REFDATE:ID4', 'V-CODE:ID17', 'C-PAIR:ID55', 'X-PROV:BD2', 'V-NUM:BD16',
    'X-DUPCON:CI7', 'V-CODE:CI11', 'S-BLANK', 'T-COUNT:FT4', 'X-NOSUBJ:CI5']) {
    assert.ok(has(r, code), code);
  }
});

// ---- detections added with the auto-fixer -------------------------------

const FIXER = require('../src/fixer.js');
const fs = require('fs');
const path = require('path');
const ch = (...codes) => String.fromCharCode(...codes);
const ENYE = ch(0xd1);

test('double spaces, odd characters, name symbols and TIN format are reported', () => {
  const id = (extra) => withLine(1, fx.individual('IND-0001', 'JUAN', 'DELA CRUZ', extra));
  assert.ok(has(id({ 'First Name': 'JUAN  CARLOS' }), 'V-DSPACE:ID7'));
  assert.ok(has(id({ 'Address 1: FullAddress': '23' + ch(0xa0) + 'MABINI ST' }), 'V-ODD:ID33'));
  assert.ok(has(id({ 'Last Name': 'PE' + ch(0xc3, 0x2018) + 'A' }), 'V-ODD:ID8'));
  assert.ok(has(id({ 'Last Name': 'DELA CRUZ, JR' }), 'V-NAME:ID8'));
  assert.ok(has(id({ 'Nickname': 'JUN2' }), 'V-NAME:ID11'));
  assert.deepStrictEqual(codes(id({ 'Last Name': "O'BRIEN-PE" + ENYE + 'A JR.' })), []);
  assert.ok(has(id({ 'Identification 1: Number': '123-456-789' }), 'C-TIN:ID55'));
  assert.ok(has(id({ 'Identification 1: Number': '12345678' }), 'C-TIN:ID55'));
  assert.ok(has(id({ 'Employment: TIN': '123-456-789' }), 'C-TIN:ID83'));
  // Only TIN (type 10) has the digits rule.
  assert.deepStrictEqual(codes(id({ 'Identification 1: Type': '11', 'Identification 1: Number': '34-1234567-8' })), []);
  assert.ok(has(withLine(4, fx.business('COM-0001', 'ACME', { 'Identification 1: Number': '987 654 321' })), 'C-TIN:BD43'));
});

// ---- auto-fixer --------------------------------------------------------

function fix(lines, options) {
  const f = FIXER.createFixer({ options });
  lines.forEach((l) => f.line(l));
  return f.finish();
}
// Field value of one record after fixing, by field name.
function fixedValue(type, lineText, fieldName, options) {
  const out = fix([lineText], options);
  const idx = SPEC.RECORDS[type].fields.findIndex((d) => d.name === fieldName);
  return out.lines[0].split('|')[idx];
}

test('fixer: a clean file comes back unchanged', () => {
  const out = fix(fx.cleanLines());
  assert.strictEqual(out.total, 0);
  assert.deepStrictEqual(out.lines, fx.cleanLines());
});

test('fixer: dates are rewritten only when there is one reading', () => {
  const same = { '1052014': '01052014', '2026-06-30': '30062026', '30/06/2026': '30062026', '06/30/2026': '30062026',
    '06302026': '30062026', '20260630': '30062026', '46203': '30062026', '30-Jun-2026': '30062026',
    'June 30, 2026': '30062026', '2026-06-30 00:00:00': '30062026', '30.06.2026': '30062026', '5/5/2026': '05052026' };
  for (const [from, to] of Object.entries(same)) assert.strictEqual(FIXER.fixDate(from), to, from);
  // Valid already, impossible, or readable two ways: left alone.
  for (const v of ['30062026', '05/06/2026', '31/02/2026', '1211989', '30/06/26', 'N/A', '99999999']) assert.strictEqual(FIXER.fixDate(v), null, v);
});

test('fixer: numbers, TINs and garbled text', () => {
  const nums = { '1,250,000.00': '1250000', '100,000': '100000', '1 000': '1000', 'PHP 1,000': '1000', '1,234.50': '1234.50' };
  for (const [from, to] of Object.entries(nums)) assert.strictEqual(FIXER.fixNumber(from), to, from);
  for (const v of ['100', '100000.50', '12,5', '1,00,000', '1E+05', 'abc', '-500']) assert.strictEqual(FIXER.fixNumber(v), null, v);
  assert.strictEqual(FIXER.fixTin('123-456-789-000'), '123456789000');
  assert.strictEqual(FIXER.fixTin('123 456 789'), '123456789');
  for (const v of ['123456789', '12345', 'A23456789', '123-456']) assert.strictEqual(FIXER.fixTin(v), null, v);
  assert.strictEqual(FIXER.repairGarbled('PE' + ch(0xc3, 0x2018) + 'A'), 'PE' + ENYE + 'A');
  assert.strictEqual(FIXER.repairGarbled('pe' + ch(0xc3, 0xb1) + 'a'), 'pe' + ch(0xf1) + 'a');
  assert.strictEqual(FIXER.repairGarbled('PE' + ENYE + 'A'), 'PE' + ENYE + 'A');
});

test('fixer: field fixes inside a record', () => {
  const line = fx.individual('IND-0001', '  JUAN   CARLOS ', 'DELA' + ch(0xa0) + 'CRUZ', {
    'Gender': 'male', 'Civil Status': 'Married', 'Nationality': 'Philippines', 'Date of Birth': '1989-11-12',
    'Number of Dependents': '2.0', 'Identification 1: Number': '123-456-789-000', 'Employment: GrossIncome': '25,000.00',
    'Middle Name': '"REYES"', 'Nickname': 'JUN' + ch(0x2019) + 'S', 'Address 1: Address Type': 'mi', 'Title': '10.0'
  });
  const out = fix([line]);
  const get = (name) => out.lines[0].split('|')[SPEC.RECORDS.ID.fields.findIndex((d) => d.name === name)];
  assert.strictEqual(get('First Name'), 'JUAN CARLOS');
  assert.strictEqual(get('Last Name'), 'DELA CRUZ');
  assert.strictEqual(get('Gender'), 'M');
  assert.strictEqual(get('Civil Status'), '2');
  assert.strictEqual(get('Nationality'), 'PH');
  assert.strictEqual(get('Date of Birth'), '12111989');
  assert.strictEqual(get('Number of Dependents'), '2');
  assert.strictEqual(get('Identification 1: Number'), '123456789000');
  assert.strictEqual(get('Employment: GrossIncome'), '25000');
  assert.strictEqual(get('Middle Name'), 'REYES');
  assert.strictEqual(get('Nickname'), "JUN'S");
  assert.strictEqual(get('Address 1: Address Type'), 'MI');
  assert.strictEqual(get('Title'), '10');
  // Every change is logged with the field it touched.
  assert.ok(out.changes.every((c) => c.line === 1 && c.rec === 'ID' && c.pos > 0 && c.before !== c.after));
  assert.strictEqual(out.changedLines, 1);
  // The fixed record passes the checker.
  const lines = fx.cleanLines();
  lines[1] = out.lines[0];
  assert.deepStrictEqual(codes(check(lines)), []);
});

test('fixer: structure, header and footer', () => {
  const src = fx.cleanLines();
  const messy = ['Record Type|Provider Code|File Reference Date', src[0].replace('|1.0|', '|1|'), '', 'id' + src[1].slice(2)]
    .concat(src.slice(2, 12), ['', src[12].replace(/\|13$/, '|99') + '|||', '']);
  messy[5] = messy[5].replace(/\|+$/, '');
  const out = fix(messy);
  assert.deepStrictEqual(out.lines, src);
  assert.strictEqual(out.records, 13);
  assert.deepStrictEqual(codes(check(out.lines)), []);
  for (const kind of ['structure', 'header', 'codes']) assert.ok(out.counts[kind] > 0, kind);
});

test('fixer: comma-delimited lines become pipe-delimited', () => {
  const out = fix(['HD,BANK1234,30062026,1.0,0,"JUNE, REGULAR"', 'FT,BANK1234,30062026,2']);
  assert.deepStrictEqual(out.lines, ['HD|BANK1234|30062026|1.0|0|JUNE, REGULAR', 'FT|BANK1234|30062026|2']);
  assert.strictEqual(out.counts.delimiter, 2);
});

test('fixer: accents and symbols are only touched when asked', () => {
  const line = fx.individual('IND-0001', 'MA. TERESA', "DELA PE" + ENYE + 'A-CRUZ, JR.', {
    'Address 1: FullAddress': '#12 RIZAL ST., BRGY. STO. NI' + ENYE + 'O', 'Provider Subject No': 'IND-0001/A',
    'Contact 1: Type': '7', 'Contact 1: Value': 'ma.teresa@example.com'
  });
  assert.strictEqual(fix([line]).total, 0);
  const plain = (name, options) => fixedValue('ID', line, name, options);
  assert.strictEqual(plain('Last Name', { enye: true }), 'DELA PENA-CRUZ, JR.');
  assert.strictEqual(plain('Last Name', { symbols: true }), 'DELA PE' + ENYE + 'A CRUZ JR');
  assert.strictEqual(plain('First Name', { symbols: true }), 'MA TERESA');
  assert.strictEqual(plain('Address 1: FullAddress', { symbols: true, enye: true }), '12 RIZAL ST BRGY STO NINO');
  // Keys, e-mail addresses and codes are never stripped.
  assert.strictEqual(plain('Provider Subject No', { symbols: true, enye: true }), 'IND-0001/A');
  assert.strictEqual(plain('Contact 1: Value', { symbols: true, enye: true }), 'ma.teresa@example.com');
  assert.strictEqual(FIXER.stripSymbols("O'BRIEN & SONS"), 'OBRIEN AND SONS');
});

test('fixer: each kind can be switched off', () => {
  const line = fx.individual('IND-0001', ' JUAN', 'DELA CRUZ', { 'Gender': 'm', 'Date of Birth': '1989-11-12' });
  const all = fix([line]);
  assert.deepStrictEqual([all.counts.spaces, all.counts.codes, all.counts.dates], [1, 1, 1]);
  const some = fix([line], { dates: false, codes: false });
  assert.deepStrictEqual([some.counts.spaces, some.counts.codes, some.counts.dates], [1, 0, 0]);
  assert.strictEqual(fixedValue('ID', line, 'Date of Birth', { dates: false }), '1989-11-12');
});

test('fixer: ANSI bytes and BOM become plain UTF-8', () => {
  const text = fx.cleanLines().join('\r\n').replace('DELA CRUZ', 'PE' + ENYE + 'A') + '\r\n';
  const expected = text.trimEnd().split('\r\n');
  for (const bytes of [Buffer.from(text, 'latin1'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])]) {
    const f = FIXER.createFixer({});
    FIXER.feedBytes(f, new Uint8Array(bytes));
    const out = f.finish();
    assert.deepStrictEqual(out.lines, expected);
    assert.strictEqual(out.counts.encoding, 1);
    assert.deepStrictEqual(codes(check(out.lines)), []);
  }
});

test('fixer: fixing twice changes nothing more, and the broken sample improves', () => {
  const before = check(fx.brokenLines());
  const out = fix(fx.brokenLines());
  const after = check(out.lines);
  assert.ok(after.totals.error < before.totals.error && after.totals.warning < before.totals.warning);
  assert.strictEqual(fix(out.lines).total, 0);
  // What needs a decision is still reported.
  for (const code of ['V-REQ:ID8', 'X-DUPSUBJ:ID5', 'V-CODE:BD10', 'X-DUPCON:CI7', 'H-SUBTYPE:HD5']) assert.ok(has(after, code), code);
  // The fully fixable record keeps only its name-symbol warning, and loses
  // that too once symbol removal is switched on.
  const left = (result) => result.issues.filter((i) => (result.detail.get(i.line) || [])[4] === 'IND-0004').map((i) => i.code);
  assert.deepStrictEqual(left(after), ['V-NAME']);
  assert.deepStrictEqual(left(check(fix(fx.brokenLines(), { symbols: true }).lines)), []);
});

test('fixer: suggested file name', () => {
  const now = new Date(2026, 6, 5, 9, 3, 7);
  assert.strictEqual(FIXER.suggestName('BANK1234', 'whatever.txt', now), 'BANK1234_CSDF_20260705090307.txt');
  assert.strictEqual(FIXER.suggestName('', 'PRVD9999_CSDF_20141229030101.txt', now), 'PRVD9999_CSDF_20260705090307.txt');
  assert.strictEqual(FIXER.suggestName('TOO-LONG-CODE', 'june.txt', now), 'june_fixed.txt');
});

test('source files hold no invisible characters', () => {
  // Such characters must be written as escapes: they are easy to lose in an
  // editor, and a line separator inside a regex literal breaks the script.
  const hidden = (o) => (o < 32 && o !== 9 && o !== 10 && o !== 13) || (o >= 0x7f && o <= 0xa0) || o === 0xad ||
    (o >= 0x300 && o <= 0x36f) || (o >= 0x2000 && o <= 0x200f) || [0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x2060, 0x3000, 0xfeff, 0xfffd].includes(o);
  const root = path.join(__dirname, '..');
  const files = ['cli.js', 'index.html'].concat(
    ['src', 'test', 'tools'].flatMap((dir) => fs.readdirSync(path.join(root, dir)).filter((f) => /\.(js|html|css)$/.test(f)).map((f) => dir + '/' + f)));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (let i = 0; i < text.length; i++) {
      if (hidden(text.charCodeAt(i))) assert.fail(`${file}: U+${text.charCodeAt(i).toString(16)} at offset ${i}`);
    }
  }
});

// ---- file readers ------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Minimal ZIP writer: entries are { name, data, store }.
function makeZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.from(e.data);
    const body = e.store ? raw : zlib.deflateRawSync(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(e.store ? 0 : 8, 8);
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26);
    locals.push(head, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(e.store ? 0 : 8, 10);
    dir.writeUInt32LE(crc32(raw), 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([dirBuf, end]));
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal workbook: a "notes" sheet first, then "template" holding the rows.
// Short digit strings become numeric cells, column B inline strings, the rest
// shared strings, so all three cell kinds are exercised.
function makeXlsx(rows) {
  const strings = [];
  const index = new Map();
  const sheetRows = rows.map((cells, r) => {
    const out = cells.map((value, c) => {
      if (value === '') return '';
      const ref = colLetter(c + 1) + (r + 1);
      if (/^[1-9]\d*$/.test(value) && value.length < 8) return `<c r="${ref}"><v>${value}</v></c>`;
      if (c === 1) return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
      if (!index.has(value)) { index.set(value, strings.length); strings.push(value); }
      return `<c r="${ref}" t="s"><v>${index.get(value)}</v></c>`;
    }).join('');
    return out ? `<row r="${r + 1}">${out}</row>` : `<row r="${r + 1}"/>`;
  }).join('');
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  return makeZip([
    { name: 'xl/workbook.xml', data: `<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="notes" sheetId="1" r:id="rId1"/><sheet name="template" sheetId="2" r:id="rId2"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: `<sst ${ns}>${strings.map((t) => `<si><t xml:space="preserve">${xmlEscape(t)}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>XX</t></is></c></row></sheetData></worksheet>` },
    { name: 'xl/worksheets/sheet2.xml', data: `<worksheet ${ns}><sheetData>${sheetRows}</sheetData></worksheet>` }
  ]);
}

const cleanText = () => fx.cleanLines().join('\r\n') + '\r\n';

test('reader: plain text file', async () => {
  const r = await checkFile(new File([cleanText()], NAME), {});
  assert.deepStrictEqual(codes(r), []);
  assert.strictEqual(r.records, 13);
  const bom = await checkFile(new File([Buffer.from([0xef, 0xbb, 0xbf]), cleanText()], NAME), {});
  assert.deepStrictEqual(codes(bom), ['F-BOM']);
  // "Ñ" saved as ANSI (0xD1) is not valid UTF-8.
  const ansi = Buffer.from(cleanText().replace('DELA CRUZ', 'PEÑA'), 'latin1');
  assert.deepStrictEqual(codes(await checkFile(new File([ansi], NAME), {})), ['F-UTF8']);
  const utf8 = Buffer.from(cleanText().replace('DELA CRUZ', 'PEÑA'), 'utf8');
  assert.deepStrictEqual(codes(await checkFile(new File([utf8], NAME), {})), []);
});

test('reader: zip of the text file', async () => {
  for (const store of [false, true]) {
    const zip = makeZip([{ name: NAME, data: cleanText(), store }]);
    const r = await checkFile(new File([zip], NAME.replace('.txt', '.zip')), {});
    assert.deepStrictEqual(codes(r), []);
    assert.strictEqual(r.fileName, NAME);
  }
  const two = makeZip([{ name: 'notes/readme.md', data: 'hello' }, { name: 'wrong name.txt', data: cleanText() }]);
  const r = await checkFile(new File([two], 'upload.zip'), {});
  assert.ok(has(r, 'F-CONTAINER') && has(r, 'F-NAME'));
});

test('reader: excel master file', async () => {
  const lines = fx.cleanLines();
  lines[4] = fx.business('COM-0001', 'A & B <TRADING> CORP');
  const rows = [['Record Type', 'Provider Code'], lines[0].split('|'), ['', '', '', 'DDMMYYYY'], []]
    .concat(lines.slice(1).map((l) => l.split('|')));
  const r = await checkFile(new File([makeXlsx(rows)], 'master.xlsx'), {});
  assert.deepStrictEqual(codes(r), ['S-SKIPPED']);
  assert.strictEqual(r.records, 13);
  assert.match(r.source, /template/);
  // A date typed as a number loses its leading zero; the finding points at the cell.
  rows[4][13] = '1211989';
  const bad = await checkFile(new File([makeXlsx(rows)], 'master.xlsx'), {});
  const issue = bad.issues.find((i) => i.code === 'V-DATE');
  assert.strictEqual(issue.line, 5);
  assert.strictEqual(issue.col, 'N');
  assert.strictEqual(bad.detail.get(5)[6], 'JUAN');
  assert.strictEqual(bad.detail.get(5)[1], 'BANK1234');
});

test('reader: refuses encrypted and legacy files', async () => {
  await assert.rejects(checkFile(new File(['x'], 'BANK1234_CSDF_20260705093000.zip.gpg'), {}), /encrypted/);
  await assert.rejects(checkFile(new File(['x'], 'master.xls'), {}), /\.xlsx/);
  await assert.rejects(checkFile(new File(['not a zip'], 'file.zip'), {}), /ZIP/);
});

test('reader: fixFile corrects text, zip and excel input', async () => {
  globalThis.CIC_FIXER = FIXER;
  const { fixFile } = globalThis.CIC_READERS;
  const broken = Buffer.from(fx.brokenLines().join('\r\n') + '\r\n', 'latin1');
  const res = await fixFile(new File([broken], 'BANK1234_CSDF_20260705101500.txt'), {});
  assert.match(res.fileName, /^BANK1234_CSDF_\d{14}\.txt$/);
  assert.ok(res.fix.total > 0 && res.fix.counts.encoding > 0);
  for (const code of ['F-UTF8', 'F-NAME', 'S-LABEL', 'S-BLANK', 'T-COUNT:FT4']) assert.ok(!has(res.after, code), code);
  // The corrected file is UTF-8 without BOM, CRLF line ends, with its Ñ intact.
  const bytes = Buffer.from(await new Blob(res.parts).arrayBuffer());
  const text = bytes.toString('utf8');
  assert.ok(bytes[0] !== 0xef && text.endsWith('\r\n') && !text.includes('\r\n\r\n'));
  assert.ok(text.includes('STO. NI' + ENYE + 'O') && !text.includes(ch(0xfffd)));
  assert.strictEqual(res.size, bytes.length);
  assert.strictEqual(res.after.records, text.trimEnd().split('\r\n').length);

  const zip = makeZip([{ name: 'BANK1234_CSDF_20260705101500.txt', data: broken }]);
  const zipped = await fixFile(new File([zip], 'upload.zip'), {});
  assert.deepStrictEqual(zipped.fix.lines, res.fix.lines);

  // Excel master file in, finished text file out.
  const rows = [['Record Type', 'Provider Code'], []].concat(fx.cleanLines().map((l) => l.split('|')));
  rows[3][13] = '1989-11-12';
  const sheet = await fixFile(new File([makeXlsx(rows)], 'master.xlsx'), {});
  assert.deepStrictEqual(sheet.fix.lines, fx.cleanLines());
  assert.strictEqual(sheet.fix.total, 1);
  assert.deepStrictEqual(codes(sheet.after), []);
  assert.match(sheet.fileName, /^BANK1234_CSDF_\d{14}\.txt$/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('ok   ' + name);
    } catch (e) {
      failed++;
      console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     '));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
