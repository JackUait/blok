package dotnet

import "testing"

// Measured on the C# host through the origin check; see
// fixtures/origin-case-fold.json for the black-box half.
func TestEqualsOrdinalIgnoreCase(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"http://k.example", "HTTP://K.EXAMPLE", true},
		{"http://k.example", "http://K.example", false},
		{"http://s.example", "http://ſ.example", false},
		{"http://i.example", "http://ı.example", false},
		{"http://i.example", "http://İ.example", false},
		{"http://é.example", "http://É.example", true},
		{"http://ß.example", "http://ẞ.example", false},
		{"http://σ.example", "http://ς.example", true},
		{"http://μ.example", "http://µ.example", true},
		{"a\xe9", "a\xe9", true},
		{"a\xe9", "a\xc9", false},
		{"ab", "a", false},
		// The pair differs in UTF-8 length; .NET compares UTF-16 chars.
		{"http://\u0250.example", "http://\u2c6f.example", true},
		{"http://\u2c65.example", "http://\u023a.example", true},
		{"a\xe9", "a\u00e9", false},
	}
	for _, c := range cases {
		if got := EqualsOrdinalIgnoreCase(c.a, c.b); got != c.want {
			t.Errorf("%q vs %q: got %v", c.a, c.b, got)
		}
	}
}
