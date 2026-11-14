package main

import (
	"context"
	"log/slog"
	"os"

	cloud "github.com/JackUait/blok/apps/service"
)

func main() {
	cfg := cloud.ConfigFromEnv()
	if e := cloud.Blokctl(context.Background(), cfg, os.Args[1:], os.Stdout, os.Stderr); e != nil {
		slog.Error("blokctl failed", "error", e)
		os.Exit(1)
	}
}
