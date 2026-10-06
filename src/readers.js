// Browser file readers: feed a .txt, .zip or .xlsx File into the checker.
// Everything is read locally with the File API; nothing is uploaded.
(function (root) {
  'use strict';
  var CHECKER = root.CIC_CHECKER;

  function ext(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(name);
    return m ? m[1].toLowerCase() : '';
  }

  function tick() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  // ---- text --------------------------------------------------------------

  // Decodes a byte stream as UTF-8 and feeds it line by line. The BOM is kept
  // so the checker can report it; bad bytes become U+FFFD and are reported too.
  async function feedStream(stream, checker, total, onProgress) {
    var decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    var feeder = CHECKER.createLineFeeder(checker);
    var reader = stream.getReader();
    var done = 0, lastPaint = Date.now();
    for (;;) {
      var part = await reader.read();
      if (part.done) break;
      feeder.push(decoder.decode(part.value, { stream: true }));
      done += part.value.byteLength;
      if (Date.now() - lastPaint > 80) {
        if (onProgress) onProgress(total ? Math.min(done / total, 1) : 0);
        await tick();
        lastPaint = Date.now();
      }
    }
    feeder.push(decoder.decode());
    feeder.end();
  }

  // ---- zip ---------------------------------------------------------------

  function u16(view, o) { return view.getUint16(o, true); }
  function u32(view, o) { return view.getUint32(o, true); }

  async function readZipDirectory(file) {
    var tailSize = Math.min(file.size, 65557);
    var tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    var eocd = -1;
    for (var i = tail.byteLength - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP file (no central directory found).');
    var count = u16(tail, eocd + 10);
    var size = u32(tail, eocd + 12);
    var offset = u32(tail, eocd + 16);
    if (count === 0xffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported. Check the .txt file directly.');
    var dir = new DataView(await file.slice(offset, offset + size).arrayBuffer());
    var names = new TextDecoder('utf-8');
    var entries = [];
    var p = 0;
    for (var n = 0; n < count && p + 46 <= dir.byteLength; n++) {
      if (u32(dir, p) !== 0x02014b50) break;
      var nameLen = u16(dir, p + 28), extraLen = u16(dir, p + 30), commentLen = u16(dir, p + 32);
      entries.push({
        name: names.decode(new Uint8Array(dir.buffer, p + 46, nameLen)),
        flags: u16(dir, p + 8),
        method: u16(dir, p + 10),
        compressedSize: u32(dir, p + 20),
        size: u32(dir, p + 24),
        headerOffset: u32(dir, p + 42)
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function zipEntryStream(file, entry) {
    if (entry.flags & 1) throw new Error('"' + entry.name + '" is password-protected.');
    var head = new DataView(await file.slice(entry.headerOffset, entry.headerOffset + 30).arrayBuffer());
    if (u32(head, 0) !== 0x04034b50) throw new Error('ZIP file is damaged.');
    var start = entry.headerOffset + 30 + u16(head, 26) + u16(head, 28);
    var body = file.slice(start, start + entry.compressedSize).stream();
    if (entry.method === 0) return body;
    if (entry.method !== 8) throw new Error('"' + entry.name + '" uses an unsupported ZIP compression method.');
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files. Use a current Chrome, Edge or Firefox, or check the .txt file directly.');
    return body.pipeThrough(new DecompressionStream('deflate-raw'));
  }

  async function zipEntryText(file, entry) {
    return new Response(await zipEntryStream(file, entry)).text();
  }

  // ---- xlsx --------------------------------------------------------------

  function xmlText(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (all, e) {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      var code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    });
  }

  function attr(tag, name) {
    var m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag);
    return m ? xmlText(m[1]) : null;
  }

  function richText(xml) {
    var out = '';
    var re = /<t\b[^>]*>([\s\S]*?)<\/t>/g, m;
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    while ((m = re.exec(xml))) out += xmlText(m[1]);
    return out;
  }

  function columnIndex(ref) {
    var n = 0;
    for (var i = 0; i < ref.length; i++) {
      var c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  function cellNumber(v) {
    if (/^-?\d+$/.test(v)) return v;
    var n = Number(v);
    return isFinite(n) ? String(n) : v;
  }

  async function readWorkbook(file) {
    var entries = await readZipDirectory(file);
    var byName = {};
    entries.forEach(function (e) { byName[e.name] = e; });
    if (!byName['xl/workbook.xml']) throw new Error('Not an Excel workbook (.xlsx). Old .xls files must be saved as .xlsx first.');

    var workbook = await zipEntryText(file, byName['xl/workbook.xml']);
    var rels = byName['xl/_rels/workbook.xml.rels'] ? await zipEntryText(file, byName['xl/_rels/workbook.xml.rels']) : '';
    var targets = {};
    rels.replace(/<Relationship\b[^>]*>/g, function (tag) {
      targets[attr(tag, 'Id')] = attr(tag, 'Target');
      return tag;
    });
    var sheets = [];
    workbook.replace(/<sheet\b[^>]*>/g, function (tag) {
      var target = targets[attr(tag, 'r:id')] || '';
      var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target;
      sheets.push({ name: attr(tag, 'name'), path: path });
      return tag;
    });
    sheets = sheets.filter(function (s) { return byName[s.path]; });
    if (!sheets.length) throw new Error('No worksheets found in the workbook.');

    var strings = [];
    if (byName['xl/sharedStrings.xml']) {
      var sst = await zipEntryText(file, byName['xl/sharedStrings.xml']);
      var si = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, m;
      while ((m = si.exec(sst))) strings.push(m[1] ? richText(m[1]) : '');
    }
    return { file: file, byName: byName, sheets: sheets, strings: strings };
  }

  // Calls onRow(cells, rowNumber) for every row of the sheet that has cells.
  async function eachRow(book, sheet, onRow, onProgress) {
    var xml = await zipEntryText(book.file, book.byName[sheet.path]);
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    var m, c, rowNumber = 0, lastPaint = Date.now();
    while ((m = rowRe.exec(xml))) {
      var r = attr(m[1], 'r');
      rowNumber = r ? parseInt(r, 10) : rowNumber + 1;
      if (!m[2]) continue;
      var cells = [];
      var next = 0;
      cellRe.lastIndex = 0;
      while ((c = cellRe.exec(m[2]))) {
        var ref = attr(c[1], 'r');
        var col = ref ? columnIndex(ref) : next;
        next = col + 1;
        var body = c[2];
        if (!body) continue;
        var type = attr(c[1], 't');
        var text = '';
        if (type === 'inlineStr') {
          text = richText(body);
        } else {
          var vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
          if (!vm) continue;
          var v = xmlText(vm[1]);
          if (type === 's') text = book.strings[+v] || '';
          else if (type === 'str' || type === 'e') text = v;
          else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
          else text = cellNumber(v);
        }
        while (cells.length < col) cells.push('');
        cells[col] = text;
      }
      if (cells.length) onRow(cells, rowNumber);
      if (Date.now() - lastPaint > 80) {
        if (onProgress) onProgress(rowRe.lastIndex / xml.length);
        await tick();
        lastPaint = Date.now();
      }
    }
  }

  // The CIC workbook keeps the records on the sheet named "template".
  function pickSheet(book) {
    for (var i = 0; i < book.sheets.length; i++) {
      if (/^template$/i.test((book.sheets[i].name || '').trim())) return book.sheets[i];
    }
    return book.sheets[0];
  }

  // ---- entry point -------------------------------------------------------

  // options: { mfi, onProgress(fraction) }. Resolves to the checker result, with
  // `source` describing what was actually read.
  async function checkFile(file, options) {
    options = options || {};
    var kind = ext(file.name);
    var started = Date.now();
    var result, source;

    if (kind === 'gpg' || kind === 'pgp' || kind === 'asc') {
      throw new Error('This file is already encrypted, so its contents cannot be read. Check the .txt file before you zip and encrypt it.');
    }
    if (kind === 'xls') {
      throw new Error('Old-format .xls workbooks cannot be read. Save the workbook as .xlsx, or check the exported .txt file.');
    }

    if (kind === 'xlsx' || kind === 'xlsm') {
      var book = await readWorkbook(file);
      var sheet = pickSheet(book);
      var xc = CHECKER.createChecker({ mode: 'excel', mfi: options.mfi, fileName: file.name, checkFileName: false });
      await eachRow(book, sheet, function (cells, n) { xc.row(cells, n); }, options.onProgress);
      result = xc.finish();
      source = 'Excel sheet "' + sheet.name + '"';
    } else if (kind === 'zip') {
      var entries = (await readZipDirectory(file)).filter(function (e) { return !/\/$/.test(e.name); });
      var texts = entries.filter(function (e) { return /\.txt$/i.test(e.name); });
      var inner = texts[0] || entries[0];
      if (!inner) throw new Error('The ZIP file is empty.');
      var innerName = inner.name.split('/').pop();
      var zc = CHECKER.createChecker({ mfi: options.mfi, fileName: innerName });
      if (entries.length !== 1) {
        zc.fileIssue('F-CONTAINER', 'The ZIP holds ' + entries.length + ' files; it must hold only the one submission .txt. Checked "' + innerName + '".', file.name);
      }
      if (inner.name.indexOf('/') >= 0) {
        zc.fileIssue('F-CONTAINER', 'The text file sits inside a folder in the ZIP. Zip the file itself, not its folder.', inner.name);
      }
      await feedStream(await zipEntryStream(file, inner), zc, inner.size, options.onProgress);
      result = zc.finish();
      source = '"' + innerName + '" inside ' + file.name;
    } else {
      var tc = CHECKER.createChecker({ mfi: options.mfi, fileName: file.name });
      await feedStream(file.stream(), tc, file.size, options.onProgress);
      result = tc.finish();
      source = file.name;
    }

    result.source = source;
    result.container = file.name;
    result.size = file.size;
    result.elapsed = Date.now() - started;
    return result;
  }

  // Runs the auto-fixer over the file, then checks the corrected text.
  // options: { fixes, mfi, onProgress }. Resolves to
  //   { fix, after, parts, fileName, size }
  // where `parts` are the text chunks of the corrected file (CRLF line ends),
  // `fix` is the fixer's change log and `after` the checker result for it.
  async function fixFile(file, options) {
    options = options || {};
    var FIXER = root.CIC_FIXER;
    var kind = ext(file.name);
    var started = Date.now();
    var progress = options.onProgress || function () {};
    var fixer, originalName = file.name;

    if (kind === 'gpg' || kind === 'pgp' || kind === 'asc') throw new Error('This file is encrypted, so it cannot be read or fixed.');
    if (kind === 'xls') throw new Error('Old-format .xls workbooks cannot be read. Save the workbook as .xlsx first.');

    if (kind === 'xlsx' || kind === 'xlsm') {
      var book = await readWorkbook(file);
      fixer = FIXER.createFixer({ mode: 'excel', options: options.fixes });
      await eachRow(book, pickSheet(book), function (cells, n) { fixer.row(cells, n); }, function (f) { progress(f * 0.6); });
      originalName = '';
    } else {
      var bytes;
      if (kind === 'zip') {
        var entries = (await readZipDirectory(file)).filter(function (e) { return !/\/$/.test(e.name); });
        var inner = entries.filter(function (e) { return /\.txt$/i.test(e.name); })[0] || entries[0];
        if (!inner) throw new Error('The ZIP file is empty.');
        originalName = inner.name.split('/').pop();
        bytes = new Uint8Array(await new Response(await zipEntryStream(file, inner)).arrayBuffer());
      } else {
        bytes = new Uint8Array(await file.arrayBuffer());
      }
      fixer = FIXER.createFixer({ options: options.fixes });
      var walk = FIXER.byteLines(bytes, fixer);
      while (walk.run(4000)) {
        progress(walk.position() / walk.total * 0.6);
        await tick();
      }
    }

    var fix = fixer.finish();
    var fileName = FIXER.suggestName(fix.provider, originalName, new Date());
    var checker = CHECKER.createChecker({ mfi: options.mfi, fileName: fileName });
    var parts = [];
    var size = 0;
    for (var i = 0; i < fix.lines.length; i += 4000) {
      var chunk = fix.lines.slice(i, i + 4000);
      for (var k = 0; k < chunk.length; k++) checker.line(chunk[k]);
      var text = chunk.join('\r\n') + '\r\n';
      parts.push(text);
      size += new Blob([text]).size;
      progress(0.6 + 0.4 * Math.min(1, (i + 4000) / fix.lines.length));
      await tick();
    }
    var after = checker.finish();
    after.source = fileName + ' (auto-fixed copy of ' + file.name + ')';
    after.container = fileName;
    after.size = size;
    after.elapsed = Date.now() - started;
    return { fix: fix, after: after, parts: parts, fileName: fileName, size: size };
  }

  root.CIC_READERS = { checkFile: checkFile, fixFile: fixFile };
})(typeof globalThis !== 'undefined' ? globalThis : this);
