package dotnet

import (
	"bufio"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func digestChallenge(mode string, second bool) string {
	switch mode {
	case "plain", "utf8":
		return `Digest realm="r", nonce="n"`
	case "qop":
		return `Digest realm="r", nonce="n", qop="auth", algorithm=MD5, opaque="o"`
	case "sha-sess":
		return `Digest realm="r", nonce="n", qop="auth,auth-int", algorithm=SHA-256-sess`
	case "auth-int":
		return `Digest realm="r", nonce="n", qop="auth-int", algorithm=SHA-256`
	case "userhash":
		return `Digest realm="r", nonce="n", userhash=true, algorithm=MD5`
	case "stale":
		if second {
			return `Digest realm="r", nonce="n2", stale=true`
		}
		return `Digest realm="r", nonce="n"`
	case "unsupported":
		return `Digest realm="r", nonce="n", algorithm=SHA-512`
	}
	return ""
}

func challengeLines(mode string, second bool) string {
	switch mode {
	case "digest+basic":
		return "Proxy-Authenticate: Basic realm=\"r\"\r\nProxy-Authenticate: Digest realm=\"r\", nonce=\"n\"\r\n"
	case "negotiate+basic":
		return "Proxy-Authenticate: Negotiate\r\nProxy-Authenticate: Basic realm=\"r\"\r\n"
	}
	return "Proxy-Authenticate: " + digestChallenge(mode, second) + "\r\n"
}

var digestField = regexp.MustCompile(`([a-z*]+)=("[^"]*"|[^, ]*)`)

// digestValid is the RFC 7616 check C#'s test makes, password p.
func digestValid(header, user string) bool {
	fields := map[string]string{}
	for _, m := range digestField.FindAllStringSubmatch(header, -1) {
		fields[m[1]] = strings.Trim(m[2], `"`)
	}
	algorithm := fields["algorithm"]
	if algorithm == "" {
		algorithm = "MD5"
	}
	hash := func(data string) string {
		if strings.HasPrefix(algorithm, "SHA-256") {
			sum := sha256.Sum256([]byte(data))
			return hex.EncodeToString(sum[:])
		}
		sum := md5.Sum([]byte(data))
		return hex.EncodeToString(sum[:])
	}
	nonce := fields["nonce"]
	a1 := hash(user + ":r:p")
	if strings.HasSuffix(algorithm, "-sess") {
		a1 = hash(a1 + ":" + nonce + ":" + fields["cnonce"])
	}
	a2 := hash("CONNECT:/")
	if fields["qop"] == "auth-int" {
		a2 = hash("CONNECT:/:" + hash(""))
	}
	want := hash(a1 + ":" + nonce + ":" + a2)
	if qop, ok := fields["qop"]; ok {
		want = hash(a1 + ":" + nonce + ":" + fields["nc"] + ":" + fields["cnonce"] + ":" + qop + ":" + a2)
	}
	return fields["uri"] == "/" && fields["response"] == want
}

var (
	maskResponse = regexp.MustCompile(`response="[0-9a-f]+"`)
	maskCnonce   = regexp.MustCompile(`cnonce="[0-9A-Za-z]{16}"`)
)

func digestProxy(t *testing.T, mode, user string) (*url.URL, func() []string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	var mu sync.Mutex
	var seen []string
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
				digests := 0
				for range 4 {
					request, err := http.ReadRequest(reader)
					if err != nil {
						return
					}
					auth := request.Header.Get("Proxy-Authorization")
					logged := "no"
					switch {
					case strings.HasPrefix(auth, "Negotiate "):
						logged = "Negotiate T"
					case auth != "":
						logged = maskCnonce.ReplaceAllString(maskResponse.ReplaceAllString(auth, `response="R"`), `cnonce="C"`)
					}
					mu.Lock()
					seen = append(seen, strconv.Itoa(id)+" auth="+logged)
					mu.Unlock()
					digest := strings.HasPrefix(auth, "Digest ")
					if digest {
						digests++
					}
					stale := mode == "stale" && digests == 1
					if digest && !stale && digestValid(auth, user) {
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
					_, _ = io.WriteString(client, "HTTP/1.1 407 Proxy Authentication Required\r\n"+challengeLines(mode, stale)+"Content-Length: 0\r\n\r\n")
				}
			}()
		}
	}()
	proxy := &url.URL{Scheme: "http", Host: listener.Addr().String(), User: url.UserPassword(user, "p")}
	return proxy, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

// The twin of C#'s AnswersADigestChallengeAsSocketsHttpHandlerDoes. Only
// negotiate+basic differs: .NET sends a Negotiate token, which is not
// spoken here, and neither sends Basic.
func TestAnswersADigestChallengeAsSocketsHttpHandlerDoes(t *testing.T) {
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer target.Close()
	trust := target.Client().Transport.(*http.Transport).TLSClientConfig
	for _, c := range []struct{ mode, user, want string }{
		{"plain", "u", `200 ok|1 auth=no|1 auth=Digest username="u", realm="r", nonce="n", uri="/", response="R"`},
		{"qop", "u", `200 ok|1 auth=no|1 auth=Digest username="u", realm="r", nonce="n", uri="/", response="R", opaque="o", algorithm=MD5, qop=auth, nc=00000001, cnonce="C"`},
		{"sha-sess", "u", `200 ok|1 auth=no|1 auth=Digest username="u", realm="r", nonce="n", uri="/", response="R", algorithm=SHA-256-sess, qop=auth, nc=00000001, cnonce="C"`},
		{"auth-int", "u", `200 ok|1 auth=no|1 auth=Digest username="u", realm="r", nonce="n", uri="/", response="R", algorithm=SHA-256, qop=auth-int, nc=00000001, cnonce="C"`},
		{"userhash", "u", `200 ok|1 auth=no|1 auth=Digest username="ba84be203fdfc7d34e054a76d285d0c9", userhash=true, realm="r", nonce="n", uri="/", response="R", algorithm=MD5`},
		{"utf8", "é", `200 ok|1 auth=no|1 auth=Digest username*=utf-8''%C3%A9, realm="r", nonce="n", uri="/", response="R"`},
		{"stale", "u", `200 ok|1 auth=no|1 auth=Digest username="u", realm="r", nonce="n", uri="/", response="R"|1 auth=Digest username="u", realm="r", nonce="n2", uri="/", response="R"`},
		{"unsupported", "u", "error|1 auth=no"},
		{"digest+basic", "u", `200 ok|1 auth=no|1 auth=Digest username="u", realm="r", nonce="n", uri="/", response="R"`},
		{"negotiate+basic", "u", "error|1 auth=no"},
	} {
		t.Run(c.mode, func(t *testing.T) {
			proxy, seen := digestProxy(t, c.mode, c.user)
			transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 2 * time.Second})
			transport.Transport.Proxy = http.ProxyURL(proxy)
			transport.Transport.TLSClientConfig = trust.Clone()
			transport.Transport.TLSClientConfig.ServerName = "127.0.0.1"
			outcome := "error"
			if response, err := (&http.Client{Transport: transport}).Get(target.URL); err == nil {
				body, _ := io.ReadAll(response.Body)
				response.Body.Close()
				outcome = strconv.Itoa(response.StatusCode) + " " + string(body)
			}
			if got := strings.Join(append([]string{outcome}, seen()...), "|"); got != c.want {
				t.Errorf("got %q\nC#  %q", got, c.want)
			}
		})
	}
}
