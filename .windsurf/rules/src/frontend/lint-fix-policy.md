---
trigger: always_on
description: Policy for handling ESLint issues by preferring autofix with yarn lint:fix
globs:
---

# Lint Fix Policy

When encountering ANY ESLint problem:

## Core Steps
1. **ALWAYS try autofix first**: Run `yarn lint:fix` (or the equivalent command for the subproject) to automatically resolve the issue.
   - For frontend: From the workspace root, run `cd packages/frontend && yarn lint:fix`
   - If targeting specific files: `cd packages/frontend && yarn eslint "path/to/file.tsx" --fix`

2. **ONLY manual fix if autofix fails**: If `yarn lint:fix` does not resolve the issue, manually edit the code to comply with ESLint rules.
   - Defer to the ESLint configuration as the source of truth: [eslint.config.js](mdc:eslint.config.js) for frontend.
   - Do not invent custom style rules; follow ESLint and integrated Prettier setups exactly.
   - After manual fixes, re-run `yarn lint` to verify resolution.

## Notes
- Prefer `yarn lint:fix` over ad-hoc formatting to ensure consistency.
- If ESLint interacts with Prettier, let ESLint enforce the rules.
- For uncertainty, consult ESLint configs before manual changes.
- Proactively use this during code edits, reviews, or generations to maintain high-quality code.
