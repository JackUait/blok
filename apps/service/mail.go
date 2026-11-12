package cloud

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/smtp"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Service) send(to, subject, text string) error {
	if strings.ContainsAny(subject, "\r\n") {
		return errors.New("invalid mail subject")
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
	if c.ResendAPIKey != "" {
		payload, _ := json.Marshal(map[string]any{"from": c.MailFrom, "to": []string{to}, "subject": subject, "text": text})
		req, e := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(payload))
		if e != nil {
			return e
		}
		req.Header.Set("Authorization", "Bearer "+c.ResendAPIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, e := (&http.Client{Timeout: 20 * time.Second}).Do(req)
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
	if c.SMTPHost == "" {
		return errors.New("mail delivery not configured")
	}
	var auth smtp.Auth
	if c.SMTPUsername != "" {
		auth = smtp.PlainAuth("", c.SMTPUsername, c.SMTPPassword, c.SMTPHost)
	}
	msg := []byte("From: " + c.SMTPFrom + "\r\nTo: " + to + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + text)
	return smtp.SendMail(net.JoinHostPort(c.SMTPHost, c.SMTPPort), auth, c.SMTPFrom, []string{to}, msg)
}
