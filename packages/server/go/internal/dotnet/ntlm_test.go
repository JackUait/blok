package dotnet

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rc4"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf16"
)

func fromHex(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

func TestMd4MatchesRfc1320(t *testing.T) {
	for input, want := range map[string]string{
		"":                           "31d6cfe0d16ae931b73c59d7e0c089c0",
		"a":                          "bde52cb31de33e46245e05fbdbd6fb24",
		"abc":                        "a448017aaf21d8525fc10ae87aa6729d",
		"abcdefghijklmnopqrstuvwxyz": "d79e1c308aa5bbcdeea8ed63df412da9",
		"12345678901234567890123456789012345678901234567890123456789012345678901234567890": "e33b4ddc9c38f2199c3e7b164fcc0536",
	} {
		if got := md4([]byte(input)); hex.EncodeToString(got[:]) != want {
			t.Errorf("md4(%q) = %x, want %s", input, got, want)
		}
	}
}

// MS-NLMP 4.2.4: User, Domain, Password, server challenge 0123456789abcdef,
// client challenge aa x 8, time 0, random session key 55 x 16.
func TestNtlmMatchesTheMsNlmpNtlmv2Vectors(t *testing.T) {
	hash, err := ntowfv2("User", "Domain", "Password")
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(hash); got != "0c868a403bfd7a93a3001ef22ef02e3f" {
		t.Errorf("NTOWFv2 %s", got)
	}
	info := fromHex("02000c0044006f006d00610069006e0001000c005300650072007600650072000000000000")[:36]
	response := ntResponse(hash, fromHex("0123456789abcdef"), bytes.Repeat([]byte{0xaa}, 8), 0, info)
	if got := hex.EncodeToString(response); got != "68cd0ab851e51c96aabc927bebef6a1c01010000000000000000000000000000aaaaaaaaaaaaaaaa0000000002000c0044006f006d00610069006e0001000c005300650072007600650072000000000000000000" {
		t.Errorf("NtChallengeResponse %s", got)
	}
	base := hmacMD5(hash, response[:16])
	if got := hex.EncodeToString(base); got != "8de40ccadbc14a82f15cb0ad0de95ca3" {
		t.Errorf("SessionBaseKey %s", got)
	}
	exported := bytes.Repeat([]byte{0x55}, 16)
	if got := hex.EncodeToString(rc4Transform(base, exported)); got != "c5dad2544fc9799094ce1ce90bc9d03e" {
		t.Errorf("EncryptedRandomSessionKey %s", got)
	}
	// 4.2.4.4: the seal RC4 runs over the 18 plaintext bytes first, so the
	// checksum sits at keystream offset 18.
	sealKey := md5.Sum(append(append([]byte(nil), exported...), sealMagic...))
	signKey := md5.Sum(append(append([]byte(nil), exported...), signMagic...))
	if hex.EncodeToString(sealKey[:]) != "59f600973cc4960a25480a7c196e4c58" || hex.EncodeToString(signKey[:]) != "4788dc861b4782f35d43fd98fe1a2d39" {
		t.Errorf("keys %x %x", sealKey, signKey)
	}
	plaintext := utf16le("Plaintext")
	mac := hmac.New(md5.New, signKey[:])
	mac.Write([]byte{0, 0, 0, 0})
	mac.Write(plaintext)
	checksum := mac.Sum(nil)[:8]
	stream := rc4Transform(sealKey[:], append(append([]byte(nil), plaintext...), checksum...))
	if got := hex.EncodeToString(stream); got != "54e50165bf1936dc996020c1811b0f06fb5f"+"7fb38ec5c55d4976" {
		t.Errorf("seal %s", got)
	}
	// GetMIC is the same checksum on a fresh RC4.
	signature := ntlmSignature(exported, 0, plaintext)
	if want := "01000000" + hex.EncodeToString(rc4Transform(sealKey[:], checksum)) + "00000000"; hex.EncodeToString(signature) != want {
		t.Errorf("signature %x, want %s", signature, want)
	}
}

// The verifying proxy of C#'s AnswersAnNtlmChallengeAsSocketsHttpHandlerDoes.
var (
	ntlmServerChallenge = []byte{0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef}
	ntlmFixedTime       = []byte{0x00, 0x80, 0x3e, 0xd5, 0xde, 0xb1, 0x9d, 0x01}
)

const (
	ntlmTestType1  = "4e544c4d535350000100000015828862000000000000000000000000000000000601b01d0000000f"
	ntlmSpnegoInit = "604806062b0601050502a03e303ca00e300c060a2b06010401823702020aa22a04284e544c4d535350000100000015828862000000000000000000000000000000000601b01d0000000f"
	ntlmServerAvs  = "2:44004f004d00410049004e00,1:530045005200560045005200,4:64006f006d00610069006e002e007400650073007400,3:7300650072007600650072002e0064006f006d00610069006e002e007400650073007400,7:00803ed5deb19d01,"
)

func avPair(id int, value []byte) []byte {
	pair := make([]byte, 4, 4+len(value))
	binary.LittleEndian.PutUint16(pair, uint16(id))
	binary.LittleEndian.PutUint16(pair[2:], uint16(len(value)))
	return append(pair, value...)
}

func testUTF16(s string) []byte {
	units := utf16.Encode([]rune(s))
	out := make([]byte, 2*len(units))
	for i, u := range units {
		binary.LittleEndian.PutUint16(out[2*i:], u)
	}
	return out
}

func fromUTF16(b []byte) string {
	units := make([]uint16, len(b)/2)
	for i := range units {
		units[i] = binary.LittleEndian.Uint16(b[2*i:])
	}
	return string(utf16.Decode(units))
}

func testType2(mode string) []byte {
	var info []byte
	info = append(info, avPair(2, testUTF16("DOMAIN"))...)
	if mode != "no-nb" {
		info = append(info, avPair(1, testUTF16("SERVER"))...)
	}
	info = append(info, avPair(4, testUTF16("domain.test"))...)
	info = append(info, avPair(3, testUTF16("server.domain.test"))...)
	info = append(info, avPair(7, ntlmFixedTime)...)
	if mode == "av9" {
		info = append(info, avPair(9, testUTF16("HTTP/x"))...)
	}
	info = append(info, 0, 0, 0, 0)
	name := testUTF16("DOMAIN")
	message := make([]byte, 56, 56+len(name)+len(info))
	copy(message, "NTLMSSP\x00")
	message[8] = 2
	binary.LittleEndian.PutUint16(message[12:], uint16(len(name)))
	binary.LittleEndian.PutUint16(message[14:], uint16(len(name)))
	binary.LittleEndian.PutUint32(message[16:], 56)
	flags := uint32(0x62898215)
	if mode == "flags" {
		flags &^= 0x40000000
	}
	binary.LittleEndian.PutUint32(message[20:], flags)
	copy(message[24:], ntlmServerChallenge)
	binary.LittleEndian.PutUint16(message[40:], uint16(len(info)))
	binary.LittleEndian.PutUint16(message[42:], uint16(len(info)))
	binary.LittleEndian.PutUint32(message[44:], uint32(56+len(name)))
	copy(message[48:], []byte{0x0a, 0x00, 0x63, 0x45, 0, 0, 0, 0x0f})
	message = append(message, name...)
	return append(message, info...)
}

// testDer reads one element: tag, content, the rest.
func testDer(data []byte) (byte, []byte, []byte) {
	tag, length, at := data[0], int(data[1]), 2
	if length > 0x80 {
		count := length - 0x80
		length = 0
		for _, b := range data[2 : 2+count] {
			length = length<<8 | int(b)
		}
		at += count
	}
	return tag, data[at : at+length], data[at+length:]
}

func testDerWrap(tag byte, content []byte) []byte {
	switch n := len(content); {
	case n < 0x80:
		return append([]byte{tag, byte(n)}, content...)
	case n < 0x100:
		return append([]byte{tag, 0x81, byte(n)}, content...)
	default:
		return append([]byte{tag, 0x82, byte(n >> 8), byte(n)}, content...)
	}
}

func spnegoChallenge(type2 []byte) []byte {
	var seq []byte
	seq = append(seq, testDerWrap(0xa0, []byte{0x0a, 0x01, 0x01})...)
	seq = append(seq, testDerWrap(0xa1, fromHex("060a2b06010401823702020a"))...)
	seq = append(seq, testDerWrap(0xa2, testDerWrap(0x04, type2))...)
	return testDerWrap(0xa1, testDerWrap(0x30, seq))
}

type ntlmProxyState struct{ type1, type2, mechList []byte }

func testHMAC(key []byte, parts ...[]byte) []byte {
	mac := hmac.New(md5.New, key)
	for _, part := range parts {
		mac.Write(part)
	}
	return mac.Sum(nil)
}

func testRC4(key, data []byte) []byte {
	c, _ := rc4.NewCipher(key)
	out := make([]byte, len(data))
	c.XORKeyStream(out, data)
	return out
}

func testField(m []byte, at int) (string, int, int) {
	length := int(binary.LittleEndian.Uint16(m[at:]))
	offset := int(binary.LittleEndian.Uint32(m[at+4:]))
	if offset+length > len(m) {
		return "?", length, offset
	}
	return fromUTF16(m[offset : offset+length]), length, offset
}

func isZero(b []byte) bool { return bytes.Count(b, []byte{0}) == len(b) }

// readNtlmToken is C#'s ReadNtlm. upper is the user as ToUpperInvariant
// gives it, from C#'s NtlmUpperCasesTheUserAsToUpperInvariant.
func readNtlmToken(scheme string, token []byte, state *ntlmProxyState, password string, upper map[string]string) (string, bool) {
	inner, spnego := token, ""
	var mechListMic []byte
	if scheme == "Negotiate" {
		if token[0] == 0x60 {
			_, app, _ := testDer(token)
			_, _, rest := testDer(app)
			_, a0, _ := testDer(rest)
			_, init, _ := testDer(a0)
			_, mechTypes, rest := testDer(init)
			tag, list, _ := testDer(mechTypes)
			state.mechList = testDerWrap(tag, list)
			_, a2, _ := testDer(rest)
			_, inner, _ = testDer(a2)
			spnego = "init " + hex.EncodeToString(token) + " mechs=" + hex.EncodeToString(state.mechList) + " "
		} else {
			_, a1, _ := testDer(token)
			_, resp, _ := testDer(a1)
			tag, first, rest := testDer(resp)
			_, inner, _ = testDer(first)
			tags := fmt.Sprintf("%02x/%02x/%02x:%02x", token[0], a1[0], tag, first[0])
			if len(rest) > 0 {
				tag, second, _ := testDer(rest)
				_, mechListMic, _ = testDer(second)
				tags += fmt.Sprintf(",%02x:%02x", tag, second[0])
			}
			spnego = "resp " + tags + " "
		}
	}
	if inner[8] == 1 {
		state.type1 = inner
		return scheme + " " + spnego + "T1 " + hex.EncodeToString(inner), false
	}
	t3 := inner
	_, lmLen, lmOff := testField(t3, 12)
	_, ntLen, ntOff := testField(t3, 20)
	dom, _, domOff := testField(t3, 28)
	user, _, userOff := testField(t3, 36)
	ws, wsLen, wsOff := testField(t3, 44)
	_, keyLen, keyOff := testField(t3, 52)
	flags := binary.LittleEndian.Uint32(t3[60:])
	response := t3[ntOff : ntOff+ntLen]
	blob := response[16:]
	up, ok := upper[user]
	if !ok {
		up = strings.ToUpper(user)
	}
	key := md4(testUTF16(password))
	ntowf := testHMAC(key[:], testUTF16(up+dom))
	proof := testHMAC(ntowf, ntlmServerChallenge, blob)
	proofOk := bytes.Equal(proof, response[:16])
	exported := testRC4(testHMAC(ntowf, proof), t3[keyOff:keyOff+keyLen])
	zeroed := append([]byte(nil), t3...)
	clear(zeroed[72:88])
	micOk := bytes.Equal(testHMAC(exported, state.type1, state.type2, zeroed), t3[72:88])
	var avs []string
	cbtOk := true
	for at := 28; at+4 <= len(blob); {
		id := int(binary.LittleEndian.Uint16(blob[at:]))
		length := int(binary.LittleEndian.Uint16(blob[at+2:]))
		value := blob[at+4 : at+4+min(length, len(blob)-at-4)]
		switch id {
		case 10:
			cbtOk = len(value) == 16 && isZero(value)
			if cbtOk {
				avs = append(avs, "10:zero")
			} else {
				avs = append(avs, "10:"+hex.EncodeToString(value))
			}
		case 9:
			avs = append(avs, "9:"+fromUTF16(value))
		default:
			avs = append(avs, strconv.Itoa(id)+":"+hex.EncodeToString(value))
		}
		at += 4 + length
		if id == 0 {
			break
		}
	}
	mlmic, mlmicOk := "", true
	if scheme == "Negotiate" {
		signKey := md5.Sum(append(append([]byte(nil), exported...), "session key to client-to-server signing key magic constant\x00"...))
		sealKey := md5.Sum(append(append([]byte(nil), exported...), "session key to client-to-server sealing key magic constant\x00"...))
		checksum := testHMAC(signKey[:], []byte{0, 0, 0, 0}, state.mechList)
		want := append(append([]byte{1, 0, 0, 0}, testRC4(sealKey[:], checksum[:8])...), 0, 0, 0, 0)
		mlmicOk = mechListMic != nil && bytes.Equal(mechListMic, want)
		switch {
		case mechListMic == nil:
			mlmic = " mlmic=none"
		case mlmicOk:
			mlmic = " mlmic=ok"
		default:
			mlmic = " mlmic=bad"
		}
	}
	host, _ := os.Hostname()
	if name, _, _ := strings.Cut(host, "."); ws == name {
		ws = "W"
	}
	word := func(ok bool) string {
		if ok {
			return "ok"
		}
		return "bad"
	}
	lmMark, cc := ":x", "?"
	if isZero(t3[lmOff : lmOff+lmLen]) {
		lmMark = ":0"
	}
	if isZero(blob[24:28]) {
		cc = "CC"
	}
	logged := fmt.Sprintf("%s %sT3 len=%d flags=%08x ver=%x lm=%d@%d%s nt=%d@%d user=%s@%d dom=%s@%d ws=%s@%d key=%d@ws+%d head=%x cc=%s avs=%s proof=%s mic=%s%s",
		scheme, spnego, len(t3)-wsLen, flags, t3[64:72], lmLen, lmOff, lmMark, ntLen, ntOff, user, userOff, dom, domOff, ws, wsOff, keyLen, keyOff-wsOff-wsLen, blob[:16], cc, strings.Join(avs, ","), word(proofOk), word(micOk), mlmic)
	return logged, proofOk && micOk && cbtOk && mlmicOk
}

func ntlmProxy(t *testing.T, mode, password string, network, address string, certificate *tls.Certificate) (string, func() []string) {
	t.Helper()
	listener, err := net.Listen(network, address)
	if err != nil {
		t.Fatal(err)
	}
	if certificate != nil {
		listener = tls.NewListener(listener, &tls.Config{Certificates: []tls.Certificate{*certificate}})
	}
	t.Cleanup(func() { listener.Close() })
	scheme := "NTLM"
	if strings.HasPrefix(mode, "negotiate") {
		scheme = "Negotiate"
	}
	upper := map[string]string{"ß": "ß", "ıſ": "ıS"}
	var mu sync.Mutex
	var seen []string
	log := func(s string) {
		mu.Lock()
		seen = append(seen, s)
		mu.Unlock()
	}
	conns := 0
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			conns++
			id := conns
			go func() {
				defer client.Close()
				reader := bufio.NewReader(client)
				state := &ntlmProxyState{}
				for range 4 {
					request, err := http.ReadRequest(reader)
					if err != nil {
						return
					}
					auth := request.Header.Get("Proxy-Authorization")
					answer, closing := "", false
					if auth == "" {
						log(strconv.Itoa(id) + " auth=no")
						closing = mode == "close1"
						answer = "Proxy-Authenticate: " + scheme + "\r\n"
					} else {
						name, data, _ := strings.Cut(auth, " ")
						token, err := base64.StdEncoding.DecodeString(data)
						if err != nil {
							log(strconv.Itoa(id) + " proxy bad base64")
							return
						}
						logged, valid := readNtlmToken(name, token, state, password, upper)
						log(strconv.Itoa(id) + " auth=" + logged)
						if valid {
							target, err := net.Dial("tcp", request.Host)
							if err != nil {
								return
							}
							defer target.Close()
							_, _ = io.WriteString(client, "HTTP/1.1 200 Connection established\r\n\r\n")
							go func() { _, _ = io.Copy(target, reader) }()
							_, _ = io.Copy(client, target)
							return
						}
						if state.type1 != nil && state.type2 == nil {
							state.type2 = testType2(mode)
							closing = mode == "close2"
							var challenge string
							switch mode {
							case "bare", "negotiate-bare":
							case "short":
								challenge = " " + base64.StdEncoding.EncodeToString(state.type2[:10])
							case "base64":
								challenge = " !!!"
							default:
								message := state.type2
								if scheme == "Negotiate" {
									message = spnegoChallenge(message)
								}
								challenge = " " + base64.StdEncoding.EncodeToString(message)
							}
							answer = "Proxy-Authenticate: " + scheme + challenge + "\r\n"
						}
					}
					if closing {
						answer += "Connection: close\r\n"
					}
					_, _ = io.WriteString(client, "HTTP/1.1 407 Proxy Authentication Required\r\n"+answer+"Content-Length: 0\r\n\r\n")
					if closing {
						return
					}
				}
			}()
		}
	}()
	return listener.Addr().String(), func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

// twinOutcome maps C#'s outcome to what the twins can see: a status
// from the tunnel, or an error without one (.NET throws or has none).
var csharpErrorWithoutStatus = regexp.MustCompile(`^(throw \w+|error )(\||$)`)

func twinOutcome(want string) string {
	return csharpErrorWithoutStatus.ReplaceAllString(want, "error$2")
}

// The twin of C#'s AnswersAnNtlmChallengeAsSocketsHttpHandlerDoes: the
// same rows, the same verifier.
func TestAnswersAnNtlmChallengeAsSocketsHttpHandlerDoes(t *testing.T) {
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer target.Close()
	trust := target.Client().Transport.(*http.Transport).TLSClientConfig
	for _, c := range []struct{ mode, user, domain, password, want string }{
		{"ntlm", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"negotiate", "u", "", "p", "200 ok|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}|1 auth=Negotiate resp a1/30/a2:04,a3:04 T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok mlmic=ok"},
		{"domain", "u", "DOM", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=358 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=DOM@336 ws=W@342 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"empty", "u", "", "", "error 407|1 auth=no"},
		{"sharp", "ß", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=ß@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"dotless", "ıſ", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=354 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=ıſ@334 dom=@338 ws=W@338 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"flags", "u", "", "p", "error 407|1 auth=no|1 auth=NTLM T1 {T1}"},
		{"no-nb", "u", "", "p", "error 407|1 auth=no|1 auth=NTLM T1 {T1}"},
		{"negotiate-bare", "u", "", "p", "error 407|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}"},
		{"bare", "u", "", "p", "throw ArgumentOutOfRangeException|1 auth=no|1 auth=NTLM T1 {T1}"},
		{"av9", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=194 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=64@112 user=u@176 dom=@178 ws=W@178 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs=0: proof=ok mic=ok"},
		{"close1", "u", "", "p", "200 ok|1 auth=no|2 auth=NTLM T1 {T1}|2 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"close2", "u", "", "p", "error |1 auth=no|1 auth=NTLM T1 {T1}"},
		{"short", "u", "", "p", "throw ArgumentOutOfRangeException|1 auth=no|1 auth=NTLM T1 {T1}"},
		{"base64", "u", "", "p", "throw FormatException|1 auth=no|1 auth=NTLM T1 {T1}"},
		{"https", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"localhost", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/localhost,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"ipv6", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=340 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=210@112 user=u@322 dom=@324 ws=W@324 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/::1,10:zero,6:02000000,0: proof=ok mic=ok"},
		{"negotiate-https", "u", "", "p", "200 ok|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}|1 auth=Negotiate resp a1/30/a2:04,a3:04 T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok mlmic=ok"},
	} {
		t.Run(c.mode, func(t *testing.T) {
			var certificate *tls.Certificate
			if strings.HasSuffix(c.mode, "https") {
				certificate = &target.TLS.Certificates[0]
			}
			network, address := "tcp", "127.0.0.1:0"
			if c.mode == "ipv6" {
				network, address = "tcp6", "[::1]:0"
			}
			listened, seen := ntlmProxy(t, c.mode, c.password, network, address, certificate)
			_, port, _ := net.SplitHostPort(listened)
			host := "127.0.0.1"
			switch c.mode {
			case "localhost":
				host = "localhost"
			case "ipv6":
				host = "[::1]"
			}
			scheme := "http"
			if certificate != nil {
				scheme = "https"
			}
			user := c.user
			if c.domain != "" {
				user = c.domain + "\\" + user
			}
			proxy := &url.URL{Scheme: scheme, Host: host + ":" + port, User: url.UserPassword(user, c.password)}
			transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 2 * time.Second})
			transport.Transport.Proxy = http.ProxyURL(proxy)
			transport.Transport.TLSClientConfig = trust.Clone()
			transport.Transport.TLSClientConfig.ServerName = "127.0.0.1"
			outcome := "error"
			if response, err := (&http.Client{Transport: transport}).Get(target.URL); err == nil {
				body, _ := io.ReadAll(response.Body)
				response.Body.Close()
				outcome = strconv.Itoa(response.StatusCode) + " " + string(body)
			} else if strings.Contains(err.Error(), "CONNECT answered ") {
				outcome = "error " + err.Error()[strings.LastIndex(err.Error(), " ")+1:]
			}
			want := strings.NewReplacer("{T1}", ntlmTestType1, "{AVS}", ntlmServerAvs, "{INIT}", ntlmSpnegoInit).Replace(twinOutcome(c.want))
			if got := strings.Join(append([]string{outcome}, seen()...), "|"); got != want {
				t.Errorf("got %q\nC#  %q", got, want)
			}
		})
	}
}

// A name the canonical lookup cannot answer (an /etc/hosts or mDNS name,
// which .NET's getaddrinfo still finds) stands as given: the dial has
// already found it.
func TestNtlmSpnHostKeepsANameTheLookupCannotAnswer(t *testing.T) {
	for host, want := range map[string]string{"127.0.0.1": "127.0.0.1", "::1": "::1", "blok-ntlm-spn.invalid": "blok-ntlm-spn.invalid"} {
		if got := ntlmSpnHost(t.Context(), host); got != want {
			t.Errorf("ntlmSpnHost(%q) = %q", host, got)
		}
	}
}
