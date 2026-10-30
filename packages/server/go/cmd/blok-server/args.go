package main

import (
	"fmt"
	"strings"

	"github.com/JackUait/blok/packages/server/go/blokserver"
	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

const defaultTicketRateLimit = 60

// hostArguments is HostParseResult in the C# host.
type hostArguments struct {
	options                 blokserver.Options
	help                    bool
	err                     string
	secretFromFlag          bool
	docEndpointAuthFromFlag bool
}

// parseHostArguments is a hand port of HostArguments.Parse, not the flag
// package: Go's flag differs in its error text, in "---x", and in how an
// explicit empty secret wins over BLOK_SECRET.
func parseHostArguments(args []string, getenv func(string) string) hostArguments {
	options := blokserver.DefaultOptions()
	options.CollabDirectory = "./blok-collab"
	options.StorageDirectory = "./blok-uploads"
	options.UnfurlEnabled = true
	origins, publicURL := "", ""
	var rateLimit *int64
	result := hostArguments{}
	journalFromFlag, richTextFromFlag := false, false
	failed := func(message string) hostArguments { return hostArguments{err: message} }

	for index := 0; index < len(args); index++ {
		argument := args[index]
		if argument == "--" || len(argument) < 2 || argument[0] != '-' {
			break
		}
		nameAndValue := argument[1:]
		if argument[1] == '-' {
			nameAndValue = argument[2:]
		}
		name, inline, hasInline := strings.Cut(nameAndValue, "=")
		switch name {
		case "h", "help":
			return hostArguments{help: true}
		case "no-unfurl", "collab", "collab-journal":
			value := true
			if hasInline {
				parsed, ok := parseBool(inline)
				if !ok {
					return failed(fmt.Sprintf("invalid value %s for flag -%s: parse error", csQuote(inline), name))
				}
				value = parsed
			}
			switch name {
			case "no-unfurl":
				options.UnfurlEnabled = !value
			case "collab":
				options.CollabEnabled = value
			default:
				options.CollabJournal = value
				journalFromFlag = true
			}
			continue
		}
		if !isValueFlag(name) {
			return failed("flag provided but not defined: -" + name)
		}
		value := inline
		if !hasInline {
			if index+1 >= len(args) {
				return failed("flag needs an argument: -" + name)
			}
			index++
			value = args[index]
		}
		invalid := func() hostArguments {
			return failed(fmt.Sprintf("invalid value %s for flag -%s: parse error", csQuote(value), name))
		}
		switch name {
		case "listen":
			options.ListenAddress = value
		case "auth":
			options.Auth = value
		case "secret":
			options.Secret = value
			result.secretFromFlag = true
		case "allow-origin":
			origins = value
		case "storage-dir":
			options.StorageDirectory = value
		case "public-url":
			publicURL = value
		case "max-upload":
			parsed, ok := parseBaseZeroInt64(value)
			if !ok {
				return invalid()
			}
			options.MaxUploadBytes = parsed
		case "rate-limit":
			parsed, ok := parseBaseZeroInt64(value)
			if !ok {
				return invalid()
			}
			rateLimit = &parsed
		case "s3-endpoint":
			options.S3Endpoint = value
		case "s3-region":
			options.S3Region = value
		case "s3-bucket":
			options.S3Bucket = value
		case "s3-bucket-url":
			options.S3BucketURL = value
		case "s3-addressing":
			options.S3Addressing = value
		case "doc-endpoint":
			options.DocEndpoint = value
		case "doc-endpoint-auth":
			options.DocEndpointAuth = value
			result.docEndpointAuthFromFlag = true
		case "collab-dir":
			options.CollabDirectory = value
		case "collab-s3-prefix":
			options.CollabS3Prefix = value
		case "rich-text-fields":
			fields, ok := parseRichTextFields(value)
			if !ok {
				return invalid()
			}
			options.RichTextFields = fields
			richTextFromFlag = true
		}
	}

	options.AllowedOrigins = splitOrigins(origins)
	options.PublicURL = publicURL
	if publicURL == "" {
		options.PublicURL = defaultPublicURL(options.ListenAddress)
	}
	switch {
	case rateLimit != nil:
		options.RateLimitPerMinute = *rateLimit
	case options.Auth == "ticket":
		options.RateLimitPerMinute = defaultTicketRateLimit
	}
	if !result.secretFromFlag {
		options.Secret = getenv("BLOK_SECRET")
	}
	if !result.docEndpointAuthFromFlag {
		options.DocEndpointAuth = getenv("BLOK_DOC_ENDPOINT_AUTH")
	}
	if variable := getenv("BLOK_COLLAB_JOURNAL"); !journalFromFlag && variable != "" {
		journal, ok := parseBool(variable)
		if !ok {
			return failed(fmt.Sprintf("invalid value %s for BLOK_COLLAB_JOURNAL: parse error", csQuote(variable)))
		}
		options.CollabJournal = journal
	}
	if variable := getenv("BLOK_RICH_TEXT_FIELDS"); !richTextFromFlag && variable != "" {
		fields, ok := parseRichTextFields(variable)
		if !ok {
			return failed(fmt.Sprintf("invalid value %s for BLOK_RICH_TEXT_FIELDS: parse error", csQuote(variable)))
		}
		options.RichTextFields = fields
	}
	options.S3AccessKey = getenv("BLOK_S3_ACCESS_KEY")
	options.S3SecretKey = getenv("BLOK_S3_SECRET_KEY")
	result.options = options
	return result
}

// csQuote is C#'s "\"{value}\"": no escaping inside.
func csQuote(s string) string { return `"` + s + `"` }

func isValueFlag(name string) bool {
	switch name {
	case "listen", "auth", "secret", "allow-origin", "storage-dir", "public-url",
		"max-upload", "rate-limit", "s3-endpoint", "s3-region", "s3-bucket",
		"s3-bucket-url", "s3-addressing", "doc-endpoint", "doc-endpoint-auth",
		"collab-dir", "collab-s3-prefix", "rich-text-fields":
		return true
	}
	return false
}

// parseBool is Go's strconv.ParseBool set, which the C# host copies.
func parseBool(value string) (bool, bool) {
	switch value {
	case "1", "t", "T", "TRUE", "true", "True":
		return true, true
	case "0", "f", "F", "FALSE", "false", "False":
		return false, true
	}
	return false, false
}

// parseBaseZeroInt64 is TryParseBaseZeroInt64: strconv.ParseInt(s, 0, 64)'s
// grammar, written out so its refusals match the C# host's.
func parseBaseZeroInt64(value string) (int64, bool) {
	if value == "" {
		return 0, false
	}
	index, negative := 0, false
	if value[0] == '+' || value[0] == '-' {
		negative = value[0] == '-'
		index++
		if index == len(value) {
			return 0, false
		}
	}
	base, explicitPrefix := uint64(10), false
	if value[index] == '0' {
		base = 8
		if index+1 < len(value) {
			switch value[index+1] {
			case 'b', 'B':
				base, explicitPrefix = 2, true
			case 'o', 'O':
				base, explicitPrefix = 8, true
			case 'x', 'X':
				base, explicitPrefix = 16, true
			}
			if explicitPrefix {
				index += 2
			}
		}
	}
	digitsStart, digitSeen, previousUnderscore := index, false, false
	limit := uint64(1<<63 - 1)
	if negative {
		limit = 1 << 63
	}
	var magnitude uint64
	for ; index < len(value); index++ {
		c := value[index]
		if c == '_' {
			followsPrefix := explicitPrefix && !digitSeen && index == digitsStart
			next := -1
			if index+1 < len(value) {
				next = digit(value[index+1])
			}
			if (!digitSeen && !followsPrefix) || previousUnderscore || next < 0 || uint64(next) >= base {
				return 0, false
			}
			previousUnderscore = true
			continue
		}
		d := digit(c)
		if d < 0 || uint64(d) >= base || magnitude > (limit-uint64(d))/base {
			return 0, false
		}
		magnitude = magnitude*base + uint64(d)
		digitSeen, previousUnderscore = true, false
	}
	if !digitSeen {
		return 0, false
	}
	if negative {
		return int64(-magnitude), true
	}
	return int64(magnitude), true
}

func digit(c byte) int {
	switch {
	case '0' <= c && c <= '9':
		return int(c - '0')
	case 'a' <= c && c <= 'z':
		return int(c-'a') + 10
	case 'A' <= c && c <= 'Z':
		return int(c-'A') + 10
	}
	return -1
}

// parseRichTextFields is TryParseRichTextFields: a JSON object of string
// lists. A repeated key is refused, as JsonNode refuses it.
func parseRichTextFields(value string) (map[string][]string, bool) {
	node, err := jsjson.ParseNode([]byte(value), jsjson.Options{RefuseDuplicates: true})
	if err != nil || node.Kind != jsjson.KindObject {
		return nil, false
	}
	fields := map[string][]string{}
	for _, member := range node.Members {
		key, err := member.Key()
		if err != nil || member.Value.Kind != jsjson.KindArray {
			return nil, false
		}
		list := []string{}
		for _, item := range member.Value.Items {
			if item.Kind != jsjson.KindString {
				return nil, false
			}
			text, err := item.Text()
			if err != nil {
				return nil, false
			}
			list = append(list, text.String())
		}
		fields[key.String()] = list
	}
	return fields, true
}

func splitOrigins(value string) []string {
	origins := []string{}
	for _, origin := range strings.Split(value, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func defaultPublicURL(listen string) string {
	host, port := splitListenAddress(listen)
	if host == "" || host == "*" || host == "+" {
		host = "127.0.0.1"
	} else if address, ok := dotnet.ParseIP(host); ok && dotnet.IsAny(address) {
		host = "127.0.0.1"
	}
	authority := host
	if strings.Contains(host, ":") {
		authority = "[" + host + "]"
	}
	if port != "" {
		authority += ":" + port
	}
	return "http://" + authority + "/files"
}

func splitListenAddress(listen string) (host, port string) {
	if strings.HasPrefix(listen, "[") {
		if bracket := strings.IndexByte(listen, ']'); bracket >= 0 {
			if bracket+1 < len(listen) && listen[bracket+1] == ':' {
				port = listen[bracket+2:]
			}
			return listen[1:bracket], port
		}
	}
	first, last := strings.IndexByte(listen, ':'), strings.LastIndexByte(listen, ':')
	if first >= 0 && first == last {
		return listen[:first], listen[first+1:]
	}
	return strings.Trim(listen, "[]"), ""
}
