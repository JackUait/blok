package outbound

import (
	"bytes"
	"encoding/base64"
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
	// policyOID is kSecTrustSettingsPolicy, the OID's DER content bytes.
	policyOID []byte
	// constrained: a hostname, application, key usage or policy options
	// rule, which a fixed root set cannot check.
	constrained bool
}

// kSecTrustSettingsResult values.
const (
	trustRoot   = 1
	trustAsRoot = 2
	trustDeny   = 3
)

// sslPolicyOID is kSecPolicyAppleSSL, 1.2.840.113635.100.1.3: the OID an
// SSL server check compares with (SecPolicyGetCompatibilityOidString).
var sslPolicyOID = []byte{0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x01, 0x03}

// keyUseAny is kSecTrustSettingsKeyUseAny.
const keyUseAny = 0xffffffff

// appliesToTLS is trustd's SecPVCMeetsConstraint for an SSL server check
// (SecPolicyServer.c): with both a name and an OID, both must be SSL's;
// with one, that one; with neither, it applies.
func (s trustSetting) appliesToTLS() bool {
	if s.constrained {
		return false
	}
	hasOID := s.policyOID != nil
	if s.hasPolicyName && s.policyName != "sslServer" {
		return false
	}
	return !hasOID || bytes.Equal(s.policyOID, sslPolicyOID)
}

// decideTrust is trustd's SecPVCGetTrustSettingsResult: an empty list
// trusts; else the first entry that applies decides, no result meaning
// TrustRoot. decided is false when no entry applies or the result is
// Unspecified or unknown, so the next domain decides.
func decideTrust(settings []trustSetting) (result int64, decided bool) {
	if len(settings) == 0 {
		return trustRoot, true
	}
	for _, s := range settings {
		if !s.appliesToTLS() {
			continue
		}
		result = trustRoot
		if s.hasResult {
			result = s.result
		}
		return result, result == trustRoot || result == trustAsRoot || result == trustDeny
	}
	return 0, false
}

// trustedAnchors runs the domains user, admin, system; the first domain
// whose settings decide a certificate decides it. certs maps SHA-1 (upper
// hex, as the exports key them) to DER; a hash with no certificate is
// skipped. The anchors come out in hash order.
func trustedAnchors(domains []map[string][]trustSetting, certs map[string][]byte) [][]byte {
	decided := map[string]int64{}
	for _, domain := range domains {
		for hash, settings := range domain {
			if _, ok := certs[hash]; !ok {
				continue
			}
			if _, ok := decided[hash]; ok {
				continue
			}
			if result, ok := decideTrust(settings); ok {
				decided[hash] = result
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
					s.policyOID, _ = dict["kSecTrustSettingsPolicy"].([]byte)
					s.constrained = constrained(dict)
					settings = append(settings, s)
				}
				out[hash] = settings
			}
			return out, nil
		}
	}
}

// constrained reports a rule trustd checks per evaluation: a hostname, the
// calling app, policy options, or a key usage other than any.
func constrained(dict map[string]any) bool {
	for _, key := range []string{"kSecTrustSettingsPolicyString", "kSecTrustSettingsApplication", "kSecTrustSettingsPolicyOptions"} {
		if _, ok := dict[key]; ok {
			return true
		}
	}
	usage, ok := dict["kSecTrustSettingsKeyUsage"]
	return ok && usage != int64(keyUseAny) && usage != int64(-1)
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
	case "data":
		text, err := plistText(decoder)
		if err != nil {
			return nil, err
		}
		return base64.StdEncoding.DecodeString(strings.Join(strings.Fields(text), ""))
	default:
		// string, date, true, false: only strings are read.
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
