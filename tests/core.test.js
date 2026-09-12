'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');

test('plain email:pass', () => {
  const r = core.parseLine('john@gmail.com:secret123', 1);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'john@gmail.com');
  assert.equal(r.pass, 'secret123');
});

test('spaced variants: email : pass', () => {
  for (const line of ['john@gmail.com : secret123', '  john@gmail.com:secret123  ', 'john@gmail.com :  secret123 ']) {
    const r = core.parseLine(line, 1);
    assert.equal(r.ok, true, line);
    assert.equal(r.email, 'john@gmail.com');
    assert.equal(r.pass, 'secret123');
  }
});

test('other delimiters', () => {
  const cases = [
    ['john@gmail.com;secret123', 'secret123'],
    ['john@gmail.com|secret123', 'secret123'],
    ['john@gmail.com,secret123', 'secret123'],
    ['john@gmail.com=secret123', 'secret123'],
    ['john@gmail.com\tsecret123', 'secret123'],
    ['john@gmail.com secret123', 'secret123'],
  ];
  for (const [line, pass] of cases) {
    const r = core.parseLine(line, 1);
    assert.equal(r.ok, true, line);
    assert.equal(r.email, 'john@gmail.com', line);
    assert.equal(r.pass, pass, line);
  }
});

test('password first (pass:email)', () => {
  const r = core.parseLine('secret123:john@gmail.com', 1);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'john@gmail.com');
  assert.equal(r.pass, 'secret123');
});

test('password containing colons survives (first delimiter wins)', () => {
  const r = core.parseLine('john@gmail.com:pass:with:colons', 1);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'john@gmail.com');
  assert.equal(r.pass, 'pass:with:colons');
});

test('password containing a comma survives when email comes first', () => {
  const r = core.parseLine('john@gmail.com,hello, world', 1);
  assert.equal(r.ok, true);
  assert.equal(r.pass, 'hello, world');
});

test('quoted csv fields', () => {
  const r = core.parseLine('"john@gmail.com","p,ass:word"', 1);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'john@gmail.com');
  assert.equal(r.pass, 'p,ass:word');
});

test('url-style creds', () => {
  const r = core.parseLine('https://john@gmail.com:secret123@accounts.example.com/login', 1);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'john@gmail.com');
  assert.equal(r.pass, 'secret123');
});

test('relay-style url with a non-email username is rejected, not mangled', () => {
  // "smtps" would otherwise be read as the local part of smtps@relay.example.com
  const r = core.parseLine('smtps://relayuser:relaypass@relay.example.com:587', 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'url without an email username');
});

test('email is upper/lower normalised', () => {
  const r = core.parseLine('  John.DOE@Gmail.COM : Hunter2 ', 1);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'john.doe@gmail.com');
  assert.equal(r.pass, 'Hunter2', 'password case must be preserved');
});

test('autoFix repairs domain typos and stray dots', () => {
  assert.equal(core.parseLine('a@gnail.com:x', 1, { autoFix: true }).email, 'a@gmail.com');
  assert.equal(core.parseLine('a@gmial.com:x', 1, { autoFix: true }).email, 'a@gmail.com');
  assert.equal(core.parseLine('john.@gmail.com:x', 1, { autoFix: true }).email, 'john@gmail.com');
  // without autoFix the typo is left alone
  assert.equal(core.parseLine('a@gnail.com:x', 1).email, 'a@gnail.com');
});

test('autoFix never eats a legitimate dot in the local part', () => {
  assert.equal(core.parseLine('john.doe@gmail.com:x', 1, { autoFix: true }).email, 'john.doe@gmail.com');
  assert.equal(core.parseLine('a.b.c@sub.example.co.uk:x', 1, { autoFix: true }).email, 'a.b.c@sub.example.co.uk');
});

test('strict mode rejects junk domains', () => {
  assert.equal(core.parseLine('a@b.c:x', 1, { strict: true }).ok, false);
  assert.equal(core.parseLine('a@b.c:x', 1, { strict: false }).ok, true);
});

test('rejects: empty, comment, header, no email, missing password', () => {
  assert.equal(core.parseLine('', 1).reason, 'empty line');
  assert.equal(core.parseLine('# note here', 1).reason, 'comment');
  assert.equal(core.parseLine('email,password', 1).reason, 'header row');
  assert.equal(core.parseLine('not-an-entry', 1).reason, 'no email found');
  assert.equal(core.parseLine('john@gmail.com:', 1).reason, 'missing password');
  assert.equal(core.parseLine('john@gmail.com', 1).reason, 'missing password');
});

test('header rows can be parsed as data on request', () => {
  const r = core.parseLine('email,password', 1, { parseHeaders: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no email found');
});

test('empty password kept only when allowed', () => {
  assert.equal(core.parseLine('john@gmail.com', 1, { allowEmptyPass: true }).ok, true);
  assert.equal(core.parseLine('john@gmail.com', 1, { allowEmptyPass: true }).pass, '');
});

test('process(): empty input is zero lines, not one blank line', () => {
  for (const empty of ['', null, undefined]) {
    const out = core.process(empty);
    assert.equal(out.stats.lines, 0);
    assert.equal(out.stats.rejected, 0);
    assert.equal(out.entries.length, 0);
  }
  // A single trailing newline is one real line plus nothing else.
  assert.equal(core.process('a@b.com:x\n').stats.lines, 2);
});

test('process(): mixed messy blob', () => {
  const input = [
    'email:password',
    'alice@outlook.com:Alpha1',
    'alice@outlook.com:Alpha1', // exact duplicate
    'bob@yahoo.com | Beta2',
    'C2c@gnail.com:Gamma3',
    'Delta4:dave@hotmail.com',
    '# a comment',
    '',
    'garbage-line',
    'https://erin@icloud.com:Eps5@x.example.org',
  ].join('\n');

  const out = core.process(input, { autoFix: true });
  assert.equal(out.stats.valid, 5, '5 unique rows, one exact dup removed');
  assert.equal(out.stats.duplicatesRemoved, 1);
  assert.equal(out.stats.headers, 1);
  assert.equal(out.stats.comments, 1);
  assert.deepEqual(
    out.entries.map((e) => e.email),
    ['alice@outlook.com', 'bob@yahoo.com', 'c2c@gmail.com', 'dave@hotmail.com', 'erin@icloud.com']
  );
  assert.deepEqual(
    out.entries.map((e) => e.pass),
    ['Alpha1', 'Beta2', 'Gamma3', 'Delta4', 'Eps5']
  );
  const bad = out.rejected.map((r) => r.reason).filter((x) => x !== 'empty line');
  assert.deepEqual(bad.sort(), ['comment', 'header row', 'no email found']);
});

test('process(): dedupe modes', () => {
  const input = 'a@x.com:one\na@x.com:two\nb@x.com:one';
  assert.equal(core.process(input, { dedupe: 'email' }).entries.length, 2);
  assert.equal(core.process(input, { dedupe: 'pair' }).entries.length, 3);
  assert.equal(core.process(input, { dedupe: 'none' }).entries.length, 3);
  const kept = core.process(input, { dedupe: 'email' }).entries[0];
  assert.equal(kept.pass, 'one', 'first occurrence wins');
});

test('process(): sorting is case-insensitive and stable', () => {
  const input = 'zeta@x.com:1\nalpha@x.com:2\nMid@x.com:3';
  // Emails are lower-cased on the way in, and the sort ignores case.
  assert.deepEqual(
    core.process(input, { sort: 'email-asc' }).entries.map((e) => e.email),
    ['alpha@x.com', 'mid@x.com', 'zeta@x.com']
  );
  assert.deepEqual(
    core.process(input, { sort: 'email-desc' }).entries.map((e) => e.email),
    ['zeta@x.com', 'mid@x.com', 'alpha@x.com']
  );
  // 'source' restores the original line order.
  assert.deepEqual(
    core.process(input, { sort: 'source' }).entries.map((e) => e.line),
    [1, 2, 3]
  );
  assert.deepEqual(
    core.process(input, { sort: 'pass-asc' }).entries.map((e) => e.pass),
    ['1', '2', '3']
  );
});

test('format(): every output shape', () => {
  const entries = core.process('john@gmail.com:secret123').entries;
  assert.equal(core.format(entries, 'email:pass'), 'john@gmail.com:secret123');
  assert.equal(core.format(entries, 'email|pass'), 'john@gmail.com|secret123');
  assert.equal(core.format(entries, 'email<tab>pass'), 'john@gmail.com\tsecret123');
  assert.equal(core.format(entries, 'csv'), 'john@gmail.com,secret123');
  assert.equal(core.format(entries, 'jsonl'), '{"email":"john@gmail.com","password":"secret123"}');
  assert.equal(core.format(entries, 'emails only'), 'john@gmail.com');
  assert.equal(core.format(entries, 'passwords only'), 'secret123');
});

test('format(): csv quotes fields containing commas', () => {
  const entries = core.process('john@gmail.com,p,word').entries;
  assert.equal(entries[0].pass, 'p,word');
  assert.equal(core.format(entries, 'csv'), 'john@gmail.com,"p,word"');
});

test('CRLF input and 5k-line bulk run', () => {
  const lines = [];
  for (let i = 0; i < 5000; i++) lines.push('user' + i + '@example.com : pass' + i);
  const out = core.process(lines.join('\r\n'));
  assert.equal(out.stats.valid, 5000);
  assert.equal(out.entries[4999].pass, 'pass4999');
});
