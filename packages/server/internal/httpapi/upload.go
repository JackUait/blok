package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
)

const (
	// multipartMemoryBytes is how much of a multipart body ParseMultipartForm
	// keeps in memory. Everything past it spills to os.TempDir, which is why
	// handleUpload must RemoveAll before it returns.
	multipartMemoryBytes = 8 << 20

	// byURLPayloadBytes bounds the JSON envelope, not the file it names. The
	// file's bound is the media fetcher's MaxBytes.
	byURLPayloadBytes = 8 << 10

	// maxMediaTypeLen matches the bound the S3 driver applies before it signs a
	// Content-Type header. A longer value is not a media type.
	maxMediaTypeLen = 255

	// maxFileNameLen bounds the name echoed back to the caller. The store never
	// uses more than an extension from it; this is about what the consumer
	// saves next to the URL.
	maxFileNameLen = 255
)

// The wire shape is fixed by src/tools/file/uploader.ts parseResponse: a 2xx
// must be JSON carrying a STRING `url`, or the client throws "malformed
// response". Everything else is optional and falls back to what the browser
// already knew about the file — except on /upload-by-url, where parseResponse
// is called with no fallbacks at all, so whatever is omitted there is simply
// absent from the block the consumer saves.
//
// A non-2xx never has its body read: parseResponse throws on the status alone.
// That is what makes the guard's text/plain refusals safe to leave as they are.
type uploadResponse struct {
	URL      string `json:"url"`
	FileName string `json:"fileName,omitempty"`
	Size     int64  `json:"size,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
}

func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	// A cap of zero is a MISSING cap, not an unlimited one, and it fails
	// closed. http.MaxBytesReader would refuse every byte anyway; saying so
	// here is what makes the misconfiguration legible instead of surfacing as
	// "every file the user picks is too large". The other direction — reading
	// zero as "no limit" — turns a forgotten flag into an unbounded request
	// body, which is the failure this service cannot recover from.
	if s.opts.MaxUploadBytes <= 0 {
		http.Error(w, "uploads are refused: this service has no upload size limit configured", http.StatusRequestEntityTooLarge)

		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, s.opts.MaxUploadBytes)

	if err := r.ParseMultipartForm(multipartMemoryBytes); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "file too large", http.StatusRequestEntityTooLarge)

			return
		}
		http.Error(w, "malformed upload", http.StatusBadRequest)

		return
	}

	// Nothing deletes the spilled temp files unless RemoveAll runs. net/http's
	// own server does it in finishRequest, so this is not a leak under
	// ListenAndServe — but that happens AFTER the response, and it happens only
	// there: mounted behind anything else (a test recorder, another router's
	// adapter) the files stay until the OS reclaims them. Registered before the
	// file handle's own Close so the LIFO order closes first and unlinks after.
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	// The field name is "file" because that is what src/tools/file/uploader.ts
	// sends by default. A consumer who sets FileConfig.field to something else
	// is configuring a backend they wrote themselves, not this one.
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file field", http.StatusBadRequest)

		return
	}
	defer file.Close()

	name := displayName(header.Filename)
	mediaType := sanitizeMediaType(header.Header.Get("Content-Type"))

	blobURL, err := s.opts.Store.Put(r.Context(), name, mediaType, file)
	if err != nil {
		http.Error(w, "upload failed", http.StatusBadGateway)

		return
	}

	// The blob is live before this line and no URL for it has reached anyone
	// yet, so a client that hung up leaves an orphan. Deleting here would race
	// a client that did receive the body; the consumer's own records are what
	// decide a blob's life, which is what Store.Delete is there for.
	//
	// header.Size is what the multipart reader measured while reading the part
	// — the same bytes Put just consumed. A body cut short by MaxBytesReader
	// never gets this far: ParseMultipartForm fails above, so a truncated blob
	// is never stored and then reported as whole.
	writeJSON(w, http.StatusOK, uploadResponse{
		URL:      blobURL,
		FileName: name,
		Size:     header.Size,
		MimeType: mediaType,
	})
}

func (s *server) handleUploadByURL(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, byURLPayloadBytes)).Decode(&payload); err != nil || payload.URL == "" {
		http.Error(w, `expected {"url": "..."}`, http.StatusBadRequest)

		return
	}

	// The MEDIA fetcher: the same guard as /unfurl, a second INSTANCE of it,
	// never a second path. New() defaults it to Fetcher.
	resp, err := s.opts.MediaFetcher.Get(r.Context(), payload.URL)
	if err != nil {
		http.Error(w, "the URL could not be fetched", http.StatusBadRequest)

		return
	}

	// A 404 or a 502 is a SUCCESSFUL fetch — nothing about the transport failed
	// — so the target's error page arrives here as a *Response carrying HTML.
	// Re-hosting it would put "Page not found" into the consumer's storage and
	// hand the URL back as the file they asked for.
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		http.Error(w, "the URL could not be fetched", http.StatusBadRequest)

		return
	}

	name := nameFromURL(resp.FinalURL)
	mediaType := sanitizeMediaType(resp.ContentType)

	// This service deliberately does NOT judge whether the bytes match what the
	// URL looked like: the same user can upload the same bytes through /upload
	// with no type check at all, so refusing them here blocks nothing. What it
	// does mean is that the stored EXTENSION comes from the URL while the
	// served type may not: the S3 driver serves the media type below, and a
	// local directory behind http.FileServer serves by extension and sniffs the
	// bytes when there is none. Whatever mounts that directory has to send
	// X-Content-Type-Options: nosniff and Content-Disposition: attachment, or an
	// HTML body re-hosted from a URL runs on the operator's origin.
	blobURL, err := s.opts.Store.Put(r.Context(), name, mediaType, bytes.NewReader(resp.Body))
	if err != nil {
		http.Error(w, "upload failed", http.StatusBadGateway)

		return
	}

	writeJSON(w, http.StatusOK, uploadResponse{
		URL:      blobURL,
		FileName: name,
		Size:     int64(len(resp.Body)),
		MimeType: mediaType,
	})
}

// nameFromURL derives a filename from the URL that actually served the bytes.
// The URL has to be PARSED first: path.Base over the raw string yields
// "i.png?v=2" for ".../i.png?v=2", and blobstore's extension rule refuses that
// whole tail — so the blob lands with no extension at all, which is exactly the
// case a stock http.FileServer resolves by sniffing the bytes instead.
func nameFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}

	return displayName(parsed.Path)
}

// displayName reduces a supplied filename to its last path segment. The store
// re-checks it and takes only an extension, so this is not the security
// boundary; it is what stops "/" or "C:\Users\me\photo.png" being saved as the
// file's name in the consumer's document.
//
// Both separators are stripped whatever this machine is: filepath.Base splits
// on "\" only on Windows, and the name comes from the browser's machine.
func displayName(raw string) string {
	if i := strings.LastIndexAny(raw, `/\`); i >= 0 {
		raw = raw[i+1:]
	}
	if raw == "." || raw == ".." || len(raw) > maxFileNameLen {
		return ""
	}

	return raw
}

// sanitizeMediaType drops a value this service should not repeat. It is
// untrusted twice over — on /upload it is a browser-supplied part header, on
// /upload-by-url it is whatever the fetched origin said — and it travels two
// ways: into the store (the S3 driver signs it into the object's Content-Type)
// and into the response, where the consumer saves it into their own block data.
//
// Parameters are KEPT. "text/plain; charset=utf-8" describes the bytes, and
// dropping the charset changes how the blob is served back.
func sanitizeMediaType(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > maxMediaTypeLen {
		return ""
	}
	if _, _, err := mime.ParseMediaType(v); err != nil {
		return ""
	}

	return v
}
