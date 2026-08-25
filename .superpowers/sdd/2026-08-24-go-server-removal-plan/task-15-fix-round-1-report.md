# Task 15 Fix Round 1 Report

## Status

All three review findings were verified against commit `8ed7e461` and fixed with narrow release-wiring changes. No external publication or push was performed.

## Fixes

- Added `.env`, `.env.*`, and `.npmrc` to the root `.dockerignore`, keeping repository and npm credentials out of the root Docker context and intermediate build layers.
- Added `.server-release-smoke` to `.dockerignore`, keeping the extracted native smoke binary out of the image context.
- Changed the workflow's pre-publication GHCR probe to run `docker manifest inspect` with a fresh empty `DOCKER_CONFIG`, so the draft is published only after the versioned image is anonymously observable.

## TDD evidence

The architecture assertions were added first. The focused test then failed in exactly two places: the delivery probe still used the authenticated Docker configuration, and the required Docker exclusions were absent. After the minimal workflow and ignore-file edits, the focused test passed with 11/11 tests.

## Verification

- `yarn vitest run --project=unit test/unit/architecture/server-release-wiring.test.ts`: 11/11 passed.
- Changed TypeScript lint: passed.
- `git diff --check`: passed.

## Concerns

None.
