'use strict';

/**
 * Guards the Cloudflare Pages artifact: runs the real build script and asserts
 * on what actually lands in dist/, because that directory is the only thing
 * that gets uploaded to a public URL.
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

test('npm run build produces exactly the expected files', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js')], { cwd: ROOT, stdio: 'pipe' });
  assert.deepEqual(listDist(), [
    '_headers',
    'app.js',
    'index.html',
    'robots.txt',
    'src/core.js',
    'styles.css',
  ]);
});

test('no dev files or credentials land in dist/', () => {
  const files = listDist();
  const forbidden = files.filter((f) =>
    /(^|\/)(package(-lock)?\.json|wrangler\.toml|README\.md|\.gitignore|.*\.test\.js)$/.test(f) ||
    /^node_modules\//.test(f) || /^tests\//.test(f) || /^\.github\//.test(f)
  );
  assert.deepEqual(forbidden, [], 'these must not be deployed: ' + forbidden.join(', '));
});

test('every asset index.html references exists in dist/', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:|data:|#)/.test(u)); // ignore absolute URLs and data URIs
  assert.ok(refs.length >= 3, 'expected local refs, got ' + JSON.stringify(refs));
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(DIST, ref)), 'dist/ is missing referenced asset: ' + ref);
  }
});

test('deployed index.html and core.js are byte-identical to the source', () => {
  for (const rel of ['index.html', 'styles.css', 'app.js', 'src/core.js']) {
    const a = fs.readFileSync(path.join(ROOT, rel));
    const b = fs.readFileSync(path.join(DIST, rel));
    assert.ok(a.equals(b), rel + ' in dist/ differs from the source');
  }
});

test('wrangler.toml points Pages at dist/', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^pages_build_output_dir\s*=\s*"dist"$/m);
  assert.match(toml, /^name\s*=\s*"combo-sorter-web"$/m);
});

test('_headers is syntactically valid for Cloudflare Pages', () => {
  const text = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
  // Rules are a path line followed by indented "Header: value" lines.
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  let seenPath = false;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      assert.match(line, /^\/\S*$/, 'rule path must start with /: ' + line);
      seenPath = true;
    } else {
      assert.ok(seenPath, 'header line before any path: ' + line);
      assert.match(line.trim(), /^[A-Za-z-]+:\s*\S.*$/, 'malformed header line: ' + line);
    }
  }
  assert.ok(seenPath, '_headers defines no rules');
});
