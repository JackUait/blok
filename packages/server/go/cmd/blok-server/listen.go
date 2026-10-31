package main

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"syscall"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// listen binds what Kestrel's UseUrls makes of --listen (Program.cs:74-77):
//   - no host: IPv4 any only (the C# host rewrites ":P" to "0.0.0.0:P");
//   - an IP address: that address alone, IPv4 sockets for IPv4;
//   - "*" or "+": IPv6 any, dual-stack, else IPv4 any (AnyIPListenOptions);
//   - localhost: 127.0.0.1 and [::1], one of them is enough
//     (LocalhostListenOptions).
//
// Options.Validate has already refused every other host.
func listen(address string) ([]net.Listener, error) {
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		return nil, err
	}
	switch {
	case host == "":
		return bindOne("tcp4", netip.AddrPortFrom(netip.IPv4Unspecified(), uint16(port)))
	case host == "*" || host == "+":
		listeners, err := bindOne("tcp", netip.AddrPortFrom(netip.IPv6Unspecified(), uint16(port)))
		if err != nil && !isAddressInUse(err) {
			return bindOne("tcp4", netip.AddrPortFrom(netip.IPv4Unspecified(), uint16(port)))
		}
		return listeners, err
	case dotnet.EqualsOrdinalIgnoreCase(host, "localhost"):
		return bindLocalhost(port)
	}
	ip, ok := dotnet.ParseIP(host)
	if !ok {
		return nil, fmt.Errorf("listen tcp: address %s: not an IP address", address)
	}
	switch {
	case ip.Is4():
		return bindOne("tcp4", netip.AddrPortFrom(ip, uint16(port)))
	case ip.Is4In6():
		// An IPv6 socket cannot bind a mapped address; Go would bind IPv4.
		return nil, errors.New("Can't assign requested address")
	case ip.IsUnspecified():
		// Kestrel sets DualMode on an IPv6 any socket.
		return bindOne("tcp", netip.AddrPortFrom(ip, uint16(port)))
	}
	// ParseIP drops the scope id; net.Listen needs it for a link-local address.
	if zoned, err := netip.ParseAddr(host); err == nil {
		ip = zoned
	}
	return bindOne("tcp6", netip.AddrPortFrom(ip, uint16(port)))
}

func bindLocalhost(port int) ([]net.Listener, error) {
	if port == 0 {
		return nil, errors.New("Dynamic port binding is not supported when binding to localhost. " +
			"You must either bind to 127.0.0.1:0 or [::1]:0, or both.")
	}
	var listeners []net.Listener
	for _, bind := range []struct {
		network string
		ip      netip.Addr
	}{{"tcp4", netip.AddrFrom4([4]byte{127, 0, 0, 1})}, {"tcp6", netip.IPv6Loopback()}} {
		bound, err := bindOne(bind.network, netip.AddrPortFrom(bind.ip, uint16(port)))
		if isAddressInUse(err) {
			closeAll(listeners)
			return nil, err
		}
		listeners = append(listeners, bound...)
	}
	if len(listeners) == 0 {
		return nil, fmt.Errorf("Failed to bind to address http://localhost:%d.", port)
	}
	return listeners, nil
}

func bindOne(network string, address netip.AddrPort) ([]net.Listener, error) {
	listener, err := net.Listen(network, address.String())
	if isAddressInUse(err) {
		return nil, addressInUse{address}
	}
	if err != nil {
		return nil, err
	}
	return []net.Listener{listener}, nil
}

// addressInUse is Kestrel's AddressInUseException message.
type addressInUse struct{ address netip.AddrPort }

func (e addressInUse) Error() string {
	return "Failed to bind to address http://" + e.address.String() + ": address already in use."
}

func isAddressInUse(err error) bool {
	var inUse addressInUse
	return errors.As(err, &inUse) || errors.Is(err, syscall.EADDRINUSE)
}

func closeAll(listeners []net.Listener) {
	for _, listener := range listeners {
		_ = listener.Close()
	}
}
