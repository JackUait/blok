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
