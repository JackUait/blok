---
name: releasing-blok
description: Use when cutting a Blok release - running yarn release, publishing a stable or beta version, bumping the version, or writing GitHub release notes.
---

# Releasing Blok

```bash
yarn release 1.0.0                # stable release
yarn release 1.0.0-beta.1         # beta release (auto-detected from version)
```

See `scripts/release.mjs` for the full workflow. Publish happens **before** git push.

The script aborts on a dirty tree: it checks `git status --porcelain` before writing the version bump, so another session's uncommitted edit to a tracked file will stop the release.

## GitHub Release Notes

- **Never use `--generate-notes`** for GitHub releases - it dumps everything under "Other Changes"
- **Always write categorized release notes** with these sections:
  - **Features** - new functionality, with PR numbers
  - **Bug Fixes** - fixes, one line each
  - **Maintenance** - dependency upgrades, tooling, tests, chores
- Group related commits into single bullet points (e.g. multiple marker commits into one "Marker Inline Tool" feature)
- Reference PR numbers where available

## CHANGELOG entries

The docs site parses `CHANGELOG.md` and renders one entry as one block of text, so an entry has to carry its own structure. Every entry is a single markdown line — a continuation line is dropped by the parser.

1. **Bold title, em-dash, body.** The title is a noun phrase naming the thing, not a sentence.
2. **The first sentence after the dash says what a reader gets, in under 25 words.** It has to stand alone, because it is the part most people read.
3. **The body caps at about 70 words.** One idea per sentence. Keep the constraint, the gotcha and the opt-in flag; cut the history and the reasoning about why the old way was wrong.
4. **Keep every public name.** Config keys, methods, flags and routes stay in backticks, so a reader can find the API from the entry.
5. **Nothing that only matters to a contributor.** No file paths, no counts of alerts triaged, and no measurements unless they change a decision.
