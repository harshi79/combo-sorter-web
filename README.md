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
  Deliberately narrow: it never rewrites a real domain such as `sub.example.co.uk`.
- **Strict email check** — reject anything that is not a fully valid address
  (default is lenient, so unusual but real addresses survive).
- **Keep email-only rows** — keep lines that have an email but no password.
- **Parse header rows** — treat `email,password` as data instead of a header.
- **De-duplicate by** — email (keeps the first occurrence), email+password, or off.
- **Sort** — original order, email A→Z / Z→A, or password A→Z.
- **Output format** — `email:pass`, `;`, `|`, `=`, TAB, CSV (properly quoted),
  JSON Lines, emails only, passwords only.

The interface has a dark/light theme toggle (it follows your OS preference on
first load and remembers your choice), drag-and-drop file loading, and a
rejected-line panel that tells you *why* each line was skipped.

Anything that could not be parsed is listed in the **Rejected lines** panel with
its line number and the reason, so nothing disappears silently.

## Deploying to Vercel

The site is fully static — no functions, no environment variables, no secrets.
`npm run build` copies the five files the site needs into `dist/`, and
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

`index.html`, `styles.css`, `app.js`, `src/core.js`, and `robots.txt` — run
`npm run build` and inspect `dist/` to see exactly that list.

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
npm test           # 49 tests: parser, UI, deploy artifact, stylesheet
```

- `src/core.js` — the parsing engine. No DOM, no dependencies, UMD-wrapped so
  the browser and the Node tests load the identical file.
- `app.js` — UI wiring only.
- `vercel.json` — the entire Vercel deployment config (build command, output
  directory, response headers).
- `scripts/build.js` — dependency-free copy of the site into `dist/`.
- `tests/core.test.js` — parser behaviour.
- `tests/ui.test.js` — boots the real `index.html` in jsdom, runs the real
  `app.js`, and asserts on what the page actually renders.
- `tests/build.test.js` — runs the build and asserts `dist/` contains exactly
  the site and none of the dev files, and that `vercel.json` is well-formed
  and still ships the right headers.
- `tests/styles.test.js` — parses `styles.css` with `css-tree` and checks that
  every `var()` is defined, every colour token is overridden by the light theme,
  every class selector is actually rendered, and every keyframe name exists.
  There is no browser in CI, so this is the substitute for eyeballing the CSS.

## License

MIT
