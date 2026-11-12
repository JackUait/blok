package cloud

import (
	"context"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL, Listen, PublicURL, InternalURL, DataDirectory, TicketSecret, InternalSecret, AdminEmail string
	SMTPHost, SMTPPort, SMTPUsername, SMTPPassword, SMTPFrom, SMTPFromName                               string
	SMTPAllowInsecureDevelopment                                                                         bool
	// Optional trust roots and dialer are dependency injection for private-CA integration tests.
	SMTPRootCAs                                      *x509.CertPool
	SMTPDialContext                                  func(context.Context, string, string) (net.Conn, error)
	ResendAPIKey, MailFrom, DevelopmentMailDirectory string
	AllowedOrigins                                   []string
	TrustedProxyCIDRs                                []string
	Development                                      bool
	AIEncryptionKey                                  string
	// AITransport is an injected transport for tests. Endpoints remain fixed to api.openai.com.
	AITransport http.RoundTripper
	// Deliver overrides SMTP for integration tests. Production must configure SMTP.
	Deliver func(to, subject, body string) error
}

func ConfigFromEnv() Config {
	get := func(k, d string) string {
		if s := os.Getenv(k); s != "" {
			return s
		}
		return d
	}
	alias := func(primary, legacy, fallback string) string {
		if value, set := os.LookupEnv(primary); set {
			return value
		}
		if value, set := os.LookupEnv(legacy); set {
			return value
		}
		return fallback
	}
	return Config{AIEncryptionKey: os.Getenv("AI_ENCRYPTION_KEY"), DatabaseURL: os.Getenv("DATABASE_URL"), Listen: get("LISTEN_ADDR", ":8080"), PublicURL: get("PUBLIC_URL", "http://localhost:8080"), InternalURL: get("INTERNAL_URL", "http://127.0.0.1:8080"), DataDirectory: get("DATA_DIRECTORY", "./data"), TicketSecret: os.Getenv("TICKET_SECRET"), InternalSecret: os.Getenv("INTERNAL_SECRET"), AdminEmail: strings.ToLower(strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_EMAIL"))), SMTPHost: alias("MAILER_HOST", "SMTP_HOST", ""), SMTPPort: alias("MAILER_PORT", "SMTP_PORT", "587"), SMTPUsername: alias("MAILER_USER", "SMTP_USERNAME", ""), SMTPPassword: alias("MAILER_PASSWORD", "SMTP_PASSWORD", ""), SMTPFrom: alias("MAILER_FROM_EMAIL", "SMTP_FROM", ""), SMTPFromName: alias("MAILER_FROM_NAME", "SMTP_FROM_NAME", ""), SMTPAllowInsecureDevelopment: alias("MAILER_ALLOW_INSECURE_DEVELOPMENT", "SMTP_ALLOW_INSECURE_DEVELOPMENT", "") == "true", TrustedProxyCIDRs: strings.FieldsFunc(os.Getenv("TRUSTED_PROXY_CIDRS"), func(r rune) bool { return r == ',' }), AllowedOrigins: strings.FieldsFunc(os.Getenv("ALLOWED_ORIGINS"), func(r rune) bool { return r == ',' }), ResendAPIKey: os.Getenv("RESEND_API_KEY"), MailFrom: os.Getenv("MAIL_FROM"), DevelopmentMailDirectory: os.Getenv("DEV_MAIL_DIRECTORY"), Development: os.Getenv("APP_ENV") == "development"}
}
func (c Config) validate() error {
	for _, raw := range c.TrustedProxyCIDRs {
		if _, e := netip.ParsePrefix(strings.TrimSpace(raw)); e != nil {
			return errors.New("invalid TRUSTED_PROXY_CIDRS")
		}
	}
	if c.DatabaseURL == "" || len(c.TicketSecret) < 32 || len(c.InternalSecret) < 32 {
		return errors.New("DATABASE_URL and secrets of at least 32 characters required")
	}
	u, e := url.Parse(c.PublicURL)
	if e != nil || u.Host == "" || (!c.Development && u.Scheme != "https") {
		return errors.New("PUBLIC_URL must use HTTPS (HTTP allowed in development)")
	}
	if c.DevelopmentMailDirectory != "" && !c.Development {
		return errors.New("DEV_MAIL_DIRECTORY is only allowed in development")
	}
	if e := c.validateSMTP(); e != nil {
		return e
	}
	if c.Deliver == nil && !(c.Development && c.DevelopmentMailDirectory != "") {
		if c.SMTPHost != "" {
			if c.SMTPFrom == "" {
				return errors.New("MAILER_FROM_EMAIL or SMTP_FROM required with SMTP")
			}
		} else if c.ResendAPIKey != "" {
			if c.MailFrom == "" {
				return errors.New("MAIL_FROM required with Resend")
			}
		} else {
			return errors.New("Configure MAILER_HOST + MAILER_FROM_EMAIL, Resend, or explicit development mail directory")
		}
	}
	return nil
}
