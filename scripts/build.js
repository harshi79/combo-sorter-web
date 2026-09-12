#!/usr/bin/env node
/*
 * Build step for Cloudflare Pages.
 *
 * There is nothing to compile — this just copies the four files the site needs
 * into dist/, so the deployment contains *only* the site. Dev files (tests,
 * package.json, wrangler.toml) never reach a public URL, and unlike
 * .assetsignore this is verifiable: run `npm run build` and look in dist/.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// The complete list of files the deployed site needs.
// The first four are what the page requests; _headers and robots.txt are read
// by Cloudflare Pages itself and must sit in the output directory.
const FILES = ['index.html', 'styles.css', 'app.js', 'src/core.js', '_headers', 'robots.txt'];

// Fail loudly rather than deploying a broken page.
for (const rel of FILES) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.error('build: missing required file: ' + rel);
    process.exit(1);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });

let total = 0;
for (const rel of FILES) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dest);
  const size = fs.statSync(dest).size;
  total += size;
  console.log('  ' + rel.padEnd(14) + String(size).padStart(7) + ' B');
}

console.log('build: ' + FILES.length + ' files, ' + total + ' B -> dist/');
