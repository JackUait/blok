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

`claude-code.html`, `claude-math.html`, `claude-lists.html` — captured the same
way, from public `claude.ai/share/...` pages. **Style-stripped**: Chrome's
serializer writes a full computed `style="..."` onto every element, so these
carry every tag, attribute and class of the real payload with only `style`
removed. Capture the raw bytes again before writing a detector against them.

Capturing Claude needs a **headed** browser (`playwright-cli open --persistent
--headed`). Headless sits on the Cloudflare interstitial forever; headed clears
the JS challenge on its own, with no login and no interaction.

- **Claude's answers are already semantic HTML** — `<p>`, `<ul>`/`<ol>` with
  text directly in `<li>` (no `<p>` wrapper), `<h3>`/`<h4>`, `<blockquote>`,
  `<table><thead><th scope>`, `<pre><code>`, `<strong>`, inline `<code>`. That
  is why there is still no Claude branch: there is nothing to rewrite.
- **The LaTeX source does NOT survive the clipboard.** The live page has
  `<annotation encoding="application/x-tex">` on every formula; the payload has
  zero (`grep -c annotation claude-math.html` → 0). What arrives is presentation
  MathML plus the `aria-hidden` KaTeX layout — so a pasted formula doubles its
  own visible text. This is the one known gap.
- **Detect on `font-claude-response-body`**, which is on every `<p>` and `<li>`
  and so survives a partial selection. `standard-markdown` sits on the message
  wrapper and is lost when the selection starts mid-answer.
- **Code language rides on `<code class="language-python">`**, and again as a
  label div above the block; an unlabelled block has neither, plus
  `aria-label="Code"`. Blok does not read either today, so a pasted Claude code
  block keeps its text and loses its language.
- Chrome's serializer — not claude.ai — adds `<span> </span>` around inter-element
  spaces and `<br class="Apple-interchange-newline"`. Verified against the live DOM.
- **Unverified, absent from every sample:** links, `<hr>`, nested lists, `<em>`,
  `<del>`, images, task-list checkboxes, and loose (blank-line-separated) lists.
