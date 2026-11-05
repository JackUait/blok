package outbound

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"slices"
	"strconv"
	"strings"
)

// trustSetting is one entry of a certificate's macOS trust settings.
type trustSetting struct {
	policyName    string
	hasPolicyName bool
	result        int64
	hasResult     bool
}

// kSecTrustSettingsResult values.
const (
	trustRoot   = 1
	trustAsRoot = 2
	trustDeny   = 3
)

// decideTrust is rustls-native-certs' tls_trust_settings_for_certificate:
// the first entry for sslServer (or for no named policy) whose result is
// TrustRoot, TrustAsRoot or Deny decides; none means TrustRoot.
func decideTrust(settings []trustSetting) int64 {
	for _, s := range settings {
		if s.hasPolicyName && s.policyName != "sslServer" {
			continue
		}
		result := int64(trustRoot)
		if s.hasResult {
			result = s.result
		}
		if result == trustRoot || result == trustAsRoot || result == trustDeny {
			return result
		}
	}
	return trustRoot
}

// trustedAnchors is load_native_certs: domains run user, admin, system, and
// the first domain that lists a certificate decides it. certs maps SHA-1
// (upper hex, as the exports key them) to DER; a hash with no certificate
// is skipped. The anchors come out in hash order.
func trustedAnchors(domains []map[string][]trustSetting, certs map[string][]byte) [][]byte {
	decided := map[string]int64{}
	for _, domain := range domains {
		for hash, settings := range domain {
			if _, ok := certs[hash]; !ok {
				continue
			}
			if _, ok := decided[hash]; !ok {
				decided[hash] = decideTrust(settings)
			}
		}
	}
	hashes := make([]string, 0, len(decided))
	for hash, result := range decided {
		if result == trustRoot || result == trustAsRoot {
			hashes = append(hashes, hash)
		}
	}
	slices.Sort(hashes)
	anchors := make([][]byte, 0, len(hashes))
	for _, hash := range hashes {
		anchors = append(anchors, certs[hash])
	}
	return anchors
}

// parseTrustList reads the trustList of `security trust-settings-export`
// (an XML plist): each certificate's SHA-1 and its trust settings.
func parseTrustList(export []byte) (map[string][]trustSetting, error) {
	decoder := xml.NewDecoder(bytes.NewReader(export))
	decoder.Strict = false
	for {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		if start, ok := token.(xml.StartElement); ok && start.Name.Local == "dict" {
			root, err := plistDict(decoder)
			if err != nil {
				return nil, err
			}
			list, _ := root["trustList"].(map[string]any)
			out := map[string][]trustSetting{}
			for hash, entry := range list {
				fields, _ := entry.(map[string]any)
				var settings []trustSetting
				raw, _ := fields["trustSettings"].([]any)
				for _, item := range raw {
					dict, _ := item.(map[string]any)
					var s trustSetting
					s.policyName, s.hasPolicyName = dict["kSecTrustSettingsPolicyName"].(string)
					s.result, s.hasResult = dict["kSecTrustSettingsResult"].(int64)
					settings = append(settings, s)
				}
				out[hash] = settings
			}
			return out, nil
		}
	}
}

// plistValue reads the value whose start tag was just read.
func plistValue(decoder *xml.Decoder, start xml.StartElement) (any, error) {
	switch start.Name.Local {
	case "dict":
		return plistDict(decoder)
	case "array":
		var items []any
		for {
			token, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			switch t := token.(type) {
			case xml.StartElement:
				item, err := plistValue(decoder, t)
				if err != nil {
					return nil, err
				}
				items = append(items, item)
			case xml.EndElement:
				return items, nil
			}
		}
	case "integer":
		text, err := plistText(decoder)
		if err != nil {
			return nil, err
		}
		return strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	default:
		// string, data, date, true, false: only strings are read.
		text, err := plistText(decoder)
		if start.Name.Local != "string" {
			return nil, err
		}
		return text, err
	}
}

func plistDict(decoder *xml.Decoder) (map[string]any, error) {
	dict := map[string]any{}
	key := ""
	for {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		switch t := token.(type) {
		case xml.StartElement:
			if t.Name.Local == "key" {
				if key, err = plistText(decoder); err != nil {
					return nil, err
				}
				continue
			}
			value, err := plistValue(decoder, t)
			if err != nil {
				return nil, err
			}
			dict[key] = value
		case xml.EndElement:
			return dict, nil
		}
	}
}

// plistText reads the text up to the end of the element just started.
func plistText(decoder *xml.Decoder) (string, error) {
	var text strings.Builder
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return "", io.ErrUnexpectedEOF
		}
		if err != nil {
			return "", err
		}
		switch t := token.(type) {
		case xml.CharData:
			text.Write(t)
		case xml.EndElement:
			return text.String(), nil
		case xml.StartElement:
			// <true/> and <false/> have no text; nested tags do not occur.
			if err := decoder.Skip(); err != nil {
				return "", err
			}
		}
	}
}
