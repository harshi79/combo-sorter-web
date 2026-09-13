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

test('email:pass survives arbitrary surrounding garbage', () => {
  const input = [
    'random words before user.one@example.com:Pass-1 and notes after',
    '<user.two@example.com>; Pass-2 trailing garbage',
    '[user.three@example.com](mailto:user.three@example.com):Pass-3 more text',
    'this line has no credential pair at all',
  ].join('\n');
  const out = core.process(input);
  assert.equal(core.format(out.entries, 'email:pass'), [
    'user.one@example.com:Pass-1',
    'user.two@example.com:Pass-2',
    'user.three@example.com:Pass-3',
  ].join('\n'));
  assert.equal(out.entries.length, 3);
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

test('autoFix: correct domains keep their case, typos still get fixed', () => {
  assert.equal(core.parseLine('MiXeD@Gmail.COM:pw', 1, { autoFix: true }).emailKeep, 'MiXeD@Gmail.COM');
  assert.equal(core.parseLine('MiXeD@Gnail.COM:pw', 1, { autoFix: true }).emailKeep, 'MiXeD@gmail.com');
  assert.equal(core.parseLine('MiXeD@gnail.com:pw', 1, { autoFix: true }).emailKeep, 'MiXeD@gmail.com');
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
  assert.equal(core.format(entries, 'usernames only'), 'john');
  assert.equal(core.format(entries, 'passwords only'), 'secret123');
});

test('domain filter: keep list with TLD-suffix matching', () => {
  const input = 'a@gmail.com:1\nb@hotmail.com:2\nc@mail.example.co.uk:3\nd@yco.uk:4';
  const out = core.process(input, { domainKeep: 'gmail.com, co.uk' });
  assert.deepEqual(out.entries.map((e) => e.email), ['a@gmail.com', 'c@mail.example.co.uk']);
  assert.equal(out.stats.filtered, 2);
  const why = out.rejected.filter((r) => r.filtered).map((r) => r.reason);
  assert.deepEqual(why, ['domain not in keep list', 'domain not in keep list']);
  // filtered rows keep their raw content for the rejected panel
  assert.equal(out.rejected.find((r) => r.filtered).raw, 'b@hotmail.com:2');
});

test('domain filter: skip list, and skip wins over keep', () => {
  const input = 'a@gmail.com:1\nb@hotmail.com:2';
  const out = core.process(input, { domainSkip: 'HOTMAIL.com' });
  assert.deepEqual(out.entries.map((e) => e.email), ['a@gmail.com']);
  assert.equal(out.stats.filtered, 1);
  assert.equal(out.rejected.find((r) => r.filtered).reason, 'domain excluded');
  const both = core.process(input, { domainKeep: 'gmail.com, hotmail.com', domainSkip: 'hotmail.com' });
  assert.deepEqual(both.entries.map((e) => e.email), ['a@gmail.com']);
});

test('domain filter: a dropped row must not eat a dedupe slot', () => {
  // First occurrence is on an excluded domain; the kept second must survive.
  const input = 'a@hotmail.com:pw1\na@gmail.com:pw1';
  const out = core.process(input, { domainSkip: 'hotmail.com' });
  assert.deepEqual(out.entries.map((e) => e.email), ['a@gmail.com']);
  assert.equal(out.stats.duplicatesRemoved, 0);
});

test('password rules: min/max length and required digit', () => {
  const input = 'a@x.com:short\nb@x.com:LongEnough1\nc@x.com:LongEnough\nd@x.com:averyveryverylongpassword1';
  const out = core.process(input, { minPassLen: 8, maxPassLen: 12, passNeedsDigit: true });
  assert.deepEqual(out.entries.map((e) => e.email), ['b@x.com']);
  const why = out.rejected.filter((r) => r.filtered).map((r) => r.reason);
  assert.deepEqual(why, [
    'password shorter than 8',
    'password has no digit',
    'password longer than 12',
  ]);
});

test('case options: email lower/keep/upper, password keep/lower/upper', () => {
  const out = core.process('MiXeD@Gmail.COM:HeLLo1');
  assert.equal(out.entries[0].emailOut, 'mixed@gmail.com', 'default is lowercase');
  assert.equal(out.entries[0].passOut, 'HeLLo1', 'password case is preserved by default');

  const keep = core.process('MiXeD@Gmail.COM:HeLLo1', { emailCase: 'keep' });
  assert.equal(keep.entries[0].emailOut, 'MiXeD@Gmail.COM');
  assert.equal(keep.entries[0].email, 'mixed@gmail.com', 'canonical form stays lower-cased');

  const upper = core.process('MiXeD@Gmail.COM:HeLLo1', { emailCase: 'upper', passCase: 'upper' });
  assert.equal(upper.entries[0].emailOut, 'MIXED@GMAIL.COM');
  assert.equal(upper.entries[0].passOut, 'HELLO1');

  const lower = core.process('MiXeD@Gmail.COM:HeLLo1', { passCase: 'lower' });
  assert.equal(lower.entries[0].passOut, 'hello1');
});

test('case options: dedupe compares canonical forms', () => {
  const out = core.process('A@X.com:Pass1\na@x.com:PASS1', { passCase: 'lower' });
  assert.equal(out.entries.length, 1, 'same pair in different case must collapse');
  assert.equal(out.stats.duplicatesRemoved, 1);
  assert.equal(out.entries[0].passOut, 'pass1');
});

test('sort by domain groups the list', () => {
  const input = 'b@zeta.com:1\na@gmail.com:2\nc@zeta.com:3\nd@gmail.com:4';
  const out = core.process(input, { sort: 'domain', dedupe: 'none' });
  assert.deepEqual(out.entries.map((e) => e.email), [
    'a@gmail.com', 'd@gmail.com', 'b@zeta.com', 'c@zeta.com',
  ]);
});

test('shuffle is a stable, seeded permutation', () => {
  const input = 'a@x.com:1\nb@x.com:2\nc@x.com:3\nd@x.com:4\ne@x.com:5';
  const s1 = core.process(input, { sort: 'shuffle', shuffleSeed: 42 });
  const s2 = core.process(input, { sort: 'shuffle', shuffleSeed: 42 });
  assert.deepEqual(s1.entries.map((e) => e.email), s2.entries.map((e) => e.email), 'same seed -> same order');
  assert.deepEqual(
    s1.entries.map((e) => e.email).slice().sort(),
    ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'],
    'must be a permutation of the input'
  );
  const s3 = core.process(input, { sort: 'shuffle', shuffleSeed: 7 });
  assert.notDeepEqual(s3.entries.map((e) => e.email), s1.entries.map((e) => e.email), 'different seed -> different order');
});

test('stats: unique emails/passwords and filtered count', () => {
  const out = core.process('a@x.com:one\nb@x.com:one\nc@x.com:two', { dedupe: 'none' });
  assert.equal(out.stats.uniqueEmails, 3);
  assert.equal(out.stats.uniquePasswords, 2);
  assert.equal(out.stats.filtered, 0);
  const filtered = core.process('a@x.com:one', { minPassLen: 5 });
  assert.equal(filtered.stats.filtered, 1);
});

test('splitText: lines-per-file, even counts, no data loss', () => {
  const text = 'l1\nl2\nl3\nl4\nl5';
  assert.deepEqual(core.splitText(text, 'lines', 2), ['l1\nl2', 'l3\nl4', 'l5']);
  assert.deepEqual(core.splitText(text, 'count', 2), ['l1\nl2\nl3', 'l4\nl5']);
  assert.deepEqual(core.splitText('', 'lines', 2), []);
  assert.deepEqual(core.splitText('only', 'count', 4), ['only'], 'fewer lines than files -> no empty parts');
  assert.deepEqual(core.splitText('a', 'lines', 0), ['a'], 'bad value clamps to 1');

  const big = Array.from({ length: 101 }, (_, i) => 'line' + i).join('\n');
  assert.equal(core.splitText(big, 'lines', 40).join('\n').split('\n').length, 101);
  assert.equal(core.splitText(big, 'count', 7).join('\n').split('\n').length, 101);
});

test('groupByDomain buckets by domain, alphabetised, pre-formatted', () => {
  const entries = core.process('a@gmail.com:1\nb@zeta.com:2\nc@gmail.com:3', { dedupe: 'none' }).entries;
  const groups = core.groupByDomain(entries, 'email:pass');
  assert.deepEqual(groups.map((g) => g.name), ['gmail.com', 'zeta.com']);
  assert.equal(groups[0].text, 'a@gmail.com:1\nc@gmail.com:3');
  assert.equal(core.groupByDomain(entries, 'usernames only')[1].text, 'b');
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

test('100k-line file clears the in-browser budget', () => {
  // Most online combo cleaners choke (or upload) somewhere under this size;
  // this whole pipeline runs in the user's tab, so it must stay comfortably fast.
  const lines = [];
  for (let i = 0; i < 100000; i++) {
    lines.push(['user' + i + '@example.com : pass' + i, 'PASS' + i + '|' + 'user' + i + '@mail.example.co.uk', 'x' + i + '=' + 'user' + i + '@proton.me'][i % 3]);
  }
  const t0 = Date.now();
  const out = core.process(lines.join('\n'), { sort: 'email-asc', dedupe: 'email' });
  const ms = Date.now() - t0;
  assert.equal(out.stats.valid, 100000);
  assert.ok(ms < 8000, '100k lines took ' + ms + 'ms (budget 8000ms)');
  console.log('    100k lines in ' + ms + 'ms');
});
