package unfurl_test

import (
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/unfurl"
)

const page = `<html><head>
<title>Fallback Title</title>
<meta property="og:title" content="OpenGraph Title">
<meta name="description" content="Plain description">
<meta property="og:image" content="/img/cover.png">
<link rel="icon" href="/favicon.ico">
</head><body>ignored</body></html>`

func TestPrefersOpenGraphOverTitleTag(t *testing.T) {
	m := unfurl.Parse([]byte(page), "https://example.com/article?x=1")

	if m.Title != "OpenGraph Title" {
		t.Fatalf("Title = %q", m.Title)
	}
	if m.Description != "Plain description" {
		t.Fatalf("Description = %q", m.Description)
	}
	if m.Domain != "example.com" {
		t.Fatalf("Domain = %q", m.Domain)
	}
}

func TestResolvesRelativeImageAndFaviconAgainstFinalURL(t *testing.T) {
	m := unfurl.Parse([]byte(page), "https://example.com/article")

	if m.Image != "https://example.com/img/cover.png" {
		t.Fatalf("Image = %q", m.Image)
	}
	if m.Favicon != "https://example.com/favicon.ico" {
		t.Fatalf("Favicon = %q", m.Favicon)
	}
}

func TestFallsBackToTitleTagAndDefaultFavicon(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head><title>Only Title</title></head></html>`), "https://example.com/x")

	if m.Title != "Only Title" {
		t.Fatalf("Title = %q", m.Title)
	}
	if m.Favicon != "https://example.com/favicon.ico" {
		t.Fatalf("Favicon = %q", m.Favicon)
	}
}

func TestReturnsDomainOnlyForAPageWithNoMetadata(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><body>nothing</body></html>`), "https://example.com/x")

	if m.Title != "" {
		t.Fatalf("Title = %q, want empty", m.Title)
	}
	if m.Domain != "example.com" {
		t.Fatalf("Domain = %q", m.Domain)
	}
}

func TestPrefersOpenGraphThenTwitterThenPlainElement(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head>
<title>Element Title</title>
<meta name="twitter:title" content="Twitter Title">
<meta name="description" content="Plain description">
<meta name="twitter:description" content="Twitter description">
</head></html>`), "https://example.com/x")

	if m.Title != "Twitter Title" {
		t.Fatalf("Title = %q, want the Twitter card to beat the title element", m.Title)
	}
	if m.Description != "Twitter description" {
		t.Fatalf("Description = %q, want the Twitter card to beat the plain meta", m.Description)
	}
}

// A <title> inside <svg> is an accessibility label for an icon, not the page
// title, and the walker reaches it before a <title> that a malformed page left
// in <body>.
func TestIgnoresTitleInsideSVG(t *testing.T) {
	tests := []struct {
		name string
		html string
		want string
	}{
		{
			name: "inline svg icon is the only title element",
			html: `<html><body><svg><title>Icon Label</title></svg><p>hi</p></body></html>`,
			want: "",
		},
		{
			name: "svg title precedes the real title in document order",
			html: `<svg><title>Icon Label</title></svg><title>Real Page</title>`,
			want: "Real Page",
		},
		{
			name: "svg title alongside a head title",
			html: `<html><head><title>Real Page</title></head><body><svg><title>Icon Label</title></svg></body></html>`,
			want: "Real Page",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := unfurl.Parse([]byte(tt.html), "https://example.com/x").Title; got != tt.want {
				t.Fatalf("Title = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolvesProtocolRelativeImageAgainstFinalURLScheme(t *testing.T) {
	tests := []struct {
		finalURL string
		want     string
	}{
		{finalURL: "https://example.com/article", want: "https://cdn.example.com/i.png"},
		{finalURL: "http://example.com/article", want: "http://cdn.example.com/i.png"},
	}

	for _, tt := range tests {
		t.Run(tt.finalURL, func(t *testing.T) {
			m := unfurl.Parse([]byte(`<html><head><meta property="og:image" content="//cdn.example.com/i.png"></head></html>`), tt.finalURL)

			if m.Image != tt.want {
				t.Fatalf("Image = %q, want %q", m.Image, tt.want)
			}
		})
	}
}

func TestPicksTheIconRelOverLookalikeRels(t *testing.T) {
	tests := []struct {
		name string
		html string
		want string
	}{
		{
			name: "rel=icon wins over earlier icon-lookalike rels",
			html: `<link rel="mask-icon" href="/mask.svg"><link rel="apple-touch-icon" href="/apple.png"><link rel="ICON SHORTCUT" href="/real.ico">`,
			want: "https://example.com/real.ico",
		},
		{
			name: "shortcut icon is the icon rel",
			html: `<link rel="shortcut icon" href="/real.ico">`,
			want: "https://example.com/real.ico",
		},
		{
			name: "apple-touch-icon beats guessing the default path",
			html: `<link rel="apple-touch-icon" href="/apple.png">`,
			want: "https://example.com/apple.png",
		},
		{
			name: "mask-icon alone is not a favicon",
			html: `<link rel="mask-icon" href="/mask.svg">`,
			want: "https://example.com/favicon.ico",
		},
		{
			name: "fluid-icon alone is not a favicon",
			html: `<link rel="fluid-icon" href="/fluid.png">`,
			want: "https://example.com/favicon.ico",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := unfurl.Parse([]byte(tt.html), "https://example.com/x").Favicon; got != tt.want {
				t.Fatalf("Favicon = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSurvivesMalformedHTML(t *testing.T) {
	tests := []struct {
		name     string
		html     string
		wantText string
		wantDesc string
	}{
		{name: "empty input", html: ``},
		{name: "not html at all", html: `%%% not html at all %%%`},
		{name: "truncated mid tag", html: `<html><head><meta property="og:tit`},
		{name: "unclosed tags", html: `<html><head><meta property="og:title" content="Unclosed"><body><p>text`, wantText: "Unclosed"},
		{name: "meta without a content attribute", html: `<html><head><meta property="og:title"><meta name="description"><title>Real</title></head>`, wantText: "Real"},
		{name: "title with no text node", html: `<html><head><title></title></head><body>x</body></html>`},
		{name: "whitespace-only title then a real one", html: `<title>   </title><title>Real</title>`, wantText: "Real"},
		// x/net/html refuses a tree deeper than 512 open elements and returns a nil
		// document with an error; the walk must not run on it.
		{name: "nested past the parser open-element cap", html: strings.Repeat("<div>", 5000) + `<meta property="og:title" content="Deep">` + strings.Repeat("</div>", 5000)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := unfurl.Parse([]byte(tt.html), "https://example.com/x")

			if m.Title != tt.wantText {
				t.Fatalf("Title = %q, want %q", m.Title, tt.wantText)
			}
			if m.Description != tt.wantDesc {
				t.Fatalf("Description = %q, want %q", m.Description, tt.wantDesc)
			}
			if m.Image != "" {
				t.Fatalf("Image = %q, want empty", m.Image)
			}
			if m.Domain != "example.com" {
				t.Fatalf("Domain = %q", m.Domain)
			}
			if m.Favicon != "https://example.com/favicon.ico" {
				t.Fatalf("Favicon = %q", m.Favicon)
			}
		})
	}
}

func TestReturnsNoURLsWhenTheFinalURLIsUnusable(t *testing.T) {
	const withRelativeImage = `<html><head><title>Still Parsed</title><meta property="og:image" content="/img/cover.png"><link rel="icon" href="/site.ico"></head></html>`

	for _, finalURL := range []string{"", ":", "http://[::1", "not a url"} {
		t.Run("finalURL="+finalURL, func(t *testing.T) {
			m := unfurl.Parse([]byte(withRelativeImage), finalURL)

			if m.Title != "Still Parsed" {
				t.Fatalf("Title = %q, want the document still parsed", m.Title)
			}
			if m.Domain != "" {
				t.Fatalf("Domain = %q, want empty", m.Domain)
			}
			if m.Image != "" {
				t.Fatalf("Image = %q, want empty rather than an unresolved relative path", m.Image)
			}
			if m.Favicon != "" {
				t.Fatalf("Favicon = %q, want empty rather than an unresolved relative path", m.Favicon)
			}
		})
	}
}

func TestKeepsAnAlreadyAbsoluteImageWhenTheFinalURLIsUnusable(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head><meta property="og:image" content="https://cdn.example.com/i.png"></head></html>`), ":")

	if m.Image != "https://cdn.example.com/i.png" {
		t.Fatalf("Image = %q, want the absolute reference kept", m.Image)
	}
}

func TestEmptyOpenGraphContentFallsThroughToTheTitleElement(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head>
<title>Element Title</title>
<meta property="og:title" content="">
<meta property="og:description" content="">
<meta name="description" content="Plain description">
</head></html>`), "https://example.com/x")

	if m.Title != "Element Title" {
		t.Fatalf("Title = %q", m.Title)
	}
	if m.Description != "Plain description" {
		t.Fatalf("Description = %q", m.Description)
	}
}

func TestALaterEmptyTagDoesNotOverwriteAnEarlierValue(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head>
<meta property="og:title" content="Real Title">
<meta property="og:title" content="">
<meta name="description" content="Real description">
<meta name="description" content="">
</head></html>`), "https://example.com/x")

	if m.Title != "Real Title" {
		t.Fatalf("Title = %q, want the first non-empty value kept", m.Title)
	}
	if m.Description != "Real description" {
		t.Fatalf("Description = %q, want the first non-empty value kept", m.Description)
	}
}

func TestDropsImageAndFaviconURLsThatAreNotHTTP(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head>
<meta property="og:image" content="javascript:alert(1)">
<link rel="icon" href="data:image/svg+xml,&lt;svg onload=alert(1)&gt;">
</head></html>`), "https://example.com/x")

	if m.Image != "" {
		t.Fatalf("Image = %q, want a non-http scheme dropped", m.Image)
	}
	if m.Favicon != "" {
		t.Fatalf("Favicon = %q, want a non-http scheme dropped", m.Favicon)
	}
}

func TestLowercasesTheDomainBeforeStrippingWWW(t *testing.T) {
	if got := unfurl.Parse([]byte(``), "https://WWW.Example.COM/x").Domain; got != "example.com" {
		t.Fatalf("Domain = %q", got)
	}
}

func TestPrefersOpenGraphImageEvenWhenTheTwitterCardComesFirst(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head>
<meta name="twitter:image" content="/twitter.png">
<meta property="og:image" content="/og.png">
</head></html>`), "https://example.com/x")

	if m.Image != "https://example.com/og.png" {
		t.Fatalf("Image = %q, want OpenGraph to win regardless of document order", m.Image)
	}
}
