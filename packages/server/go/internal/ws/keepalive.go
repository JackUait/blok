package ws

import (
	"encoding/binary"
	"time"
)

// keepAlive is KeepAlivePingState: a ping carries a counter, only an
// 8-byte pong with that counter answers it, and data received pushes the
// next ping back. Guarded by Conn.stateMu.
type keepAlive struct {
	delay, timeout time.Duration
	payload        int64
	pingSent       bool
	// A pong answers only a ping that was written; one that races ahead of
	// the write is held until the write returns.
	pingWritten, earlyPong bool
	pingDeadline           time.Time
	nextPing               time.Time
	fault                  error
}

// startKeepAlive runs the heartbeat every max(min(delay, timeout)/4, 1ms);
// with no timeout it is .NET's unsolicited-pong strategy, every delay.
func (c *Conn) startKeepAlive(delay, timeout time.Duration) {
	heartbeat := delay
	if timeout > 0 {
		c.keepAlive = &keepAlive{delay: delay, timeout: timeout, nextPing: time.Now().Add(delay)}
		heartbeat = max(min(delay, timeout)/4, time.Millisecond)
	}
	go func() {
		ticker := time.NewTicker(heartbeat)
		defer ticker.Stop()
		for {
			select {
			case <-c.done:
				return
			case <-ticker.C:
				c.heartbeat()
			}
		}
	}()
}

func (c *Conn) heartbeat() {
	if c.keepAlive == nil {
		// .NET queues one pong per tick behind a stuck send; one waiting
		// pong is enough here, so no goroutine piles up.
		if c.keepAliveSending.CompareAndSwap(false, true) {
			go func() {
				defer c.keepAliveSending.Store(false)
				c.sendKeepAliveFrame(opPong, nil)
			}()
		}
		return
	}
	c.stateMu.Lock()
	k := c.keepAlive
	if k.fault != nil {
		c.stateMu.Unlock()
		return
	}
	now := time.Now()
	send := false
	if k.pingSent {
		if now.After(k.pingDeadline) {
			k.fault = ErrKeepAliveTimeout
			c.aborted = true
			c.stateMu.Unlock()
			c.dispose()
			return
		}
	} else if now.After(k.nextPing) {
		k.pingSent = true
		k.pingWritten, k.earlyPong = false, false
		k.pingDeadline = now.Add(k.timeout)
		k.payload++
		send = true
	}
	payload := k.payload
	c.stateMu.Unlock()
	// Off the heartbeat: a send stuck on a peer that stops reading holds
	// sendMu, and the timeout check above must keep running to abort it.
	// pingSent stays set until the ping is written, so one ping is in flight.
	if send {
		go func() {
			if !c.sendKeepAliveFrame(opPing, binary.BigEndian.AppendUint64(nil, uint64(payload))) {
				return
			}
			c.stateMu.Lock()
			defer c.stateMu.Unlock()
			if k.pingSent && k.payload == payload {
				k.pingWritten = true
				if k.earlyPong {
					k.pingSent = false
					k.pingDeadline = time.Time{}
				}
			}
		}()
	}
}

// sendKeepAliveFrame is TrySendKeepAliveFrameAsync: nothing once our close
// went out. It reports whether the frame was written.
func (c *Conn) sendKeepAliveFrame(opcode byte, payload []byte) bool {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	c.stateMu.Lock()
	valid := c.validSendState()
	c.stateMu.Unlock()
	return valid && c.writeFrame(opcode, payload) == nil
}

func (c *Conn) onDataReceived() {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if c.keepAlive != nil {
		c.keepAlive.nextPing = time.Now().Add(c.keepAlive.delay)
	}
}

func (c *Conn) onPong(payload int64) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	k := c.keepAlive
	if k == nil || !k.pingSent || payload != k.payload {
		return
	}
	if !k.pingWritten {
		k.earlyPong = true
		return
	}
	k.pingSent = false
	k.pingDeadline = time.Time{}
}
