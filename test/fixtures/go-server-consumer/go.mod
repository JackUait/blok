module example.test/blok-server-consumer

go 1.27.1

require github.com/JackUait/blok/packages/server/go v0.0.0

require (
	github.com/andybalholm/brotli v1.2.6 // indirect
	github.com/dlclark/regexp2/v2 v2.11.0 // indirect
	github.com/dop251/goja v0.0.0-20261030192516-032d024709ca // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	golang.org/x/net v0.62.0 // indirect
	golang.org/x/text v0.43.0 // indirect
)

// scripts/test-server-go-module.mjs points this at a copy of the tracked
// module files, which is what a consumer of the tag downloads.
replace github.com/JackUait/blok/packages/server/go => ../../../packages/server/go
