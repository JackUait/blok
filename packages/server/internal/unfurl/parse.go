package unfurl

import (
	"bytes"
	"net/url"
	"strings"

	"golang.org/x/net/html"
)

type Meta struct {
	Title       string
	Description string
	Image       string
	Favicon     string
	Domain      string
}

// Parse extracts preview metadata. It never performs I/O, so it is safe to run
// on any bytes the guard returned. Preference order per key is OpenGraph,
// then Twitter cards, then the plain HTML element — resolved after the walk so
// it does not depend on the order the tags happen to appear in.
func Parse(page []byte, finalURL string) Meta {
	base, err := url.Parse(finalURL)
	if err != nil {
		base = nil
	}

	var (
		meta          Meta
		titleTag      string
		ogTitle       string
		twTitle       string
		ogDesc        string
		twDesc        string
		plainDesc     string
		ogImage       string
		twImage       string
		iconHref      string
		appleIconHref string
	)

	// html.Parse returns a nil document with an error when the markup nests
	// deeper than its open-element cap, so the walk must stay behind this guard.
	if doc, parseErr := html.Parse(bytes.NewReader(page)); parseErr == nil {
		var walk func(*html.Node)
		walk = func(n *html.Node) {
			if n.Type == html.ElementNode {
				switch n.Data {
				case "title":
					// <title> in a foreign namespace is an <svg>/<math> accessibility
					// label for an icon, and the walk reaches it before a <title> that
					// a malformed page left in <body>.
					if n.Namespace == "" && n.FirstChild != nil {
						keepFirst(&titleTag, strings.TrimSpace(n.FirstChild.Data))
					}
				case "meta":
					property, name, content := attr(n, "property"), attr(n, "name"), attr(n, "content")
					switch {
					case property == "og:title":
						keepFirst(&ogTitle, content)
					case name == "twitter:title":
						keepFirst(&twTitle, content)
					case property == "og:description":
						keepFirst(&ogDesc, content)
					case name == "twitter:description":
						keepFirst(&twDesc, content)
					case name == "description":
						keepFirst(&plainDesc, content)
					case property == "og:image":
						keepFirst(&ogImage, content)
					case name == "twitter:image":
						keepFirst(&twImage, content)
					}
				case "link":
					if href := attr(n, "href"); href != "" {
						// Token equality, not substring: rel="mask-icon" (a monochrome
						// Safari mask) and rel="fluid-icon" both contain "icon".
						for _, rel := range strings.Fields(strings.ToLower(attr(n, "rel"))) {
							switch {
							case rel == "icon":
								keepFirst(&iconHref, href)
							case strings.HasPrefix(rel, "apple-touch-icon"):
								keepFirst(&appleIconHref, href)
							}
						}
					}
				}
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
		}
		walk(doc)
	}

	meta.Title = firstNonEmpty(ogTitle, twTitle, titleTag)
	meta.Description = firstNonEmpty(ogDesc, twDesc, plainDesc)

	icon := firstNonEmpty(iconHref, appleIconHref)

	if base != nil && base.Host != "" {
		meta.Domain = strings.TrimPrefix(strings.ToLower(base.Hostname()), "www.")

		if icon == "" {
			icon = "/favicon.ico"
		}
	}

	meta.Image = absolute(base, firstNonEmpty(ogImage, twImage))
	meta.Favicon = absolute(base, icon)

	return meta
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return strings.TrimSpace(a.Val)
		}
	}

	return ""
}

func keepFirst(dst *string, value string) {
	if *dst == "" {
		*dst = value
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}

	return ""
}

// absolute resolves ref against base, dropping anything a link card could not
// load: a relative ref with no usable base, and any scheme other than http(s)
// — an og:image of "javascript:..." otherwise reaches the consumer's <img src>.
func absolute(base *url.URL, ref string) string {
	if ref == "" {
		return ""
	}

	parsed, err := url.Parse(ref)
	if err != nil {
		return ""
	}

	if base != nil && base.Host != "" {
		parsed = base.ResolveReference(parsed)
	}

	if parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}

	return parsed.String()
}
