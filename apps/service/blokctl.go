package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// BlokctlUsage is printed on bad arguments.
const BlokctlUsage = `usage: blokctl <command>

  blokctl admin grant <email>
  blokctl admin list
  blokctl admin revoke <email>
  blokctl settings show
  blokctl settings set key=value...
  blokctl setup token [--regenerate]
  blokctl email test <address>

Config is read from the environment (DATABASE_URL required).
`

// Blokctl runs one recovery command against cfg. stdout/stderr receive output.
func Blokctl(ctx context.Context, cfg Config, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("missing command")
	}
	switch args[0] {
	case "admin", "settings", "setup", "email":
	case "help", "-h", "--help":
		fmt.Fprint(stdout, BlokctlUsage)
		return nil
	default:
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("unknown command")
	}
	ops, e := Operate(ctx, cfg)
	if e != nil {
		return e
	}
	defer ops.Close()

	switch args[0] {
	case "admin":
		return blokctlAdmin(ctx, ops, args[1:], stdout, stderr)
	case "settings":
		return blokctlSettings(ctx, ops, args[1:], stdout, stderr)
	case "setup":
		return blokctlSetup(ctx, ops, args[1:], stdout, stderr)
	case "email":
		return blokctlEmail(ctx, ops, args[1:], stdout, stderr)
	default:
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("unknown command")
	}
}

func blokctlAdmin(ctx context.Context, ops *Ops, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("missing admin subcommand")
	}
	switch args[0] {
	case "grant":
		if len(args) != 2 {
			fmt.Fprint(stderr, BlokctlUsage)
			return errors.New("usage: blokctl admin grant <email>")
		}
		created, e := ops.GrantInstanceAdmin(ctx, args[1])
		if e != nil {
			return e
		}
		email, _ := normalizeEmail(args[1])
		if created {
			fmt.Fprintf(stdout, "created and granted instance admin: %s\n", email)
		} else {
			fmt.Fprintf(stdout, "granted instance admin: %s\n", email)
		}
		return nil
	case "list":
		if len(args) != 1 {
			fmt.Fprint(stderr, BlokctlUsage)
			return errors.New("usage: blokctl admin list")
		}
		emails, e := ops.ListInstanceAdmins(ctx)
		if e != nil {
			return e
		}
		for _, email := range emails {
			fmt.Fprintln(stdout, email)
		}
		return nil
	case "revoke":
		if len(args) != 2 {
			fmt.Fprint(stderr, BlokctlUsage)
			return errors.New("usage: blokctl admin revoke <email>")
		}
		if e := ops.RevokeInstanceAdmin(ctx, args[1]); e != nil {
			return e
		}
		email, _ := normalizeEmail(args[1])
		fmt.Fprintf(stdout, "revoked instance admin: %s\n", email)
		return nil
	default:
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("unknown admin subcommand")
	}
}

func blokctlSettings(ctx context.Context, ops *Ops, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("missing settings subcommand")
	}
	switch args[0] {
	case "show":
		if len(args) != 1 {
			fmt.Fprint(stderr, BlokctlUsage)
			return errors.New("usage: blokctl settings show")
		}
		cfg, e := ops.Settings(ctx)
		if e != nil {
			return e
		}
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(settingsJSON(cfg))
	case "set":
		if len(args) < 2 {
			fmt.Fprint(stderr, BlokctlUsage)
			return errors.New("usage: blokctl settings set key=value...")
		}
		patch, e := parseSettingsPairs(args[1:])
		if e != nil {
			return e
		}
		updated, e := ops.SetSettings(ctx, patch)
		if e != nil {
			return e
		}
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(settingsJSON(updated))
	default:
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("unknown settings subcommand")
	}
}

func parseSettingsPairs(pairs []string) (SettingsPatch, error) {
	var patch SettingsPatch
	for _, raw := range pairs {
		key, value, ok := strings.Cut(raw, "=")
		if !ok || key == "" {
			return patch, fmt.Errorf("invalid setting %q (want key=value)", raw)
		}
		switch key {
		case "name":
			name := strings.TrimSpace(value)
			if len(name) < 1 || len(name) > 120 {
				return patch, errors.New("invalid name")
			}
			patch.Name = &name
		case "signup-policy":
			switch value {
			case "invite", "domain", "open":
			default:
				return patch, errors.New("invalid signup-policy")
			}
			patch.SignupPolicy = &value
		case "workspace-creation":
			switch value {
			case "anyone", "admins_only", "disabled":
			default:
				return patch, errors.New("invalid workspace-creation")
			}
			patch.WorkspaceCreation = &value
		case "signup-domains":
			parts := strings.FieldsFunc(value, func(r rune) bool { return r == ',' })
			domains := make([]string, 0, len(parts))
			for _, p := range parts {
				p = strings.ToLower(strings.TrimSpace(p))
				if p != "" {
					domains = append(domains, p)
				}
			}
			patch.SignupDomains = &domains
		case "default-workspace-id":
			if value == "" {
				return patch, errors.New("invalid default-workspace-id")
			}
			patch.DefaultWorkspaceID = &value
		default:
			return patch, fmt.Errorf("unknown setting %q", key)
		}
	}
	return patch, nil
}

func blokctlSetup(ctx context.Context, ops *Ops, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 || args[0] != "token" {
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("usage: blokctl setup token [--regenerate]")
	}
	regenerate := false
	for _, a := range args[1:] {
		switch a {
		case "--regenerate":
			regenerate = true
		default:
			fmt.Fprint(stderr, BlokctlUsage)
			return fmt.Errorf("unknown flag %q", a)
		}
	}
	token, e := ops.SetupToken(ctx, regenerate)
	if e != nil {
		return e
	}
	fmt.Fprintln(stdout, token)
	return nil
}

func blokctlEmail(ctx context.Context, ops *Ops, args []string, stdout, stderr io.Writer) error {
	if len(args) != 2 || args[0] != "test" {
		fmt.Fprint(stderr, BlokctlUsage)
		return errors.New("usage: blokctl email test <address>")
	}
	backend, e := ops.EmailTest(ctx, args[1])
	if e != nil {
		return e
	}
	fmt.Fprintf(stdout, "ok backend=%s\n", backend)
	return nil
}
