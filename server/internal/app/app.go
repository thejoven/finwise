package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"alphax/server/internal/config"
	"alphax/server/internal/infra/db"
)

// App is the assembled application: an HTTP router plus background workers,
// holding the resources they share. Build wires it; Run owns the serve loop and
// graceful shutdown; Close releases resources.
type App struct {
	cfg     *config.Config
	logger  *zap.Logger
	pool    *db.Pool
	router  *gin.Engine
	workers []worker
}

// Build opens the DB and wires every module into a ready-to-run App. On a wiring
// error it closes anything it already opened so the caller can just return.
func Build(ctx context.Context, cfg *config.Config, logger *zap.Logger) (*App, error) {
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("db open: %w", err)
	}
	logger.Info("db connected")

	router, workers, err := assemble(ctx, cfg, logger, pool)
	if err != nil {
		pool.Close()
		return nil, err
	}

	return &App{cfg: cfg, logger: logger, pool: pool, router: router, workers: workers}, nil
}

// Close releases resources held by the App. Safe to defer right after Build.
func (a *App) Close() {
	a.pool.Close()
}

// Run starts the background workers and the HTTP server, then blocks until a
// shutdown signal (SIGINT/SIGTERM), a canceled ctx, or a fatal listen error.
// On shutdown it drains the server (10s) and waits for every worker to stop.
func (a *App) Run(ctx context.Context) error {
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", a.cfg.Port),
		Handler:           a.router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	workerCtx, workerCancel := context.WithCancel(ctx)
	defer workerCancel()

	var wg sync.WaitGroup
	for _, w := range a.workers {
		w := w
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.run(workerCtx)
		}()
	}
	a.logger.Info("background workers started", zap.Int("count", len(a.workers)))

	serveErr := make(chan error, 1)
	go func() {
		a.logger.Info("http listen", zap.Int("port", a.cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	select {
	case <-ctx.Done():
		a.logger.Info("shutdown (context canceled)")
	case sig := <-sigCh:
		a.logger.Info("shutdown", zap.String("signal", sig.String()))
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("listen: %w", err)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}

	workerCancel()
	wg.Wait()
	return nil
}
