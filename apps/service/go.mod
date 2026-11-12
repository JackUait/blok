module github.com/JackUait/blok/apps/service

go 1.27.1

toolchain go1.27.4

require (
	github.com/JackUait/blok/packages/server/go/v2 v2.0.0
	github.com/jackc/pgx/v5 v5.7.6
	golang.org/x/net v0.62.0
)

require (
	github.com/andybalholm/brotli v1.2.7 // indirect
	github.com/dlclark/regexp2/v2 v2.11.0 // indirect
	github.com/dop251/goja v0.0.0-20261030192516-032d024709ca // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/crypto v0.58.0 // indirect
	golang.org/x/sync v0.24.0 // indirect
	golang.org/x/text v0.43.0 // indirect
)

replace github.com/JackUait/blok/packages/server/go/v2 => ../../packages/server/go
