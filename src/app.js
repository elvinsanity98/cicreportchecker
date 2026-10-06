// Browser UI for the checker. All rendering goes through h(), which sets text
// with textContent, so values from the checked file are never parsed as HTML.
(function () {
  'use strict';
  var CHECKER = window.CIC_CHECKER, SPEC = window.CIC_SPEC, DOMAINS = window.CIC_DOMAINS, READERS = window.CIC_READERS;
  var FIXER = window.CIC_FIXER;
  var SEVS = ['error', 'warning', 'info'];
  var SEV_LABEL = { error: 'Error', warning: 'Warning', info: 'Note' };
  var SEV_PLURAL = { error: 'Errors', warning: 'Warnings', info: 'Notes' };
  var PAGE = 100;

  var state = {
    file: null, result: null, runId: 0,
    sev: { error: true, warning: true, info: true }, rec: '', q: '', view: 'rule', page: 0,
    open: {}, shown: {}, byGroup: {}, byLine: null, fix: null
  };

  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function num(n) { return Number(n).toLocaleString('en-US'); }
  function plural(n, word) { return num(n) + ' ' + word + (n === 1 ? '' : 's'); }
  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  // ---- tabs --------------------------------------------------------------

  var TABS = ['results', 'codes', 'steps', 'rules'];
  function showTab(name) {
    TABS.forEach(function (t) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('panel-' + t).hidden = t !== name;
    });
  }
  TABS.forEach(function (t) { $('tab-' + t).addEventListener('click', function () { showTab(t); }); });

  // ---- intake ------------------------------------------------------------

  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function () { drop.classList.remove('over'); });
  });
  // Dropping a file outside the drop zone must not make the browser open it.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) run(f);
  });
  $('file').addEventListener('change', function () {
    if (this.files[0]) run(this.files[0]);
    this.value = '';
  });
  $('mfi').addEventListener('change', function () { if (state.file) run(state.file); });

  function run(file) {
    var id = ++state.runId;
    state.file = file;
    $('fail').hidden = true;
    $('progress').hidden = false;
    $('bar').style.width = '0%';
    $('progress-text').textContent = 'Checking ' + file.name + '…';
    READERS.checkFile(file, {
      mfi: $('mfi').checked,
      onProgress: function (f) { if (id === state.runId) $('bar').style.width = Math.round(f * 100) + '%'; }
    }).then(function (result) {
      if (id !== state.runId) return;
      $('progress').hidden = true;
      setResult(result);
    }).catch(function (err) {
      if (id !== state.runId) return;
      $('progress').hidden = true;
      $('fail').hidden = false;
      $('fail').textContent = 'Could not check ' + file.name + '. ' + (err && err.message ? err.message : err);
      // Do not leave the previous file's results on screen under this message.
      state.file = null;
      state.result = null;
      $('results').hidden = true;
      $('empty').hidden = false;
      $('tab-results').textContent = 'Results';
    });
  }

  // ---- results -----------------------------------------------------------

  function setResult(r) {
    state.result = r;
    state.rec = '';
    state.q = '';
    state.page = 0;
    state.open = {};
    state.shown = {};
    state.byLine = null;
    state.byGroup = {};
    state.fix = null;
    r.issues.forEach(function (i) { (state.byGroup[i.group] || (state.byGroup[i.group] = [])).push(i); });
    SEVS.forEach(function (s) { state.sev[s] = true; });
    $('empty').hidden = true;
    var box = clear($('results'));
    box.hidden = false;
    append(box, [verdict(r), notices(r), h('section', { class: 'card fixcard', id: 'fixcard', 'aria-label': 'Auto-fix' }), cards(r), findings(r)]);
    renderFix();
    var tab = $('tab-results');
    clear(tab);
    append(tab, ['Results', r.totals.error ? h('span', { class: 'count', text: num(r.totals.error) }) : null]);
    showTab('results');
    renderList();
  }

  function verdict(r) {
    var t = r.totals;
    var kind = t.error ? 'error' : t.warning ? 'warning' : 'ok';
    var title = t.error ? 'Not ready: ' + plural(t.error, 'error') + ' to fix'
      : t.warning ? 'No errors. ' + plural(t.warning, 'warning') + ' to review'
      : 'No problems found';
    var parts = [r.source, plural(r.records, 'record'), bytes(r.size), 'checked in ' + (r.elapsed < 1000 ? r.elapsed + ' ms' : (r.elapsed / 1000).toFixed(1) + ' s')];
    var extra = t.error && (t.warning || t.info)
      ? ' Also ' + [t.warning ? plural(t.warning, 'warning') : '', t.info ? plural(t.info, 'note') : ''].filter(Boolean).join(' and ') + '.'
      : !t.error && t.info ? ' ' + plural(t.info, 'note') + '.' : '';
    return h('div', { class: 'verdict ' + kind },
      h('span', { class: 'glyph', 'aria-hidden': 'true', text: kind === 'ok' ? '✓' : '!' }),
      h('div', null,
        h('h2', { text: title }),
        h('p', { text: parts.join(' · ') + '.' + extra })));
  }

  function notices(r) {
    var out = [];
    if (r.mode === 'excel') {
      out.push(h('div', { class: 'notice', text: 'You checked the Excel master file, so row numbers and columns refer to the sheet. File name, encoding and delimiter can only be checked on the exported .txt, so run that through here as well before you zip it.' }));
    }
    if (r.truncated) {
      out.push(h('div', { class: 'notice', text: 'Some rules fired more than 1,000 times. Counts are complete, but only the first 1,000 occurrences of each rule are listed.' }));
    }
    return out;
  }

  function kv(rows) {
    var dl = h('dl', { class: 'kv' });
    rows.forEach(function (row) {
      if (!row) return;
      if (row === '-') { dl.appendChild(h('div', { class: 'rule' })); return; }
      dl.appendChild(h('dt', { text: row[0] }));
      dl.appendChild(h('dd', { class: row[2] || '', text: row[1] }));
    });
    return dl;
  }

  function cards(r) {
    var hd = r.header;
    var subType = !hd ? '' : hd.subType === '0' ? '0 · standard periodical' : hd.subType === '1' ? '1 · correction / history' : hd.subType || '(empty)';
    var footerOk = r.footerCount !== null && String(r.footerCount) === String(r.records);
    var fileCard = h('div', { class: 'card' },
      h('h3', { text: 'File' }),
      hd ? kv([
        ['Provider code', hd.provider || '(empty)'],
        ['File reference date', r.period ? r.period.refDate : hd.refDateRaw || '(empty)', r.period ? '' : 'bad'],
        ['Version', hd.version || '(empty)', hd.version === SPEC.FORMAT_VERSION ? '' : 'bad'],
        ['Submission type', subType, hd.subType === '0' || hd.subType === '1' ? '' : 'bad'],
        '-',
        ['Records in file', num(r.records)],
        ['Footer says', r.footerCount === null ? 'no footer' : r.footerCount || '(empty)', footerOk ? '' : 'bad']
      ]) : h('p', { class: 'muted', text: 'No header (HD) record was found.' }));

    var recCard = h('div', { class: 'card' },
      h('h3', { text: 'Records by type' }),
      kv(SPEC.ORDER.map(function (t) {
        return [t + ' · ' + SPEC.RECORDS[t].label, num(r.counts[t]), r.counts[t] ? '' : 'zero'];
      })));

    var tr = r.transmittal;
    var foot = null;
    if (r.period) {
      var p = r.period;
      var when = p.daysToDue > 0 ? 'in ' + plural(p.daysToDue, 'day') : p.daysToDue === 0 ? 'today' : plural(-p.daysToDue, 'day') + ' ago';
      var type = hd && hd.subType === '1' ? 'Header says correction / history, so pick the matching Special Submission type.'
        : p.monthsBehind <= 1 ? 'Filed today, the portal lists it as Regular Submission.'
        : p.monthsBehind === 2 ? 'Filed today, the portal lists it as Regular Submission - Delayed.'
        : 'Filed today, the portal lists it as Delayed or Lapsed.';
      foot = h('p', { class: 'card-foot' + (p.daysToDue < 0 && !(hd && hd.subType === '1') ? ' late' : '') },
        'Covered period ' + p.label + '. Regular deadline ' + p.due + ' (' + when + '). ' + type);
    }
    var trCard = h('div', { class: 'card' },
      h('h3', { text: 'Transmittal figures' }),
      kv([
        ['Subject (Individual)', num(tr.individual)],
        ['Subject (Business)', num(tr.business)],
        ['Contract (Installment)', num(tr.installment)],
        ['Contract (Non-Installment)', num(tr.nonInstallment)],
        ['Contract (Credit Card)', num(tr.creditCard)],
        tr.utilities ? ['Services / Utilities (not on the form)', num(tr.utilities)] : null
      ]),
      foot);
    return h('div', { class: 'cards' }, fileCard, recCard, trCard);
  }

  function findings(r) {
    var total = r.totals.error + r.totals.warning + r.totals.info;
    if (!total) {
      return h('div', { class: 'empty' },
        h('p', null, h('strong', { text: 'Nothing to report.' })),
        h('p', { text: 'Structure, formats, codes and cross-references all pass. Continue with the steps under “Before you submit”.' }));
    }
    var recs = {};
    r.groups.forEach(function (g) { recs[g.rec] = true; });
    var recSelect = h('select', { id: 'f-rec', onchange: function () { state.rec = this.value; state.page = 0; renderList(); } },
      h('option', { value: '', text: 'All records' }),
      SPEC.ORDER.filter(function (t) { return recs[t]; }).map(function (t) { return h('option', { value: t, text: t + ' · ' + SPEC.RECORDS[t].label }); }),
      recs[''] ? h('option', { value: '*file', text: 'Whole file' }) : null);

    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Severity' }, SEVS.map(function (s) {
      if (!r.totals[s]) return null;
      return h('button', {
        class: 'chip ' + s, type: 'button', 'aria-pressed': 'true',
        onclick: function () {
          state.sev[s] = !state.sev[s];
          this.setAttribute('aria-pressed', String(state.sev[s]));
          state.page = 0;
          renderList();
        }
      }, SEV_PLURAL[s] + ' ' + num(r.totals[s]));
    }));

    function viewButton(name, label) {
      return h('button', {
        type: 'button', 'data-view': name, 'aria-pressed': String(state.view === name),
        onclick: function () {
          state.view = name;
          state.page = 0;
          var all = this.parentNode.querySelectorAll('button');
          for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', String(all[i] === this));
          renderList();
        }
      }, label);
    }

    return [
      h('div', { class: 'section-head' },
        h('h2', { text: 'Findings' }),
        h('div', { class: 'chips' },
          h('button', { class: 'btn', type: 'button', onclick: copyIssues, id: 'copy-btn' }, 'Copy for Excel'),
          h('button', { class: 'btn', type: 'button', onclick: downloadIssues }, 'Download CSV'))),
      h('div', { class: 'toolbar' },
        chips,
        h('label', { class: 'field' }, 'Record', recSelect),
        h('label', { class: 'field grow' }, 'Search',
          h('input', { type: 'search', placeholder: r.where + ' number, field, value or message', oninput: function () { state.q = this.value.trim().toLowerCase(); state.page = 0; renderList(); } })),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, viewButton('rule', 'By rule'), viewButton('line', 'By ' + r.where.toLowerCase()))),
      h('div', { id: 'list' })
    ];
  }

  function matches(i) {
    if (!state.sev[i.sev]) return false;
    if (state.rec && (state.rec === '*file' ? i.rec !== '' : i.rec !== state.rec)) return false;
    if (state.q) {
      var hay = (i.line + ' ' + i.rec + i.pos + ' ' + i.col + ' ' + i.field + ' ' + i.value + ' ' + i.msg + ' ' + i.code).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }

  function fieldCell(i) {
    if (!i.pos) return h('td', { class: 'fld' }, i.rec ? h('span', { class: 'tag pos', text: i.rec }) : h('span', { class: 'name', text: 'Whole file' }));
    return h('td', { class: 'fld' }, h('span', { class: 'tag pos', text: i.rec + i.pos }), ' ', h('span', { class: 'name', text: i.field }));
  }

  function rowAttrs(i) {
    var can = i.line && state.result.detail.has(i.line);
    return can ? { class: 'click', tabindex: '0', onclick: function () { openDrawer(i.line); }, onkeydown: function (e) { if (e.key === 'Enter') openDrawer(i.line); } } : null;
  }

  function renderList() {
    var r = state.result;
    // A file with no findings has no list to fill.
    if (!$('list')) return;
    var list = clear($('list'));
    if (state.view === 'rule') renderGroups(r, list);
    else renderFlat(r, list);
  }

  function renderGroups(r, list) {
    var filtered = !!(state.q || state.rec);
    var box = h('div', { class: 'groups' });
    var any = false;
    r.groups.forEach(function (g) {
      var rows = (state.byGroup[g.key] || []).filter(matches);
      if (!rows.length) return;
      any = true;
      var allSev = SEVS.every(function (s) { return state.sev[s]; });
      var count = filtered || !allSev ? rows.length : g.count;
      var open = !!state.open[g.key];
      var el = h('div', { class: 'group' + (open ? ' open' : '') });
      el.appendChild(h('button', {
        class: 'group-head', type: 'button', 'aria-expanded': String(open),
        onclick: function () { state.open[g.key] = !state.open[g.key]; renderList(); }
      },
        h('span', { class: 'sev ' + rows[0].sev, text: SEV_LABEL[rows[0].sev] }),
        h('span', { class: 'group-main' },
          h('span', { class: 'group-title', text: g.title }),
          h('span', { class: 'group-meta' },
            g.pos ? h('span', { class: 'tag pos', text: g.rec + g.pos }) : g.rec ? h('span', { class: 'tag pos', text: g.rec }) : null,
            g.pos ? h('span', { text: g.field + ' · column ' + g.col }) : null,
            h('span', { class: 'tag', text: g.code }),
            g.basis === 'practice' ? h('span', { class: 'tag basis-practice', text: 'Sanity check' }) : null)),
        h('span', { class: 'group-count', text: num(count) })));
      if (open) {
        var limit = state.shown[g.key] || 25;
        var tbody = h('tbody');
        rows.slice(0, limit).forEach(function (i) {
          tbody.appendChild(h('tr', rowAttrs(i),
            h('td', { class: 'line', text: i.line ? r.where + ' ' + num(i.line) : 'File' }),
            h('td', { class: 'value', text: i.value }),
            h('td', { class: 'msg', text: i.msg })));
        });
        var body = h('div', { class: 'group-body' },
          h('div', { class: 'table-scroll' },
            h('table', { class: 'grid' },
              h('thead', null, h('tr', null, h('th', { style: 'width:7rem', text: r.where }), h('th', { style: 'width:30%', text: 'Value' }), h('th', { text: 'What to do' }))),
              tbody)));
        if (rows.length > limit || g.count > g.kept) {
          body.appendChild(h('div', { class: 'group-more' },
            rows.length > limit ? h('button', { class: 'btn small', type: 'button', onclick: function () { state.shown[g.key] = limit + 200; renderList(); } }, 'Show more') : null,
            h('span', { text: 'Showing ' + num(Math.min(limit, rows.length)) + ' of ' + num(count) + (g.count > g.kept ? ' (first ' + num(g.kept) + ' kept)' : '') })));
        }
        el.appendChild(body);
      }
      box.appendChild(el);
    });
    list.appendChild(any ? box : h('div', { class: 'none', text: 'Nothing matches the current filters.' }));
  }

  function renderFlat(r, list) {
    var rows = r.issues.filter(matches).sort(function (a, b) { return a.line - b.line || a.pos - b.pos; });
    if (!rows.length) { list.appendChild(h('div', { class: 'none', text: 'Nothing matches the current filters.' })); return; }
    var pages = Math.ceil(rows.length / PAGE);
    if (state.page >= pages) state.page = pages - 1;
    var tbody = h('tbody');
    rows.slice(state.page * PAGE, (state.page + 1) * PAGE).forEach(function (i) {
      tbody.appendChild(h('tr', rowAttrs(i),
        h('td', { class: 'line', text: i.line ? num(i.line) : '–' }),
        h('td', null, h('span', { class: 'sev ' + i.sev, text: SEV_LABEL[i.sev] })),
        fieldCell(i),
        h('td', { class: 'value', text: i.value }),
        h('td', { class: 'msg' }, h('strong', { text: ruleTitle(i) + '. ' }), i.msg)));
    });
    list.appendChild(h('div', { class: 'table-scroll' },
      h('table', { class: 'grid' },
        h('thead', null, h('tr', null,
          h('th', { style: 'width:5rem', text: r.where }), h('th', { style: 'width:6rem', text: 'Severity' }),
          h('th', { style: 'width:22%', text: 'Field' }), h('th', { style: 'width:20%', text: 'Value' }), h('th', { text: 'Finding' }))),
        tbody)));
    list.appendChild(h('div', { class: 'pager' },
      h('span', { text: num(state.page * PAGE + 1) + '–' + num(Math.min(rows.length, (state.page + 1) * PAGE)) + ' of ' + num(rows.length) }),
      h('button', { class: 'btn small', type: 'button', disabled: state.page === 0, onclick: function () { state.page--; renderList(); } }, 'Previous'),
      h('button', { class: 'btn small', type: 'button', disabled: state.page >= pages - 1, onclick: function () { state.page++; renderList(); } }, 'Next')));
  }

  function ruleTitle(i) { return CHECKER.RULES[i.code].title; }

  // ---- record drawer -----------------------------------------------------

  var drawerState = { line: 0, showEmpty: false };

  function openDrawer(line) {
    drawerState.line = line;
    renderDrawer();
    $('overlay').hidden = false;
    $('drawer').hidden = false;
    var close = $('drawer').querySelector('.btn');
    if (close) close.focus();
  }

  function closeDrawer() {
    $('overlay').hidden = true;
    $('drawer').hidden = true;
  }
  $('overlay').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

  function renderDrawer() {
    var r = state.result, line = drawerState.line;
    var fields = r.detail.get(line) || [];
    var type = (fields[0] || '').trim();
    var spec = SPEC.RECORDS[type];
    var defs = spec ? spec.fields : [];
    if (!state.byLine) {
      state.byLine = new Map();
      r.issues.forEach(function (i) {
        if (!i.line) return;
        if (!state.byLine.has(i.line)) state.byLine.set(i.line, []);
        state.byLine.get(i.line).push(i);
      });
    }
    var issues = state.byLine.get(line) || [];
    var byPos = {};
    issues.forEach(function (i) { (byPos[i.pos] || (byPos[i.pos] = [])).push(i); });

    function issueLines(list) {
      return (list || []).map(function (i) {
        return h('div', { class: 'fissue' }, h('span', { class: 'sev ' + i.sev, text: SEV_LABEL[i.sev] }), h('span', { text: ruleTitle(i) + '. ' + i.msg }));
      });
    }

    var body = h('div', { class: 'drawer-body' });
    if (byPos[0]) body.appendChild(h('div', { class: 'frow flag' }, h('span', { class: 'fpos', text: 'record' }), h('div', null, issueLines(byPos[0]))));
    var n = Math.max(defs.length, fields.length);
    var hiddenCount = 0;
    for (var k = 0; k < n; k++) {
      var raw = fields[k] === undefined ? '' : fields[k];
      var flagged = byPos[k + 1];
      if (!raw && !flagged && !drawerState.showEmpty) { hiddenCount++; continue; }
      var def = defs[k];
      body.appendChild(h('div', { class: 'frow' + (flagged ? ' flag' : '') },
        h('span', { class: 'fpos', text: (spec ? type : '') + (k + 1) + ' · ' + CHECKER.colLetter(k + 1) }),
        h('div', null,
          h('div', { class: 'fname', text: def ? def.name : 'Beyond the layout' }),
          h('div', { class: 'fval' + (raw ? '' : ' blank'), text: raw || 'empty' }),
          issueLines(flagged))));
    }

    var drawer = clear($('drawer'));
    append(drawer, [
      h('div', { class: 'drawer-head' },
        h('div', null,
          h('h2', { text: r.where + ' ' + num(line) + (spec ? ' · ' + type + ' ' + spec.label : '') }),
          h('p', { text: plural(issues.length, 'finding') + ' on this record. Position · Excel column on the left.' })),
        h('button', { class: 'btn', type: 'button', onclick: closeDrawer }, 'Close')),
      h('div', { class: 'drawer-tools' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: drawerState.showEmpty, onchange: function () { drawerState.showEmpty = this.checked; renderDrawer(); } }),
          h('span', { text: 'Show empty fields' + (drawerState.showEmpty ? '' : ' (' + hiddenCount + ' hidden)') }))),
      body
    ]);
  }

  // ---- export ------------------------------------------------------------

  function exportRows() {
    var r = state.result;
    var rows = [['Severity', 'Rule', r.where, 'Record', 'Field No', 'Excel Column', 'Field', 'Value', 'Finding', 'What to do']];
    r.issues.filter(matches).sort(function (a, b) { return a.line - b.line || a.pos - b.pos; }).forEach(function (i) {
      rows.push([SEV_LABEL[i.sev], i.code, i.line || '', i.rec, i.pos || '', i.col, i.field, i.value, ruleTitle(i), i.msg]);
    });
    return rows;
  }

  function saveBlob(blob, name) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function downloadCsv(rows, name) {
    var csv = rows.map(function (row) {
      return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    // The byte-order mark makes Excel read the CSV as UTF-8.
    saveBlob(new Blob([String.fromCharCode(0xfeff) + csv + '\r\n'], { type: 'text/csv;charset=utf-8' }), name);
  }

  // Tab-separated text pastes into Excel correctly whatever the Windows list
  // separator is (CIC's guide has users change it to "|", which breaks CSVs).
  function copyRows(rows, btn) {
    var text = rows.map(function (row) {
      return row.map(function (c) { return String(c).replace(/[\t\r\n]+/g, ' '); }).join('\t');
    }).join('\r\n');
    var label = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', label);
    function done(ok) {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { btn.textContent = label; }, 1600);
    }
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function baseName() { return (state.result.fileName || 'file').replace(/\.[^.]+$/, ''); }
  function downloadIssues() { downloadCsv(exportRows(), baseName() + '_findings.csv'); }
  function copyIssues() { copyRows(exportRows(), $('copy-btn')); }

  // ---- auto-fix ----------------------------------------------------------

  var FIX_KEY = 'cic-checker-fix-options';
  var FIX_PAGE = 50;
  var fixOptions = (function () {
    var o = FIXER.defaultOptions();
    try {
      var saved = JSON.parse(localStorage.getItem(FIX_KEY) || '{}');
      for (var k in o) if (typeof saved[k] === 'boolean') o[k] = saved[k];
    } catch (e) { /* storage unavailable: defaults apply */ }
    o.encoding = true;
    return o;
  })();

  function runFix() {
    var file = state.file, id = state.runId;
    if (!file) return;
    state.fix = { running: true, progress: 0 };
    renderFix();
    READERS.fixFile(file, {
      fixes: fixOptions, mfi: $('mfi').checked,
      onProgress: function (f) {
        var el = $('fix-progress');
        if (el && id === state.runId) el.textContent = 'Working… ' + Math.round(f * 100) + '%';
      }
    }).then(function (res) {
      if (id !== state.runId || state.file !== file) return;
      state.fix = { out: res.fix, after: res.after, parts: res.parts, name: res.fileName, kind: '', page: 0 };
      renderFix();
    }).catch(function (err) {
      if (id !== state.runId || state.file !== file) return;
      state.fix = { error: err && err.message ? err.message : String(err) };
      renderFix();
    });
  }

  // Loads the corrected text into the page as if it had been dropped in.
  function useFixed() {
    var f = state.fix;
    state.file = new File(f.parts, f.name, { type: 'text/plain' });
    state.runId++;
    setResult(f.after);
    window.scrollTo(0, 0);
  }

  function changeRows() {
    var r = state.result, f = state.fix;
    var rows = [[r.where, 'Record', 'Field No', 'Excel Column', 'Field', 'Before', 'After', 'Fix']];
    f.out.changes.forEach(function (c) {
      rows.push([c.line || '', c.rec, c.pos || '', c.pos ? CHECKER.colLetter(c.pos) : '', c.field, c.before, c.after, c.note]);
    });
    return rows;
  }

  function fixOption(kind, f) {
    var count = f && f.out ? f.out.counts[kind.id] : 0;
    return h('label', { class: 'check fix-opt' },
      h('input', {
        type: 'checkbox', checked: fixOptions[kind.id], disabled: !!kind.always || !!(f && f.running),
        onchange: function () {
          fixOptions[kind.id] = this.checked;
          try { localStorage.setItem(FIX_KEY, JSON.stringify(fixOptions)); } catch (e) { /* not remembered */ }
          if (state.fix && state.fix.out) runFix();
        }
      }),
      h('span', null, kind.label, count ? h('span', { class: 'count', text: num(count) }) : null,
        kind.detail ? h('small', { text: kind.detail }) : null));
  }

  function renderFix() {
    var card = $('fixcard');
    if (!card) return;
    clear(card);
    var r = state.result, f = state.fix;
    var excel = r.mode === 'excel';
    var summary, actions = [];
    var runLabel = excel ? 'Build fixed .txt' : 'Auto-fix this file';

    if (!f) {
      summary = excel
        ? 'Builds the submission .txt from the sheet and corrects what can be corrected without guessing. You get the file and a list of every change.'
        : 'Corrects what can be corrected without guessing: spacing, dates, numbers, codes, encoding and structure. You get a new file and a list of every change.';
      actions.push(h('button', { class: 'btn primary', type: 'button', onclick: runFix }, runLabel));
    } else if (f.running) {
      summary = h('span', { id: 'fix-progress', text: 'Working…' });
    } else if (f.error) {
      summary = 'Auto-fix could not run. ' + f.error;
      actions.push(h('button', { class: 'btn', type: 'button', onclick: runFix }, 'Try again'));
    } else {
      var o = f.out, a = f.after.totals, b = r.totals;
      var delta = 'Errors ' + num(b.error) + ' → ' + num(a.error) + ', warnings ' + num(b.warning) + ' → ' + num(a.warning) + '.';
      summary = o.total
        ? num(o.total) + (o.total === 1 ? ' fix' : ' fixes') + ' on ' + plural(o.changedLines, r.where.toLowerCase()) + '. ' + delta
        : excel ? 'Nothing needed correcting. ' + delta
        : b.error + b.warning ? 'Nothing here can be fixed automatically. What is left needs a person to decide.'
        : 'Nothing needs fixing.';
      if (o.total || excel) {
        actions.push(h('button', { class: 'btn primary', type: 'button', onclick: function () { saveBlob(new Blob(f.parts, { type: 'text/plain;charset=utf-8' }), f.name); } }, 'Download fixed file'));
        actions.push(h('button', { class: 'btn', type: 'button', onclick: useFixed }, 'Show its findings'));
      }
    }

    append(card, h('div', { class: 'fix-head' },
      h('div', null, h('h3', { text: 'Auto-fix' }), h('p', { class: 'fix-summary' + (f && f.error ? ' bad' : '') }, summary)),
      h('div', { class: 'chips' }, actions)));

    if (f && f.out && (f.out.total || excel)) {
      var notes = [f.name + ' is a new file with a new timestamp.'];
      if (f.after.totals.error) notes.push(plural(f.after.totals.error, 'error') + ' still need fixing by hand.');
      notes.push('Correct the same values in your master file too, or they come back next month.');
      if (f.out.truncated) notes.push('Only the first ' + num(f.out.changes.length) + ' changes are listed; all were applied.');
      card.appendChild(h('p', { class: 'fix-note', text: notes.join(' ') }));
    }

    var kinds = FIXER.KINDS;
    card.appendChild(h('div', { class: 'fix-options' },
      h('div', null, kinds.filter(function (k) { return !k.optional; }).map(function (k) { return fixOption(k, f); })),
      h('div', null,
        h('p', { class: 'fix-group', text: 'Your call: these change the data itself' }),
        kinds.filter(function (k) { return k.optional; }).map(function (k) { return fixOption(k, f); }))));

    if (!f || !f.out || !f.out.changes.length) return;

    var changes = f.out.changes.filter(function (c) { return !f.kind || c.kind === f.kind; });
    var pages = Math.ceil(changes.length / FIX_PAGE);
    if (f.page >= pages) f.page = Math.max(0, pages - 1);
    var tbody = h('tbody');
    changes.slice(f.page * FIX_PAGE, (f.page + 1) * FIX_PAGE).forEach(function (c) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'line', text: c.line ? num(c.line) : '–' }),
        h('td', { class: 'fld' }, c.pos ? [h('span', { class: 'tag pos', text: c.rec + c.pos }), ' ', h('span', { class: 'name', text: c.field })] : h('span', { class: 'name', text: c.rec ? c.rec + ' record' : 'Whole line' })),
        h('td', { class: 'value' }, h('span', { class: 'lit old', text: c.before })),
        h('td', { class: 'value' }, h('span', { class: 'lit new', text: c.after })),
        h('td', { text: c.note })));
    });
    var filter = h('select', { 'aria-label': 'Kind of fix', onchange: function () { f.kind = this.value; f.page = 0; renderFix(); } },
      h('option', { value: '', text: 'All fixes (' + num(f.out.changes.length) + ')' }),
      kinds.filter(function (k) { return f.out.counts[k.id]; }).map(function (k) {
        return h('option', { value: k.id, selected: f.kind === k.id, text: k.label + ' (' + num(f.out.counts[k.id]) + ')' });
      }));
    append(card, [
      h('div', { class: 'toolbar fix-tools' },
        h('label', { class: 'field grow' }, 'Changes made', filter),
        h('button', { class: 'btn', type: 'button', onclick: function () { copyRows(changeRows(), this); } }, 'Copy for Excel'),
        h('button', { class: 'btn', type: 'button', onclick: function () { downloadCsv(changeRows(), f.name.replace(/\.txt$/, '') + '_changes.csv'); } }, 'Download CSV')),
      h('div', { class: 'table-scroll' },
        h('table', { class: 'grid' },
          h('thead', null, h('tr', null,
            h('th', { style: 'width:5rem', text: r.where }), h('th', { style: 'width:22%', text: 'Field' }),
            h('th', { style: 'width:22%', text: 'Before' }), h('th', { style: 'width:22%', text: 'After' }), h('th', { text: 'Fix' }))),
          tbody)),
      pages > 1 ? h('div', { class: 'pager' },
        h('span', { text: num(f.page * FIX_PAGE + 1) + '–' + num(Math.min(changes.length, (f.page + 1) * FIX_PAGE)) + ' of ' + num(changes.length) }),
        h('button', { class: 'btn small', type: 'button', disabled: f.page === 0, onclick: function () { f.page--; renderFix(); } }, 'Previous'),
        h('button', { class: 'btn small', type: 'button', disabled: f.page >= pages - 1, onclick: function () { f.page++; renderFix(); } }, 'Next')) : null
    ]);
  }

  // ---- code tables -------------------------------------------------------

  var usedBy = {};
  SPEC.ORDER.forEach(function (type) {
    SPEC.RECORDS[type].fields.forEach(function (def, idx) {
      [].concat(def.dom || [], def.orDom || []).forEach(function (name) {
        (usedBy[name] || (usedBy[name] = [])).push(type + (idx + 1) + ' ' + def.name);
      });
    });
  });

  function initCodes() {
    var select = $('code-table');
    Object.keys(DOMAINS.DOMAINS).sort().forEach(function (name) {
      select.appendChild(h('option', { value: name, text: name + ' (' + Object.keys(DOMAINS.DOMAINS[name]).length + ')' }));
    });
    select.value = 'ContractPhase';
    select.addEventListener('change', renderCodes);
    $('code-search').addEventListener('input', renderCodes);
    renderCodes();
  }

  function renderCodes() {
    var name = $('code-table').value;
    var table = DOMAINS.DOMAINS[name];
    var q = $('code-search').value.trim().toLowerCase();
    var codes = Object.keys(table).filter(function (c) {
      return !q || c.toLowerCase().indexOf(q) >= 0 || table[c].toLowerCase().indexOf(q) >= 0;
    });
    var tbody = clear($('code-grid').querySelector('tbody'));
    codes.slice(0, 400).forEach(function (c) {
      tbody.appendChild(h('tr', null, h('td', { class: 'mono', text: c }), h('td', { text: table[c] })));
    });
    if (!codes.length) tbody.appendChild(h('tr', null, h('td', { colspan: '2', class: 'none', text: 'No code matches.' })));
    var uses = usedBy[name] || [];
    $('code-used').textContent = uses.length
      ? 'Used by ' + uses.slice(0, 6).join(', ') + (uses.length > 6 ? ' and ' + (uses.length - 6) + ' more fields' : '') + '.'
      : '';
    var note = codes.length > 400 ? 'Showing the first 400 of ' + num(codes.length) + ' codes. Type in the search box to narrow down. ' : '';
    if (name === 'PSIC' || name === 'PSOC') note += 'Leading zeros were lost in CIC’s workbook for this table, so the checker accepts a code with or without them.';
    $('code-note').textContent = note;
  }

  function initRules() {
    var tbody = $('rule-grid').querySelector('tbody');
    Object.keys(CHECKER.RULES).forEach(function (code) {
      var rule = CHECKER.RULES[code];
      tbody.appendChild(h('tr', null,
        h('td', { class: 'mono', text: code }),
        h('td', null, h('span', { class: 'sev ' + rule.sev, text: SEV_LABEL[rule.sev] })),
        h('td', { text: rule.title }),
        h('td', null, h('span', { class: 'tag basis-' + rule.basis, text: rule.basis === 'manual' ? 'CIC manual' : 'Sanity check' }))));
    });
  }

  $('domain-source').textContent = DOMAINS.SOURCE;
  initCodes();
  initRules();
})();
