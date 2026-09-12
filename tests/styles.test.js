'use strict';

/**
 * Stylesheet validation. There is no browser available in this environment, so
 * instead of eyeballing the CSS these tests parse it for real and cross-check
 * it against the markup and the JS that generates DOM at runtime.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function parse() {
  const errors = [];
  const ast = csstree.parse(css, {
    positions: true,
    onParseError(e) {
      errors.push(e.message + ' (line ' + e.line + ')');
    },
  });
  return { ast, errors };
}

test('styles.css parses without errors', () => {
  const { ast, errors } = parse();
  assert.deepEqual(errors, [], 'CSS parse errors: ' + errors.join('; '));
  assert.ok(ast.children.size > 50, 'stylesheet looks suspiciously small');
});

test('every var(--x) referenced is actually defined', () => {
  const defined = new Set();
  for (const m of css.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)) defined.add(m[1]);
  const used = new Set();
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z][\w-]*)/g)) used.add(m[1]);

  const missing = [...used].filter((v) => !defined.has(v));
  assert.deepEqual(missing, [], 'undefined custom properties: ' + missing.join(', '));
  assert.ok(used.size > 10, 'expected the stylesheet to use its design tokens');
});

test('every colour token is overridden by the light theme', () => {
  // Structural tokens (--mono, --r-lg, ...) are intentionally shared, but a
  // colour token defined only in :root would leak dark styling into light mode.
  const blockVars = (selectorText) => {
    const escaped = selectorText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, 'missing block: ' + selectorText);
    const vars = new Map();
    for (const x of m[1].matchAll(/(--[a-zA-Z][\w-]*)\s*:\s*([^;]+);/g)) vars.set(x[1], x[2].trim());
    return vars;
  };

  const isColour = (v) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(v);

  const dark = blockVars(':root');
  const light = blockVars('[data-theme="light"]');

  const darkColours = [...dark.entries()].filter(([, v]) => isColour(v)).map(([k]) => k);
  assert.ok(darkColours.length >= 15, 'expected a full colour palette, got ' + darkColours.length);

  const missing = darkColours.filter((v) => !light.has(v));
  assert.deepEqual(missing, [], 'colour tokens missing from the light theme: ' + missing.join(', '));

  // And nothing in the light block should be an orphan the dark theme lacks.
  const orphans = [...light.keys()].filter((v) => !dark.has(v));
  assert.deepEqual(orphans, [], 'light theme defines tokens :root does not: ' + orphans.join(', '));
});

test('every class selector used in CSS exists in the markup or the JS', () => {
  const { ast } = parse();

  const usedInCss = new Set();
  csstree.walk(ast, {
    visit: 'ClassSelector',
    enter(node) {
      usedInCss.add(node.name);
    },
  });

  // Classes present statically in index.html.
  const available = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => available.add(c));
  }
  // Classes created at runtime by app.js. Note renderStats builds
  // `'<span class="chip' + kind + '">'`, so the closing quote is not in the
  // literal — match the leading run of class characters without requiring it.
  for (const m of js.matchAll(/class="([A-Za-z0-9 _-]+)/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => available.add(c));
  }
  for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)) {
    available.add(m[1]);
  }
  // Conditional class fragments built by string concatenation in renderStats.
  ['good', 'warn', 'bad'].forEach((c) => available.add(c));

  const orphans = [...usedInCss].filter((c) => !available.has(c)).sort();
  assert.deepEqual(orphans, [], 'CSS styles classes that nothing renders: ' + orphans.join(', '));
});

test('every animated keyframe name is defined', () => {
  const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const used = new Set();
  for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
    for (const part of m[1].split(',')) {
      // First identifier that is not a timing keyword/duration is the name.
      const tokens = part.trim().split(/\s+/);
      const name = tokens.find((t) => /^[a-zA-Z][\w-]*$/.test(t) && !/^(ease|linear|infinite|alternate|both|forwards|backwards|normal|reverse|none|running|paused|steps|cubic-bezier)$/.test(t));
      if (name) used.add(name);
    }
  }
  const missing = [...used].filter((n) => !defined.has(n));
  assert.deepEqual(missing, [], 'animations reference undefined keyframes: ' + missing.join(', '));
  assert.ok(defined.size >= 4, 'expected the aurora/pulse/rise/chip animations');
});

test('no remote assets are referenced from CSS', () => {
  assert.ok(!/@import/.test(css), '@import would add a blocking remote fetch');
  assert.ok(!/url\(\s*['"]?https?:/.test(css), 'CSS must not reference remote urls');
});

test('responsive and reduced-motion guards are present', () => {
  assert.match(css, /@media\s*\(max-width:\s*1020px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /:focus-visible/);
});

test('brace balance is exact', () => {
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  assert.equal(open, close, 'unbalanced braces: ' + open + ' open vs ' + close + ' close');
});
