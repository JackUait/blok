package dotnet

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"strings"
)

// AuthenticationHelper's Digest (System.Net.Http 10.0.11, decompiled),
// for a CONNECT: the request URI is the proxy's, so uri is "/" and A2 is
// "CONNECT:/". Pinned by C#'s AnswersADigestChallengeAsSocketsHttpHandlerDoes.

// parseDigest is DigestResponse.Parse. Keys match without case; realm,
// nonce, opaque and qop must be quoted, and parsing stops at the first
// pair that breaks the rules. A key seen twice is refused, as
// Dictionary.Add throws.
func parseDigest(challenge string) (map[string]string, bool) {
	parameters := map[string]string{}
	i := 0
	for i < len(challenge) {
		key, next := digestKey(challenge, i)
		i = next
		if key == "" || i >= len(challenge) {
			break
		}
		lower := strings.ToLower(key)
		quoted := lower == "realm" || lower == "nonce" || lower == "opaque" || lower == "qop"
		value, ok, next := digestValue(challenge, i, quoted)
		i = next
		if !ok || value == "" && lower != "opaque" && lower != "domain" && lower != "realm" {
			break
		}
		if _, seen := parameters[lower]; seen {
			return nil, false
		}
		parameters[lower] = value
	}
	return parameters, true
}

func spaceOrTab(c byte) bool { return c == ' ' || c == '\t' }

// digestKey is GetNextKey: "" when no '=' follows the key.
func digestKey(data string, i int) (string, int) {
	for i < len(data) && spaceOrTab(data[i]) {
		i++
	}
	start := i
	for i < len(data) && data[i] != '=' && !spaceOrTab(data[i]) {
		i++
	}
	if i == len(data) {
		return "", i
	}
	end := i
	if spaceOrTab(data[i]) {
		for i < len(data) && spaceOrTab(data[i]) {
			i++
		}
		if i == len(data) || data[i] != '=' {
			return "", i
		}
	}
	for i < len(data) && (spaceOrTab(data[i]) || data[i] == '=') {
		i++
	}
	return data[start:end], i
}

// digestValue is GetNextValue.
func digestValue(data string, i int, expectQuotes bool) (string, bool, int) {
	quoted := false
	if data[i] == '"' {
		quoted = true
		i++
	}
	if expectQuotes && !quoted {
		return "", false, i
	}
	var b strings.Builder
	for i < len(data) && (quoted && data[i] != '"' || !quoted && data[i] != ',') {
		b.WriteByte(data[i])
		i++
		if i == len(data) || !quoted && spaceOrTab(data[i]) {
			break
		}
		if quoted && data[i] == '"' && data[i-1] == '\\' {
			b.WriteByte(data[i])
			i++
		}
	}
	if quoted {
		i++
	}
	for i < len(data) && spaceOrTab(data[i]) {
		i++
	}
	if i >= len(data) {
		return b.String(), true, i
	}
	if data[i] != ',' {
		return "", false, i + 1
	}
	i++
	for i < len(data) && spaceOrTab(data[i]) {
		i++
	}
	return b.String(), true, i
}

// digestToken is GetDigestTokenForCredential for a CONNECT; "" when .NET
// gives no token (an algorithm it lacks, no nonce, no realm).
func digestToken(user, password string, parameters map[string]string) string {
	algorithm, specified := parameters["algorithm"]
	if specified {
		switch strings.ToLower(algorithm) {
		case "sha-256", "md5", "sha-256-sess", "md5-sess":
		default:
			return ""
		}
	} else {
		algorithm = "MD5"
	}
	nonce, ok := parameters["nonce"]
	if !ok {
		return ""
	}
	realm, ok := parameters["realm"]
	if !ok {
		return ""
	}
	opaque, hasOpaque := parameters["opaque"]
	hash := func(data string) string {
		if len(algorithm) >= 7 && strings.EqualFold(algorithm[:7], "SHA-256") {
			sum := sha256.Sum256([]byte(data))
			return hex.EncodeToString(sum[:])
		}
		sum := md5.Sum([]byte(data))
		return hex.EncodeToString(sum[:])
	}
	var b strings.Builder
	pair := func(key, value string, quotes, comma bool) {
		b.WriteString(key + "=")
		if quotes {
			b.WriteString(`"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value) + `"`)
		} else {
			b.WriteString(value)
		}
		if comma {
			b.WriteString(", ")
		}
	}
	if userhash := parameters["userhash"]; userhash == "true" {
		pair("username", hash(user+":"+realm), true, true)
		pair("userhash", userhash, false, true)
	} else if !isASCII(user) {
		pair("username*", encode5987(user), false, true)
	} else {
		pair("username", user, true, true)
	}
	pair("realm", realm, true, true)
	pair("nonce", nonce, true, true)
	pair("uri", "/", true, true)
	qop := "auth"
	offered, hasQop := parameters["qop"]
	if hasQop {
		if at := strings.Index(offered, "auth-int"); at != -1 && strings.Index(offered, "auth") == at &&
			!strings.Contains(offered[at+len("auth-int"):], "auth") {
			qop = "auth-int"
		}
	}
	cnonce := randomAlphaNumeric(16)
	a1 := user + ":" + realm + ":" + password
	if len(algorithm) >= 4 && strings.EqualFold(algorithm[len(algorithm)-4:], "sess") {
		a1 = hash(a1) + ":" + nonce + ":" + cnonce
	}
	a2 := "CONNECT:/"
	if qop == "auth-int" {
		// A CONNECT has no content.
		a2 += ":" + hash("")
	}
	response := hash(hash(a1) + ":" + nonce + ":" + hash(a2))
	if hasQop {
		response = hash(hash(a1) + ":" + nonce + ":00000001:" + cnonce + ":" + qop + ":" + hash(a2))
	}
	pair("response", response, true, hasOpaque || specified || hasQop)
	if hasOpaque {
		pair("opaque", opaque, true, specified || hasQop)
	}
	if specified {
		pair("algorithm", algorithm, false, hasQop)
	}
	if hasQop {
		pair("qop", qop, false, true)
		pair("nc", "00000001", false, true)
		pair("cnonce", cnonce, true, false)
	}
	return b.String()
}

// encode5987 is HeaderUtilities.Encode5987: utf-8” and the attr-chars,
// anything else as %XX.
func encode5987(s string) string {
	const attr = "!#$&+-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ^_`abcdefghijklmnopqrstuvwxyz|~"
	var b strings.Builder
	b.WriteString("utf-8''")
	for i := 0; i < len(s); i++ {
		if strings.IndexByte(attr, s[i]) >= 0 {
			b.WriteByte(s[i])
		} else {
			b.WriteString("%" + strings.ToUpper(hex.EncodeToString([]byte{s[i]})))
		}
	}
	return b.String()
}

// randomAlphaNumeric is GetRandomAlphaNumericString: n chars drawn
// evenly from the 62 letters and digits.
func randomAlphaNumeric(n int) string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	out := make([]byte, n)
	for i := range out {
		v, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			panic(err)
		}
		out[i] = alphabet[v.Int64()]
	}
	return string(out)
}
