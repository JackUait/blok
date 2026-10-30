package blokdocs

// Degradation actions the runtime reports. The field stays an open string:
// a later runtime may add one.
const (
	ActionDropped  = "dropped"
	ActionDegraded = "degraded"
)

// Degradation is one construct a conversion could not carry.
type Degradation struct {
	Construct string `json:"construct"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
}

// MarkdownConversion is Markdown plus what did not survive it.
type MarkdownConversion struct {
	Markdown string        `json:"markdown"`
	Warnings []Degradation `json:"warnings"`
}

// PlainTextConversion is plain text plus what the reader made nothing of.
type PlainTextConversion struct {
	Text     string        `json:"text"`
	Warnings []Degradation `json:"warnings"`
}

// ImportConversion is an imported document, ready to store, and what the
// source could not carry. The warnings are not part of the document.
type ImportConversion struct {
	DocumentJSON string
	Warnings     []Degradation
}

// Validation answers whether Blok can read a document and whether it holds
// anything. Failure is set when the runtime could not answer.
type Validation struct {
	IsDocument             bool
	IsEmpty                bool
	BlockCount             int
	MalformedBlockCount    int
	UnrecognizedBlockTypes []string
	Failure                *Reason
}

// IsFullyUnderstood is a document with no malformed or unknown block.
func (v Validation) IsFullyUnderstood() bool {
	return v.IsDocument && v.MalformedBlockCount == 0 && len(v.UnrecognizedBlockTypes) == 0
}

// PageIndex is what a page document owns, references and says.
type PageIndex struct {
	Owners     []PageOwnerEdge `json:"owners"`
	Text       []PageTextEntry `json:"text"`
	References []PageReference `json:"references"`
}

// PageOwnerEdge is a page block that owns a sub-page.
type PageOwnerEdge struct {
	PageID        string `json:"pageId"`
	SourceBlockID string `json:"sourceBlockId"`
	Order         int    `json:"order"`
}

// PageTextEntry is one block's text. BlockID is nil for a block with no id.
type PageTextEntry struct {
	BlockID *string `json:"blockId"`
	Order   int     `json:"order"`
	Text    string  `json:"text"`
}

// PageReference is a link to a page. SourceBlockID is nil when no block id is known.
type PageReference struct {
	PageID        string  `json:"pageId"`
	SourceBlockID *string `json:"sourceBlockId"`
	Order         int     `json:"order"`
}

// PageInfo is what a host knows about one linked page. In a pages map, a nil
// *PageInfo means the page is missing; an id left out means unresolved.
type PageInfo struct {
	// Title is sent only when non-nil; an empty title is still sent.
	Title *string
	Icon  *PageIcon
	// NoAccess sends nothing else, and the page's href is never built.
	NoAccess bool
}

// PageIcon is an emoji or an image URL.
type PageIcon struct {
	image bool
	value string
}

// EmojiIcon is an emoji icon.
func EmojiIcon(emoji string) *PageIcon { return &PageIcon{value: emoji} }

// ImageIcon is an image icon. The HTML writes it as <img alt="">; Markdown drops it.
func ImageIcon(url string) *PageIcon { return &PageIcon{image: true, value: url} }

// IsImage reports an image icon.
func (i *PageIcon) IsImage() bool { return i.image }

// Value is the emoji or the URL.
func (i *PageIcon) Value() string { return i.value }
