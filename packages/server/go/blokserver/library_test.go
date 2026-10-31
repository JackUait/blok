package blokserver

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver/ticket"
	"github.com/JackUait/blok/packages/server/go/internal/blob"
)

// AddBlokServer TryAdds TimeProvider.System (BlokServerServiceCollectionExtensions.cs:77),
// so a host's own clock drives the guard's ticket check.
func TestOptionsClockDrivesTheTicketCheck(t *testing.T) {
	then := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	token, err := ticket.Mint(guardSecret, ticket.Claims{User: "u1", Write: true}, then)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name  string
		clock func() time.Time
		ok    bool
	}{
		{"host clock at mint time", func() time.Time { return then.Add(time.Minute) }, true},
		{"system clock", nil, false},
	} {
		o := DefaultOptions()
		o.Auth = "ticket"
		o.Secret = guardSecret
		o.AllowedOrigins = []string{"https://app.example.com"}
		o.Clock = c.clock
		s, err := New(o)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("GET", "/health", nil)
		request.Header.Set("Origin", "https://app.example.com")
		request.Header.Set("Authorization", "Bearer "+token)
		if _, ok := s.guard(httptest.NewRecorder(), request, true); ok != c.ok {
			t.Fatalf("%s: accepted %v, want %v", c.name, ok, c.ok)
		}
	}
}

// C# validates the registered options again whenever it builds a service
// (V35). Go validates once in New, so New must keep a copy a caller cannot
// change afterwards, slices and maps included.
func TestNewKeepsItsOwnCopyOfTheOptions(t *testing.T) {
	o := DefaultOptions()
	o.AllowedOrigins = []string{"https://app.example.com"}
	o.RichTextFields = map[string][]string{"card": {"body"}}
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	o.AllowedOrigins[0] = "https://evil.example"
	o.RichTextFields["card"][0] = "changed"
	o.RichTextFields["other"] = []string{"x"}

	request := httptest.NewRequest("GET", "/health", nil)
	request.Header.Set("Origin", "https://app.example.com")
	recorder := httptest.NewRecorder()
	if _, ok := s.guard(recorder, request, false); !ok ||
		recorder.Header().Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Fatalf("%v %d %v", ok, recorder.Code, recorder.Header())
	}
	if got := s.options.RichTextFields; len(got) != 1 || got["card"][0] != "body" {
		t.Fatalf("rich text fields changed: %v", got)
	}
}

// L6: the S3 store spools to Path.GetTempPath() (blob.S3 reads an empty
// TempDir as os.TempDir) and caps the spool at MaxUploadBytes
// (BlokServerServiceCollectionExtensions.cs:210-226).
func TestS3StoreSpoolsToTheTempDirUpToTheUploadCap(t *testing.T) {
	o := DefaultOptions()
	o.S3Endpoint = "https://s3.example.com"
	o.S3Region = "us-east-1"
	o.S3Bucket = "media"
	o.S3AccessKey = "a"
	o.S3SecretKey = "b"
	o.MaxUploadBytes = 12345
	store, err := newS3Store(&o, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	s3, ok := store.(*blob.S3)
	if !ok || s3.MaxSpoolBytes != 12345 || s3.TempDir != "" {
		t.Fatalf("%T %+v", store, store)
	}
}
