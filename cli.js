#!/usr/bin/env node
// Command-line front end for the checker. Handles .txt files (the browser tool
// also reads .zip and .xlsx).
//
//   node cli.js <file.txt> [--mfi] [--csv issues.csv] [--all] [--fix [--plain-letters] [--no-symbols] [--even-fields]]
//
// --fix writes a corrected copy next to the input (new timestamp in its name).
// Exit code: 0 = no errors (after fixing, with --fix), 1 = errors, 2 = could not run.
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
    fs.writeFileSync(csvOut, '\ufeff' + rows.map((row) => row.map(q).join(',')).join('\r\n') + '\r\n');
    console.log(`\nIssue list written to ${csvOut}`);
  }
  if (!args.includes('--fix')) process.exit(r.totals.error ? 1 : 0);

  const FIXER = require('./src/fixer.js');
  const fixer = FIXER.createFixer({
    options: { enye: args.includes('--plain-letters'), symbols: args.includes('--no-symbols'), fieldcount: args.includes('--even-fields') }
  });
  FIXER.feedBytes(fixer, new Uint8Array(fs.readFileSync(file)));
  const out = fixer.finish();
  console.log(`\nAuto-fix  ${out.total} fix(es) on ${out.changedLines} line(s)`);
  for (const kind of FIXER.KINDS) {
    if (out.counts[kind.id]) console.log(`    ${String(out.counts[kind.id]).padStart(6)}  ${kind.label}`);
  }
  if (!out.total) process.exit(r.totals.error ? 1 : 0);

  const name = FIXER.suggestName(out.provider, path.basename(file));
  const target = path.join(path.dirname(file), name);
  fs.writeFileSync(target, out.lines.join('\r\n') + '\r\n', 'utf8');
  const recheck = createChecker({ fileName: name, mfi: args.includes('--mfi') });
  out.lines.forEach((line) => recheck.line(line));
  const after = recheck.finish();
  console.log(`Written   ${target}`);
  console.log(`Now       ${after.totals.error} error(s), ${after.totals.warning} warning(s), ${after.totals.info} note(s) (was ${r.totals.error}, ${r.totals.warning}, ${r.totals.info})`);
  process.exit(after.totals.error ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
