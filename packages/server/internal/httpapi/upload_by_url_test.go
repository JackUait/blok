package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/fetchguard"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

// recordingFetcher answers with one canned response and remembers it was asked,
// so a test can tell WHICH of the two configured clients a handler reached for.
type recordingFetcher struct {
	resp  *fetchguard.Response
	err   error
	calls int
}

func (f *recordingFetcher) Get(context.Context, string) (*fetchguard.Response, error) {
	f.calls++

	return f.resp, f.err
}

func byURLRequest(target string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/upload-by-url", strings.NewReader(`{"url":"`+target+`"}`))
	req.Header.Set("Content-Type", "application/json")

	return req
}

func mediaResponse(finalURL, contentType string) *fetchguard.Response {
	return &fetchguard.Response{
		Body:        []byte("imagebytes"),
		ContentType: contentType,
		FinalURL:    finalURL,
		StatusCode:  http.StatusOK,
	}
}

func TestUploadByURLReHostsThroughTheStore(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{
		Auth:  config.AuthProxy,
		Store: store,
		// StatusCode is not optional in a stub: the handler refuses a non-2xx,
		// and the zero value is not a success. See
		// TestUploadByURLRefusesANonSuccessStatus for why it may not be.
		Fetcher: stubFetcher{resp: mediaResponse("https://example.com/i.png", "image/png")},
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got struct {
		URL      string `json:"url"`
		MimeType string `json:"mimeType"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got.URL != "https://cdn.example.com/files/abc.png" {
		t.Fatalf("url = %q", got.URL)
	}
	if store.lastMime != "image/png" {
		t.Fatalf("store received mime %q", store.lastMime)
	}
}

// The whole reason this task exists: a blocked address must be refused here
// exactly as it is on /unfurl, not quietly re-hosted.
func TestUploadByURLRefusesABlockedAddress(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{
		Auth:    config.AuthProxy,
		Store:   store,
		Fetcher: stubFetcher{err: fetchguard.ErrBlockedAddress},
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("http://169.254.169.254/"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if store.puts != 0 {
		t.Fatalf("store.puts = %d, want 0", store.puts)
	}
}

// A 404 or a 502 is a SUCCESSFUL fetch — nothing about the transport failed —
// so the target's error page arrives here as a *Response. Re-hosting it would
// put an HTML "Page not found" into the consumer's storage and hand it back as
// the image they asked for.
func TestUploadByURLRefusesANonSuccessStatus(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusBadGateway, http.StatusMovedPermanently} {
		store := &stubStore{}
		h := httpapi.New(httpapi.Options{
			Auth:  config.AuthProxy,
			Store: store,
			Fetcher: stubFetcher{resp: &fetchguard.Response{
				Body:        []byte("<html><body>Page not found</body></html>"),
				ContentType: "text/html",
				FinalURL:    "https://example.com/i.png",
				StatusCode:  status,
			}},
		})

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status %d: response = %d, want 400", status, rec.Code)
		}
		if store.puts != 0 {
			t.Fatalf("status %d: store.puts = %d — an error page was re-hosted", status, store.puts)
		}
	}
}

// path.Base over the RAW url returns "i.png?v=2", whose extension is
// ".png?v=2" — which blobstore refuses outright, so the blob lands with no
// extension at all and a local-directory deployment then serves it by sniffing
// the bytes. The URL has to be parsed before its last segment is taken.
func TestUploadByURLDerivesTheNameFromTheParsedURLPath(t *testing.T) {
	for _, tc := range []struct{ finalURL, want string }{
		{"https://example.com/i.png?v=2", "i.png"},
		{"https://example.com/a/b/photo.jpeg#frag", "photo.jpeg"},
		{"https://example.com/i.png", "i.png"},
	} {
		store := &stubStore{}
		h := httpapi.New(httpapi.Options{
			Auth:    config.AuthProxy,
			Store:   store,
			Fetcher: stubFetcher{resp: mediaResponse(tc.finalURL, "image/png")},
		})

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, byURLRequest("https://example.com/x"))

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, body = %s", tc.finalURL, rec.Code, rec.Body.String())
		}

		var got struct {
			FileName string `json:"fileName"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if store.lastName != tc.want {
			t.Fatalf("%s: store received name %q, want %q", tc.finalURL, store.lastName, tc.want)
		}
		if got.FileName != tc.want {
			t.Fatalf("%s: reported fileName %q, want %q", tc.finalURL, got.FileName, tc.want)
		}
	}
}

// A URL with no filename in it must yield no name at all — never "." or "/",
// which is what path.Base returns for these and what the consumer would then
// save as the file's name.
func TestUploadByURLReportsNoNameForAPathlessURL(t *testing.T) {
	for _, finalURL := range []string{"https://example.com", "https://example.com/", "https://example.com/a/../"} {
		store := &stubStore{}
		h := httpapi.New(httpapi.Options{
			Auth:    config.AuthProxy,
			Store:   store,
			Fetcher: stubFetcher{resp: mediaResponse(finalURL, "image/png")},
		})

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, byURLRequest("https://example.com/x"))

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d", finalURL, rec.Code)
		}
		if store.lastName != "" {
			t.Fatalf("%s: store received name %q, want empty", finalURL, store.lastName)
		}
		if body := rec.Body.String(); strings.Contains(body, `"fileName"`) {
			t.Fatalf("%s: body = %s, want no fileName", finalURL, body)
		}
	}
}

// fetchguard's MaxBytes is sized for an HTML <head>. Re-hosting a real file
// through that client truncates it, so this route gets its own instance of the
// SAME guard with a file-sized cap — a second instance, never a second path.
func TestUploadByURLUsesTheMediaFetcher(t *testing.T) {
	page := &recordingFetcher{resp: mediaResponse("https://example.com/i.png", "text/html")}
	media := &recordingFetcher{resp: mediaResponse("https://example.com/i.png", "image/png")}

	h := httpapi.New(httpapi.Options{
		Auth:         config.AuthProxy,
		Store:        &stubStore{},
		Fetcher:      page,
		MediaFetcher: media,
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if media.calls != 1 || page.calls != 0 {
		t.Fatalf("media fetcher called %d times, page fetcher %d — want 1 and 0", media.calls, page.calls)
	}
}

// A deployment that configures only one client still works. It gets the
// page-sized cap, which is a smaller file than it wanted — not a 404.
func TestUploadByURLFallsBackToThePageFetcher(t *testing.T) {
	page := &recordingFetcher{resp: mediaResponse("https://example.com/i.png", "image/png")}

	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: &stubStore{}, Fetcher: page})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if page.calls != 1 {
		t.Fatalf("page fetcher called %d times, want 1", page.calls)
	}
}

// With no guarded client there is no way to fetch, and an unregistered route is
// how this service says "not here" — the handler must never be reachable with a
// nil fetcher, which would panic the connection.
func TestUploadByURLIsNotRegisteredWithoutAFetcher(t *testing.T) {
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: &stubStore{}})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestUploadByURLIsNotRegisteredWithoutAStore(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		Auth:    config.AuthProxy,
		Fetcher: stubFetcher{resp: mediaResponse("https://example.com/i.png", "image/png")},
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestUploadByURLRejectsAMalformedPayload(t *testing.T) {
	for _, body := range []string{`{}`, `{"url":""}`, `not json`, ``} {
		store := &stubStore{}
		h := httpapi.New(httpapi.Options{
			Auth:    config.AuthProxy,
			Store:   store,
			Fetcher: stubFetcher{resp: mediaResponse("https://example.com/i.png", "image/png")},
		})

		req := httptest.NewRequest(http.MethodPost, "/upload-by-url", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: status = %d, want 400", body, rec.Code)
		}
		if store.puts != 0 {
			t.Fatalf("%q: store.puts = %d, want 0", body, store.puts)
		}
	}
}

// The media type reaches the store (the S3 driver signs it into the object's
// Content-Type) and the response, where the consumer saves it into their own
// block data. A value that is not a media type at all is dropped rather than
// repeated.
func TestUploadByURLDropsAnUnusableMediaType(t *testing.T) {
	for _, contentType := range []string{"not a media type", strings.Repeat("a", 300) + "/x", ""} {
		store := &stubStore{}
		h := httpapi.New(httpapi.Options{
			Auth:    config.AuthProxy,
			Store:   store,
			Fetcher: stubFetcher{resp: mediaResponse("https://example.com/i.png", contentType)},
		})

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

		if rec.Code != http.StatusOK {
			t.Fatalf("%q: status = %d", contentType, rec.Code)
		}
		if store.lastMime != "" {
			t.Fatalf("%q: store received mime %q, want empty", contentType, store.lastMime)
		}
		if body := rec.Body.String(); strings.Contains(body, `"mimeType"`) {
			t.Fatalf("%q: body = %s, want no mimeType", contentType, body)
		}
	}
}

// A charset is part of what the bytes are; dropping it changes how the blob is
// served back.
func TestUploadByURLKeepsMediaTypeParameters(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{
		Auth:    config.AuthProxy,
		Store:   store,
		Fetcher: stubFetcher{resp: mediaResponse("https://example.com/a.txt", "text/plain; charset=utf-8")},
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("https://example.com/a.txt"))

	if store.lastMime != "text/plain; charset=utf-8" {
		t.Fatalf("store received mime %q", store.lastMime)
	}
}

func TestUploadByURLReportsTheFetchedSize(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		Auth:    config.AuthProxy,
		Store:   &stubStore{},
		Fetcher: stubFetcher{resp: mediaResponse("https://example.com/i.png", "image/png")},
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, byURLRequest("https://example.com/i.png"))

	var got struct {
		Size int64 `json:"size"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Size != int64(len("imagebytes")) {
		t.Fatalf("size = %d, want %d", got.Size, len("imagebytes"))
	}
}
