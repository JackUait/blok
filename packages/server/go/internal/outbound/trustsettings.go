package outbound

import (
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"io"
	"slices"
	"strconv"
	"strings"
)

// The trust rules are trustd's, which C#'s SecTrust runs on macOS. Cited
// from apple-oss-distributions/Security at db15acbe6a7f:
//   - trust/trustd/SecTrustServer.c:260-285 (anchor source order) and
//     :641-669 (SecPathBuilderIsAnchor: the first source that anchors or
//     denies decides);
//   - trust/trustd/SecPolicyServer.c:3303-3346 (SecPVCMeetsConstraint),
//     :3359-3375 (SecPVCGetTrustSettingsResult: the first entry that
//     meets decides, whatever its result) and :3378-3423
//     (SecPVCIsAnchorPerConstraints: TrustRoot only for a self-signed
//     cert, TrustAsRoot only for one that is not, Deny denies);
//   - trust/trustd/SecCertificateSource.c:330-366 (a system anchor's
//     constraints end in TrustRoot) and :998-1021 (admin settings, when
//     present, replace the user's);
//   - OSX/libsecurity_keychain/lib/TrustSettings.cpp:1009-1128 (which
//     fields reach trustd: policy options do not, and an entry with none of
//     them is dropped);
//   - OSX/utilities/SecAppleAnchor.c:141-180, 590-606 (Apple's own roots,
//     checked before any trust setting);
//   - OSX/sec/Security/SecCertificate.c:6192-6222 (self-signed).

// trustSetting is one entry of a certificate's macOS trust settings.
type trustSetting struct {
	policyName    string
	hasPolicyName bool
	result        int64
	hasResult     bool
	// policyOID is kSecTrustSettingsPolicy, the OID's DER content bytes.
	policyOID []byte
	// constrained: whether the entry meets depends on the evaluation (a
	// hostname, the calling app, a key usage other than any), or a field
	// could not be read.
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

// keyUseAny is kSecTrustSettingsKeyUseAny, read as a 64-bit number.
const keyUseAny = 0xffffffff

// maxConstrained caps the evaluations tried for one certificate.
const maxConstrained = 10

// namesTLS is the policy part of SecPVCMeetsConstraint for an SSL server
// check (SecPVCContainsPolicy, SecPolicyServer.c:3041-3083): with both a
// name and an OID, both must be SSL's; with one, that one; with neither,
// it applies.
func (s trustSetting) namesTLS() bool {
	if s.hasPolicyName && s.policyName != "sslServer" {
		return false
	}
	return s.policyOID == nil || bytes.Equal(s.policyOID, sslPolicyOID)
}

type anchorVerdict int

const (
	passOn anchorVerdict = iota // the next anchor source decides
	anchored
	denied
)

// legacyVerdict is SecPVCIsAnchorPerConstraints over one list. meets says
// whether a constrained entry meets in this evaluation.
func legacyVerdict(settings []trustSetting, selfSigned bool, meets func(int) bool) anchorVerdict {
	if len(settings) == 0 {
		if selfSigned {
			return anchored
		}
		return passOn
	}
	result := int64(0) // kSecTrustSettingsResultInvalid: nothing met
	for i, s := range settings {
		if !s.namesTLS() || s.constrained && !meets(i) {
			continue
		}
		result = trustRoot
		if s.hasResult {
			result = s.result
		}
		break
	}
	switch {
	case selfSigned && result == trustRoot, !selfSigned && result == trustAsRoot:
		return anchored
	case result == trustDeny:
		return denied
	}
	return passOn
}

// trustedAnchors picks the anchors trustd would use for an SSL server
// check. certs maps SHA-1 (upper hex, as the exports key them) to DER;
// system holds the hashes of the system root keychain. Apple's roots
// anchor first. Then the trust settings: admin's list when admin lists the
// cert, else the user's. A list that neither anchors nor denies leaves it
// to the system roots, which anchor a self-signed cert. A cert whose
// constrained entries could go either way is an anchor only if it is one
// in every case, so the set never trusts more than trustd. The anchors
// come out in hash order.
func trustedAnchors(user, admin map[string][]trustSetting, system map[string]bool, certs map[string][]byte,
	selfSigned, apple func([]byte) bool) [][]byte {
	candidates := map[string]bool{}
	for _, domain := range []map[string][]trustSetting{user, admin} {
		for hash := range domain {
			candidates[hash] = true
		}
	}
	for hash := range system {
		candidates[hash] = true
	}
	var hashes []string
	for hash := range candidates {
		der, ok := certs[hash]
		if !ok {
			continue
		}
		if isAnchor(hash, der, user, admin, system, selfSigned, apple) {
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

func isAnchor(hash string, der []byte, user, admin map[string][]trustSetting, system map[string]bool,
	selfSigned, apple func([]byte) bool) bool {
	if apple(der) {
		return true
	}
	self := selfSigned(der)
	systemAnchor := system[hash] && self
	settings, listed := admin[hash]
	if !listed {
		settings, listed = user[hash]
	}
	if !listed {
		return systemAnchor
	}
	var open []int
	for i, s := range settings {
		if s.constrained && s.namesTLS() {
			open = append(open, i)
		}
	}
	if len(open) > maxConstrained {
		return false
	}
	for world := 0; world < 1<<len(open); world++ {
		meets := func(i int) bool {
			bit := slices.Index(open, i)
			return bit >= 0 && world&(1<<bit) != 0
		}
		switch legacyVerdict(settings, self, meets) {
		case anchored:
		case passOn:
			if !systemAnchor {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// parseTrustList reads the trustList of `security trust-settings-export`
// (an XML plist): each certificate's SHA-1 and its trust settings.
func parseTrustList(export []byte) (map[string][]trustSetting, error) {
	root, err := readPlistDict(export)
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
			if setting, ok := readSetting(item); ok {
				settings = append(settings, setting)
			}
		}
		out[hash] = settings
	}
	return out, nil
}

// copiedKeys are the fields TrustSettings::copyTrustSettings hands trustd
// (TrustSettings.cpp:1040-1123); an entry with none of them is dropped.
// Policy options are not among them.
var copiedKeys = []string{
	"kSecTrustSettingsPolicy", "kSecTrustSettingsApplication", "kSecTrustSettingsPolicyString",
	"kSecTrustSettingsAllowedError", "kSecTrustSettingsResult", "kSecTrustSettingsKeyUsage",
}

// readSetting reads one entry; ok is false for an entry trustd never sees.
// An entry or a field it cannot read is kept as constrained.
func readSetting(item any) (s trustSetting, ok bool) {
	dict, isDict := item.(map[string]any)
	if !isDict {
		return trustSetting{constrained: true}, true
	}
	if !slices.ContainsFunc(copiedKeys, func(key string) bool { _, has := dict[key]; return has }) {
		return trustSetting{}, false
	}
	s.policyName, s.hasPolicyName = dict["kSecTrustSettingsPolicyName"].(string)
	s.result, s.hasResult = dict["kSecTrustSettingsResult"].(int64)
	s.policyOID, _ = dict["kSecTrustSettingsPolicy"].([]byte)
	s.constrained = constrained(dict)
	for key, read := range map[string]bool{
		"kSecTrustSettingsPolicyName": s.hasPolicyName,
		"kSecTrustSettingsResult":     s.hasResult,
		"kSecTrustSettingsPolicy":     s.policyOID != nil,
	} {
		if _, present := dict[key]; present && !read {
			s.constrained = true
		}
	}
	return s, true
}

// constrained reports an entry whose match depends on the evaluation: a
// hostname (SecPVCContainsString), the calling app, or a key usage other
// than any (SecPVCContainsTrustSettingsKeyUsage, SecPolicyServer.c:3174-3227).
func constrained(dict map[string]any) bool {
	for _, key := range []string{"kSecTrustSettingsPolicyString", "kSecTrustSettingsApplication"} {
		if _, ok := dict[key]; ok {
			return true
		}
	}
	usage, ok := dict["kSecTrustSettingsKeyUsage"]
	return ok && usage != int64(keyUseAny)
}

// readPlistDict reads the top dict of an XML plist.
func readPlistDict(data []byte) (map[string]any, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	for {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		if start, ok := token.(xml.StartElement); ok && start.Name.Local == "dict" {
			return plistDict(decoder)
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

// deniedCerts are the hashes trustd denies in any role. It checks the leaf
// and every parent with SecPathBuilderIsAnchor (SecTrustServer.c:855-875,
// 910-925): Apple's roots are found first, then the legacy source, whose
// Deny makes a "denied anchor" that SecPVCCheckUsageConstraints fails
// (SecPolicyServer.c:3425-3440). A Deny does not depend on the cert being
// self-signed. A cert whose constrained entries deny in any case is in the
// set, so a chain is never trusted where trustd refuses it.
func deniedCerts(user, admin map[string][]trustSetting, certs map[string][]byte, apple func([]byte) bool) map[string]bool {
	out := map[string]bool{}
	for _, domain := range []map[string][]trustSetting{admin, user} {
		for hash := range domain {
			if der, ok := certs[hash]; ok && apple(der) {
				continue
			}
			settings, listed := admin[hash]
			if !listed {
				settings = user[hash]
			}
			if deniedInSomeCase(settings) {
				out[hash] = true
			}
		}
	}
	return out
}

func deniedInSomeCase(settings []trustSetting) bool {
	var open []int
	for i, s := range settings {
		if s.constrained && s.namesTLS() {
			open = append(open, i)
		}
	}
	if len(open) > maxConstrained {
		return true
	}
	for world := 0; world < 1<<len(open); world++ {
		meets := func(i int) bool {
			bit := slices.Index(open, i)
			return bit >= 0 && world&(1<<bit) != 0
		}
		if legacyVerdict(settings, false, meets) == denied {
			return true
		}
	}
	return false
}

// selfSigned is _SecCertificateIsSelfSigned (SecCertificate.c:6192-6222):
// the issuer is the subject, an authority key ID equals the subject key
// ID, and the cert's own key verifies its signature. Apple compares
// normalized names; the raw bytes here can only say no more often.
func selfSigned(der []byte) bool {
	certificate, err := x509.ParseCertificate(der)
	if err != nil || !bytes.Equal(certificate.RawIssuer, certificate.RawSubject) {
		return false
	}
	if len(certificate.AuthorityKeyId) > 0 && !bytes.Equal(certificate.AuthorityKeyId, certificate.SubjectKeyId) {
		return false
	}
	return certificate.CheckSignature(certificate.SignatureAlgorithm, certificate.RawTBSCertificate, certificate.Signature) == nil
}

// appleRoots are the SHA-256 digests of SecGetAppleTrustAnchors
// (SecAppleAnchor.c:141-180): Apple Root CA, G2, G3 and the two Platform
// Backport roots.
var appleRoots = map[[32]byte]bool{
	{0xb0, 0xb1, 0x73, 0x0e, 0xcb, 0xc7, 0xff, 0x45, 0x05, 0x14, 0x2c, 0x49, 0xf1, 0x29, 0x5e, 0x6e, 0xda, 0x6b, 0xca, 0xed, 0x7e, 0x2c, 0x68, 0xc5, 0xbe, 0x91, 0xb5, 0xa1, 0x10, 0x01, 0xf0, 0x24}: true,
	{0xc2, 0xb9, 0xb0, 0x42, 0xdd, 0x57, 0x83, 0x0e, 0x7d, 0x11, 0x7d, 0xac, 0x55, 0xac, 0x8a, 0xe1, 0x94, 0x07, 0xd3, 0x8e, 0x41, 0xd8, 0x8f, 0x32, 0x15, 0xbc, 0x3a, 0x89, 0x04, 0x44, 0xa0, 0x50}: true,
	{0x63, 0x34, 0x3a, 0xbf, 0xb8, 0x9a, 0x6a, 0x03, 0xeb, 0xb5, 0x7e, 0x9b, 0x3f, 0x5f, 0xa7, 0xbe, 0x7c, 0x4f, 0x5c, 0x75, 0x6f, 0x30, 0x17, 0xb3, 0xa8, 0xc4, 0x88, 0xc3, 0x65, 0x3e, 0x91, 0x79}: true,
	{0xfb, 0x3f, 0x6c, 0xf6, 0x94, 0x67, 0xb5, 0xfa, 0x9f, 0xfa, 0x2b, 0x3b, 0x39, 0x2b, 0x6e, 0x5e, 0x77, 0x5b, 0xbb, 0x09, 0xc7, 0x7b, 0x6e, 0x75, 0x9e, 0x90, 0x38, 0xe2, 0x6b, 0xbf, 0x90, 0x49}: true,
	{0xed, 0xa2, 0x3b, 0x3f, 0x22, 0x4f, 0x45, 0xe0, 0x95, 0x2f, 0x20, 0xe4, 0xd2, 0xb3, 0x3e, 0x00, 0x0d, 0x49, 0xc8, 0x04, 0x4c, 0x11, 0x68, 0xde, 0x47, 0xb4, 0x43, 0xcd, 0x2b, 0x35, 0x36, 0xdc}: true,
}

// appleRoot reports one of Apple's own roots, which no trust setting
// overrides: trustd checks them first, with no constraints.
func appleRoot(der []byte) bool { return appleRoots[sha256.Sum256(der)] }
