package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

type stubFetcher struct {
	resp *fetchguard.Response
	err  error
}

func (s stubFetcher) Get(context.Context, string) (*fetchguard.Response, error) {
	return s.resp, s.err
}

// The response shape is fixed by src/tools/link/metadata-fetcher.ts. Note that
// `image` is an OBJECT, not a string — changing it breaks every consumer.
func TestUnfurlReturnsTheShapeTheClientParses(t *testing.T) {
	// StatusCode is not optional in a stub: the handler refuses a non-2xx, and
	// the zero value is not a success. See
	// TestUnfurlReportsANonSuccessStatusAsSuccessZero for why it may not be.
	h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{resp: &fetchguard.Response{
		Body:       []byte(`<html><head><meta property="og:title" content="T"><meta name="description" content="D"><meta property="og:image" content="https://example.com/i.png"></head></html>`),
		FinalURL:   "https://example.com/a",
		StatusCode: http.StatusOK,
	}}})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl?url=https%3A%2F%2Fexample.com%2Fa", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var body struct {
		Success int    `json:"success"`
		Link    string `json:"link"`
		Meta    struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			Image       struct {
				URL string `json:"url"`
			} `json:"image"`
			Domain string `json:"domain"`
		} `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Success != 1 || body.Link != "https://example.com/a" {
		t.Fatalf("body = %+v", body)
	}
	if body.Meta.Title != "T" || body.Meta.Description != "D" {
		t.Fatalf("meta = %+v", body.Meta)
	}
	if body.Meta.Image.URL != "https://example.com/i.png" {
		t.Fatalf("image = %q", body.Meta.Image.URL)
	}
	if body.Meta.Domain != "example.com" {
		t.Fatalf("domain = %q", body.Meta.Domain)
	}
}

// A blocked or unreachable target is NOT a server error: the service is healthy,
// the target simply yielded nothing. 200 + success:0 lets the client tell this
// apart from "the service is down" and degrade to a plain link.
func TestUnfurlReportsFailureAsSuccessZero(t *testing.T) {
	h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{err: fetchguard.ErrBlockedAddress}})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl?url=http%3A%2F%2F10.0.0.1%2F", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body struct {
		Success int `json:"success"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body.Success != 0 {
		t.Fatalf("success = %d, want 0", body.Success)
	}
}

func TestUnfurlRejectsAMissingURLParameter(t *testing.T) {
	h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{err: errors.New("must not be called")}})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl", nil))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// A 404 or a 502 reaches the handler as a perfectly successful *Response
// carrying the error page's bytes. Parsing those bytes yields a link card
// titled "Page not found" out of the error page's own <title> and og: tags,
// presented as if the target had been read. A non-2xx is a failed unfurl.
func TestUnfurlReportsANonSuccessStatusAsSuccessZero(t *testing.T) {
	for _, status := range []int{
		http.StatusMovedPermanently, // a redirect the guard did not follow
		http.StatusUnauthorized,
		http.StatusNotFound,
		http.StatusTooManyRequests,
		http.StatusBadGateway,
	} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{resp: &fetchguard.Response{
				Body:       []byte(`<html><head><title>Page not found — 404</title><meta property="og:title" content="404"></head></html>`),
				FinalURL:   "https://example.com/missing",
				StatusCode: status,
			}}})

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl?url=https%3A%2F%2Fexample.com%2Fmissing", nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}

			var body struct {
				Success int         `json:"success"`
				Meta    *unfurlPeek `json:"meta"`
			}
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body.Success != 0 {
				t.Fatalf("success = %d, want 0 for upstream status %d", body.Success, status)
			}
			if body.Meta != nil {
				t.Fatalf("meta = %+v, want none: the error page's own metadata must not be served as the target's", *body.Meta)
			}
		})
	}
}

type unfurlPeek struct {
	Title string `json:"title"`
}

// Every 2xx is a page worth parsing, not only 200 — a 203 or a 206 still
// carries markup.
func TestUnfurlAcceptsEveryTwoHundredStatus(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusNonAuthoritativeInfo, http.StatusIMUsed} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{resp: &fetchguard.Response{
				Body:       []byte(`<html><head><title>T</title></head></html>`),
				FinalURL:   "https://example.com/a",
				StatusCode: status,
			}}})

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl?url=https%3A%2F%2Fexample.com%2Fa", nil))

			var body struct {
				Success int `json:"success"`
			}
			_ = json.NewDecoder(rec.Body).Decode(&body)
			if body.Success != 1 {
				t.Fatalf("success = %d, want 1 for upstream status %d", body.Success, status)
			}
		})
	}
}
