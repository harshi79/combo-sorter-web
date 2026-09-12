# Combo Sorter

Paste bulk `email:pass` data in **any** variant format and get back one clean,
de-duplicated `email:pass` list. Built for cleaning up exports where every line
seems to use a different separator.

**Everything runs in your browser.** There is no backend, no analytics and no
upload — the page makes zero network requests, so it is safe to open straight
from `file://` with sensitive data in the box. Nothing is ever sent to Vercel
or anywhere else.

## Try it

```bash
npm start          # serves the site on http://localhost:8080
```

Or just open `index.html` in a browser — no build step, no dependencies.

## What it handles

Every line is parsed independently, so one file can mix all of these:

| Input | Result |
| --- | --- |
| `john@gmail.com:secret123` | `john@gmail.com:secret123` |
| `john@gmail.com : secret123` | `john@gmail.com:secret123` |
| `secret123:john@gmail.com` | `john@gmail.com:secret123` |
| `john@gmail.com \| secret123` | `john@gmail.com:secret123` |
| `john@gmail.com,secret123` | `john@gmail.com:secret123` |
| `john@gmail.com;secret123` / `=secret123` / `<TAB>secret123` | `john@gmail.com:secret123` |
| `"john@gmail.com","p,ass:word"` | `john@gmail.com:p,ass:word` |
| `https://john@gmail.com:secret123@accounts.example.com/login` | `john@gmail.com:secret123` |
| `BOB.Jones@Yahoo.com` | `bob.jones@yahoo.com` (email lower-cased, password case kept) |
| `carol@gnail.com:pw` *(auto-fix on)* | `carol@gmail.com:pw` |
| `# comment` / blank line / `email,password` header | skipped |

Passwords may contain the separator — `john@gmail.com:pass:with:colons` keeps
`pass:with:colons`, because the first delimiter after the email is the split.

### Options

- **Auto-fix domain typos** — `gnail.com`/`gmial.com`/`yaho.com`/… → correct
  domain, stray dot before `@` removed, doubled TLD (`gmail.com.com`) collapsed.
  Deliberately narrow: it never rewrites a real domain such as `sub.example.co.uk`,
  and a correctly-spelled domain keeps its original casing.
- **Strict email check** — reject anything that is not a fully valid address
  (default is lenient, so unusual but real addresses survive).
- **Keep email-only rows** — keep lines that have an email but no password.
- **Parse header rows** — treat `email,password` as data instead of a header.
- **Require digit in password** — drop rows whose password contains no `0-9`.
- **Keep only these domains / Skip these domains** — comma-separated,
  case-insensitive; TLD suffixes work (`co.uk` matches `mail.example.co.uk`).
  Skip wins over keep when a domain hits both lists.
- **Min / Max pass length** — drop passwords that are too short or too long.
- **Email case / Password case** — lowercase, as pasted, or UPPERCASE.
  De-duplication always compares case-insensitively, so `A@x.com:Pass` and
  `a@x.com:pass` still collapse.
- **De-duplicate by** — email (keeps the first occurrence), email+password, or off.
- **Sort** — original order, email A→Z / Z→A, password A→Z, domain A→Z (then
  email), or a **seeded shuffle** — deterministic per seed, so the list does
  not re-jitter on every keystroke and the same seed reproduces the same order.
- **Output format** — `email:pass`, `;`, `|`, `=`, TAB, CSV (properly quoted),
  JSON Lines, emails only, usernames only (local part, no domain), passwords only.
- **Split → .zip** — split the finished output by *lines per file*, into *N
  even files*, or into *one file per domain*, and download it as a single
  `.zip`. The archive is built in-tab by a small dependency-free ZIP writer
  (`src/zip.js`) that produces standard stored-ZIP output any unzip tool opens.

The interface has a dark/light theme toggle (it follows your OS preference on
first load and remembers your choice), drag-and-drop file loading, live stats
(lines, clean, rejected, duplicates, filtered, unique emails/passwords, top
domain), and a rejected-line panel that tells you *why* each line was skipped.

Anything that did not make it into the clean list — unparseable **or filtered
out by a rule** — is listed in the **Rejected lines** panel with its line
number and the reason (`domain excluded`, `password shorter than 8`, …), so
nothing disappears silently.

## Why this one beats most combo cleaners

Most combo tools make you choose between convenience and privacy. This one
doesn't:

- **Your list never leaves the tab.** Online cleaners upload your credentials
  to a backend "for processing". This page makes zero network requests — the
  whole pipeline (parse → filter → dedupe → sort → split → zip) runs in your
  browser, so it even works from `file://`.
- **Big files stay fast.** The test suite ships a 100k-line benchmark with a
  time budget; most web tools start choking or queueing well before that.
- **Splitting is a first-class citizen.** Lines-per-file, N even files, or one
  file per domain, exported as a real `.zip` — no server-side file handling,
  no 10 MB upload cap, no waiting in a queue.
- **Filters explain themselves.** Every dropped line lands in the rejected
  panel with its reason, and filtered rows do not eat de-duplication slots
  (a duplicate kept from an excluded domain still survives).

## Deploying to Vercel

The site is fully static — no functions, no environment variables, no secrets.
`npm run build` copies the six files the site needs into `dist/`, and
`vercel.json` tells Vercel to run that build and serve `dist/` only, so dev
files (`tests/`, `package.json`, `vercel.json`) can never reach a public URL.

### One-time setup (no env vars, no tokens)

1. Make sure the repo is on GitHub.
2. Open <https://vercel.com/new>, sign in with GitHub, and import the repo.
3. Press **Deploy**.

That is the whole setup. Vercel reads `vercel.json`, which pins the build
command (`npm run build`) and the output directory (`dist`) — no framework
preset to pick, no dashboard config, no API token, no GitHub Actions workflow,
no environment variables.

After that it is fully hands-off:

- every push to `main` deploys to the production URL,
- every branch and pull request gets its own preview URL automatically.

### What gets deployed

`index.html`, `styles.css`, `app.js`, `src/core.js`, `src/zip.js`, and
`robots.txt` — run `npm run build` and inspect `dist/` to see exactly that
list.

`vercel.json` also carries the response headers: `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`
on every response, plus a 1-hour cache on the three static assets. There is no
`X-Frame-Options` / `frame-ancestors` on purpose: the page holds no session
and no server-side state, so clickjacking has no payoff, and framing it is
useful (embeds, previews, iframes). Add a rule in `vercel.json` if you
disagree.

`robots.txt` blocks crawlers by default, since the tool exists to handle
credentials — delete it if you want the page indexed.

**Note:** hosting on Vercel does not change the privacy story. The page still
makes zero network requests, so pasted data is never sent to Vercel or anywhere
else — the host only serves the five static files.

## Development

```bash
npm test           # 69 tests: parser, zip, UI, deploy artifact, stylesheet
```

- `src/core.js` — the parsing engine. No DOM, no dependencies, UMD-wrapped so
  the browser and the Node tests load the identical file.
- `src/zip.js` — the dependency-free ZIP writer behind the split→.zip export.
- `app.js` — UI wiring only.
- `vercel.json` — the entire Vercel deployment config (build command, output
  directory, response headers).
- `scripts/build.js` — dependency-free copy of the site into `dist/`.
- `tests/core.test.js` — parser behaviour, filters, case options, sorting,
  splitting, plus a 100k-line performance budget.
- `tests/zip.test.js` — walks the produced archives the way a real unzip tool
  would (EOCD → central directory → local headers) and verifies every name,
  CRC and byte.
- `tests/ui.test.js` — boots the real `index.html` in jsdom, runs the real
  `app.js`, and asserts on what the page actually renders — including the
  split→zip wiring.
- `tests/build.test.js` — runs the build and asserts `dist/` contains exactly
  the site and none of the dev files, and that `vercel.json` is well-formed
  and still ships the right headers.
- `tests/styles.test.js` — parses `styles.css` with `css-tree` and checks that
  every `var()` is defined, every colour token is overridden by the light theme,
  every class selector is actually rendered, and every keyframe name exists.
  There is no browser in CI, so this is the substitute for eyeballing the CSS.

## License

MIT
