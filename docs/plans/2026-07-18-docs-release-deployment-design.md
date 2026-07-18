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
  library and docs from the release tag, and become candidates to deploy
  GitHub Pages.

The release event is not sufficient proof by itself because GitHub also allows
a maintainer or API client to publish a Release for an arbitrary tag. Before
the docs build can run, a verification job must prove all of the following:

- the release tag is a canonical `v<semver>` package tag;
- the root, React, Vue, Angular, and CLI manifests all contain that exact
  version; and
- that exact version of all five `@bloklabs/*` packages is available from npm.

Registry checks retry briefly so normal npm propagation delay does not reject a
valid release. A published GitHub Release plus these checks is the deployment
authorization boundary.

Remove `workflow_dispatch`. A manual dispatch would allow a new Pages
deployment without a corresponding package release and would violate the
strict deployment invariant. GitHub can still re-run a workflow attached to an
existing published release when operational recovery is needed.

The live `github-pages` environment must allow `v*` tags. GitHub evaluates
environment deployment policies against the workflow's tag ref; its previous
`master`-only policy rejects every release-triggered deployment before the
deploy job starts. The workflow's package verification remains the stricter
application-level gate.

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
4. A verification job checks out `github.event.release.tag_name`, validates
   every lockstep manifest, and confirms all five package versions on npm.
5. The build job depends on both docs tests and package verification, then
   explicitly checks out `github.event.release.tag_name`.
6. The existing library build, docs build, artifact upload, and Pages
   deployment run unchanged.

## Failure Handling

- A docs test failure blocks the release-triggered build and deployment.
- A malformed tag, manifest mismatch, or missing npm package blocks the build
  and deployment.
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
- the release-verification job runs only for releases and invokes the package
  verifier;
- the build depends on successful docs tests and package verification;
- the Pages build is restricted to release events;
- the release build checks out the published release tag; and
- deployment still depends on the gated build.

Unit-test canonical tags, lockstep manifest validation, the complete package
list, npm propagation retries, and missing-package rejection. Run the focused
regression tests, the real verifier against the current published version,
`actionlint`, the docs tests, the complete unit-test suite, YAML parsing, and
whitespace validation before completion. Finally, inspect the live
`github-pages` environment and prove its `v*` tag policy exists.
