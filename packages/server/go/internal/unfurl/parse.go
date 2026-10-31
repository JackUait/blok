// Package unfurl reads link-preview metadata out of an HTML page the way
// C#'s UnfurlMetadataParser does: HTML5 tree building, a depth cut at 512,
// Open Graph first, then Twitter, then the plain tags.
package unfurl

import (
	"bytes"
	"strings"
	"unicode"

	"golang.org/x/net/html"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

const maxOpenElementDepth = 512

// Metadata is UnfurlMetadata. Empty fields are absent.
type Metadata struct {
	Title, Description, Image, Favicon, Domain string
}

// Parse reads body as UTF-8, whatever charset the page names.
func Parse(body []byte, finalURL string) Metadata {
	base, ok := dotnet.ParseAbsoluteURI(finalURL)
	if !ok || base.Host == "" {
		base = nil
	}
	var title, ogTitle, twitterTitle, ogDescription, twitterDescription, description, ogImage, twitterImage, icon, appleIcon string
	// .NET decodes invalid UTF-8 to U+FFFD, one per maximal bad sequence.
	text := jsjson.FromString(string(body)).String()
	// AngleSharp parses with scripting off, so <noscript> holds markup.
	document, err := html.ParseWithOptions(strings.NewReader(text), html.ParseOptionEnableScripting(false))
	if err != nil {
		return build(base, "", "", "", "")
	}
	type frame struct {
		node  *html.Node
		depth int
		// sel is set below a <select>; see dropsInSelect.
		sel *selectState
	}
	stack := []frame{{document, 0, nil}}
	for len(stack) > 0 {
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		node := top.node
		if node.Type == html.ElementNode {
			if top.depth > maxOpenElementDepth {
				return build(base, "", "", "", "")
			}
			tag := node.Data
			if top.sel.drops() {
				if node.Namespace == "" && (tag == "input" || tag == "keygen" || tag == "textarea") {
					top.sel.closed = true
				}
				tag = ""
			}
			switch tag {
			case "title":
				if node.Namespace == "" && node.FirstChild != nil {
					keepFirst(&title, textContent(node.FirstChild))
				} else if node.Namespace == "" {
					keepFirst(&title, "")
				}
			case "meta":
				property, name, content := attribute(node, "property"), attribute(node, "name"), attribute(node, "content")
				switch {
				case property == "og:title":
					keepFirst(&ogTitle, content)
				case name == "twitter:title":
					keepFirst(&twitterTitle, content)
				case property == "og:description":
					keepFirst(&ogDescription, content)
				case name == "twitter:description":
					keepFirst(&twitterDescription, content)
				case name == "description":
					keepFirst(&description, content)
				case property == "og:image":
					keepFirst(&ogImage, content)
				case name == "twitter:image":
					keepFirst(&twitterImage, content)
				}
			case "link":
				href := attribute(node, "href")
				if href == "" {
					break
				}
				for _, relation := range strings.FieldsFunc(attribute(node, "rel"), unicode.IsSpace) {
					relation = asciiLower(relation)
					if relation == "icon" {
						keepFirst(&icon, href)
					} else if strings.HasPrefix(relation, "apple-touch-icon") {
						keepFirst(&appleIcon, href)
					}
				}
			}
		}
		// AngleSharp keeps template contents in a separate fragment, not
		// among the element's children.
		if node.Type == html.ElementNode && node.Namespace == "" && node.Data == "template" {
			continue
		}
		sel := top.sel
		if node.Type == html.ElementNode && node.Namespace == "" {
			switch {
			case node.Data == "select" && (sel == nil || sel.closed):
				sel = &selectState{}
			case sel.drops() && (node.Data == "option" || node.Data == "optgroup" || node.Data == "button"):
				sel = &selectState{open: true}
			}
		}
		var children []*html.Node
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			children = append(children, child)
		}
		for i := len(children) - 1; i >= 0; i-- {
			stack = append(stack, frame{children[i], top.depth + 1, sel})
		}
	}
	return build(base,
		firstNonEmpty(ogTitle, twitterTitle, title),
		firstNonEmpty(ogDescription, twitterDescription, description),
		firstNonEmpty(ogImage, twitterImage),
		firstNonEmpty(icon, appleIcon))
}

// selectState stands in for AngleSharp 1.8.6's "in select" mode, which x/net
// does not have: x/net builds <select> by the customizable-select spec and
// keeps any element inside. AngleSharp drops a start tag (title, meta, link,
// div...) whose current node is the select itself, builds normally inside
// option, optgroup and button, and lets input, keygen or textarea close the
// select. unfurl-html.json pins the cases.
type selectState struct {
	open, closed bool
}

func (s *selectState) drops() bool {
	return s != nil && !s.open && !s.closed
}

// asciiLower stands in for ToLowerInvariant before a compare with an ASCII
// word: invariant casing keeps U+0130, where strings.ToLower makes it "i".
func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}

func build(base *dotnet.URI, title, description, image, favicon string) Metadata {
	domain := ""
	if base != nil {
		domain = strings.TrimPrefix(strings.ToLower(base.IdnHost), "www.")
		if favicon == "" {
			favicon = "/favicon.ico"
		}
	}
	return Metadata{
		Title:       title,
		Description: description,
		Image:       resolveURL(base, image),
		Favicon:     resolveURL(base, favicon),
		Domain:      domain,
	}
}

func resolveURL(base *dotnet.URI, reference string) string {
	if reference == "" {
		return ""
	}
	var resolved *dotnet.URI
	var ok bool
	if base == nil {
		resolved, ok = dotnet.ParseAbsoluteURI(reference)
	} else {
		resolved, ok = dotnet.ResolveURI(base, reference)
	}
	if !ok || !resolved.IsHTTP() || resolved.Host == "" {
		return ""
	}
	return resolved.AbsoluteURI
}

func attribute(node *html.Node, name string) string {
	for _, a := range node.Attr {
		if a.Namespace == "" && a.Key == name {
			return strings.TrimSpace(a.Val)
		}
	}
	return ""
}

func keepFirst(destination *string, value string) {
	if *destination == "" {
		*destination = strings.TrimSpace(value)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func textContent(node *html.Node) string {
	if node.Type == html.TextNode {
		return node.Data
	}
	var b bytes.Buffer
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return b.String()
}
