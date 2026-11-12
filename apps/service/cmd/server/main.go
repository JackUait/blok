package main

import (
	"context"
	"errors"
	cloud "github.com/JackUait/blok/apps/service"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if e := run(); e != nil {
		slog.Error("service failed", "error", e)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg := cloud.ConfigFromEnv()
	s, e := cloud.New(ctx, cfg)
	if e != nil {
		return e
	}
	defer s.Close()
	server := &http.Server{Addr: cfg.Listen, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 32 << 10}
	done := make(chan error, 1)
	go func() { slog.Info("service listening", "address", cfg.Listen); done <- server.ListenAndServe() }()
	select {
	case e = <-done:
		if e != http.ErrServerClosed {
			return e
		}
		return nil
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	drainErr := s.Drain(shutdown)
	if drainErr != nil {
		slog.Error("collaboration drain failed", "error", drainErr)
	}
	return errors.Join(drainErr, server.Shutdown(shutdown))
}
