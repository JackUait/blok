# Publishing Guide

## How to Release

Blok uses a tag-triggered release workflow. Versioning is manual; pushing a tag triggers CI which publishes to npm and creates a GitHub release.

### Stable Release

```bash
# 1. Bump version in package.json
# 2. Commit and tag
git commit -am "chore(release): v1.2.3"
git tag v1.2.3
git push && git push --tags
```

### Beta Release

```bash
# 1. Bump version in package.json (e.g., 1.2.3-beta.1)
# 2. Commit and tag
git commit -am "chore(release): v1.2.3-beta.1"
git tag v1.2.3-beta.1
git push && git push --tags
```

Beta tags (`v*-beta.*`) publish to the npm `beta` dist-tag and create a prerelease GitHub release.

## Commit Message Conventions

The project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint. These conventions affect GitHub's auto-generated release notes.

**Format:** `<type>(<scope>): <subject>`

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `docs` | Documentation |
| `test` | Tests |
| `chore` | Maintenance |
| `refactor` | Code restructuring |
| `style` | Formatting |
| `build` / `ci` | Build/CI changes |

Breaking changes: add `BREAKING CHANGE:` in the commit body or use `!` after the type (e.g., `feat!: redesign API`).

## What Happens During a Release

When a version tag is pushed, GitHub Actions runs:

1. **Lint** -- ESLint + TypeScript checks
2. **Test** -- Unit tests (Vitest)
3. **Build** -- Production build
4. **E2E** -- End-to-end tests (Playwright)
5. **Publish** -- Publishes to npm with OIDC provenance
6. **GitHub Release** -- Creates a release with auto-generated notes

## Troubleshooting

### Release failed

Fix the issue, then re-trigger by deleting and re-pushing the tag:

```bash
git tag -d v1.2.3
git push --delete origin v1.2.3
# Fix the issue, then:
git tag v1.2.3
git push --tags
```

### Wrong version published

If you tagged the wrong commit or version, delete the tag (see above), correct the version in `package.json`, commit, and re-tag.

## Configuration

- **`.github/workflows/release.yml`** -- GitHub Actions release workflow
- **`package.json`** -- Version source of truth

## References

- [Conventional Commits](https://www.conventionalcommits.org/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
