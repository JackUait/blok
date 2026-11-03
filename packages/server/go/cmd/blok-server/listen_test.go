package main

import (
	"net"
	"strconv"
	"testing"
)

func TestListenRefusesAPortThatDoesNotFitSixteenBits(t *testing.T) {
	free, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := free.Addr().(*net.TCPAddr).Port
	if err := free.Close(); err != nil {
		t.Fatal(err)
	}

	for _, portText := range []string{strconv.Itoa(port + 65536), "-1"} {
		listeners, err := listen("127.0.0.1:" + portText)
		closeAll(listeners)

		want := "listen tcp: address " + portText + ": invalid port"
		if err == nil || err.Error() != want {
			t.Fatalf("%s: bound %v, err %v", portText, listeners, err)
		}
	}
}
