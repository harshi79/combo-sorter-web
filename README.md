# Combo Sorter

Paste bulk `email:pass` data in **any** variant format and get back one clean,
de-duplicated `email:pass` list. Built for cleaning up exports where every line
seems to use a different separator.

**Everything runs in your browser.** There is no backend, no analytics and no
upload — the page makes zero network requests, so it is safe to open straight
from `file://` with sensitive data in the box. Nothing is ever sent to
Cloudflare or anywhere else.

## Try it

```bash
npm start          # serves the folder on http://localhost:8080
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

Anything that could not be parsed is listed in the **Rejected lines** panel with
its line number and the reason, so nothing disappears silently.

## Deploying to Cloudflare Pages

The site is fully static — no Worker code, no bundling. `npm run build` copies
the six files Pages needs into `dist/`, and that directory is the only thing
uploaded, so dev files (`tests/`, `package.json`, `wrangler.toml`) can never
reach a public URL.

### Option A — push to deploy (recommended)

1. In Cloudflare, create a Pages project named `combo-sorter-web`.
2. Create an API token with **Cloudflare Pages — Edit** permission, and grab
   your account ID from the dashboard.
3. In the GitHub repo, add two secrets: `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.

The workflow lives at `deploy/cloudflare-pages.yml` — the automation account
used to build this repo isn't permitted to create files under
`.github/workflows/`, so copy it into place yourself:

```bash
mkdir -p .github/workflows
cp deploy/cloudflare-pages.yml .github/workflows/deploy.yml
git add .github/workflows/deploy.yml && git commit -m "Enable Pages deploy" && git push
```

After that, every push to `main` runs the tests, builds, and deploys.

If you'd rather not use Actions at all, Option B below needs no workflow.

### Option B — deploy from your machine

```bash
export CLOUDFLARE_API_TOKEN=...      # Pages: Edit
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy                       # build + wrangler pages deploy
```

### Local preview of the real Pages runtime

```bash
npm run pages:dev                    # build + wrangler pages dev dist
```

This runs Cloudflare's actual `workerd` runtime, so `_headers` is applied for
real — useful for confirming caching and security headers before you ship.

### What gets deployed

`index.html`, `styles.css`, `app.js`, `src/core.js`, plus `_headers` and
`robots.txt`. Run `npm run build` and inspect `dist/` to see exactly that list.

`_headers` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer`, a restrictive `Permissions-Policy`, and a 1-hour cache on the
static assets. `robots.txt` blocks crawlers by default, since the tool exists
to handle credentials — delete it if you want the page indexed.

**Note:** hosting on Cloudflare does not change the privacy story. The page
still makes zero network requests, so pasted data is never sent to Cloudflare
or anywhere else — the host only serves the four static files.

## Development

```bash
npm test           # 38 tests: parser, UI (jsdom drives the real page), build output
```

- `src/core.js` — the parsing engine. No DOM, no dependencies, UMD-wrapped so
  the browser and the Node tests load the identical file.
- `app.js` — UI wiring only.
- `scripts/build.js` — dependency-free copy of the site into `dist/`.
- `tests/core.test.js` — parser behaviour.
- `tests/ui.test.js` — boots the real `index.html` in jsdom, runs the real
  `app.js`, and asserts on what the page actually renders.
- `tests/build.test.js` — runs the build and asserts `dist/` contains exactly
  the site and none of the dev files.

## License

MIT
