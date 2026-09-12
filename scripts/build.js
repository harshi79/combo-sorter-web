#!/usr/bin/env node
/*
 * Build step for Vercel.
 *
 * There is nothing to compile — this just copies the five files the site
 * needs into dist/, the directory vercel.json (#outputDirectory) points
 * Vercel at. The deployment contains *only* the site: dev files (tests,
 * package.json, vercel.json) never reach a public URL, and this is
 * verifiable — run `npm run build` and look in dist/.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// The complete list of files the deployed site needs. The first four are what
// the page requests; robots.txt is served as a plain file at the site root.
// Response headers live in vercel.json, which Vercel reads from the project
// root — it is configuration, so it never gets deployed itself.
const FILES = ['index.html', 'styles.css', 'app.js', 'src/core.js', 'robots.txt'];

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
