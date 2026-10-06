#!/usr/bin/env node
// Command-line front end for the checker. Handles .txt files (the browser tool
// also reads .zip and .xlsx).
//
//   node cli.js <file.txt> [--mfi] [--csv issues.csv] [--all]
//
// Exit code: 0 = no errors, 1 = errors found, 2 = could not run.
const fs = require('fs');
const path = require('path');
const { createChecker, createLineFeeder } = require('./src/checker.js');

function main() {
  const args = process.argv.slice(2);
  const csvIdx = args.indexOf('--csv');
  const csvOut = csvIdx >= 0 ? args[csvIdx + 1] : null;
  const file = args.find((a, i) => !a.startsWith('--') && (csvIdx < 0 || i !== csvIdx + 1));
  if (!file) {
    console.error('Usage: node cli.js <ProviderCode_CSDF_Timestamp.txt> [--mfi] [--csv issues.csv] [--all]');
    process.exit(2);
  }
  const showAll = args.includes('--all');

  const checker = createChecker({ fileName: path.basename(file), mfi: args.includes('--mfi') });
  const feeder = createLineFeeder(checker);
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    feeder.push(decoder.decode(buf.subarray(0, n), { stream: true }));
  }
  fs.closeSync(fd);
  feeder.push(decoder.decode());
  feeder.end();
  const r = checker.finish();

  const h = r.header;
  console.log(`File      ${r.fileName}`);
  if (h) console.log(`Header    provider ${h.provider}, reference date ${h.refDateRaw}, version ${h.version}, submission type ${h.subType}`);
  if (r.period) console.log(`Period    ${r.period.label} (regular submission due ${r.period.due})`);
  console.log(`Records   ${r.records} total: ` + Object.keys(r.counts).filter((k) => r.counts[k]).map((k) => `${k} ${r.counts[k]}`).join(', '));
  console.log(`Result    ${r.totals.error} error(s), ${r.totals.warning} warning(s), ${r.totals.info} note(s)\n`);

  for (const g of r.groups) {
    const field = g.pos ? ` ${g.rec}${g.pos} ${g.field}:` : g.rec ? ` ${g.rec}:` : '';
    console.log(`[${g.sev.toUpperCase()}] ${g.code}${field} ${g.title} (${g.count})`);
    const rows = r.issues.filter((i) => i.group === g.key);
    for (const i of showAll ? rows : rows.slice(0, 5)) {
      const loc = i.line ? `line ${i.line}` : 'file';
      const val = i.value ? ` "${i.value}"` : '';
      console.log(`    ${loc}:${val} ${i.msg}`);
    }
    if (!showAll && g.count > 5) console.log(`    ... ${g.count - 5} more (use --all or --csv)`);
  }

  if (csvOut) {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const rows = [['Severity', 'Rule', 'Line', 'Record', 'Field No', 'Excel Column', 'Field', 'Value', 'Message']]
      .concat(r.issues.map((i) => [i.sev, i.code, i.line || '', i.rec, i.pos || '', i.col, i.field, i.value, i.msg]));
    fs.writeFileSync(csvOut, '﻿' + rows.map((row) => row.map(q).join(',')).join('\r\n') + '\r\n');
    console.log(`\nIssue list written to ${csvOut}`);
  }
  process.exit(r.totals.error ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
