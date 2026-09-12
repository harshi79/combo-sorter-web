/*
 * combo-sorter-web :: UI wiring.
 *
 * All parsing lives in src/core.js. This file only moves data between the DOM
 * and that module — it never talks to the network.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    input: $('input'),
    output: $('output'),
    stats: $('stats'),
    format: $('format'),
    dedupe: $('dedupe'),
    sort: $('sort'),
    autoFix: $('autoFix'),
    strict: $('strict'),
    allowEmptyPass: $('allowEmptyPass'),
    parseHeaders: $('parseHeaders'),
    rejectedPanel: $('rejectedPanel'),
    rejectedList: $('rejectedList'),
    toast: $('toast'),
    themeBtn: $('themeBtn'),
    inputMeta: $('inputMeta'),
  };

  const STORAGE_KEY = 'combo-sorter-web:v1';
  const THEME_KEY = 'combo-sorter-web:theme';
  const SETTINGS = ['autoFix', 'strict', 'allowEmptyPass', 'parseHeaders', 'dedupe', 'sort', 'format'];

  let lastResult = null;
  let rejectedText = '';

  // ---------------------------------------------------------------- format list
  ComboCore.formatNames.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name === 'email<tab>pass' ? 'email<TAB>pass' : name;
    els.format.appendChild(opt);
  });
  els.format.value = 'email:pass';

  // ---------------------------------------------------------------- theme
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) { /* ignore */ }
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (_) { /* ignore */ }
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
  }

  // ---------------------------------------------------------------- persistence
  function save() {
    const state = { input: els.input.value };
    SETTINGS.forEach((k) => {
      state[k] = els[k].type === 'checkbox' ? els[k].checked : els[k].value;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* private mode / quota — the tool still works, it just won't remember */
    }
  }

  function restore() {
    let state = null;
    try {
      state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (_) {
      state = null;
    }
    if (!state) return;
    SETTINGS.forEach((k) => {
      if (state[k] === undefined || state[k] === null) return;
      if (els[k].type === 'checkbox') els[k].checked = !!state[k];
      else els[k].value = state[k];
    });
    if (typeof state.input === 'string') els.input.value = state.input;
  }

  // ---------------------------------------------------------------- rendering
  function chip(label, value, kind) {
    return '<span class="chip' + (kind ? ' ' + kind : '') + '">' + label + ' <b>' + value + '</b></span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function renderStats(stats) {
    const parts = [
      chip('lines', stats.lines),
      chip('clean', stats.valid, stats.valid ? 'good' : ''),
      chip('rejected', stats.rejected, stats.rejected ? 'bad' : 'good'),
    ];
    if (stats.duplicatesRemoved) parts.push(chip('duplicates removed', stats.duplicatesRemoved, 'warn'));
    const skipped = stats.emptyLines + stats.comments + stats.headers;
    if (skipped) parts.push(chip('blank/comment/header', skipped));
    const domains = Object.keys(stats.domains || {});
    if (domains.length) {
      const top = Object.entries(stats.domains).sort((a, b) => b[1] - a[1])[0];
      parts.push(chip('domains', domains.length));
      parts.push(chip('top domain', escapeHtml(top[0]) + ' (' + top[1] + ')'));
    }
    els.stats.innerHTML = parts.join('');
  }

  function renderRejected(rejected) {
    // Skip noise: blank lines and comments are intentional, not problems.
    const real = rejected.filter((r) => r.reason !== 'empty line' && r.reason !== 'comment' && r.reason !== 'header row');
    rejectedText = real.map((r) => 'line ' + r.line + ': ' + r.raw + '   ← ' + r.reason).join('\n');

    if (!real.length) {
      els.rejectedPanel.hidden = true;
      els.rejectedList.innerHTML = '';
      return;
    }
    els.rejectedPanel.hidden = false;
    const cap = 500;
    const rows = real.slice(0, cap).map((r) =>
      '<div class="rej"><span class="ln">' + r.line + '</span><span class="txt">' + escapeHtml(r.raw) +
      '</span><span class="why">' + escapeHtml(r.reason) + '</span></div>'
    );
    if (real.length > cap) rows.push('<div class="rej"><span class="ln"></span><span class="txt">… and ' + (real.length - cap) + ' more</span><span class="why"></span></div>');
    els.rejectedList.innerHTML = rows.join('');
  }

  function currentOptions() {
    return {
      strict: els.strict.checked,
      autoFix: els.autoFix.checked,
      allowEmptyPass: els.allowEmptyPass.checked,
      parseHeaders: els.parseHeaders.checked,
      dedupe: els.dedupe.value,
      sort: els.sort.value,
    };
  }

  function updateMeta() {
    const v = els.input.value;
    const lines = v === '' ? 0 : v.split(/\r\n|\r|\n/).length;
    const chars = v.length;
    els.inputMeta.textContent =
      lines.toLocaleString() + (lines === 1 ? ' line' : ' lines') + ' · ' + chars.toLocaleString() + ' chars';
  }

  function run() {
    const started = performance.now();
    lastResult = ComboCore.process(els.input.value, currentOptions());
    els.output.value = ComboCore.format(lastResult.entries, els.format.value);
    renderStats(lastResult.stats);
    renderRejected(lastResult.rejected);
    updateMeta();
    save();
    const ms = Math.round(performance.now() - started);
    if (ms > 250) showToast('Parsed ' + lastResult.stats.lines.toLocaleString() + ' lines in ' + ms + ' ms');
  }

  // Debounced so typing/pasting a huge blob stays responsive.
  let timer = null;
  function scheduleRun() {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  }

  // ---------------------------------------------------------------- feedback
  let toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  async function copyText(text, label) {
    if (!text) return showToast('Nothing to copy');
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // Clipboard API can be blocked (http, permissions) — fall back to a
      // temporary textarea so the button still works everywhere.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast(label + ' copied · ' + text.split('\n').length.toLocaleString() + ' lines');
  }

  function download(text, filename) {
    if (!text) return showToast('Nothing to download');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Saved ' + filename);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function extensionFor(formatName) {
    if (formatName === 'csv') return 'csv';
    if (formatName === 'jsonl') return 'jsonl';
    return 'txt';
  }

  // ---------------------------------------------------------------- file input
  function appendFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let pending = files.length;
    let added = 0;
    let errored = 0;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        els.input.value = els.input.value.trim() ? els.input.value.replace(/\s*$/, '') + '\n' + text : text;
        added += text.split(/\r\n|\r|\n/).length;
        finish();
      };
      reader.onerror = () => { errored++; finish(); };
      reader.readAsText(file);
    });

    function finish() {
      if (--pending > 0) return;
      if (errored) showToast('Could not read ' + errored + ' file(s)');
      else showToast('Loaded ' + files.length + ' file(s) · ' + added.toLocaleString() + ' lines');
      run();
      els.input.focus();
    }
  }

  // ---------------------------------------------------------------- sample data
  const SAMPLE = [
    '# raw export — formats are all over the place',
    'email,password',
    'alice.smith@gmail.com:Winter2024!',
    'alice.smith@gmail.com:Winter2024!',
    'BOB.Jones@Yahoo.com | sunset99',
    'carol@gnail.com;Tr0ub4dor',
    'hunter2:dave.wilson@HOTMAIL.com',
    'erin@outlook.com , coffee#1',
    '"frank.lee@icloud.com","p,ass:word"',
    'https://grace@proton.me:S3cret@accounts.proton.me/login',
    'henry@xcorp.io\tp@ssw0rd',
    'not-an-email-line',
    '',
    'ivy@company.co.uk:London2023',
  ].join('\n');

  // ---------------------------------------------------------------- events
  els.input.addEventListener('input', scheduleRun);
  SETTINGS.forEach((k) => els[k].addEventListener('change', run));

  els.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });

  $('clearBtn').addEventListener('click', () => {
    els.input.value = '';
    els.output.value = '';
    run();
    els.input.focus();
  });

  $('sampleBtn').addEventListener('click', () => {
    els.input.value = SAMPLE;
    run();
  });

  $('copyBtn').addEventListener('click', () => copyText(els.output.value, 'Clean list'));
  $('copyRejectedBtn').addEventListener('click', () => copyText(rejectedText, 'Rejected lines'));
  $('hideRejectedBtn').addEventListener('click', () => { els.rejectedPanel.hidden = true; });

  $('downloadBtn').addEventListener('click', () => {
    download(els.output.value, 'combo-sorted-' + stamp() + '.' + extensionFor(els.format.value));
  });

  $('fileInput').addEventListener('change', (e) => {
    appendFiles(e.target.files);
    e.target.value = ''; // allow re-loading the same file
  });

  // Drag & drop anywhere on the page.
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('dragging');
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) appendFiles(e.dataTransfer.files);
  });

  // Ctrl/Cmd+S downloads instead of opening the browser save dialog.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      $('downloadBtn').click();
    }
  });

  // ---------------------------------------------------------------- boot
  initTheme();
  restore();
  run();
})();
