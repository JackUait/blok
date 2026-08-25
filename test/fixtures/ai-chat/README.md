# AI chat clipboard fixtures

Real clipboard payloads copied out of AI chat web apps, used by
`test/unit/components/modules/paste/ai-chat-preprocessor.test.ts`.

Captured **2026-08-25**.

## Capture method

Not a DOM dump — these are the exact bytes a `paste` listener receives, so the
fixtures include whatever the app's own `copy` handler and the browser between
them decided to emit.

1. Open the public share page in headless Chromium (Playwright).
2. Select the message body with a `Range` over the app's message container
   (`.markdown` for ChatGPT, `message-content` for Gemini) and press `Meta+C`.
3. In a second tab, focus a `contenteditable` and press `Meta+V`; a `paste`
   listener records `event.clipboardData.getData(type)` for every entry in
   `types`.

The OS clipboard is not involved: headless Chromium keeps its own, and reading
it back through a real paste event is what makes these faithful.

## Files

| File | Source | Contains |
| --- | --- | --- |
| `chatgpt-code-tables.*` | [share/68fea49c](https://chatgpt.com/share/68fea49c-be90-8000-b7db-da3420e66d56) | code block (CodeMirror), table, `<hr>`, `<h3>`, inline `<code>` |
| `chatgpt-math.*` | [share/67c65c48](https://chatgpt.com/share/67c65c48-b8fc-800d-bd1c-244bf1bf7068) | inline + display KaTeX, 870 layout spans |
| `chatgpt-table.*` | [share/cecf8c8d](https://chatgpt.com/share/cecf8c8d-40ba-47da-b2b4-7bb60e996f3a) | table, empty citation spans |
| `gemini-response.*` | [share/060ac63490d7](https://gemini.google.com/share/060ac63490d7) | code block with language header + copy/download buttons, table, list |

`.html` is the `text/html` flavor, `.txt` the `text/plain` twin. The two ChatGPT
`.html` files and the Gemini one are **trimmed** to a representative excerpt —
markup is verbatim, whole elements were dropped to keep the files small (the
sanitizer takes ~5s on the untrimmed 69KB payload).

## Key facts (verified against these files)

- **Every construct is selection-copy.** No capture of the apps' **Copy button**
  exists here — that path is reported to emit different markup (ChatGPT a fresh
  markdown→HTML render; both apps raw markdown as `text/plain`). Nothing in the
  preprocessor should assume it.
- **ChatGPT stamps `data-start`/`data-end`** source offsets on every node. This
  survives a partial selection, unlike the `.markdown` wrapper class.
- **ChatGPT ships no MathML.** The only recoverable TeX is `data-math-source`
  on the wrapper; everything visible is `aria-hidden` KaTeX layout.
- **ChatGPT code blocks are a CodeMirror instance**: `<pre>` → ~12 divs →
  `<pre class="cm-content">`. **No language is present anywhere** in the payload.
- **`text/plain` is rendered text, not markdown**: a table arrives tab-separated
  and a code block arrives with no ``` fence.
- **Gemini prints the code language as text** in `.code-block-decoration`, next
  to `<gem-icon-button>` copy/download buttons that copy along with it.
- Gemini emits `<th>` in `<thead>` and no `data-language` on `<pre>` — both
  contrary to older third-party reports, which is why the preprocessor relies on
  neither.

## Claude

No `claude.ai` fixture: its share pages sit behind a Cloudflare bot check that
headless Chromium does not clear, so no payload could be captured. The
preprocessor therefore has no Claude branch — adding one needs a real capture
first.
