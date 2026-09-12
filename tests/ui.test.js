'use strict';

/**
 * UI smoke test: loads the real index.html in jsdom, runs the real app.js
 * against the real src/core.js, and drives the page the way a user would.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function loadPage() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // jsdom does not implement the async clipboard; record calls instead.
  const copied = [];
  window.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };

  // jsdom cannot hand a Blob to the user: record zip builds and blob URLs.
  const zipCalls = [];
  const createdBlobs = [];
  window.ComboZip = {
    buildZip: (files) => { zipCalls.push(files); return new Uint8Array([0x50, 0x4b, 0x05, 0x06]); },
  };
  window.URL.createObjectURL = (blob) => { createdBlobs.push(blob); return 'blob:fake-' + createdBlobs.length; };
  window.URL.revokeObjectURL = () => {};

  // localStorage exists in jsdom; keep it isolated per test.
  window.localStorage.clear();

  window.eval(fs.readFileSync(path.join(ROOT, 'src/core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));

  return { window, document: window.document, copied, zipCalls, createdBlobs };
}

const $ = (document, id) => document.getElementById(id);

test('page boots: format list populated, empty state renders', () => {
  const { document } = loadPage();
  const format = $(document, 'format');
  assert.ok(format.options.length >= 9, 'format <select> should be filled from core.formatNames()');
  assert.equal(format.value, 'email:pass');
  assert.equal($(document, 'output').value, '');
  assert.match($(document, 'stats').textContent, /lines 0/);
});

test('typing in the input produces a clean list', () => {
  const { document } = loadPage();
  const input = $(document, 'input');
  input.value = 'john@gmail.com:secret123\njohn@gmail.com : secret123\nBOB@yahoo.com | Beta2';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  // app.js debounces by 120ms
  return new Promise((resolve) => setTimeout(() => {
    assert.equal($(document, 'output').value, 'john@gmail.com:secret123\nbob@yahoo.com:Beta2');
    assert.match($(document, 'stats').textContent, /clean 2/);
    assert.match($(document, 'stats').textContent, /duplicates removed 1/);
    resolve();
  }, 200));
});

test('Sample button fills messy data and produces the expected clean rows', () => {
  const { document } = loadPage();
  $(document, 'sampleBtn').click();
  const out = $(document, 'output').value.split('\n');
  assert.ok(out.length >= 8, 'sample should yield several rows, got ' + out.length);
  assert.ok(out.includes('alice.smith@gmail.com:Winter2024!'), out.join(' | '));
  assert.ok(out.includes('bob.jones@yahoo.com:sunset99'), out.join(' | '));
  assert.ok(out.includes('carol@gmail.com:Tr0ub4dor'), 'autoFix should repair gnail.com -> gmail.com');
  assert.ok(out.includes('dave.wilson@hotmail.com:hunter2'), 'pass-first row should be normalised');
  assert.ok(out.includes('frank.lee@icloud.com:p,ass:word'), 'quoted csv password should survive');
  assert.ok(out.includes('grace@proton.me:S3cret'), 'url userinfo should be extracted');
  // the junk line must be rejected, and surfaced with a reason
  assert.match($(document, 'rejectedList').textContent, /not-an-email-line/);
  assert.match($(document, 'rejectedList').textContent, /no email found/);
});

test('changing the output format re-renders without re-parsing the input', () => {
  const { document } = loadPage();
  const input = $(document, 'input');
  input.value = 'john@gmail.com:secret123';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  return new Promise((resolve) => setTimeout(() => {
    const format = $(document, 'format');
    format.value = 'csv';
    format.dispatchEvent(new format.ownerDocument.defaultView.Event('change'));
    assert.equal($(document, 'output').value, 'john@gmail.com,secret123');

    format.value = 'jsonl';
    format.dispatchEvent(new format.ownerDocument.defaultView.Event('change'));
    assert.equal($(document, 'output').value, '{"email":"john@gmail.com","password":"secret123"}');
    resolve();
  }, 200));
});

test('strict mode moves borderline rows into the rejected panel', () => {
  const { document } = loadPage();
  const input = $(document, 'input');
  input.value = 'good@gmail.com:pw1\nbad@b.c:pw2';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  return new Promise((resolve) => setTimeout(() => {
    assert.equal($(document, 'output').value.split('\n').length, 2);
    const strict = $(document, 'strict');
    strict.checked = true;
    strict.dispatchEvent(new strict.ownerDocument.defaultView.Event('change'));
    assert.equal($(document, 'output').value, 'good@gmail.com:pw1');
    assert.match($(document, 'rejectedList').textContent, /bad@b\.c/);
    resolve();
  }, 200));
});

test('copy button puts the clean list on the clipboard', async () => {
  const { document, copied } = loadPage();
  $(document, 'sampleBtn').click();
  $(document, 'copyBtn').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(copied.length, 1);
  assert.match(copied[0], /alice\.smith@gmail\.com:Winter2024!/);
});

test('clear button empties both panes', () => {
  const { document } = loadPage();
  $(document, 'sampleBtn').click();
  assert.ok($(document, 'output').value.length > 0);
  $(document, 'clearBtn').click();
  assert.equal($(document, 'input').value, '');
  assert.equal($(document, 'output').value, '');
});

test('settings and input survive a reload (localStorage)', () => {
  const first = loadPage();
  first.document.getElementById('input').value = 'keepme@gmail.com:pw';
  first.document.getElementById('strict').checked = true;
  first.document.getElementById('strict').dispatchEvent(new first.window.Event('change'));
  const saved = first.window.localStorage.getItem('combo-sorter-web:v1');
  assert.ok(saved, 'state should be persisted');

  // Second page, same storage backing.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.localStorage.setItem('combo-sorter-web:v1', saved);
  dom.window.navigator.clipboard = { writeText: () => Promise.resolve() };
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'src/core.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));

  const doc = dom.window.document;
  assert.equal(doc.getElementById('input').value, 'keepme@gmail.com:pw');
  assert.equal(doc.getElementById('strict').checked, true);
  assert.equal(doc.getElementById('output').value, 'keepme@gmail.com:pw');
});

test('theme toggle flips data-theme and persists it', () => {
  const { window, document } = loadPage();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark', 'dark is the default');
  document.getElementById('themeBtn').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(window.localStorage.getItem('combo-sorter-web:theme'), 'light');
  document.getElementById('themeBtn').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(window.localStorage.getItem('combo-sorter-web:theme'), 'dark');
});

test('input meta reports line and character counts', () => {
  const { document } = loadPage();
  assert.equal(document.getElementById('inputMeta').textContent, '0 lines · 0 chars');
  const input = document.getElementById('input');
  input.value = 'a@b.com:1\nc@d.com:2';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  return new Promise((resolve) => setTimeout(() => {
    assert.equal(document.getElementById('inputMeta').textContent, '2 lines · 19 chars');
    resolve();
  }, 200));
});

test('domain + password filters re-render live and surface filtered rows', () => {
  const { document } = loadPage();
  const input = $(document, 'input');
  input.value = 'a@gmail.com:Longpass1\nb@hotmail.com:Longpass1\nc@gmail.com:ab';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  return new Promise((resolve) => setTimeout(() => {
    assert.match($(document, 'stats').textContent, /unique passwords 2/);
    const skip = $(document, 'domainSkip');
    skip.value = 'hotmail.com';
    skip.dispatchEvent(new skip.ownerDocument.defaultView.Event('change'));
    const min = $(document, 'minPassLen');
    min.value = '8';
    min.dispatchEvent(new min.ownerDocument.defaultView.Event('change'));
    assert.equal($(document, 'output').value, 'a@gmail.com:Longpass1');
    assert.match($(document, 'stats').textContent, /filtered 2/);
    assert.match($(document, 'rejectedList').textContent, /domain excluded/);
    assert.match($(document, 'rejectedList').textContent, /password shorter than 8/);
    resolve();
  }, 200));
});

test('email case and seeded shuffle sort render in the output', () => {
  const { document } = loadPage();
  const input = $(document, 'input');
  input.value = 'MiXeD@Gmail.COM:HeLLo1\nzeta@x.com:pw9';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  return new Promise((resolve) => setTimeout(() => {
    const ec = $(document, 'emailCase');
    ec.value = 'keep';
    ec.dispatchEvent(new ec.ownerDocument.defaultView.Event('change'));
    assert.match($(document, 'output').value.split('\n')[0], /MiXeD@Gmail\.COM:HeLLo1/);
    const sort = $(document, 'sort');
    sort.value = 'shuffle';
    sort.dispatchEvent(new sort.ownerDocument.defaultView.Event('change'));
    const first = $(document, 'output').value.split('\n')[0];
    sort.dispatchEvent(new sort.ownerDocument.defaultView.Event('change'));
    assert.equal($(document, 'output').value.split('\n')[0], first, 'same seed must keep the same order');
    resolve();
  }, 200));
});

test('split -> zip wiring: part count, names, contents, blob hand-off', () => {
  const { document, zipCalls, createdBlobs } = loadPage();
  const input = $(document, 'input');
  input.value = 'a@x.com:1\nb@x.com:2\nc@y.com:3\nd@y.com:4';
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  return new Promise((resolve) => setTimeout(() => {
    // 4 lines, 10000 per file -> one part
    assert.match($(document, 'splitMeta').textContent, /1 file/);

    const sv = $(document, 'splitValue');
    sv.value = '2';
    sv.dispatchEvent(new sv.ownerDocument.defaultView.Event('change'));
    assert.match($(document, 'splitMeta').textContent, /2 files · 2 lines each/);

    $(document, 'zipBtn').click();
    assert.equal(zipCalls.length, 1, 'ComboZip.buildZip should be called once');
    const files = zipCalls[0];
    assert.equal(files.length, 2);
    assert.match(files[0].name, /^combo-sorted-\d{8}-\d{4}-part-001\.txt$/);
    assert.match(files[1].name, /-part-002\.txt$/);
    assert.equal(files[0].data, 'a@x.com:1\nb@x.com:2');
    assert.equal(files[1].data, 'c@y.com:3\nd@y.com:4');
    assert.equal(createdBlobs.length, 1, 'the archive should be handed to URL.createObjectURL');

    // domain mode: one file per domain, alphabetised
    const mode = $(document, 'splitMode');
    mode.value = 'domain';
    mode.dispatchEvent(new mode.ownerDocument.defaultView.Event('change'));
    assert.match($(document, 'splitMeta').textContent, /2 files — one per domain/);
    assert.ok($(document, 'splitValue').disabled, 'size input is irrelevant in domain mode');
    $(document, 'zipBtn').click();
    const byDomain = zipCalls[1];
    // (zipCalls elements were created inside the jsdom realm, so compare as
    // plain strings instead of relying on cross-realm deep equality.)
    assert.equal(byDomain.map((f) => f.name).join(','), 'x.com.txt,y.com.txt');
    assert.equal(byDomain[1].data, 'c@y.com:3\nd@y.com:4');
    resolve();
  }, 200));
});

test('the page never makes a network request', () => {
  // Comments legitimately contain example URLs (smtps://u:p@relay:587), so strip
  // them before scanning for anything that would actually touch the network.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = {
    'index.html': fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
    'app.js': strip(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')),
    'core.js': strip(fs.readFileSync(path.join(ROOT, 'src/core.js'), 'utf8')),
    'zip.js': strip(fs.readFileSync(path.join(ROOT, 'src/zip.js'), 'utf8')),
  };
  const NETWORK = /fetch\s*\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket|new\s+Image\s*\(/;
  for (const [name, src] of Object.entries(files)) {
    assert.ok(!NETWORK.test(src), name + ' must not make network requests');
  }
  // No remote <script>/<link>/<img> either — the page must work from file://.
  assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)\s*=\s*["']https?:/i.test(files['index.html']),
    'index.html must not load anything from a remote origin');
});
