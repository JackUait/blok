package dotnet

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/rc4"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"
)

// The NTLMv2 and SPNEGO client .NET runs on macOS for a proxy's NTLM or
// Negotiate challenge: ManagedNtlmNegotiateAuthenticationPal and
// ManagedSpnegoNegotiateAuthenticationPal (System.Net.Security 10.0.11,
// decompiled, NegotiateAuthenticationPal.cs:645-1640). Pinned by C#'s
// AnswersAnNtlmChallengeAsSocketsHttpHandlerDoes. No LM, no NTLMv1, no
// Kerberos: without a ticket .NET offers NTLM only.

// errNtlmThrow is where .NET throws out of the handshake: the request
// fails without a status.
var errNtlmThrow = errors.New("proxy: the NTLM challenge cannot be read")

// kerberosOid is 1.2.840.113554.1.2.2's content.
const kerberosOid = "\x2a\x86\x48\x86\xf7\x12\x01\x02\x02"

const (
	// Unicode, TargetName, Sign, NTLM, AlwaysSign, NTLM2, TargetInfo,
	// Version, 128 and KeyExchange: sent, and required of the server.
	ntlmFlags uint32 = 0x62888215
	ntlmSeal  uint32 = 0x20
	ntlmSign  uint32 = 0x10
)

// ntlmVersion is 6.1.7600, revision 15.
var ntlmVersion = []byte{6, 1, 0xb0, 0x1d, 0, 0, 0, 0x0f}

var (
	ntlmOid   = []byte{0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a}
	spnegoOid = []byte{0x06, 0x06, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x02}
	signMagic = []byte("session key to client-to-server signing key magic constant\x00")
	sealMagic = []byte("session key to client-to-server sealing key magic constant\x00")
)

type ntlmAuth struct {
	user, domain, password, spn string
	workstation                 []byte
	negotiate                   bool
	random                      io.Reader
	now                         func() time.Time
	type1, mechList, exported   []byte
	// chosen is SPNEGO's mechanism picked by the server's answer.
	chosen bool
	// authenticated is set once a challenge is answered, as .NET sets it
	// before it reads the challenge.
	authenticated bool
}

// newNtlmAuth is NegotiateAuthentication for package NTLM or Negotiate;
// nil when .NET gives no token (a blank user or password).
func newNtlmAuth(negotiate bool, user, domain, password, spn string) *ntlmAuth {
	blank := func(s string) bool { return strings.TrimFunc(s, unicode.IsSpace) == "" }
	if blank(user) || blank(password) {
		return nil
	}
	return &ntlmAuth{
		user: user, domain: domain, password: password, spn: spn,
		workstation: utf16le(machineName()),
		negotiate:   negotiate,
		random:      rand.Reader,
		now:         time.Now,
	}
}

// machineName is Environment.MachineName on Unix: the host name up to
// its first dot.
func machineName() string {
	name, _ := os.Hostname()
	name, _, _ = strings.Cut(name, ".")
	return name
}

// initial is the first token: the Type 1, or SPNEGO's NegTokenInit around
// it with NTLM as the only mechanism.
func (a *ntlmAuth) initial() []byte {
	a.type1 = make([]byte, 40)
	copy(a.type1, "NTLMSSP\x00")
	a.type1[8] = 1
	binary.LittleEndian.PutUint32(a.type1[12:], ntlmFlags)
	copy(a.type1[32:], ntlmVersion)
	if !a.negotiate {
		return a.type1
	}
	a.mechList = der(0x30, ntlmOid)
	return der(0x60, spnegoOid, der(0xa0, der(0x30, der(0xa0, a.mechList), der(0xa2, der(0x04, a.type1)))))
}

// respond answers the server's challenge token: nil when .NET sends
// nothing more, errNtlmThrow when it throws.
func (a *ntlmAuth) respond(challenge []byte) ([]byte, error) {
	if !a.negotiate {
		a.authenticated = true
		return a.type3(challenge)
	}
	negState, mech, token, ok := readNegTokenResp(challenge)
	if !ok {
		return nil, nil
	}
	name := ""
	switch mech {
	case string(ntlmOid[2:]):
		name = "NTLM"
	case kerberosOid:
		name = "Kerberos"
	}
	if !a.chosen {
		// Kerberos would be a GSSAPI mechanism of its own: not ported.
		if name != "NTLM" {
			return nil, nil
		}
		a.chosen = true
	} else if name != "" && name != "NTLM" {
		return nil, nil
	}
	if len(token) == 0 {
		return nil, nil
	}
	type3, err := a.type3(token)
	if type3 == nil || err != nil {
		return nil, err
	}
	// RequestMic (3) leaves the handshake open.
	a.authenticated = negState != 3
	mic := ntlmSignature(a.exported, 0, a.mechList)
	return der(0xa1, der(0x30, der(0xa2, der(0x04, type3)), der(0xa3, der(0x04, mic)))), nil
}

// readNegTokenResp reads [1] { SEQ { [0] negState, [1] supportedMech,
// [2] responseToken, [3] mechListMIC } } in strict DER, each part
// optional and in order.
func readNegTokenResp(data []byte) (negState int, mech string, token []byte, ok bool) {
	negState = -1
	outer, rest, ok := derRead(data, 0xa1)
	if !ok || len(rest) != 0 {
		return 0, "", nil, false
	}
	fields, rest, ok := derRead(outer, 0x30)
	if !ok || len(rest) != 0 {
		return 0, "", nil, false
	}
	for i, tag := range []byte{0xa0, 0xa1, 0xa2, 0xa3} {
		if len(fields) == 0 || fields[0] != tag {
			continue
		}
		var inner, value []byte
		if inner, fields, ok = derRead(fields, tag); !ok {
			return 0, "", nil, false
		}
		if value, rest, ok = derRead(inner, [...]byte{0x0a, 0x06, 0x04, 0x04}[i]); !ok || len(rest) != 0 {
			return 0, "", nil, false
		}
		switch i {
		case 0:
			if len(value) == 0 || len(value) > 4 {
				return 0, "", nil, false
			}
			negState = int(int8(value[0]))
			for _, b := range value[1:] {
				negState = negState<<8 | int(b)
			}
		case 1:
			mech = string(value)
		case 2:
			token = value
		}
	}
	return negState, mech, token, len(fields) == 0
}

// type3 is ProcessChallenge.
func (a *ntlmAuth) type3(blob []byte) ([]byte, error) {
	if len(blob) < 56 {
		return nil, errNtlmThrow
	}
	if blob[8] != 2 || string(blob[:8]) != "NTLMSSP\x00" {
		return nil, nil
	}
	flags := binary.LittleEndian.Uint32(blob[20:])
	// TargetName is read, and can throw, before the flags are checked.
	if _, err := ntlmField(blob, 12); err != nil {
		return nil, err
	}
	if flags&ntlmFlags != ntlmFlags {
		return nil, nil
	}
	targetInfo, err := ntlmField(blob, 40)
	if err != nil {
		return nil, err
	}
	info, stamp, hasNbNames, err := a.targetInfo(targetInfo)
	if err != nil {
		return nil, err
	}
	if !hasNbNames && flags&(ntlmSign|ntlmSeal) != 0 {
		return nil, nil
	}
	user, domain := utf16le(a.user), utf16le(a.domain)
	message := make([]byte, 88, 88+24+48+len(info)+len(user)+len(domain)+len(a.workstation)+16)
	copy(message, "NTLMSSP\x00")
	message[8] = 3
	binary.LittleEndian.PutUint32(message[60:], ntlmFlags|flags&ntlmSeal)
	copy(message[64:], ntlmVersion)
	hash, err := ntowfv2(a.user, a.domain, a.password)
	if err != nil {
		return nil, err
	}
	clientChallenge := make([]byte, 8)
	if _, err := io.ReadFull(a.random, clientChallenge); err != nil {
		return nil, err
	}
	add := func(at int, data []byte) error {
		if len(data) > 32767 {
			return errNtlmThrow
		}
		binary.LittleEndian.PutUint16(message[at:], uint16(len(data)))
		binary.LittleEndian.PutUint16(message[at+2:], uint16(len(data)))
		binary.LittleEndian.PutUint32(message[at+4:], uint32(len(message)))
		message = append(message, data...)
		return nil
	}
	_ = add(12, make([]byte, 24))
	response := ntResponse(hash, blob[24:32], clientChallenge, stamp, info)
	if err := add(20, response); err != nil {
		return nil, err
	}
	for _, field := range []struct {
		at   int
		data []byte
	}{{36, user}, {28, domain}, {44, a.workstation}} {
		if err := add(field.at, field.data); err != nil {
			return nil, err
		}
	}
	exported := make([]byte, 16)
	if _, err := io.ReadFull(a.random, exported); err != nil {
		return nil, err
	}
	_ = add(52, rc4Transform(hmacMD5(hash, response[:16]), exported))
	mac := hmac.New(md5.New, exported)
	mac.Write(a.type1)
	mac.Write(blob)
	mac.Write(message)
	copy(message[72:], mac.Sum(nil))
	a.exported = exported
	return message, nil
}

// ntlmSignature is GetMIC (CalculateSignature) with the client signing
// key and a fresh client sealing RC4.
func ntlmSignature(exported []byte, sequence uint32, message []byte) []byte {
	signKey := md5.Sum(append(append([]byte(nil), exported...), signMagic...))
	sealKey := md5.Sum(append(append([]byte(nil), exported...), sealMagic...))
	signature := make([]byte, 16)
	binary.LittleEndian.PutUint32(signature, 1)
	binary.LittleEndian.PutUint32(signature[12:], sequence)
	mac := hmac.New(md5.New, signKey[:])
	mac.Write(signature[12:])
	mac.Write(message)
	copy(signature[4:12], rc4Transform(sealKey[:], mac.Sum(nil)[:8]))
	return signature
}

// ntlmField is GetField: the length and offset read as Int16, empty when
// the field is empty or runs past the message.
func ntlmField(blob []byte, at int) ([]byte, error) {
	length := int(int16(binary.LittleEndian.Uint16(blob[at:])))
	offset := int(int16(binary.LittleEndian.Uint16(blob[at+4:])))
	if length == 0 || offset+length > len(blob) {
		return nil, nil
	}
	if offset < 0 || length < 0 {
		return nil, errNtlmThrow
	}
	return blob[offset : offset+length], nil
}

// targetInfo is ProcessTargetInfo: the server's pairs without its target
// name and channel bindings, then the SPN (9), zero channel bindings (10),
// the MIC flag (6) and the end. The CONNECT conn carries no
// TransportContext, so the bindings are zero even to an https proxy. A
// dropped pair leaves the buffer longer than what was written, and then
// .NET returns its tail (AsSpan(offset)), which is kept.
func (a *ntlmAuth) targetInfo(info []byte) ([]byte, uint64, bool, error) {
	spn := utf16le(a.spn)
	if len(spn) > 32767 {
		return nil, 0, false, errNtlmThrow
	}
	out := make([]byte, len(info)+20+4+len(spn)+8)
	at := 0
	stamp := fileTime(a.now())
	nbComputer, nbDomain := false, false
	rest := info
	for len(rest) >= 4 {
		id := rest[0]
		length := int(rest[3])<<8 + int(rest[2])
		if id == 0 {
			break
		}
		if len(rest) < length+4 || id == 7 && len(rest) < 12 {
			return nil, 0, false, errNtlmThrow
		}
		switch id {
		case 7:
			// Eight bytes, whatever the pair's length says.
			value := int64(binary.LittleEndian.Uint64(rest[4:]))
			// DateTime.FromFileTimeUtc's range.
			if value < 0 || value > 2650467743999999999 {
				return nil, 0, false, errNtlmThrow
			}
			stamp = uint64(value)
		case 9, 10:
			rest = rest[length+4:]
			continue
		case 1:
			nbComputer = true
		case 2:
			nbDomain = true
		}
		at += copy(out[at:], rest[:length+4])
		rest = rest[length+4:]
	}
	out[at] = 9
	binary.LittleEndian.PutUint16(out[at+2:], uint16(len(spn)))
	copy(out[at+4:], spn)
	at += 4 + len(spn)
	out[at] = 10
	out[at+2] = 16
	at += 20
	out[at] = 6
	out[at+2] = 4
	out[at+4] = 2
	at += 8 + 4
	switch {
	case at == len(out):
		return out, stamp, nbComputer && nbDomain, nil
	case at > len(out):
		// No end pair in the server's list: AsSpan past the buffer.
		return nil, 0, false, errNtlmThrow
	}
	return append([]byte(nil), out[at:]...), stamp, nbComputer && nbDomain, nil
}

// fileTime is DateTime.ToFileTimeUtc: 100 ns ticks since 1601.
func fileTime(t time.Time) uint64 {
	const epoch = 116444736000000000
	return uint64(t.UnixNano()/100 + epoch)
}

// ntResponse is makeNtlm2ChallengeResponse: NTProofStr, then the blob
// (versions 1 and 1, the time, the client challenge, the target info and
// four zero bytes).
func ntResponse(hash, serverChallenge, clientChallenge []byte, stamp uint64, info []byte) []byte {
	response := make([]byte, 48+len(info))
	response[16], response[17] = 1, 1
	binary.LittleEndian.PutUint64(response[24:], stamp)
	copy(response[32:], clientChallenge)
	copy(response[44:], info)
	mac := hmac.New(md5.New, hash)
	mac.Write(serverChallenge)
	mac.Write(response[16:])
	copy(response, mac.Sum(nil))
	return response
}

// ntowfv2 is makeNtlm2Hash: HMAC-MD5 keyed by MD4 of the password, over
// the upper-cased user and the domain as is.
func ntowfv2(user, domain, password string) ([]byte, error) {
	if len(utf16.Encode([]rune(password))) > 128 {
		return nil, errNtlmThrow
	}
	key := md4(utf16le(password))
	return hmacMD5(key[:], utf16le(toUpperInvariant(user)+domain)), nil
}

// toUpperInvariant is string.ToUpperInvariant: the simple mapping, except
// that ı keeps its case (measured on .NET 10).
func toUpperInvariant(s string) string {
	return strings.Map(func(r rune) rune {
		if r == 'ı' {
			return r
		}
		return unicode.ToUpper(r)
	}, s)
}

func utf16le(s string) []byte {
	units := utf16.Encode([]rune(s))
	out := make([]byte, 2*len(units))
	for i, unit := range units {
		binary.LittleEndian.PutUint16(out[2*i:], unit)
	}
	return out
}

func hmacMD5(key, data []byte) []byte {
	mac := hmac.New(md5.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func rc4Transform(key, data []byte) []byte {
	cipher, err := rc4.NewCipher(key)
	if err != nil {
		panic(err)
	}
	out := make([]byte, len(data))
	cipher.XORKeyStream(out, data)
	return out
}

// der is one DER element: tag, the shortest length, then the content.
func der(tag byte, content ...[]byte) []byte {
	var body []byte
	for _, part := range content {
		body = append(body, part...)
	}
	out := []byte{tag}
	switch n := len(body); {
	case n < 0x80:
		out = append(out, byte(n))
	case n < 0x100:
		out = append(out, 0x81, byte(n))
	case n < 0x10000:
		out = append(out, 0x82, byte(n>>8), byte(n))
	default:
		out = append(out, 0x83, byte(n>>16), byte(n>>8), byte(n))
	}
	return append(out, body...)
}

// derRead reads one element with this tag in strict DER: its content and
// what follows it.
func derRead(data []byte, tag byte) ([]byte, []byte, bool) {
	if len(data) < 2 || data[0] != tag {
		return nil, nil, false
	}
	length, at := int(data[1]), 2
	if length >= 0x80 {
		count := length - 0x80
		if count == 0 || count > 3 || len(data) < 2+count || data[2] == 0 {
			return nil, nil, false
		}
		length = 0
		for _, b := range data[2 : 2+count] {
			length = length<<8 | int(b)
		}
		if length < 0x80 {
			return nil, nil, false
		}
		at += count
	}
	if len(data)-at < length {
		return nil, nil, false
	}
	return data[at : at+length], data[at+length:], true
}

// md4 is RFC 1320.
func md4(input []byte) [16]byte {
	message := make([]byte, ((len(input)+8)/64+1)*64)
	copy(message, input)
	message[len(input)] = 0x80
	binary.LittleEndian.PutUint64(message[len(message)-8:], uint64(len(input))*8)
	a, b, c, d := uint32(0x67452301), uint32(0xefcdab89), uint32(0x98badcfe), uint32(0x10325476)
	rotl := func(x uint32, s int) uint32 { return x<<s | x>>(32-s) }
	var x [16]uint32
	order := [16]int{0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15}
	for block := 0; block < len(message); block += 64 {
		for i := range x {
			x[i] = binary.LittleEndian.Uint32(message[block+4*i:])
		}
		aa, bb, cc, dd := a, b, c, d
		for i := range 16 {
			t := rotl(a+(b&c|^b&d)+x[i], [4]int{3, 7, 11, 19}[i%4])
			a, b, c, d = d, t, b, c
		}
		for i := range 16 {
			t := rotl(a+(b&c|b&d|c&d)+x[i%4*4+i/4]+0x5a827999, [4]int{3, 5, 9, 13}[i%4])
			a, b, c, d = d, t, b, c
		}
		for i := range 16 {
			t := rotl(a+(b^c^d)+x[order[i]]+0x6ed9eba1, [4]int{3, 9, 11, 15}[i%4])
			a, b, c, d = d, t, b, c
		}
		a, b, c, d = a+aa, b+bb, c+cc, d+dd
	}
	var digest [16]byte
	binary.LittleEndian.PutUint32(digest[0:], a)
	binary.LittleEndian.PutUint32(digest[4:], b)
	binary.LittleEndian.PutUint32(digest[8:], c)
	binary.LittleEndian.PutUint32(digest[12:], d)
	return digest
}
