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
  assert.ok(has(check(['﻿' + lines[0]].concat(lines.slice(1))), 'F-BOM'));
  assert.ok(has(withLine(1, fx.individual('IND-0001', 'JUAN', 'PE�A')), 'F-UTF8'));
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
