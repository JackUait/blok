package framecheck

import (
	"regexp"
	"strconv"
	"unicode/utf16"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// In UTF-16 units, like every other cap in the server.
const (
	maxTextLength = 256
	maxURLLength  = 2048
	maxSize       = 4096
)

var wholeSize = regexp.MustCompile(`^[1-9][0-9]{0,8}$`)

// OEmbed is C#'s OEmbedAnswer: the few oEmbed fields Blok passes on. The
// html field never leaves the server (oEmbed §3 calls it an XSS vector).
// Empty and zero fields are absent.
type OEmbed struct {
	Title, ProviderName jsjson.Str
	ThumbnailURL        string
	Width, Height       int
}

// Empty reports whether no field survived.
func (o OEmbed) Empty() bool {
	return len(o.Title) == 0 && len(o.ProviderName) == 0 && o.ThumbnailURL == "" && o.Width == 0 && o.Height == 0
}

// ParseOEmbed reads an oEmbed JSON body the way C# does: JsonDocument rules,
// a repeated name's last value winning even when it is not usable.
func ParseOEmbed(body []byte) OEmbed {
	var o OEmbed
	root, err := jsjson.ParseNode(body, jsjson.Options{})
	if err != nil || root.Kind != jsjson.KindObject {
		return o
	}
	for _, member := range root.Members {
		key, err := member.Key()
		if err != nil {
			continue
		}
		value := member.Value
		switch key.String() {
		case "title":
			o.Title = text(value)
		case "provider_name":
			o.ProviderName = text(value)
		case "thumbnail_url":
			o.ThumbnailURL = secureURL(value)
		case "width":
			o.Width = size(value)
		case "height":
			o.Height = size(value)
		}
	}
	return o
}

func str(value *jsjson.Node) (jsjson.Str, bool) {
	if value.Kind != jsjson.KindString {
		return nil, false
	}
	s, err := value.Text()
	return s, err == nil
}

func text(value *jsjson.Node) jsjson.Str {
	s, ok := str(value)
	if !ok || len(s) <= maxTextLength {
		return s
	}
	end := maxTextLength
	if utf16.IsSurrogate(rune(s[end-1])) && s[end-1] < 0xdc00 {
		end--
	}
	return s[:end]
}

func secureURL(value *jsjson.Node) string {
	s, ok := str(value)
	if !ok || hasControl(s) {
		return ""
	}
	u, ok := dotnet.ParseAbsoluteURI(s.String())
	if !ok || u.Scheme != "https" || u.Host == "" || u.UserInfo != "" ||
		hasEncodedControl(u.AbsoluteURI) || len(jsjson.FromString(u.AbsoluteURI)) > maxURLLength {
		return ""
	}
	return u.AbsoluteURI
}

// hasControl finds a C0, DEL or C1 character. Go's parser trims them at the
// ends and .NET's escapes them, so a URL with one is dropped before parsing.
func hasControl(s jsjson.Str) bool {
	for _, c := range s {
		if c < 0x20 || 0x7f <= c && c <= 0x9f {
			return true
		}
	}
	return false
}

// hasEncodedControl finds %00-%1F or %7F, in either hex case.
func hasEncodedControl(url string) bool {
	for i := 0; i+2 < len(url); i++ {
		if url[i] != '%' {
			continue
		}
		hi, lo := url[i+1]|0x20, url[i+2]|0x20
		if hi == '0' || hi == '1' || hi == '7' && lo == 'f' {
			return true
		}
	}
	return false
}

func size(value *jsjson.Node) int {
	if value.Kind != jsjson.KindNumber || !wholeSize.Match(value.Raw()) {
		return 0
	}
	n, _ := strconv.Atoi(string(value.Raw()))
	return min(n, maxSize)
}

// AppendJSON writes the fields that survived, as System.Text.Json would.
func (o OEmbed) AppendJSON(dst []byte) []byte {
	dst = append(dst, '{')
	comma := false
	field := func(name string) {
		if comma {
			dst = append(dst, ',')
		}
		comma = true
		dst = append(dst, `"`+name+`":`...)
	}
	if len(o.Title) > 0 {
		field("title")
		dst = jsjson.AppendQuoted(dst, o.Title)
	}
	if len(o.ProviderName) > 0 {
		field("provider_name")
		dst = jsjson.AppendQuoted(dst, o.ProviderName)
	}
	if o.ThumbnailURL != "" {
		field("thumbnail_url")
		dst = jsjson.AppendQuoted(dst, jsjson.FromString(o.ThumbnailURL))
	}
	if o.Width != 0 {
		field("width")
		dst = strconv.AppendInt(dst, int64(o.Width), 10)
	}
	if o.Height != 0 {
		field("height")
		dst = strconv.AppendInt(dst, int64(o.Height), 10)
	}
	return append(dst, '}')
}
