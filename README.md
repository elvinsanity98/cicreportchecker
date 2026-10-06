# CIC Report Checker

Pre-checks a CIC submission file (CSDF) before you zip, encrypt and upload it, so
structure and format mistakes are caught on your desk instead of in CIC's
Output Error Report.

It is an unofficial helper. It does not replace CIC's own validation: a file
that passes here can still be rejected.

## Use it

Open **`index.html`** (the one in the top folder) in Chrome, Edge or Firefox and
drop a file on it.

- `.txt`: the submission file. This is the check that counts.
- `.zip`: the zipped `.txt`, before encryption.
- `.xlsx`: the Excel master file. It reads the sheet named `template` and
  reports problems by Excel row and column. Label rows are ignored.

The page is one self-contained file with no network requests. The submission
file is read by the browser and never leaves the computer, so the HTML file can
be copied to any PC or shared drive and used offline.

Tick **Submitting entity is a microfinance institution (MFI)** if that applies;
Place of Birth and Nationality then become optional.

The Results tab also gives the record counts to type into the CE Portal
transmittal form, and the regular-submission deadline for the covered period.

## Auto-fix

After a check, **Auto-fix this file** builds a corrected copy and lists every
change it made (line, field, before, after). It only rewrites a value when
there is exactly one thing it can mean; anything that needs a decision is left
alone and still reported.

| Fix | Example |
| --- | --- |
| Save as UTF-8 without BOM (always on) | A file saved as ANSI keeps its `Ñ`; `PEÃ‘A` becomes `PEÑA` |
| Remove label rows and blank lines; even out the field count | Trailing `\|\|\|` from Excel added or dropped |
| Comma-delimited lines to pipe-delimited | `HD,BANK1234,...` |
| Trim values and collapse double spaces | `" JUAN  CARLOS "` to `JUAN CARLOS` |
| Remove Excel quote wrapping; straighten curly quotes and long dashes | `"REYES"` to `REYES` |
| Upper-case codes; swap a description for its code | `m` to `M`, `PHILIPPINES` to `PH`, `Married` to `2` |
| Rewrite dates as `DDMMYYYY` | `1052014`, `2026-06-30`, `06302026`, `30-Jun-2026`, Excel date numbers |
| Clean numbers | `1,250,000.00` to `1250000` |
| TIN: digits only | `123-456-789-000` to `123456789000` |
| Header version and footer count | `1` to `1.0`; footer recounted |

Two more are **off until you tick them**, because they change the data itself.
The choice is remembered on that computer.

- **Replace Ñ and accented letters with plain letters** (`Ñ` to `N`). Not
  needed for a valid file: the encoding fix above already keeps `Ñ` intact.
- **Remove symbols from names, addresses and trade names**. Keeps letters,
  digits and spaces. Never touches subject or contract numbers, e-mail
  addresses or codes.

Not fixed, on purpose: ambiguous dates such as `05/06/2026`, numbers with real
decimals, missing values, codes that are not in the table, duplicates.

The corrected file gets a new name with a fresh timestamp. Dropping the `.xlsx`
master file and pressing **Build fixed .txt** produces the submission text file
directly from the sheet. Copy the same corrections into the master file, or
they return next month.

## What it checks

| Area | Checks |
| --- | --- |
| File | Name `<ProviderCode>_CSDF_<YYYYMMDDhhmmss>.txt`, UTF-8 without BOM, invalid bytes (ANSI `Ñ`), pipe delimiter |
| Structure | HD first, FT last, one of each, known record types, field count per record, leftover label rows, blank lines |
| Header / footer | Version `1.0`, Submission Type `0`/`1`, provider code matches file name and every record, footer date and record count |
| Fields | Mandatory fields, `DDMMYYYY` dates, plain numbers, maximum lengths, every coded field against CIC's code tables |
| Characters | Leading, trailing and double spaces, tabs, non-breaking spaces, curly quotes, garbled encoding (`Ã‘` for `Ñ`), digits or symbols in names |
| Cross-checks | Reference dates not after the File Reference Date, duplicate Provider Subject No, same contract twice for one subject, subjects referenced but not in the file |
| Consistency | Type/number pairs, TIN is 9 to 12 digits, address, identification and contact present, dates in order, dates that fit the Contract Phase, overdue number vs amount |

The **What is checked** tab lists every rule. Each one is marked:

- **CIC manual**: stated in the CIC session materials or the
  "Fields in Excel v1.7" workbook (record layouts, field counts, code tables,
  header rules, file naming).
- **Sanity check**: a sensible check those materials do not spell out.
  Read these as prompts to look, not as CIC's verdict.

### Known limits

The reference materials give full field rules only for the header and a few
individual fields. For the rest, this tool knows the field order, the type
implied by the field name (date, amount, code) and the code table, but not
CIC's official mandatory flags or maximum lengths. Those are therefore kept
deliberately small:

- Hard mandatory: record keys, names, date of birth, trade name, role, contract
  number, type and phase, event code, link fields.
- "Normally required" (warning only): gender, currency, event date, address,
  identification, contact.

If you have CIC's full data-format specification, tighten `src/spec.js`
(`req: 'M'`, `max: n`) and rebuild.

PSIC and PSOC codes lost their leading zeros in CIC's workbook, so those two
tables are matched with or without leading zeros.

## Command line

```bash
node cli.js samples/with-errors/BANK1234_CSDF_20260705101500.txt
```

Options: `--mfi`, `--all` (list every occurrence), `--csv findings.csv`,
`--fix` (write a corrected copy next to the input; add `--plain-letters` for
`Ñ` to `N` and `--no-symbols` to strip symbols).
Exit code is `0` when there are no errors, `1` when there are. Text files only.

## Change it

```
index.html                built file; this is what people open (do not edit)
cli.js                    command-line front end
src/spec.js               record layouts and field rules
src/domains.js            code tables (generated)
src/checker.js            validation engine and the rule list
src/fixer.js              auto-fixer and the list of fix kinds
src/readers.js            .txt / .zip / .xlsx readers
src/index.html, app.js, styles.css   the page source
tools/build.js            bundles src/ into the top-level index.html
tools/build_domains.py    regenerates src/domains.js from CIC's workbook
tools/make_samples.js     writes the fictitious files in samples/
test/run.js               tests
```

After editing anything in `src/`:

```bash
node test/run.js
```

```bash
node tools/build.js
```

When CIC issues a new "Fields in Excel" workbook (needs `pip install openpyxl`):

```bash
python tools/build_domains.py "path/to/Fields in Excel v1.8.xlsx"
```

The script reads fixed cell ranges that match v1.7, so compare a few tables in
the Code tables tab against the new workbook afterwards.

The files in `samples/` are made up; no real borrower data is included. The
`with-errors` file is saved as ANSI on purpose, to show the encoding fix.

Write invisible characters (non-breaking space, byte-order mark and the like)
as `\uXXXX` escapes in the source, never as the raw character; a test enforces
this.

## Credits

Developed by Eejay Gimena - IT Head - Rural Bank of Liloy (ZN), Inc.
