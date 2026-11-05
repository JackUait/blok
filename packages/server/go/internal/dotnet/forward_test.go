package dotnet

import (
	"bufio"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

var digestResponsePattern = regexp.MustCompile(`response="([0-9a-f]+)"`)

func maskDigest(auth string) string {
	return digestResponsePattern.ReplaceAllString(auth, `response="R"`)
}

func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// forwardProxy is C#'s ServeForwardProxy: it answers absolute-form
// requests itself and logs "conn request-line auth=... body=...".
func forwardProxy(t *testing.T, mode string) (*url.URL, func() []string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	scheme := "NTLM"
	if mode == "negotiate" {
		scheme = "Negotiate"
	}
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
				state := &ntlmProxyState{}
				for range 4 {
					request, err := http.ReadRequest(reader)
					if err != nil {
						return
					}
					body, _ := io.ReadAll(request.Body)
					auth := request.Header.Get("Proxy-Authorization")
					logged := "no"
					if auth != "" {
						logged = maskDigest(auth)
					}
					answer, closing, ok := "", false, false
					if (mode == "ntlm" || mode == "negotiate") && strings.HasPrefix(auth, scheme+" ") {
						name, data, _ := strings.Cut(auth, " ")
						token, _ := base64.StdEncoding.DecodeString(data)
						read, valid := readNtlmToken(name, token, state, "p", map[string]string{})
						switch {
						case strings.Contains(read, " T1 "):
							logged = name + " T1"
						case valid:
							logged = name + " T3 ok"
						default:
							logged = name + " T3 bad"
						}
						ok = valid
						if !valid && state.type2 == nil {
							state.type2 = testType2("ntlm")
							message := state.type2
							if scheme == "Negotiate" {
								message = spnegoChallenge(message, "")
							}
							answer = "Proxy-Authenticate: " + scheme + " " + base64.StdEncoding.EncodeToString(message) + "\r\n"
						}
					} else {
						ok = auth != ""
						if mode == "digest" && ok {
							match := digestResponsePattern.FindStringSubmatch(auth)
							ok = match != nil && match[1] == md5Hex(md5Hex("u:r:p")+":n:"+md5Hex(request.Method+":/x?q"))
						}
						switch mode {
						case "basic", "basic-close":
							answer = "Proxy-Authenticate: Basic realm=\"r\"\r\n"
						case "digest":
							answer = "Proxy-Authenticate: Digest realm=\"r\", nonce=\"n\"\r\n"
						case "ntlm", "negotiate":
							answer = "Proxy-Authenticate: " + scheme + "\r\n"
						}
						closing = mode == "basic-close"
					}
					line := request.Method + " " + request.RequestURI + " " + request.Proto
					mu.Lock()
					seen = append(seen, strconv.Itoa(id)+" "+line+" auth="+logged+" body="+string(body))
					mu.Unlock()
					if ok {
						_, _ = io.WriteString(client, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
						continue
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
	return &url.URL{Scheme: "http", Host: listener.Addr().String(), User: url.UserPassword("u", "p")}, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

// The twin of C#'s AuthenticatesAForwardedRequestAsSocketsHttpHandlerDoes:
// an http target through a proxy gets no credentials before a 407.
func TestAuthenticatesAForwardedRequestAsSocketsHttpHandlerDoes(t *testing.T) {
	for _, c := range []struct{ mode, method, want string }{
		{"basic", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Basic dTpw body="},
		{"basic-close", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|2 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Basic dTpw body="},
		{"basic", "POST", "200 ok|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=abc|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=Basic dTpw body=abc"},
		{"none", "GET", "407 |1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body="},
		{"digest", "GET", `200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Digest username="u", realm="r", nonce="n", uri="/x?q", response="R" body=`},
		{"ntlm", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=NTLM T1 body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=NTLM T3 ok body="},
		{"negotiate", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Negotiate T1 body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Negotiate T3 ok body="},
	} {
		t.Run(c.mode+" "+c.method, func(t *testing.T) {
			proxy, seen := forwardProxy(t, c.mode)
			transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 2 * time.Second})
			transport.Transport.Proxy = http.ProxyURL(proxy)
			var body io.Reader
			if c.method == "POST" {
				body = strings.NewReader("abc")
			}
			request, _ := http.NewRequest(c.method, "http://127.0.0.1:1/x?q", body)
			outcome := "error"
			if response, err := (&http.Client{Transport: transport}).Do(request); err == nil {
				got, _ := io.ReadAll(response.Body)
				response.Body.Close()
				outcome = strconv.Itoa(response.StatusCode) + " " + string(got)
			}
			if got := strings.Join(append([]string{outcome}, seen()...), "|"); got != c.want {
				t.Errorf("got %q\nC#  %q", got, c.want)
			}
		})
	}
}
