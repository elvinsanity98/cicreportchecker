// Writes the fictitious sample files in samples/. Run: node tools/make_samples.js
const fs = require('fs');
const path = require('path');
const { cleanLines, brokenLines, PROVIDER } = require('../test/fixtures.js');

const root = path.join(__dirname, '..', 'samples');
const files = {
  [`clean/${PROVIDER}_CSDF_20260705093000.txt`]: cleanLines(),
  [`with-errors/${PROVIDER}_CSDF_20260705101500.txt`]: brokenLines()
};
for (const [name, lines] of Object.entries(files)) {
  const out = path.join(root, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // The broken sample is saved as ANSI on purpose, the way Excel and Notepad
  // save by default, so its "Ñ" is not valid UTF-8.
  fs.writeFileSync(out, lines.join('\r\n') + '\r\n', name.startsWith('with-errors') ? 'latin1' : 'utf8');
  console.log('wrote', path.relative(path.join(__dirname, '..'), out));
}
