package blob

import (
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// environmentProxy is .NET's HttpEnvironmentProxy (System.Net.Http 10.0.11,
// decompiled), which SocketsHttpHandler uses by default. Unlike Go's
// ProxyFromEnvironment it reads ALL_PROXY, takes a lower-case variable even
// when it is empty for no_proxy, matches NO_PROXY entries only exactly or as
// ".suffix", has no "*" and no loopback bypass, and skips HTTP_PROXY only
// under GATEWAY_INTERFACE. With no variable set .NET on macOS falls back to
// the system proxy settings; Go does not read those.
func environmentProxy(lookup func(string) (string, bool)) func(*http.Request) (*url.URL, error) {
	get := func(name string) string { value, _ := lookup(name); return value }
	httpProxy := proxyURL(get("http_proxy"))
	if _, cgi := lookup("GATEWAY_INTERFACE"); httpProxy == nil && !cgi {
		httpProxy = proxyURL(get("HTTP_PROXY"))
	}
	httpsProxy := firstURL(get("https_proxy"), get("HTTPS_PROXY"))
	if httpProxy == nil || httpsProxy == nil {
		all := firstURL(get("all_proxy"), get("ALL_PROXY"))
		if httpProxy == nil {
			httpProxy = all
		}
		if httpsProxy == nil {
			httpsProxy = all
		}
	}
	if httpProxy == nil && httpsProxy == nil {
		return nil
	}
	bypass, found := lookup("no_proxy")
	if !found {
		bypass = get("NO_PROXY")
	}
	var entries []string
	for _, entry := range strings.Split(bypass, ",") {
		if entry = strings.TrimSpace(entry); entry != "" {
			entries = append(entries, entry)
		}
	}
	return func(r *http.Request) (*url.URL, error) {
		proxy := httpsProxy
		if r.URL.Scheme == "http" {
			proxy = httpProxy
		}
		if proxy == nil || bypassed(entries, uriHost(r.URL)) {
			return nil, nil
		}
		return proxy, nil
	}
}

func firstURL(lower, upper string) *url.URL {
	if u := proxyURL(lower); u != nil {
		return u
	}
	return proxyURL(upper)
}

// proxyURL is GetUriFromString: an optional scheme, optional user info
// before the last "@", and a port made of the digits after the last ":"
// (anything after them is dropped).
func proxyURL(value string) *url.URL {
	if value == "" {
		return nil
	}
	scheme, port := "http", 80
	for _, prefix := range []struct {
		text, scheme string
		port         int
	}{{"http://", "http", 80}, {"https://", "https", 443}, {"socks4://", "socks4", 80}, {"socks5://", "socks5", 80}, {"socks4a://", "socks4a", 80}} {
		if len(value) >= len(prefix.text) && strings.EqualFold(value[:len(prefix.text)], prefix.text) {
			scheme, port = prefix.scheme, prefix.port
			value = value[len(prefix.text):]
			break
		}
	}
	var user *url.Userinfo
	if at := strings.LastIndexByte(value, '@'); at >= 0 {
		info := dotnet.UnescapeDataString(value[:at])
		value = value[at+1:]
		if name, password, ok := strings.Cut(info, ":"); ok {
			user = url.UserPassword(name, password)
		} else {
			user = url.User(info)
		}
	}
	host := value
	bracket := strings.IndexByte(value, ']')
	if colon := strings.LastIndexByte(value, ':'); colon >= 0 && (bracket < 0 || colon > bracket) {
		host = value[:colon]
		end := colon + 1
		for end < len(value) && '0' <= value[end] && value[end] <= '9' {
			end++
		}
		parsed, err := strconv.ParseUint(value[colon+1:end], 10, 16)
		if err != nil {
			return nil
		}
		port = int(parsed)
	}
	if host == "" || strings.ContainsAny(host, "/?#@ ") {
		return nil
	}
	if address, err := netip.ParseAddr(host); err == nil && address.Is6() {
		host = "[" + host + "]"
	}
	return &url.URL{Scheme: scheme, User: user, Host: host + ":" + strconv.Itoa(port)}
}

// uriHost is System.Uri.Host: IPv6 in brackets.
func uriHost(u *url.URL) string {
	host := u.Hostname()
	if strings.Contains(host, ":") {
		return "[" + host + "]"
	}
	return host
}

// bypassed is IsMatchInBypassList.
func bypassed(entries []string, host string) bool {
	for _, entry := range entries {
		if entry[0] == '.' {
			if strings.EqualFold(entry[1:], host) || len(host) >= len(entry) && strings.EqualFold(host[len(host)-len(entry):], entry) {
				return true
			}
		} else if strings.EqualFold(entry, host) {
			return true
		}
	}
	return false
}

func osProxy() func(*http.Request) (*url.URL, error) { return environmentProxy(os.LookupEnv) }
