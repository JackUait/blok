package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

func TestHealthReportsVersion(t *testing.T) {
	h := httpapi.New(httpapi.Options{Version: "1.10.1"})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ok" || body.Version != "1.10.1" {
		t.Fatalf("body = %+v, want status=ok version=1.10.1", body)
	}
}
