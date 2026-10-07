# Agent control of Blok — shared brief

Date: 2026-10-08. Every spec in this folder builds on this brief. If a spec needs to deviate from it, the spec says so in its "Open questions for other specs" section. It never deviates silently.

## Goal

Give agents full control and understanding of the editor, so they can operate it the way humans do.

The problem today: agents don't know how to create blocks or use Blok's features. They write Markdown into block data, and that breaks content. Blok already has Markdown import in the browser API (`blocks.importMarkdown`, `useBlocks.insertMarkdown`), in `@bloklabs/core/markdown` and in the C# server (`IBlokDocumentConverter`). Agents just don't find it, and the wrong path fails silently. The fix is not "more Markdown". It is a real agent interface.

## Decisions already made by the user

1. **Two kinds of agents, both supported.**
   - **In-app**: an assistant built into the host app. It operates the document the user has open, in the browser, live.
   - **Outside**: Claude Code, Claude Desktop and similar agents, connecting over a tool protocol (MCP).
2. **Outside agents reach both:**
   - **live collab rooms**, where the agent joins as a participant that people can see;
   - **stored documents**, where there is no room: load the saved JSON, edit it headless, save.
3. **Agents act through meaning-level commands, not simulated input.** "Insert a toggle with these children after block X", "bold characters 4–12 of block Y", "move Z into column 2". There are no clicks, keystrokes or pixels. "Like humans do" means **every capability a human can reach is reachable**, not that gestures are copied.

## Decomposition (one spec each, written in parallel)

| # | Sub-project | Owns |
|---|---|---|
| 01 | Core command layer + document view | The command set and its typed envelope (name, args, result, errors), the agent-readable document view (a tree with block ids, rich text, selection), the execution semantics (validation, atomic batches, undo grouping, origin/attribution, collab safety), and where it runs (browser editor + the server's embedded JS runtime). |
| 02 | Tool self-description | How a tool declares its data schema and its named actions (e.g. `table.addRow`, `table.mergeCells`, `image.crop`, `database.addView`), and the capability manifest that core builds from the live tool registry, including host custom tools and existing statics (`childTools`, `acceptsChildren`, `richTextFields`, `conversionConfig`, `toolbox`…). Tool actions RUN through 01's command layer. |
| 03 | In-app surface | `blok.agent` (or the final name) on the editor instance, plus framework adapter parity (React/Vue/Angular). Ready-made LLM tool definitions generated from 01+02. Live visibility of agent edits to the user, undo, and attribution. |
| 04 | Outside surface | The MCP server. In live rooms: the agent as a named participant (existing activity/identity frames 106/107), with edits going through the room's sync. For stored documents: load, edit and save through the server's embedded Blok runtime (Jint, C#) or a Node runtime. Plus auth, deployment and packaging. |
| 05 | Coverage + evals | A coverage law that every human-reachable feature has a command (mechanically enforced, like the repo's existing `test/unit/architecture/*-law.test.ts` files), and an eval suite of real agent tasks with pass criteria. |

## Seams (who provides what to whom)

- **01 → 02, 03, 04, 05**: the command envelope, the document view format, the error model and the execution entry point. 01 must be runtime-agnostic: no DOM required, so 04 can run it on the server.
- **02 → 01**: tool actions are commands. 01 defines how a tool-scoped command is dispatched; 02 defines how a tool declares one.
- **02 → 03, 04**: the manifest that is rendered into LLM tool definitions or MCP tools, plus agent-facing guidance text.
- **03, 04**: both render the same 01+02 contract. Neither may invent a command or a data shape of its own.
- **05**: consumes all of them. It defines what "full control" means as a measurable test.

## Repo laws every spec must respect

Read `/Users/jackuait/Packages/blok/CLAUDE.md` in full before writing. The ones most likely to matter here:

- **Everything is a block.** Do not build a data model that shadows the block tree.
- **Container contracts are declared** (`childTools`, `acceptsChildren`, `data-blok-keyboard-owner`). Reuse them; do not re-implement them.
- The **paste attribute law** and the **sanitizer** rules: commands that carry rich text or HTML must go through the same sanitization host data goes through (see `hostDataForTool` in `src/components/modules/api/blocks.ts`).
- **Rich text is saved ONLY as segments** `{text, marks?} | {embed, marks?}` (types/rich-text.d.ts). Collab stores rich text as formatted `Y.XmlText`.
- **The published-types law**: `types/*.d.ts` is hand-authored and never imports from `src/`. Mirrors of `src/` values are generated and drift-tested.
- **The breaking-change rules**: say what breaks, who it breaks for, and how to migrate.
- **The undo/redo and collab laws** in memory (gesture grouping, live inserts need `yjsSync:'add'`, the echo window, the move-group replay anchor).

## Rules for spec writers

- **Never guess.** Every claim about existing code cites `path:line`, backed by reading the file. Label anything unverified as such.
- Read-only exploration. Write ONLY your own spec file. No commits, no test runs, no edits elsewhere.
- Follow existing patterns. Name the existing code you build on.
- YAGNI: scope to what the goal needs.
- Use short, simple language. One idea per sentence.

## Required spec sections

1. Purpose and success criteria
2. What exists today (with citations)
3. Design: architecture, components, data flow, error handling
4. Public surface (types, names), and whether anything is breaking
5. **Interfaces I provide** (exact shapes) and **interfaces I consume** (from which spec, with what assumption)
6. Testing strategy (TDD; which law tests, unit, e2e)
7. **Open questions for other specs**: numbered, each addressed to a spec number
8. Out of scope
