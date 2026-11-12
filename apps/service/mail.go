package cloud

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const smtpTimeout = 20 * time.Second

var smtpHostname = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

func invalidMailHeader(value string) bool { return strings.IndexFunc(value, unicode.IsControl) >= 0 }
func smtpSender(c Config) (*mail.Address, error) {
	if invalidMailHeader(c.SMTPFrom) || invalidMailHeader(c.SMTPFromName) {
		return nil, errors.New("invalid SMTP sender header")
	}
	sender, e := mail.ParseAddress(c.SMTPFrom)
	if e != nil {
		return nil, errors.New("invalid MAILER_FROM_EMAIL or SMTP_FROM")
	}
	if c.SMTPFromName != "" {
		sender.Name = c.SMTPFromName
	}
	if invalidMailHeader(sender.Name) {
		return nil, errors.New("invalid SMTP sender display name")
	}
	return sender, nil
}
func (c Config) validateSMTP() error {
	if c.SMTPAllowInsecureDevelopment && !c.Development {
		return errors.New("MAILER_ALLOW_INSECURE_DEVELOPMENT is only allowed in development")
	}
	if (c.SMTPUsername == "") != (c.SMTPPassword == "") {
		return errors.New("SMTP username and password must both be set or both be empty")
	}
	if strings.ContainsAny(c.SMTPUsername, "\r\n\x00") || strings.ContainsAny(c.SMTPPassword, "\r\n\x00") {
		return errors.New("invalid SMTP authentication configuration")
	}
	if invalidMailHeader(c.SMTPFrom) || invalidMailHeader(c.SMTPFromName) {
		return errors.New("invalid SMTP sender header")
	}
	if c.SMTPHost == "" {
		if c.SMTPUsername != "" {
			return errors.New("MAILER_HOST or SMTP_HOST required with SMTP configuration")
		}
		return nil
	}
	if net.ParseIP(c.SMTPHost) == nil && !smtpHostname.MatchString(c.SMTPHost) {
		return errors.New("invalid SMTP hostname; use a host without scheme or port")
	}
	port, e := strconv.Atoi(c.SMTPPort)
	if e != nil || port < 1 || port > 65535 {
		return errors.New("SMTP port must be between 1 and 65535")
	}
	_, e = smtpSender(c)
	return e
}
func (s *Service) send(to, subject, text string) error {
	if invalidMailHeader(subject) || invalidMailHeader(to) {
		return errors.New("invalid mail header")
	}
	recipient, e := mail.ParseAddress(to)
	if e != nil || invalidMailHeader(recipient.Name) {
		return errors.New("invalid mail recipient")
	}
	c := s.Config
	if c.Deliver != nil {
		return c.Deliver(to, subject, text)
	}
	if c.Development && c.DevelopmentMailDirectory != "" {
		if e := os.MkdirAll(c.DevelopmentMailDirectory, 0700); e != nil {
			return e
		}
		encoded, _ := json.Marshal(map[string]string{"to": to, "subject": subject, "text": text})
		return os.WriteFile(filepath.Join(c.DevelopmentMailDirectory, hash(to)+".json"), encoded, 0600)
	}
	// SMTP is the selected backend whenever configured, including if a legacy
	// Resend key still exists in the environment.
	if c.SMTPHost != "" {
		if e := c.validateSMTP(); e != nil {
			return e
		}
		return sendSMTP(c, recipient, subject, text)
	}
	if c.ResendAPIKey != "" {
		payload, _ := json.Marshal(map[string]any{"from": c.MailFrom, "to": []string{recipient.Address}, "subject": subject, "text": text})
		req, e := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(payload))
		if e != nil {
			return e
		}
		req.Header.Set("Authorization", "Bearer "+c.ResendAPIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, e := (&http.Client{Timeout: smtpTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("mail redirect refused") }}).Do(req)
		if e != nil {
			return e
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("Resend delivery status %d", resp.StatusCode)
		}
		return nil
	}
	return errors.New("mail delivery not configured")
}
func sendSMTP(c Config, recipient *mail.Address, subject, text string) error {
	sender, e := smtpSender(c)
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(context.Background(), smtpTimeout)
	defer cancel()
	dial := c.SMTPDialContext
	if dial == nil {
		dial = (&net.Dialer{Timeout: smtpTimeout}).DialContext
	}
	conn, e := dial(ctx, "tcp", net.JoinHostPort(c.SMTPHost, c.SMTPPort))
	if e != nil {
		return errors.New("SMTP connection failed")
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	if e = conn.SetDeadline(deadline); e != nil {
		return errors.New("SMTP deadline could not be set")
	}
	tlsConfig := &tls.Config{ServerName: c.SMTPHost, MinVersion: tls.VersionTLS12, RootCAs: c.SMTPRootCAs}
	implicit := c.SMTPPort == "465"
	if implicit {
		secured := tls.Client(conn, tlsConfig)
		if e = secured.HandshakeContext(ctx); e != nil {
			return errors.New("SMTP TLS handshake failed")
		}
		conn = secured
	}
	client, e := smtp.NewClient(conn, c.SMTPHost)
	if e != nil {
		return errors.New("SMTP greeting failed")
	}
	defer client.Close()
	if !implicit {
		if supported, _ := client.Extension("STARTTLS"); supported {
			if e = client.StartTLS(tlsConfig); e != nil {
				return errors.New("SMTP STARTTLS handshake failed")
			}
		} else if !(c.Development && c.SMTPAllowInsecureDevelopment) {
			return errors.New("SMTP server does not support required STARTTLS")
		}
	}
	if c.SMTPUsername != "" {
		if e = client.Auth(smtp.PlainAuth("", c.SMTPUsername, c.SMTPPassword, c.SMTPHost)); e != nil {
			return errors.New("SMTP authentication failed")
		}
	}
	if e = client.Mail(sender.Address); e != nil {
		return errors.New("SMTP sender refused")
	}
	if e = client.Rcpt(recipient.Address); e != nil {
		return errors.New("SMTP recipient refused")
	}
	data, e := client.Data()
	if e != nil {
		return errors.New("SMTP DATA refused")
	}
	var message bytes.Buffer
	fmt.Fprintf(&message, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", sender.String(), recipient.String(), mime.QEncoding.Encode("UTF-8", subject), time.Now().Format(time.RFC1123Z))
	encoded := quotedprintable.NewWriter(&message)
	if _, e = encoded.Write([]byte(text)); e != nil {
		data.Close()
		return errors.New("SMTP message encoding failed")
	}
	if e = encoded.Close(); e != nil {
		data.Close()
		return errors.New("SMTP message encoding failed")
	}
	if _, e = data.Write(message.Bytes()); e != nil {
		data.Close()
		return errors.New("SMTP message delivery failed")
	}
	if e = data.Close(); e != nil {
		return errors.New("SMTP message delivery failed")
	}
	if e = client.Quit(); e != nil {
		return errors.New("SMTP session did not finish cleanly")
	}
	return nil
}
