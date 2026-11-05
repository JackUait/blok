package ws

import (
	"net"
	"runtime"
	"testing"
	"time"
)

// idleCost is the heap and stack one idle connection holds, averaged.
func idleCost(t *testing.T, conns int) (heap, stack float64) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	clients := make([]net.Conn, 0, conns)
	raws := make([]net.Conn, 0, conns)
	for range conns {
		client, err := net.Dial("tcp", listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		raw, err := listener.Accept()
		if err != nil {
			t.Fatal(err)
		}
		clients, raws = append(clients, client), append(raws, raw)
	}
	defer func() {
		for _, c := range clients {
			_ = c.Close()
		}
	}()
	measure := func() runtime.MemStats {
		time.Sleep(100 * time.Millisecond)
		runtime.GC()
		runtime.GC()
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		return m
	}
	before := measure()
	servers := make([]*Conn, 0, conns)
	for _, raw := range raws {
		servers = append(servers, NewServerConn(raw, nil, Options{}))
	}
	after := measure()
	runtime.KeepAlive(servers)
	for _, s := range servers {
		s.Abort()
	}
	n := float64(conns)
	return float64(after.HeapInuse-before.HeapInuse) / n, float64(after.StackInuse-before.StackInuse) / n
}

// The read-ahead must not hold a read buffer of its own while the peer is
// quiet: thousands of idle sockets each pay for it.
func TestAnIdleConnectionHoldsNoReadAheadBuffer(t *testing.T) {
	heap, stack := idleCost(t, 500)
	t.Logf("per idle connection: heap %.0f B, stack %.0f B", heap, stack)
	// Two 4 KiB bufio buffers plus the Conn; a 16 KiB chunk would pass 20 KiB.
	if heap > 12*1024 {
		t.Fatalf("an idle connection holds %.0f heap bytes", heap)
	}
}
