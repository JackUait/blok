package cloud

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/textproto"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSMTPEnvironmentAliasesAndDefaults(t *testing.T) {
	names := []string{"MAILER_HOST", "MAILER_PORT", "MAILER_USER", "MAILER_PASSWORD", "MAILER_FROM_EMAIL", "MAILER_FROM_NAME", "MAILER_ALLOW_INSECURE_DEVELOPMENT", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_FROM_NAME", "SMTP_ALLOW_INSECURE_DEVELOPMENT"}
	for _, name := range names {
		t.Setenv(name, "")
		os.Unsetenv(name)
	}
	if c := ConfigFromEnv(); c.SMTPPort != "587" || c.SMTPUsername != "" || c.SMTPPassword != "" || c.SMTPFromName != "" || c.SMTPAllowInsecureDevelopment {
		t.Fatal("SMTP defaults changed")
	}
	t.Setenv("SMTP_HOST", "legacy.example.test")
	t.Setenv("SMTP_PORT", "587")
	t.Setenv("SMTP_USERNAME", "old-user")
	t.Setenv("SMTP_PASSWORD", "old-password")
	t.Setenv("SMTP_FROM", "legacy@example.test")
	t.Setenv("SMTP_FROM_NAME", "Legacy")
	c := ConfigFromEnv()
	if c.SMTPHost != "legacy.example.test" || c.SMTPUsername != "old-user" || c.SMTPFrom != "legacy@example.test" || c.SMTPFromName != "Legacy" {
		t.Fatal("legacy SMTP aliases no longer work")
	}
	t.Setenv("MAILER_HOST", "smtp.example.com")
	t.Setenv("MAILER_PORT", "465")
	t.Setenv("MAILER_USER", "")
	t.Setenv("MAILER_PASSWORD", "")
	t.Setenv("MAILER_FROM_EMAIL", "blok@example.com")
	t.Setenv("MAILER_FROM_NAME", "blok")
	c = ConfigFromEnv()
	if c.SMTPHost != "smtp.example.com" || c.SMTPPort != "465" || c.SMTPFrom != "blok@example.com" || c.SMTPFromName != "blok" || c.SMTPUsername != "" || c.SMTPPassword != "" {
		t.Fatal("preferred MAILER aliases or explicit blank auth overrides failed")
	}
	if e := c.validateSMTP(); e != nil {
		t.Fatal(e)
	}
}
func TestSMTPConfigRejectsInvalidCredentialsHeadersAndPorts(t *testing.T) {
	if e := (Config{SMTPFromName: "Blok"}).validateSMTP(); e != nil {
		t.Fatal("unused display name must not disable Resend/development sink", e)
	}
	valid := Config{SMTPHost: "smtp.example.test", SMTPPort: "465", SMTPFrom: "blok@example.test", SMTPFromName: "Blok"}
	cases := map[string]func(*Config){"username only": func(c *Config) { c.SMTPUsername = "user" }, "password only": func(c *Config) { c.SMTPPassword = "password" }, "sender injection": func(c *Config) { c.SMTPFrom = "blok@example.test\r\nBcc: other@example.test" }, "name injection": func(c *Config) { c.SMTPFromName = "Blok\nBcc: other@example.test" }, "bad sender": func(c *Config) { c.SMTPFrom = "not-an-email" }, "zero port": func(c *Config) { c.SMTPPort = "0" }, "large port": func(c *Config) { c.SMTPPort = "65536" }, "non-numeric port": func(c *Config) { c.SMTPPort = "tls" }, "host with scheme": func(c *Config) { c.SMTPHost = "https://smtp.example.test" }, "production plaintext flag": func(c *Config) { c.SMTPAllowInsecureDevelopment = true }}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			c := valid
			change(&c)
			if e := c.validateSMTP(); e == nil {
				t.Fatal("invalid SMTP configuration accepted")
			}
		})
	}
	service := &Service{Config: valid}
	if e := service.send("member@example.test", "Hello\r\nBcc: attacker@example.test", "text"); e == nil {
		t.Fatal("subject injection accepted")
	}
	if e := service.send("member@example.test\r\nBcc: attacker@example.test", "Hello", "text"); e == nil {
		t.Fatal("recipient injection accepted")
	}
}

type smtpCapture struct {
	TLS               bool
	Version           uint16
	Auth              bool
	Sender, Recipient string
	Message           []byte
	Commands          []string
	Err               error
}

func smtpCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	caKey, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "SMTP integration CA"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	caDER, e := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if e != nil {
		t.Fatal(e)
	}
	parsedCA, e := x509.ParseCertificate(caDER)
	if e != nil {
		t.Fatal(e)
	}
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "smtp.test"}, DNSNames: []string{"smtp.test"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, e := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, caKey)
	if e != nil {
		t.Fatal(e)
	}
	roots := x509.NewCertPool()
	roots.AddCert(parsedCA)
	return tls.Certificate{Certificate: [][]byte{der, caDER}, PrivateKey: key}, roots
}
func mockSMTP(t *testing.T, implicit, advertiseSTARTTLS bool) (string, *x509.CertPool, <-chan smtpCapture) {
	t.Helper()
	certificate, roots := smtpCertificate(t)
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { listener.Close() })
	done := make(chan smtpCapture, 1)
	go func() {
		capture := smtpCapture{}
		defer func() { done <- capture }()
		conn, e := listener.Accept()
		if e != nil {
			capture.Err = e
			return
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(5 * time.Second))
		upgrade := func() bool {
			secured := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
			if e := secured.Handshake(); e != nil {
				capture.Err = e
				return false
			}
			conn = secured
			capture.TLS = true
			capture.Version = secured.ConnectionState().Version
			return true
		}
		if implicit && !upgrade() {
			return
		}
		reader := bufio.NewReader(conn)
		if _, e = io.WriteString(conn, "220 smtp.test integration relay\r\n"); e != nil {
			capture.Err = e
			return
		}
		for {
			line, e := reader.ReadString('\n')
			if e != nil {
				capture.Err = e
				return
			}
			line = strings.TrimSpace(line)
			capture.Commands = append(capture.Commands, line)
			switch {
			case strings.HasPrefix(line, "EHLO ") || strings.HasPrefix(line, "HELO "):
				io.WriteString(conn, "250-smtp.test\r\n")
				if advertiseSTARTTLS && !capture.TLS {
					io.WriteString(conn, "250-STARTTLS\r\n")
				}
				if capture.TLS {
					io.WriteString(conn, "250-AUTH PLAIN\r\n")
				}
				io.WriteString(conn, "250 8BITMIME\r\n")
			case line == "STARTTLS":
				if !advertiseSTARTTLS {
					capture.Err = errors.New("unexpected STARTTLS")
					return
				}
				io.WriteString(conn, "220 Start TLS\r\n")
				if !upgrade() {
					return
				}
				reader = bufio.NewReader(conn)
			case strings.HasPrefix(line, "AUTH PLAIN "):
				decoded, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(line, "AUTH PLAIN "))
				if e != nil || string(decoded) != "\x00mock-user\x00mock-password" || !capture.TLS {
					capture.Err = errors.New("invalid or unencrypted authentication")
					io.WriteString(conn, "535 Authentication failed\r\n")
					return
				}
				capture.Auth = true
				io.WriteString(conn, "235 Authentication successful\r\n")
			case strings.HasPrefix(line, "MAIL FROM:"):
				capture.Sender = line
				io.WriteString(conn, "250 Sender OK\r\n")
			case strings.HasPrefix(line, "RCPT TO:"):
				capture.Recipient = line
				io.WriteString(conn, "250 Recipient OK\r\n")
			case line == "DATA":
				io.WriteString(conn, "354 End with dot\r\n")
				capture.Message, e = textproto.NewReader(reader).ReadDotBytes()
				if e != nil {
					capture.Err = e
					return
				}
				io.WriteString(conn, "250 Message accepted\r\n")
			case line == "QUIT":
				io.WriteString(conn, "221 Goodbye\r\n")
				return
			default:
				capture.Err = errors.New("unexpected SMTP command")
				return
			}
		}
	}()
	return listener.Addr().String(), roots, done
}
func smtpTestConfig(t *testing.T, address, port string, roots *x509.CertPool) Config {
	t.Helper()
	return Config{SMTPHost: "smtp.test", SMTPPort: port, SMTPFrom: "blok@example.com", SMTPFromName: "blok équipe", SMTPRootCAs: roots, SMTPDialContext: func(ctx context.Context, network, target string) (net.Conn, error) {
		if target != net.JoinHostPort("smtp.test", port) || network != "tcp" {
			t.Error("wrong configured SMTP dial target")
		}
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}}
}
func readCapture(t *testing.T, done <-chan smtpCapture) smtpCapture {
	t.Helper()
	select {
	case result := <-done:
		return result
	case <-time.After(6 * time.Second):
		t.Fatal("SMTP mock did not finish")
		return smtpCapture{}
	}
}
func TestSMTP465ImplicitTLSWithoutAuthentication(t *testing.T) {
	address, roots, done := mockSMTP(t, true, false)
	c := smtpTestConfig(t, address, "465", roots)
	c.ResendAPIKey = "unused-legacy-key"
	if e := (&Service{Config: c}).send("member@example.test", "Invitation Blok — équipe", "Bienvenue é\n.\nfin"); e != nil {
		t.Fatal(e)
	}
	capture := readCapture(t, done)
	if capture.Err != nil {
		t.Fatal(capture.Err)
	}
	if !capture.TLS || capture.Version < tls.VersionTLS12 || capture.Auth {
		t.Fatal("implicit TLS or optional authentication behavior wrong")
	}
	if !strings.HasPrefix(capture.Sender, "MAIL FROM:<blok@example.com>") || strings.Contains(capture.Sender, "équipe") || !strings.HasPrefix(capture.Recipient, "RCPT TO:<member@example.test>") {
		t.Fatal("SMTP envelope did not use pure addresses")
	}
	message, e := mail.ReadMessage(bytes.NewReader(capture.Message))
	if e != nil {
		t.Fatal(e)
	}
	from, e := mail.ParseAddress(message.Header.Get("From"))
	if e != nil || from.Name != "blok équipe" || from.Address != "blok@example.com" {
		t.Fatal("display name or From header encoded incorrectly")
	}
	subject, e := new(mime.WordDecoder).DecodeHeader(message.Header.Get("Subject"))
	if e != nil || subject != "Invitation Blok — équipe" {
		t.Fatal("UTF-8 subject encoded incorrectly")
	}
	body, e := io.ReadAll(quotedprintable.NewReader(message.Body))
	if e != nil || strings.TrimSuffix(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n") != "Bienvenue é\n.\nfin" {
		t.Fatal("message text or dot-stuffing corrupted")
	}
}
func TestSMTP587RequiresSTARTTLSAndAuthenticatesAfterUpgrade(t *testing.T) {
	address, roots, done := mockSMTP(t, false, true)
	c := smtpTestConfig(t, address, "587", roots)
	c.SMTPUsername = "mock-user"
	c.SMTPPassword = "mock-password"
	if e := (&Service{Config: c}).send("member@example.test", "Test", "Message"); e != nil {
		t.Fatal(e)
	}
	capture := readCapture(t, done)
	if capture.Err != nil || !capture.TLS || !capture.Auth {
		t.Fatal("STARTTLS or authentication failed")
	}
	start, auth := -1, -1
	for i, line := range capture.Commands {
		if line == "STARTTLS" {
			start = i
		}
		if strings.HasPrefix(line, "AUTH ") {
			auth = i
		}
	}
	if start < 0 || auth <= start {
		t.Fatal("credentials sent before STARTTLS")
	}
}
func TestSMTPRefusesUnencryptedProductionEvenWithoutAuthentication(t *testing.T) {
	address, roots, done := mockSMTP(t, false, false)
	c := smtpTestConfig(t, address, "587", roots)
	if e := (&Service{Config: c}).send("member@example.test", "Test", "Message"); e == nil {
		t.Fatal("production plaintext SMTP accepted")
	}
	capture := readCapture(t, done)
	if capture.Sender != "" || capture.Auth {
		t.Fatal("message or credentials sent over plaintext")
	}
}
func TestSMTPPlaintextRequiresExplicitDevelopmentOption(t *testing.T) {
	address, roots, done := mockSMTP(t, false, false)
	c := smtpTestConfig(t, address, "1025", roots)
	c.Development = true
	c.SMTPAllowInsecureDevelopment = true
	if e := (&Service{Config: c}).send("member@example.test", "Test", "Message"); e != nil {
		t.Fatal(e)
	}
	capture := readCapture(t, done)
	if capture.Err != nil || capture.TLS || capture.Sender == "" {
		t.Fatal("explicit local plaintext test delivery failed")
	}
}
func TestSMTPCertificateVerificationCannotBeBypassed(t *testing.T) {
	for _, mode := range []string{"untrusted CA", "wrong hostname"} {
		t.Run(mode, func(t *testing.T) {
			address, roots, done := mockSMTP(t, true, false)
			c := smtpTestConfig(t, address, "465", roots)
			if mode == "untrusted CA" {
				c.SMTPRootCAs = nil
			} else {
				c.SMTPHost = "smtp-wrong.test"
				c.SMTPDialContext = func(ctx context.Context, network, target string) (net.Conn, error) {
					return (&net.Dialer{}).DialContext(ctx, network, address)
				}
			}
			if e := (&Service{Config: c}).send("member@example.test", "Test", "Message"); e == nil {
				t.Fatal("unverified TLS certificate accepted")
			}
			capture := readCapture(t, done)
			if capture.Sender != "" || capture.Auth {
				t.Fatal("message or credentials sent before certificate validation")
			}
		})
	}
}

type smtpDeadlineConn struct {
	net.Conn
	set *time.Time
}

func (c smtpDeadlineConn) SetDeadline(deadline time.Time) error {
	*c.set = deadline
	return errors.New("test stops before SMTP greeting")
}
func TestSMTPSessionHasTwentySecondDeadline(t *testing.T) {
	left, right := net.Pipe()
	defer right.Close()
	var deadline time.Time
	c := Config{SMTPHost: "smtp.test", SMTPPort: "465", SMTPFrom: "blok@example.test", SMTPDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		limit, ok := ctx.Deadline()
		if !ok || time.Until(limit) < 19*time.Second || time.Until(limit) > 21*time.Second {
			t.Error("SMTP dial timeout is not20seconds")
		}
		return smtpDeadlineConn{Conn: left, set: &deadline}, nil
	}}
	if e := (&Service{Config: c}).send("member@example.test", "Test", "Message"); e == nil {
		t.Fatal("deadline failure not propagated")
	}
	if time.Until(deadline) < 19*time.Second || time.Until(deadline) > 21*time.Second {
		t.Fatal("SMTP session deadline is not20seconds")
	}
}
