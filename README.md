# Combo Sorter

Paste bulk `email:pass` data in **any** variant format and get back one clean,
de-duplicated `email:pass` list. Built for cleaning up exports where every line
seems to use a different separator.

**Everything runs in your browser.** There is no backend, no analytics and no
upload — the page makes zero network requests, so it is safe to open straight
from `file://` with sensitive data in the box.

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

## Development

```bash
npm test           # 32 tests: parser (node --test) + UI (jsdom drives the real page)
```

- `src/core.js` — the parsing engine. No DOM, no dependencies, UMD-wrapped so
  the browser and the Node tests load the identical file.
- `app.js` — UI wiring only.
- `tests/core.test.js` — parser behaviour.
- `tests/ui.test.js` — boots the real `index.html` in jsdom, runs the real
  `app.js`, and asserts on what the page actually renders.

## License

MIT
