'use strict';

/**
 * Guards the Vercel artifact: runs the real build script and asserts on what
 * actually lands in dist/, because that directory (vercel.json#outputDirectory)
 * is the only thing that reaches a public URL.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function listDist() {
  const out = [];
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), r);
      else out.push(r);
    }
  })(DIST, '');
  return out.sort();
}

function loadVercelConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
}

// Does a header rule's source regex match the given path? (Vercel matches
// `source` as a regular expression against the request path.)
function matches(rule, p) {
  try {
    return new RegExp(rule.source).test(p);
  } catch (_) {
    return false;
  }
}

function headerKeysFor(cfg, p) {
  const out = new Map();
  for (const rule of cfg.headers || []) {
    if (!matches(rule, p)) continue;
    for (const h of rule.headers || []) out.set(h.key, h.value);
  }
  return out;
}

test('npm run build produces exactly the expected files', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js')], { cwd: ROOT, stdio: 'pipe' });
  assert.deepEqual(listDist(), [
    'app.js',
    'index.html',
    'robots.txt',
    'src/core.js',
    'src/zip.js',
    'styles.css',
  ]);
});

test('no dev files or credentials land in dist/', () => {
  const files = listDist();
  const forbidden = files.filter((f) =>
    /(^|\/)(package(-lock)?\.json|vercel\.json|README\.md|\.gitignore|.*\.test\.js)$/.test(f) ||
    /^node_modules\//.test(f) || /^tests\//.test(f) || /^\.github\//.test(f)
  );
  assert.deepEqual(forbidden, [], 'these must not be deployed: ' + forbidden.join(', '));
});

test('every asset index.html references exists in dist/', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)=\"([^\"]+)\"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:|data:|#)/.test(u)); // ignore absolute URLs and data URIs
  assert.ok(refs.length >= 3, 'expected local refs, got ' + JSON.stringify(refs));
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(DIST, ref)), 'dist/ is missing referenced asset: ' + ref);
  }
});

test('deployed index.html and core.js are byte-identical to the source', () => {
  for (const rel of ['index.html', 'styles.css', 'app.js', 'src/core.js', 'src/zip.js']) {
    const a = fs.readFileSync(path.join(ROOT, rel));
    const b = fs.readFileSync(path.join(DIST, rel));
    assert.ok(a.equals(b), rel + ' in dist/ differs from the source');
  }
});

test('vercel.json tells Vercel to build with npm and serve dist/', () => {
  const cfg = loadVercelConfig();
  assert.equal(cfg.buildCommand, 'npm run build', 'buildCommand must run the real build');
  assert.equal(cfg.outputDirectory, 'dist', 'outputDirectory must be the build output');
  // No framework preset on purpose: the site has no framework, and a wrong
  // preset would make Vercel apply framework-specific build steps.
  assert.equal(cfg.framework, undefined, 'do not pin a framework preset');
  // "no env direct": the deployment must not require any environment variable.
  assert.equal(cfg.env, undefined, 'the site is fully static — no env vars');
  assert.equal(cfg.build && cfg.build.env, undefined, 'no build-time env vars either');
});

test('vercel.json headers are well-formed and cover the whole site', () => {
  const cfg = loadVercelConfig();
  assert.ok(Array.isArray(cfg.headers) && cfg.headers.length > 0, 'expected a headers array');
  for (const rule of cfg.headers) {
    assert.ok(typeof rule.source === 'string' && rule.source.length > 0, 'rule without source');
    new RegExp(rule.source); // must compile
    assert.ok(Array.isArray(rule.headers) && rule.headers.length > 0, 'rule without headers');
    for (const h of rule.headers) {
      assert.ok(typeof h.key === 'string' && /^[A-Za-z-]+$/.test(h.key), 'malformed header key: ' + h.key);
      assert.ok(typeof h.value === 'string' && h.value.length > 0, 'empty header value for ' + h.key);
    }
  }
});

test('vercel.json ships the same security + cache headers as before', () => {
  const cfg = loadVercelConfig();

  // Every response gets the security headers (the old catch-all rule).
  const any = headerKeysFor(cfg, '/totally/unrelated/path');
  assert.equal(any.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(any.get('Referrer-Policy'), 'no-referrer');
  assert.ok(any.has('Permissions-Policy'), 'expected a restrictive Permissions-Policy');

  // Every asset the site serves gets the 1-hour cache rule.
  for (const asset of ['/styles.css', '/app.js', '/src/core.js', '/src/zip.js']) {
    const cc = headerKeysFor(cfg, asset).get('Cache-Control');
    assert.equal(cc, 'public, max-age=3600', 'wrong Cache-Control for ' + asset);
  }

  // And the page itself must NOT be pinned to a long-lived cache.
  assert.ok(!headerKeysFor(cfg, '/').has('Cache-Control'), 'index.html must stay revalidatable');
});
