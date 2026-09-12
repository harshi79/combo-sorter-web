/*
 * combo-sorter-web :: core parsing engine (pure logic, no DOM).
 *
 * This file is deliberately dependency-free and environment-free so it can be
 * unit-tested with plain `node --test` and loaded in the browser as a classic
 * script at the same time.
 *
 * Everything happens in the user's browser. Nothing is ever uploaded.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // node / tests
  if (root) root.ComboCore = api; // browser
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Regexes
  // --------------------------------------------------------------------------

  // Loose: used to *find* something that is probably an email inside a messy line.
  const EMAIL_LOOSE = /[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/;

  // Strict: used to *validate* in strict mode.
  const EMAIL_STRICT = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

  // Header rows we should not treat as data: "email,password" / "Email | Pass" / ...
  const HEADER_ROW = /^\s*(?:e-?mail(?:\s*address)?|user(?:name)?|login|mail)\s*[,;:|=\t]\s*(?:pass(?:word|wd)?|pwd|secret|key)\s*$/i;

  // Domain typos we can repair automatically when "auto-fix" is on.
  const DOMAIN_FIXES = [
    [/\bgmai[l1]\.com$/i, 'gmail.com'],
    [/\bgmial\.com$/i, 'gmail.com'],
    [/\bgamil\.com$/i, 'gmail.com'],
    [/\bgnail\.com$/i, 'gmail.com'],
    [/\bgmaill\.com$/i, 'gmail.com'],
    [/\bgmali\.com$/i, 'gmail.com'],
    [/\bhotmai[l1]\.com$/i, 'hotmail.com'],
    [/\bhotmial\.com$/i, 'hotmail.com'],
    [/\byaho[o0]\.com$/i, 'yahoo.com'],
    [/\byahho\.com$/i, 'yahoo.com'],
    [/\boutloo?k\.com$/i, 'outlook.com'],
    [/\bicl?oud\.com$/i, 'icloud.com'],
  ];

  // --------------------------------------------------------------------------
  // Small helpers
  // --------------------------------------------------------------------------

  const QUOTE_CHARS = { '"': '"', "'": "'", '`': '`' };

  function unquote(v) {
    if (v == null) return '';
    let s = String(v);
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if (s.length >= 2 && QUOTE_CHARS[first] && last === QUOTE_CHARS[first]) {
      return s.slice(1, -1).replace(/\\(["'`])/g, '$1');
    }
    return s;
  }

  /** Strip wrapping quotes + surrounding whitespace, and trailing separators. */
  function tidy(v) {
    let s = String(v == null ? '' : v).trim();
    s = unquote(s).trim();
    return s.replace(/[,;|]+$/, '').trim();
  }
  /** Split on a delimiter, ignoring delimiters inside quotes. Returns [] if none. */
  function splitUnquoted(line, delim) {
    const parts = [];
    let buf = '';
    let quote = null;
    let hits = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === '\\' && line[i + 1] === quote) { buf += quote; i++; continue; }
        if (ch === quote) quote = null;
        buf += ch;
        continue;
      }
      if (QUOTE_CHARS[ch]) { quote = ch; buf += ch; continue; }
      if (ch === delim) { parts.push(buf); buf = ''; hits++; continue; }
      buf += ch;
    }
    parts.push(buf);
    return hits > 0 ? parts : [];
  }

  /**
   * Best-effort "is this an email?" check. Applies auto-fix cleanups first so a
   * line like "john.@gmail.com:pw" is still recognised instead of being dropped.
   */
  function looksLikeEmail(s) {
    const cleaned = cleanEmail(String(s || ''), { autoFix: true });
    return EMAIL_LOOSE.test(cleaned) || EMAIL_LOOSE.test(String(s || '').trim());
  }

  /** Drop a URL scheme prefix so "https://john@x.com" can be recognised as an email. */
  function stripScheme(s) {
    return String(s == null ? '' : s).trim().replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '');
  }

  /**
   * Strip an accidentally doubled final label: "a@gmail.com.com" -> "a@gmail.com".
   * Deliberately narrow — it only fires when the last two labels are *identical*,
   * because any "known TLD list" heuristic silently destroys real domains such as
   * "sub.example.co.uk". Better to leave a typo alone than to corrupt good data.
   */
  const DOUBLED_LABEL = /\.([A-Za-z]{2,})\.\1$/i;


  function cleanEmail(raw, options) {
    let email = tidy(raw).toLowerCase();
    // Trailing dot(s) before the domain, or a stray dot gluing two domains: a@b.com.x
    // A dot immediately before the @ is always a typo ("john.@gmail.com").
    // Only that one — dots inside the local part are legitimate ("john.doe@").
    if (options && options.autoFix) {
      email = email.replace(/\.(?=@)/, '');
      email = email.replace(DOUBLED_LABEL, '.$1');
      for (const [re, fix] of DOMAIN_FIXES) email = email.replace(re, fix);
    }
    return email;
  }

  function validateEmail(email, strict) {
    if (!email) return 'empty';
    if (!email.includes('@')) return 'no @';
    const at = email.lastIndexOf('@');
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (!local) return 'no local part';
    if (!domain) return 'no domain';
    if (!domain.includes('.')) return 'domain has no dot';
    if (strict && !EMAIL_STRICT.test(email)) return 'fails strict pattern';
    if (!strict && !EMAIL_LOOSE.test(email)) return 'not email-shaped';
    return null;
  }

  // --------------------------------------------------------------------------
  // Line parsing
  // --------------------------------------------------------------------------

  const DELIMS = [':', ';', '|', ',', '=', '\t', ' '];

  /**
   * Try `line` as `<something><delim><something>` for every supported delimiter.
   * Prefers the split where exactly one side is email-shaped; when both work
   * (rare) the delimiter that appears earliest in the line wins.
   */
  function splitAsPair(line) {
    let best = null;
    for (const d of DELIMS) {
      const parts = splitUnquoted(line, d);
      if (parts.length < 2) continue;
      // Try left-to-right groupings so passwords containing the delimiter survive
      // in the common case (first delimiter is the separator).
      for (let i = 1; i < parts.length; i++) {
        const left = parts.slice(0, i).join(d);
        const right = parts.slice(i).join(d);
        const lEmail = looksLikeEmail(stripScheme(left));
        const rEmail = looksLikeEmail(stripScheme(right));
        if (lEmail && tidy(right).length) {
          return { email: stripScheme(left), pass: right, delim: d, order: 'email-first', index: line.indexOf(d) };
        }
        if (rEmail && tidy(left).length) {
          return { email: stripScheme(right), pass: left, delim: d, order: 'pass-first', index: line.indexOf(d) };
        }
        if (!best && lEmail !== rEmail) best = { email: left, pass: right, delim: d, order: 'email-first', index: line.indexOf(d) };
      }
    }
    return best;
  }

  /** Two tokens separated by whitespace, either order: `pass john@x.com`. */
  function splitByWhitespace(line) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== 2) return null;
    if (looksLikeEmail(tokens[0])) return { email: tokens[0], pass: tokens[1], delim: ' ', order: 'email-first' };
    if (looksLikeEmail(tokens[1])) return { email: tokens[1], pass: tokens[0], delim: ' ', order: 'pass-first' };
    return null;
  }

  /**
   * Parse one raw line.
   * @returns {{ok:boolean, email?:string, pass?:string, reason?:string, source:string, line:number, raw:string}}
   */
  function parseLine(rawLine, lineNumber, options) {
    const opts = Object.assign({ strict: false, autoFix: false, allowEmptyPass: false, parseHeaders: false }, options || {});
    const raw = String(rawLine == null ? '' : rawLine);
    const line = raw.replace(/\r$/, '').trim();
    const base = { line: lineNumber, raw, source: 'line' };

    if (!line) return Object.assign(base, { ok: false, reason: 'empty line' });
    if (/^(#|\/\/|;(?!\S)|--)/.test(line)) return Object.assign(base, { ok: false, reason: 'comment' });
    if (!opts.parseHeaders && HEADER_ROW.test(line)) return Object.assign(base, { ok: false, reason: 'header row' });

    let emailRaw = null;
    let passRaw = null;
    let how = null;

    // Pull a URL scheme off the front before anything else, otherwise the "://"
    // colon gets read as the email/password separator.
    const schemeMatch = line.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)(.*)$/);
    const body = schemeMatch ? schemeMatch[2] : line;

    if (schemeMatch) {
      // The line is a URL, so read it as URL userinfo: "email:password@host/path".
      // Anything after the '@' is the host, not part of the password.
      const ui = body.match(/^([^\s]+?):([^\s]*)@([^\s]*)$/);
      if (ui) {
        const candidate = cleanEmail(ui[1], opts);
        if (ui[2] && !validateEmail(candidate, false)) {
          emailRaw = candidate;
          passRaw = ui[2];
          how = 'url userinfo';
        } else {
          // A URL whose userinfo is not an email (e.g. smtps://user:pw@relay:587).
          // Guessing here produces silently wrong rows, so reject it instead.
          return Object.assign(base, { ok: false, reason: 'url without an email username' });
        }
      }
    }

    // Delimiter split is the most reliable signal for hand-pasted bulk data.
    if (emailRaw == null) {
      const pair = splitAsPair(body);
      if (pair) {
        emailRaw = pair.email;
        passRaw = pair.pass;
        how = 'delimiter ' + JSON.stringify(pair.delim) + ' (' + pair.order + ')';
      }
    }

    if (emailRaw == null) {
      const ws = splitByWhitespace(body);
      if (ws) { emailRaw = ws.email; passRaw = ws.pass; how = 'whitespace (' + ws.order + ')'; }
    }

    // Last resort: the whole line is just an email (no password supplied).
    if (emailRaw == null) {
      const only = body.match(EMAIL_LOOSE);
      if (only && only[0].length === body.length) {
        emailRaw = body;
        passRaw = '';
        how = 'email only';
      }
    }

    if (emailRaw == null) return Object.assign(base, { ok: false, reason: 'no email found' });

    const email = cleanEmail(emailRaw, opts);
    const pass = tidy(passRaw);

    const emailProblem = validateEmail(email, opts.strict);
    if (emailProblem) return Object.assign(base, { ok: false, reason: 'invalid email: ' + emailProblem, email, pass });
    if (!pass && !opts.allowEmptyPass) return Object.assign(base, { ok: false, reason: 'missing password', email, pass });

    return Object.assign(base, { ok: true, email, pass, source: how });
  }

  // --------------------------------------------------------------------------
  // Bulk pipeline
  // --------------------------------------------------------------------------

  /**
   * Turn a blob of messy text into a clean, de-duplicated list.
   *
   * @param {string} text
   * @param {object} options
   *   strict         {boolean} require the email to match a strict pattern
   *   autoFix        {boolean} repair common domain typos / stray dots
   *   allowEmptyPass {boolean} keep entries that have an email but no password
   *   parseHeaders   {boolean} treat "email,password" header rows as data
   *   dedupe         {'email'|'pair'|'none'}
   *   sort           {'none'|'email-asc'|'email-desc'|'pass-asc'|'source'}
   * @returns {{entries:Array, rejected:Array, stats:object}}
   */
  function process(text, options) {
    const opts = Object.assign(
      { strict: false, autoFix: false, allowEmptyPass: false, parseHeaders: false, dedupe: 'email', sort: 'none' },
      options || {}
    );

    const raw = String(text == null ? '' : text);
    // An empty box is zero lines, not one blank line.
    const lines = raw === '' ? [] : raw.split(/\r\n|\r|\n/);
    const entries = [];
    const rejected = [];

    lines.forEach((rawLine, i) => {
      const res = parseLine(rawLine, i + 1, opts);
      if (res.ok) entries.push(res);
      else rejected.push(res);
    });

    // ---- de-duplicate -------------------------------------------------
    const seen = new Map();
    const kept = [];
    let dupes = 0;
    if (opts.dedupe === 'none') {
      kept.push(...entries);
    } else {
      for (const e of entries) {
        const key = opts.dedupe === 'pair' ? e.email + '\u0000' + e.pass : e.email;
        if (seen.has(key)) { dupes++; continue; }
        seen.set(key, true);
        kept.push(e);
      }
    }

    // ---- sort ---------------------------------------------------------
    const sorted = kept.slice();
    const byEmailAsc = (a, b) => a.email.localeCompare(b.email, 'en', { sensitivity: 'base' }) || a.line - b.line;
    if (opts.sort === 'email-asc') sorted.sort(byEmailAsc);
    else if (opts.sort === 'email-desc') sorted.sort((a, b) => -byEmailAsc(a, b));
    else if (opts.sort === 'pass-asc') sorted.sort((a, b) => a.pass.localeCompare(b.pass) || byEmailAsc(a, b));
    else if (opts.sort === 'source') sorted.sort((a, b) => a.line - b.line);

    const byReason = {};
    for (const r of rejected) byReason[r.reason] = (byReason[r.reason] || 0) + 1;

    const domains = {};
    for (const e of sorted) {
      const d = e.email.split('@')[1] || '?';
      domains[d] = (domains[d] || 0) + 1;
    }

    return {
      entries: sorted,
      rejected,
      stats: {
        lines: lines.length,
        valid: sorted.length,
        rejected: rejected.length,
        duplicatesRemoved: dupes,
        emptyLines: rejected.filter((r) => r.reason === 'empty line').length,
        comments: rejected.filter((r) => r.reason === 'comment').length,
        headers: rejected.filter((r) => r.reason === 'header row').length,
        reasons: byReason,
        domains,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Output formatting
  // --------------------------------------------------------------------------

  const FORMATS = {
    'email:pass': (e) => e.email + ':' + e.pass,
    'email;pass': (e) => e.email + ';' + e.pass,
    'email|pass': (e) => e.email + '|' + e.pass,
    'email=pass': (e) => e.email + '=' + e.pass,
    'email<tab>pass': (e) => e.email + '\t' + e.pass,
    csv: (e) => csvField(e.email) + ',' + csvField(e.pass),
    jsonl: (e) => JSON.stringify({ email: e.email, password: e.pass }),
    'emails only': (e) => e.email,
    'passwords only': (e) => e.pass,
  };

  function csvField(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function format(entries, formatName) {
    const fn = FORMATS[formatName] || FORMATS['email:pass'];
    return entries.map(fn).join('\n');
  }

  return {
    EMAIL_LOOSE,
    EMAIL_STRICT,
    FORMATS,
    formatNames: Object.keys(FORMATS),
    parseLine,
    process,
    format,
    cleanEmail,
    validateEmail,
    splitUnquoted,
    tidy,
    unquote,
  };
});
