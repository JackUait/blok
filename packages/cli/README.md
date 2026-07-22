# @bloklabs/cli

Command-line tools for [Blok](https://blokeditor.com) — the headless, Notion-like block editor whose content is JSON blocks, not HTML. Converts legacy HTML into Blok JSON and prints the Editor.js migration guide.

## Install

```bash
npx @bloklabs/cli --help
```

Or install it locally:

```bash
npm install --save-dev @bloklabs/cli
```

## Usage

```
Usage: blok-cli [options]

Options:
  --convert-html       Convert legacy HTML from stdin to Blok JSON (stdout)
  --convert-gdocs      Convert Google Docs HTML from stdin to Blok JSON (stdout)
  --migration          Output the EditorJS to Blok migration guide (LLM-friendly)
  --output <file>      Write output to a file instead of stdout
  --help               Show this help message
```

### Convert existing HTML to Blok JSON

```bash
npx @bloklabs/cli --convert-html < article.html --output article.json
```

The result is an `OutputData` document you can hand straight to `new Blok({ data })`.

### Convert a Google Docs export

```bash
npx @bloklabs/cli --convert-gdocs < gdocs-export.html --output doc.json
```

### Migrating from Editor.js

```bash
npx @bloklabs/cli --migration --output migration-guide.md
```

The guide is written to be pasted into an LLM alongside your codebase.

## Docs

- [Migration guide](https://blokeditor.com/migration)
- [Output data reference](https://blokeditor.com/docs/output-data)

Licensed under Apache-2.0.
