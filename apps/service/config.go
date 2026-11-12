package cloud

import (
	"errors"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL, Listen, PublicURL, InternalURL, DataDirectory, TicketSecret, InternalSecret, AdminEmail string
	SMTPHost, SMTPPort, SMTPUsername, SMTPPassword, SMTPFrom                                             string
	ResendAPIKey, MailFrom, DevelopmentMailDirectory                                                     string
	AllowedOrigins                                                                                       []string
	TrustedProxyCIDRs                                                                                    []string
	Development                                                                                          bool
	AIEncryptionKey                                                                                      string
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
	return Config{AIEncryptionKey: os.Getenv("AI_ENCRYPTION_KEY"), DatabaseURL: os.Getenv("DATABASE_URL"), Listen: get("LISTEN_ADDR", ":8080"), PublicURL: get("PUBLIC_URL", "http://localhost:8080"), InternalURL: get("INTERNAL_URL", "http://127.0.0.1:8080"), DataDirectory: get("DATA_DIRECTORY", "./data"), TicketSecret: os.Getenv("TICKET_SECRET"), InternalSecret: os.Getenv("INTERNAL_SECRET"), AdminEmail: strings.ToLower(strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_EMAIL"))), SMTPHost: os.Getenv("SMTP_HOST"), SMTPPort: get("SMTP_PORT", "587"), SMTPUsername: os.Getenv("SMTP_USERNAME"), SMTPPassword: os.Getenv("SMTP_PASSWORD"), SMTPFrom: os.Getenv("SMTP_FROM"), TrustedProxyCIDRs: strings.FieldsFunc(os.Getenv("TRUSTED_PROXY_CIDRS"), func(r rune) bool { return r == ',' }), AllowedOrigins: strings.FieldsFunc(os.Getenv("ALLOWED_ORIGINS"), func(r rune) bool { return r == ',' }), ResendAPIKey: os.Getenv("RESEND_API_KEY"), MailFrom: os.Getenv("MAIL_FROM"), DevelopmentMailDirectory: os.Getenv("DEV_MAIL_DIRECTORY"), Development: os.Getenv("APP_ENV") == "development"}
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
	if c.Deliver == nil && c.ResendAPIKey == "" && !(c.Development && c.DevelopmentMailDirectory != "") && (c.SMTPHost == "" || c.SMTPFrom == "") {
		return errors.New("Configure RESEND_API_KEY + MAIL_FROM, SMTP, or explicit development mail directory")
	}
	if c.ResendAPIKey != "" && c.MailFrom == "" {
		return errors.New("MAIL_FROM required with Resend")
	}
	return nil
}
