# Docs Release Deployment Design

## Goal

Deploy a new version of the documentation website only after the lockstep
`@bloklabs/*` package family has been released.

Documentation-only changes must continue to receive docs unit-test coverage,
but they must not build or deploy GitHub Pages.

## Current Behavior

`.github/workflows/deploy-docs.yml` runs for every branch push. Its detection
job allows the Pages build when either:

- `docs/**` or `CHANGELOG.md` changed; or
- the tip commit looks like a package release commit.

As a result, merging an ordinary documentation change into `master` creates a
new Pages deployment even though no package version was released.

## Approved Design

Use two event classes in the existing workflow:

- Branch pushes limited by path filters to `docs/**` and `CHANGELOG.md`.
  These events run docs unit tests only.
- Published GitHub Release events. These events run docs unit tests, build the
  library and docs from the release tag, and deploy GitHub Pages.

The release script publishes the full lockstep package family before it creates
the GitHub Release. The published-release event is therefore the repository's
strongest existing signal that the main packages have been released.

Remove `workflow_dispatch`. A manual dispatch would allow a new Pages
deployment without a corresponding package release and would violate the
strict deployment invariant. GitHub can still re-run a workflow attached to an
existing published release when operational recovery is needed.

## Workflow and Data Flow

For a docs or changelog push:

1. GitHub starts the workflow because the changed path matches.
2. The docs unit-test job checks out the pushed commit and runs.
3. The build job is skipped because the event is not a release.
4. The deploy job is skipped because its required build did not run.

For a published package-family release:

1. `scripts/release.mjs` publishes the package family, creates and pushes its
   version tag, and publishes the matching GitHub Release.
2. GitHub starts the docs workflow for the `published` release event.
3. Docs unit tests run against the release event's tagged source.
4. The build job explicitly checks out `github.event.release.tag_name`.
5. The existing library build, docs build, artifact upload, and Pages
   deployment run unchanged.

## Failure Handling

- A docs test failure blocks the release-triggered build and deployment.
- A build failure blocks the deployment.
- A release script failure before the GitHub Release is published cannot start
  a docs deployment.
- Docs-only changes can fail their tests without affecting the currently
  deployed website.

## Verification

Add a static Vitest regression test that parses
`.github/workflows/deploy-docs.yml` and proves:

- docs/changelog pushes are the only push triggers;
- only published GitHub Releases are release triggers;
- manual dispatch is absent;
- the Pages build is restricted to release events;
- the release build checks out the published release tag; and
- deployment still depends on the gated build.

Run the focused regression test, the complete unit-test suite, YAML parsing,
and whitespace validation before completion.
