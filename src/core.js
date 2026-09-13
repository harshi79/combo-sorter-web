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

  /** Strip a URL scheme prefix so "https://john@x.com" can be recognised as an email. */
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

  /** Normalise an email without touching its case (auto-fixes only). */
  function normalizeEmail(raw, options) {
    let email = tidy(raw);
    if (options && options.autoFix) {
      // A dot immediately before the @ is always a typo ("john.@gmail.com").
      // Only that one — dots inside the local part are legitimate ("john.doe@").
      email = email.replace(/\.(?=@)/, '');
      email = email.replace(DOUBLED_LABEL, '.$1');
      // Only rewrite a domain that is actually misspelled; a correct domain
      // keeps its original casing ("Gmail.COM" survives "as pasted" mode).
      for (const [re, fix] of DOMAIN_FIXES) email = email.replace(re, (m) => (m.toLowerCase() === fix ? m : fix));
    }
    return email;
  }

  /** Normalise + lowercase. The canonical form used for validation and dedupe. */
  function cleanEmail(raw, options) {
    return normalizeEmail(raw, options).toLowerCase();
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
  // Case + domain-list helpers
  // --------------------------------------------------------------------------

  /**
   * Apply a case mode to an email or password.
   * 'lower' and 'upper' operate on the canonical (lower-cased) value so the
   * result is well-defined; 'keep' returns the value as parsed.
   */
  function applyCase(canonical, original, mode) {
    if (mode === 'upper') return String(canonical == null ? '' : canonical).toUpperCase();
    if (mode === 'keep') return String(original == null ? '' : original);
    return String(canonical == null ? '' : canonical).toLowerCase(); // 'lower' (default)
  }

  /** Parse a comma/space/semicolon-separated list of domains into clean tokens. */
  function parseDomainList(text) {
    return String(text == null ? '' : text)
      .split(/[,;|\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * Does domain match a filter token? Exact domain match, or the token is a
   * TLD/domain suffix ("co.uk" matches "mail.example.co.uk").
   */
  function domainMatches(domain, token) {
    if (!domain || !token) return false;
    return domain === token || domain.endsWith('.' + token);
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
   * Markdown mail links are common when credentials are copied from chat or
   * another rich-text source. Handle the link as an email token, not as the
   * first colon-delimited pair (`mailto:` contains a colon of its own).
   *
   * Only the first non-whitespace token after the `:` or `;` is the password.
   * Everything after that is commentary and must not leak into the output.
   */
  function splitMarkdownMailto(line) {
    const match = String(line || '').match(
      /\[([^\]\s]+)\]\(\s*mailto:([^\)\s]+)\s*\)\s*([:;])\s*(\S+)/i
    );
    if (!match) return null;

    const displayEmail = tidy(match[1]);
    const targetEmail = tidy(match[2]);
    const email = looksLikeEmail(displayEmail) ? displayEmail : targetEmail;
    if (!looksLikeEmail(email)) return null;

    return {
      email,
      pass: match[4],
      delim: match[3],
      order: 'email-first',
      markdown: true,
    };
  }

  /** Keep the credential token and discard prose after it for : and ; rows. */
  function firstCredentialToken(value, delim) {
    const clean = tidy(value);
    if (delim === ':' || delim === ';') {
      const token = clean.match(/^\S+/);
      return token ? token[0] : '';
    }
    return clean;
  }

  /**
   * Parse one raw line.
   * @returns {{ok:boolean, email?:string, emailKeep?:string, pass?:string, reason?:string, source:string, line:number, raw:string}}
   *
   * On success: `email` is the canonical lower-cased address, `emailKeep` the
   * same address with its original casing (after auto-fixes), `pass` as parsed.
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
    let parsedDelim = null;

    // A copied Markdown mail link has a `mailto:` colon before the actual
    // credential separator. Recognise it before generic delimiter parsing.
    const markdownPair = splitMarkdownMailto(line);
    if (markdownPair) {
      emailRaw = markdownPair.email;
      passRaw = markdownPair.pass;
      parsedDelim = markdownPair.delim;
      how = 'markdown mail link (' + JSON.stringify(markdownPair.delim) + ')';
    }

    // Pull a URL scheme off the front before anything else, otherwise the "://"
    // colon gets read as the email/password separator.
    const schemeMatch = line.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)(.*)$/);
    const body = schemeMatch ? schemeMatch[2] : line;

    if (schemeMatch && emailRaw == null) {
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
        parsedDelim = pair.delim;
        how = 'delimiter ' + JSON.stringify(pair.delim) + ' (' + pair.order + ')';
      }
    }

    if (emailRaw == null) {
      const ws = splitByWhitespace(body);
      if (ws) {
        emailRaw = ws.email;
        passRaw = ws.pass;
        parsedDelim = ws.delim;
        how = 'whitespace (' + ws.order + ')';
      }
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

    const emailKeep = normalizeEmail(emailRaw, opts);
    const email = emailKeep.toLowerCase();
    // In the simple, human-friendly format, a row is `email:pass` or
    // `email;pass`. A space starts trailing notes, so `email:pass anything`
    // becomes only `email:pass`. Keep the older delimiter behaviour intact for
    // callers that still use CSV/pipe input.
    const pass = firstCredentialToken(passRaw, parsedDelim);

    const emailProblem = validateEmail(email, opts.strict);
    if (emailProblem) return Object.assign(base, { ok: false, reason: 'invalid email: ' + emailProblem, email, pass });
    if (!pass && !opts.allowEmptyPass) return Object.assign(base, { ok: false, reason: 'missing password', email, pass });

    return Object.assign(base, { ok: true, email, emailKeep, pass, source: how });
  }

  // --------------------------------------------------------------------------
  // Bulk pipeline
  // --------------------------------------------------------------------------

  /** Deterministic PRNG (mulberry32) so "shuffle" is stable per seed. */
  function mulberry32(seed) {
    let a = (seed | 0) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const domainOf = (email) => String(email).split('@')[1] || '?';

  /**
   * Turn a blob of messy text into a clean, de-duplicated list.
   *
   * @param {string} text
   * @param {object} options
   *   strict           {boolean} require the email to match a strict pattern
   *   autoFix          {boolean} repair common domain typos / stray dots
   *   allowEmptyPass   {boolean} keep entries that have an email but no password
   *   parseHeaders     {boolean} treat "email,password" header rows as data
   *   dedupe           {'email'|'pair'|'none'}
   *   sort             {'none'|'source'|'email-asc'|'email-desc'|'pass-asc'|'domain'|'shuffle'}
   *   shuffleSeed      {number} seed for the deterministic 'shuffle' sort
   *   emailCase        {'lower'|'keep'|'upper'} output casing for emails
   *   passCase         {'keep'|'lower'|'upper'} output casing for passwords
   *   domainKeep       {string} comma-separated domains to KEEP ("" = all)
   *   domainSkip       {string} comma-separated domains to DROP ("")
   *   minPassLen       {number} drop passwords shorter than this (0 = off)
   *   maxPassLen       {number} drop passwords longer than this (0 = off)
   *   passNeedsDigit   {boolean} drop passwords containing no 0-9
   * @returns {{entries:Array, rejected:Array, stats:object}}
   *
   * Entries carry both the canonical form (`email`, `pass`) and the display
   * form (`emailOut`, `passOut`) after case options are applied.
   */
  function process(text, options) {
    const opts = Object.assign({
      strict: false, autoFix: false, allowEmptyPass: false, parseHeaders: false,
      dedupe: 'email', sort: 'none', shuffleSeed: 1,
      emailCase: 'lower', passCase: 'keep',
      domainKeep: '', domainSkip: '', minPassLen: 0, maxPassLen: 0, passNeedsDigit: false,
    }, options || {});

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

    // ---- case options ------------------------------------------------------
    // Canonical (lower-cased) values keep driving validation/dedupe/stats;
    // the display values are what the user actually gets out.
    for (const e of entries) {
      e.emailOut = applyCase(e.email, e.emailKeep || e.email, opts.emailCase);
      e.passOut = applyCase(e.pass, e.pass, opts.passCase);
    }

    // ---- filters (before dedupe: a dropped row must not eat a dedupe slot) --
    const keepList = parseDomainList(opts.domainKeep);
    const skipList = parseDomainList(opts.domainSkip);
    const minLen = Math.max(0, parseInt(opts.minPassLen, 10) || 0);
    const maxLen = Math.max(0, parseInt(opts.maxPassLen, 10) || 0);
    let filtered = 0;
    const surviving = [];
    for (const e of entries) {
      const domain = domainOf(e.email);
      let fail = null;
      if (keepList.length && !keepList.some((t) => domainMatches(domain, t))) fail = 'domain not in keep list';
      else if (skipList.length && skipList.some((t) => domainMatches(domain, t))) fail = 'domain excluded';
      else if (minLen > 0 && e.passOut.length < minLen) fail = 'password shorter than ' + minLen;
      else if (maxLen > 0 && e.passOut.length > maxLen) fail = 'password longer than ' + maxLen;
      else if (opts.passNeedsDigit && !/[0-9]/.test(e.passOut)) fail = 'password has no digit';
      if (fail) {
        filtered++;
        rejected.push(Object.assign({}, e, { ok: false, reason: fail, filtered: true, source: 'filter' }));
        continue;
      }
      surviving.push(e);
    }

    // ---- de-duplicate -------------------------------------------------------
    const seen = new Map();
    const kept = [];
    let dupes = 0;
    if (opts.dedupe === 'none') {
      kept.push(...surviving);
    } else {
      for (const e of surviving) {
        const key = opts.dedupe === 'pair' ? e.email + '\u0000' + e.passOut : e.email;
        if (seen.has(key)) { dupes++; continue; }
        seen.set(key, true);
        kept.push(e);
      }
    }

    // ---- sort ----------------------------------------------------------------
    const byEmailAsc = (a, b) => a.email.localeCompare(b.email, 'en', { sensitivity: 'base' }) || a.line - b.line;
    const sorted = kept.slice();
    if (opts.sort === 'email-asc') sorted.sort(byEmailAsc);
    else if (opts.sort === 'email-desc') sorted.sort((a, b) => -byEmailAsc(a, b));
    else if (opts.sort === 'pass-asc') sorted.sort((a, b) => a.passOut.localeCompare(b.passOut) || byEmailAsc(a, b));
    else if (opts.sort === 'domain') {
      sorted.sort((a, b) => {
        const da = domainOf(a.email);
        const db = domainOf(b.email);
        return da.localeCompare(db, 'en') || byEmailAsc(a, b);
      });
    }
    else if (opts.sort === 'shuffle') {
      const rand = mulberry32(opts.shuffleSeed);
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = sorted[i]; sorted[i] = sorted[j]; sorted[j] = t;
      }
    }
    else if (opts.sort === 'source') sorted.sort((a, b) => a.line - b.line);

    // ---- stats -----------------------------------------------------------------
    const byReason = {};
    for (const r of rejected) byReason[r.reason] = (byReason[r.reason] || 0) + 1;

    const domains = {};
    for (const e of sorted) {
      const d = domainOf(e.email);
      domains[d] = (domains[d] || 0) + 1;
    }

    const uniqueEmails = new Set(sorted.map((e) => e.email)).size;
    const uniquePasswords = new Set(sorted.map((e) => e.passOut)).size;

    return {
      entries: sorted,
      rejected,
      stats: {
        lines: lines.length,
        valid: sorted.length,
        rejected: rejected.length,
        duplicatesRemoved: dupes,
        filtered,
        uniqueEmails,
        uniquePasswords,
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

  const emailOf = (e) => e.emailOut != null ? e.emailOut : e.email;
  const passOf = (e) => e.passOut != null ? e.passOut : e.pass;

  const FORMATS = {
    'email:pass': (e) => emailOf(e) + ':' + passOf(e),
    'email;pass': (e) => emailOf(e) + ';' + passOf(e),
    'email|pass': (e) => emailOf(e) + '|' + passOf(e),
    'email=pass': (e) => emailOf(e) + '=' + passOf(e),
    'email<tab>pass': (e) => emailOf(e) + '\t' + passOf(e),
    csv: (e) => csvField(emailOf(e)) + ',' + csvField(passOf(e)),
    jsonl: (e) => JSON.stringify({ email: emailOf(e), password: passOf(e) }),
    'emails only': (e) => emailOf(e),
    'usernames only': (e) => emailOf(e).split('@')[0],
    'passwords only': (e) => passOf(e),
  };

  function csvField(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function format(entries, formatName) {
    const fn = FORMATS[formatName] || FORMATS['email:pass'];
    return entries.map(fn).join('\n');
  }

  // --------------------------------------------------------------------------
  // Splitting (for the .zip export)
  // --------------------------------------------------------------------------

  /**
   * Split finished output text into file contents.
   * @param {string} text  the full output (any format)
   * @param {'lines'|'count'} mode  'lines' = at most `value` lines per file,
   *                                'count' = exactly `value` roughly-even files
   * @param {number} value
   * @returns {string[]} file contents (empty input -> [])
   */
  function splitText(text, mode, value) {
    const raw = String(text == null ? '' : text);
    const lines = raw === '' ? [] : raw.split(/\r\n|\r|\n/);
    const v = Math.max(1, Math.floor(Number(value) || 1));
    const out = [];
    if (mode === 'count') {
      const base = Math.floor(lines.length / v);
      const extra = lines.length % v;
      let start = 0;
      for (let i = 0; i < v; i++) {
        const n = base + (i < extra ? 1 : 0);
        if (n > 0) out.push(lines.slice(start, start + n).join('\n'));
        start += n;
      }
    } else {
      for (let i = 0; i < lines.length; i += v) out.push(lines.slice(i, i + v).join('\n'));
    }
    return out;
  }

  /**
   * Group entries by email domain, one entry per domain, alphabetised by
   * domain. Each group carries a pre-formatted text payload.
   */
  function groupByDomain(entries, formatName) {
    const map = new Map();
    for (const e of entries || []) {
      const d = domainOf(e.email);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(e);
    }
    const out = [];
    for (const [d, list] of map) out.push({ name: d, text: format(list, formatName) });
    out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return out;
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
    normalizeEmail,
    validateEmail,
    splitUnquoted,
    tidy,
    unquote,
    applyCase,
    parseDomainList,
    domainMatches,
    splitText,
    groupByDomain,
  };
});
