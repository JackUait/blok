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
	document, err := html.Parse(strings.NewReader(text))
	if err != nil {
		return build(base, "", "", "", "")
	}
	type frame struct {
		node  *html.Node
		depth int
	}
	stack := []frame{{document, 0}}
	for len(stack) > 0 {
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		node := top.node
		if node.Type == html.ElementNode {
			if top.depth > maxOpenElementDepth {
				return build(base, "", "", "", "")
			}
			switch node.Data {
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
					relation = strings.ToLower(relation)
					if relation == "icon" {
						keepFirst(&icon, href)
					} else if strings.HasPrefix(relation, "apple-touch-icon") {
						keepFirst(&appleIcon, href)
					}
				}
			}
		}
		var children []*html.Node
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			children = append(children, child)
		}
		for i := len(children) - 1; i >= 0; i-- {
			stack = append(stack, frame{children[i], top.depth + 1})
		}
	}
	return build(base,
		firstNonEmpty(ogTitle, twitterTitle, title),
		firstNonEmpty(ogDescription, twitterDescription, description),
		firstNonEmpty(ogImage, twitterImage),
		firstNonEmpty(icon, appleIcon))
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
