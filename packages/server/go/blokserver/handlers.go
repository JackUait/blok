package blokserver

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/blob"
	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/mediatype"
	"github.com/JackUait/blok/packages/server/go/internal/outbound"
	"github.com/JackUait/blok/packages/server/go/internal/unfurl"
)

const maxEnvelopeBytes = 8 << 10

var unfurlLimits = outbound.Limits{Timeout: 10 * time.Second, MaxBytes: 2 << 20, MaxRedirects: 5}

// unfurl is UnfurlEndpoint: 400 {"success":0} without a url, 200
// {"success":0} for any fetch failure, else the metadata.
func (s *Server) unfurl(w http.ResponseWriter, r *http.Request) {
	target := ""
	if values := r.URL.Query()["url"]; len(values) > 0 {
		target = values[0]
	}
	if target == "" {
		writeJSON(w, http.StatusBadRequest, []byte("{\"success\":0}\n"))
		return
	}
	response, err := s.fetcher.Get(r.Context(), target, unfurlLimits)
	if err != nil {
		if r.Context().Err() == nil {
			writeJSON(w, http.StatusOK, []byte("{\"success\":0}\n"))
		}
		return
	}
	defer response.Release()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		writeJSON(w, http.StatusOK, []byte("{\"success\":0}\n"))
		return
	}
	meta := unfurl.Parse(response.Body, response.FinalURL)
	body := []byte(`{"success":1,"link":`)
	body = jsjson.AppendQuoted(body, jsjson.FromString(response.FinalURL))
	body = append(body, `,"meta":{`...)
	field := func(name, value string, comma bool) {
		if value == "" {
			return
		}
		if comma {
			body = append(body, ',')
		}
		body = append(body, `"`+name+`":`...)
		body = jsjson.AppendQuoted(body, jsjson.FromString(value))
	}
	field("title", meta.Title, false)
	if meta.Title != "" {
		body = append(body, ',')
	}
	field("description", meta.Description, false)
	if meta.Description != "" {
		body = append(body, ',')
	}
	body = append(body, `"image":{`...)
	field("url", meta.Image, false)
	body = append(body, '}')
	field("favicon", meta.Favicon, true)
	field("domain", meta.Domain, true)
	writeJSON(w, http.StatusOK, append(body, "}}\n"...))
}

// readEnvelope reads {"url": "..."} the way the C# JSON routes do: at most
// 8 KiB, names in any case, the last repeat winning, a non-empty string url,
// and nothing but space after the object.
func readEnvelope(r *http.Request) (string, bool) {
	data, err := io.ReadAll(io.LimitReader(r.Body, maxEnvelopeBytes+1))
	if err != nil || len(data) > maxEnvelopeBytes {
		return "", false
	}
	node, err := jsjson.ParseNode(data, jsjson.Options{})
	if err != nil || node.Kind != jsjson.KindObject {
		return "", false
	}
	target := ""
	for _, member := range node.Members {
		key, err := member.Key()
		if err != nil || !strings.EqualFold(key.String(), "url") {
			continue
		}
		switch member.Value.Kind {
		case jsjson.KindNull:
		case jsjson.KindString:
			text, err := member.Value.Text()
			if err != nil {
				return "", false
			}
			target = text.String()
		default:
			return "", false
		}
	}
	return target, target != ""
}

// delete is DeleteEndpoint.
func (s *Server) delete(w http.ResponseWriter, r *http.Request) {
	if !mediatype.IsJSON(firstValue(r.Header, "Content-Type")) {
		writeText(w, http.StatusUnsupportedMediaType, "expected application/json\n")
		return
	}
	target, ok := readEnvelope(r)
	if !ok {
		writeText(w, http.StatusBadRequest, "expected {\"url\": \"...\"}\n")
		return
	}
	store, err := s.blobStore()
	if err == nil {
		err = store.Delete(r.Context(), target)
	}
	switch {
	case errors.Is(err, blob.ErrForeign):
		// A URL never issued looks like one issued and forgotten, so a
		// caller cannot probe another store through this one.
		writeText(w, http.StatusNotFound, "not found\n")
	case err != nil:
		if r.Context().Err() == nil {
			writeText(w, http.StatusBadGateway, "delete failed\n")
		}
	default:
		writeJSON(w, http.StatusOK, []byte("{\"success\":1}\n"))
	}
}

// uploadByURL is UploadByUrlEndpoint. The fetch slot is held until the
// store has the bytes.
func (s *Server) uploadByURL(w http.ResponseWriter, r *http.Request) {
	if !mediatype.IsJSON(firstValue(r.Header, "Content-Type")) {
		writeText(w, http.StatusUnsupportedMediaType, "expected application/json\n")
		return
	}
	target, ok := readEnvelope(r)
	if !ok {
		writeText(w, http.StatusBadRequest, "expected {\"url\": \"...\"}\n")
		return
	}
	response, err := s.fetcher.Get(r.Context(), target, outbound.Limits{
		Timeout: 2 * time.Minute, MaxBytes: s.options.MaxUploadBytes, MaxRedirects: 5,
	})
	if err != nil {
		if r.Context().Err() == nil {
			writeText(w, http.StatusBadRequest, "the URL could not be fetched\n")
		}
		return
	}
	defer response.Release()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		writeText(w, http.StatusBadRequest, "the URL could not be fetched\n")
		return
	}
	fileName := nameFromURL(response.FinalURL)
	mimeType := mediatype.SanitizeWire(response.ContentType)
	store, err := s.blobStore()
	var url string
	if err == nil {
		url, err = store.Put(r.Context(), blob.NormalizeExtension(blob.Extension(fileName)), mimeType,
			strings.NewReader(string(response.Body)))
	}
	if err != nil {
		if r.Context().Err() == nil {
			writeText(w, http.StatusBadGateway, "upload failed\n")
		}
		return
	}
	uploadResponse(w, url, fileName, int64(len(response.Body)), mimeType)
}

func nameFromURL(raw string) string {
	url, ok := dotnet.ParseAbsoluteURI(raw)
	if !ok || !url.IsHTTP() {
		return ""
	}
	return sanitizeFileName(dotnet.UnescapeDataString(url.AbsolutePath))
}

// serveLocalFile is LocalFileEndpoint: no guard and no CORS, a generated
// name only, served as an attachment with nosniff.
func (s *Server) serveLocalFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("fileName")
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) || !blob.IsGenerated(name) {
		writeText(w, http.StatusNotFound, "404 page not found\n")
		return
	}
	file, err := os.Open(filepath.Join(s.options.StorageDirectory, name))
	if err != nil {
		writeText(w, http.StatusNotFound, "404 page not found\n")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		writeText(w, http.StatusNotFound, "404 page not found\n")
		return
	}
	serveFile(w, r, file, info.Size(), info.ModTime().UTC().Truncate(time.Second), contentTypeFor(name))
}

func writeLength(w http.ResponseWriter, length int64) {
	w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
}
