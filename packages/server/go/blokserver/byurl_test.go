package blokserver

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/outbound"
)

// blockingStore holds Put until release closes.
type blockingStore struct {
	entered chan struct{}
	release chan struct{}
}

func (b *blockingStore) Put(ctx context.Context, extension, _ string, content io.Reader) (string, error) {
	_, _ = io.Copy(io.Discard, content)
	close(b.entered)
	<-b.release
	return "https://uploads.example.com/files/" + strings.Repeat("a", 32) + extension, nil
}

func (b *blockingStore) Delete(context.Context, string) error { return nil }

// UploadByUrlEndpoint.cs:90 holds the response (and its fetch slot) with
// `await using` until PutAsync returns, so a slow store still counts
// against the four outbound fetches.
func TestUploadByURLHoldsItsFetchSlotUntilTheStoreReturns(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("png"))
	}))
	defer origin.Close()
	port, _ := strconv.Atoi(strings.TrimPrefix(origin.URL, "http://127.0.0.1:"))
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	o.UnfurlEnabled = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	s.fetcher = outbound.NewFetcher(outbound.ExactOriginPolicy{Origin: origin.URL, Port: port})
	store := &blockingStore{entered: make(chan struct{}), release: make(chan struct{})}
	s.storeOnce.Do(func() { s.store = store })
	done := make(chan int, 1)
	go func() {
		body := `{"url":"` + origin.URL + `/photo.png"}`
		request := httptest.NewRequest(http.MethodPost, "/upload-by-url", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		s.Handler("").ServeHTTP(recorder, request)
		done <- recorder.Code
	}()
	select {
	case <-store.entered:
	case code := <-done:
		t.Fatalf("upload-by-url answered %d before reaching the store", code)
	case <-time.After(5 * time.Second):
		t.Fatal("upload-by-url never reached the store")
	}

	limits := outbound.Limits{Timeout: 200 * time.Millisecond, MaxBytes: 1 << 20, MaxRedirects: 0}
	var held []*outbound.Response
	for i := 0; i < 3; i++ {
		response, err := s.fetcher.Get(context.Background(), origin.URL+"/", limits)
		if err != nil {
			t.Fatalf("fetch %d of the three free slots: %v", i+1, err)
		}
		held = append(held, response)
	}
	if _, err := s.fetcher.Get(context.Background(), origin.URL+"/", limits); !outbound.IsFailure(err, outbound.TimedOut) {
		t.Fatalf("a fourth fetch during Put got %v, want TimedOut", err)
	}
	close(store.release)
	if code := <-done; code != http.StatusOK {
		t.Fatalf("upload-by-url answered %d", code)
	}
	for _, response := range held {
		response.Release()
	}
}
