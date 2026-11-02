# Progress: delivery-ci lane (Go server)

Branch `go/delivery-ci`, worktree `/Users/jackuait/Packages/.blok-go/delivery-ci`, based on origin/main e06c7122. Round 1, 2026-11-02 (the run before it was cut off and left the CI move uncommitted; it is committed now as e78f05c9).

## Commits (oldest first)

| Commit | What |
|--------|------|
| 163f50c1 | go.mod toolchain go1.27.3, x/net v0.62.0 (govulncheck v1.9.0 found 11 reachable vulns before) |
| 343d1846 | `check-server-coverage.mjs --go`: 80% statement floor |
| 036f769a | `scripts/publish-server-go.mjs`: six `blok-server-go_<os>_<arch>` archives + `checksums-go.txt`, cgo off, `-X main.version` |
| 0129eb77 | `yarn release` tags `packages/server/go/vX.Y.Z`; refuses a major the module path does not carry |
| 9c1454bd | release-server.yml: Go test/vet, archives, native + Alpine smoke, upload, proxy check; `server-go-delivery-law.test.ts` |
| 17f41750 | `test/fixtures/go-server-consumer` + `scripts/test-server-go-module.mjs` (tracked files only, runtime SHA, release host build) |
| e78f05c9 | Go gates move to Server Security; govulncheck, coverage floor, module test in CI; Dependabot gomod |
| 6fadcc2a | CodeQL Go in the weekly `codeql.yml`, not ci.yml |
| 00b0a0d1 | runner runs `page-transfer-sidecar.server.test.ts` (R14); its stale string expectations fixed to segments |
| 6bf05128 | README, protocol §11.1, release-manifest comment |

## CI decisions (measured)

- t=0 on a main push: 17 ci.yml jobs + Link Check + Mutation = 19 (run 41164765119 and its siblings, `created_at` of every job). The cap is 20, and workflow_run jobs (Deploy Docs, mirror) from the previous run overlap. So no new job.
- Job times on main (41164765119 / 41164648927): Server 6m01s / 6m24s, Server Delivery 4m11s / 4m05s, Server Security 2m02s / 2m08s, CodeQL csharp 2m50s / 3m38s, CodeQL js 7m37s / 7m45s (already over 7 min, not this lane).
- Go steps moved from Server Delivery to Server Security. Step times: Go conformance 1m14s on CI; locally gofmt+vet 2s, govulncheck 6s, `go test -count=1` 24s, module test 4s. Projected Server Security about 4 to 5 min, Server Delivery about 2m45s plus the sidecar suite (11s locally). **UNVERIFIED on a runner**: the first main run after landing must confirm both jobs stay under 7 min (cold Go cache made vet 28s in the http-host lane).
- CodeQL Go: `init`'s build-mode works for one language per job (codeql-action init/action.yml at 9b325408, lines 32-35), so Go cannot share the C# leg; a third ci.yml leg is the 20th t=0 slot. Go runs in the weekly scan with `go build ./...`. **UNVERIFIED** until the weekly workflow is dispatched once.
- Go coverage is 80.52% against the 80% floor. Little headroom.

## Ledger rows

DONE (oracle):
- R1-R3, R5, R7-R13: http-host lane; conformance suites through `--target go`; `test-server-conformance.test.ts`.
- R4: runner refuses `--configuration` for go (http-host); `test-server-conformance.test.ts`.
- R6: shared guard, target-independent.
- R14: 00b0a0d1; `server-release-wiring.test.ts` "runs every conformance suite"; C# passes 6/6. Go skips it (no collab), via the explicit `--suite` list.
- H1: `-X main.version`; publish-server-go.test.ts + module test checks stamped `/health`; local build says `dev`.
- H2-H9: http-host lane conformance (host-cli-contract, server-contract, http-host-contract). H6 warning text: host-cli-contract.test.ts:180.
- N1-N6: unchanged; `server-go-delivery-law.test.ts` pins the wrapper never resolves or names a Go archive.
- N7: kept on purpose. npm still ships C#, and package-metadata-law forbids "Go" in the description.
- P1-P5: publish-server-go.test.ts. P6/P9: module ships as the tag; module test checks the tracked bundle SHA; release verify asks proxy.golang.org. P7/P8: test-server-go-module.mjs. P10, P13 (archive on Alpine), P16: server-go-delivery-law.test.ts. P15, P17: release-cli.test.ts.
- G1-G6, G10 (gomod), G11: ci-critical-path-law + server-quality-gates. G8: weekly CodeQL law. G9: `internal/outbound/law_test.go` (http-host, go/parser with alias resolution and planted violations). G12: no new job, nothing to add.
- D1 (server-go-parity-law on main), D2, D6, D7, D8, D9, D11, D17 (no removal-law entry left).

DEFERRED (reason):
- P11, P12, P14, H10, G7, D3, Dependabot docker for Go: a Go Docker image. U1 lists module + archives only and keeps the Docker image unchanged.
- R15: agent-evals and the MCP participant spec need collab and the MCP participant, which Go lacks. Collab/agent lanes.
- D10: docs site Go path. No Go tag or archive is published yet, and Go has no collab. A path card would send readers to nothing. Add it at the first release that ships the Go tag.
- D12: Go twin of `docs/maintainers/page-csharp-host.md`: needs the collab/page host in Go.
- D13-D16: memory files live outside the worktree; the main session updates them on landing.
- G4 staticcheck: a new dependency, a user call. `go vet` is the gate.
- G5 Trivy fs reading go.mod: UNVERIFIED for trivy-action 0.36.0; govulncheck is the Go gate.

## Release notes owed (no CHANGELOG edits; the user decides at release)

- d30e8163, 9d4b7385, 343e6eb7 (BREAKING, from earlier lanes).
- This lane adds no BREAKING change: the npm wrapper, C# archive names, `checksums.txt` and the Docker image are unchanged. New in the next release: the Go module tag and the Go archives.
