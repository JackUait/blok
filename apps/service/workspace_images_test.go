package cloud

import (
	"encoding/base64"
	"strings"
	"testing"
)

const tinyPNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII="

func TestWorkspaceImageValidation(t *testing.T) {
	data, extension, err := decodeWorkspaceImage(tinyPNG, maxEmojiImage)
	if err != nil || len(data) == 0 || extension != ".png" {
		t.Fatalf("valid PNG: %s %v", extension, err)
	}
	for _, raw := range []string{
		"data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(`<svg onload="alert(1)"></svg>`)),
		"data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("<html>script</html>")),
		strings.Replace(tinyPNG, "image/png", "image/jpeg", 1),
		"data:image/png;base64,not-base64",
		"https://example.test/image.png",
		"data:image/png;base64," + strings.Repeat("A", base64.StdEncoding.EncodedLen(maxEmojiImage)+4),
	} {
		if _, _, err := decodeWorkspaceImage(raw, maxEmojiImage); err == nil {
			t.Fatalf("accepted invalid image %.70s", raw)
		}
	}
	if _, _, err := decodeWorkspaceImage(tinyPNG, 8); err == nil {
		t.Fatal("accepted oversized PNG")
	}
}
func TestRemoteImageURLValidation(t *testing.T) {
	for _, raw := range []string{"https://example.test/image.png", "https://images.example.test/picture?q=one"} {
		if !validRemoteImage(raw) {
			t.Fatalf("rejected %s", raw)
		}
	}
	for _, raw := range []string{"http://example.test/image.png", "javascript:alert(1)", "data:image/png;base64,abc", "//example.test/a", "https://user:pass@example.test/a", "https:///image"} {
		if validRemoteImage(raw) {
			t.Fatalf("accepted %s", raw)
		}
	}
}
