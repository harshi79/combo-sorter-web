# Combo Sorter

Paste a text file or a block of messy lines and get back one clean,
de-duplicated `email:pass` list. The everyday interface intentionally keeps
only the simple `email:pass` and `email;pass` formats.

**Everything runs in your browser.** There is no backend, no analytics and no
upload — the page makes zero network requests, so it is safe to open straight
from `file://` with sensitive data in the box. Nothing is ever sent to Vercel
or anywhere else.

## Try it

```bash
npm start          # serves the site on http://localhost:8080
```

Or open `index.html` directly. There is no build step and no backend.

## Simple cleanup rules

The visible interface is deliberately small: load or paste, clean, copy, and
download. You do not need to choose a separator or configure a parser.

Each line is handled on its own:

- `email:pass` is kept.
- `email;pass` is kept.
- Spaces around the separator are okay.
- A copied Markdown mail link such as
  `[you@example.com](mailto:you@example.com):secret123` is cleaned to
  `you@example.com:secret123`.
- Once the password token ends, all trailing notes or garbage are removed.
- A line without an email plus `:` or `;` plus a password is ignored.
- Blank lines are ignored, and repeated email addresses are kept only once.

For example:

```text
[arenai@gmail.com](mailto:arenai@gmail.com):arena123 dtae 12348ufdj, random notes
yes sure, this is not a credential line
cosmo@gmail.com: halo jsdjiejdcjedc
```

becomes:

```text
arenai@gmail.com:arena123
cosmo@gmail.com:halo
```

Everything runs locally in the browser. Your pasted data never leaves the tab.

## Why this one is simple and private

- **No customization maze.** The page has one clear path: load or paste,
  clean, copy, or download.
- **Garbage is safe to paste.** Each line is isolated. Only the first valid
  credential token is returned; prose on the same line does not carry over.
- **Duplicates are removed.** The first occurrence of an email wins.
- **Nothing is uploaded.** Parsing, deduplication, and exporting happen in
  this tab. The page makes no network requests and also works from `file://`.
- **Large files stay local.** The parser processes the text in the browser,
  with no server upload limit or queue.

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
