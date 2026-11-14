CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text UNIQUE NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_codes(email text PRIMARY KEY,digest text NOT NULL,expires_at timestamptz NOT NULL,attempts int NOT NULL DEFAULT 0,sent_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces(id text PRIMARY KEY,slug text UNIQUE NOT NULL,name text NOT NULL,revision bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS memberships(workspace_id text REFERENCES workspaces(id),user_id text REFERENCES users(id),role text NOT NULL CHECK(role IN ('admin','member','viewer')),PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS join_requests(id text PRIMARY KEY,workspace_id text REFERENCES workspaces(id),user_id text REFERENCES users(id),message text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS invites(id text PRIMARY KEY,workspace_id text REFERENCES workspaces(id),email text NOT NULL,role text NOT NULL CHECK(role IN ('member','viewer')),status text NOT NULL DEFAULT 'pending',expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pages(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),metadata jsonb NOT NULL,trashed boolean NOT NULL DEFAULT false,deleted boolean NOT NULL DEFAULT false,content jsonb,version bigint NOT NULL DEFAULT 0,lineage text,sequence numeric(20,0));
CREATE INDEX IF NOT EXISTS pages_workspace ON pages(workspace_id);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS mcp_tokens(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),label text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz);
CREATE INDEX IF NOT EXISTS mcp_tokens_user ON mcp_tokens(user_id);
CREATE TABLE IF NOT EXISTS email_rate_limits(key text PRIMARY KEY,window_start timestamptz NOT NULL DEFAULT now(),count int NOT NULL);
CREATE TABLE IF NOT EXISTS assets(name text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),document_id text NOT NULL REFERENCES pages(id),created_at timestamptz NOT NULL DEFAULT now());
-- Unused since instance_admins (§5.1); keep the empty table rather than drop it mid-flight.
CREATE TABLE IF NOT EXISTS bootstrap_markers(name text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE pages ADD COLUMN IF NOT EXISTS admission_started boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS schema_migrations(version int PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ai_credentials(scope text NOT NULL CHECK(scope IN ('personal','workspace')),owner_id text NOT NULL,encrypted_key bytea,model text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope,owner_id));
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;

-- Workspace images do not require an existing page (emoji and cover uploads).
ALTER TABLE assets ALTER COLUMN document_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS workspace_emojis(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),name text NOT NULL,url text NOT NULL,created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,name));
INSERT INTO schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;

-- Permissions par page. La visibilité s'hérite du parent tant qu'elle vaut 'inherit' ;
-- un partage nommé s'ajoute par-dessus. Conception : docs/plans/2026-11-13-page-permissions-design.md
ALTER TABLE pages ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'inherit' CHECK(visibility IN ('inherit','private','workspace'));
-- Compatibilité : ce qui existait reste ouvert à l'espace. Le schéma étant rejoué à
-- chaque démarrage, ce rattrapage se conditionne à sa propre première exécution.
UPDATE pages SET visibility='workspace' WHERE coalesce(metadata->>'parentId','')='' AND visibility='inherit' AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=4);
CREATE TABLE IF NOT EXISTS page_shares(page_id text NOT NULL REFERENCES pages(id),user_id text NOT NULL REFERENCES users(id),level text NOT NULL CHECK(level IN ('view','edit','full')),granted_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(page_id,user_id));
CREATE INDEX IF NOT EXISTS page_shares_user ON page_shares(user_id);
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;

-- Instance self-host : réglages, administrateurs, jeton de setup.
-- Conception : docs/plans/2026-11-14-self-host-product-plan.md
CREATE TABLE IF NOT EXISTS instance_settings(
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  name text NOT NULL DEFAULT 'Blok',
  signup_policy text NOT NULL DEFAULT 'invite'
    CHECK(signup_policy IN ('invite','domain','open')),
  signup_domains text[] NOT NULL DEFAULT '{}',
  workspace_creation text NOT NULL DEFAULT 'admins_only'
    CHECK(workspace_creation IN ('anyone','admins_only','disabled')),
  default_workspace_id text REFERENCES workspaces(id),
  setup_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users(id));
CREATE TABLE IF NOT EXISTS instance_admins(
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS setup_tokens(
  digest text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
INSERT INTO instance_settings DEFAULT VALUES ON CONFLICT DO NOTHING;
-- Une instance qui a déjà des membres n'attend pas d'assistant.
UPDATE instance_settings SET setup_completed_at=now()
 WHERE setup_completed_at IS NULL AND EXISTS(SELECT 1 FROM memberships);
-- ...et elle garde les politiques sous lesquelles elle tournait.
-- Le schéma étant rejoué à chaque démarrage, ce rattrapage se conditionne
-- à sa propre première exécution — sinon chaque redémarrage écraserait le
-- choix de l'administrateur.
UPDATE instance_settings SET signup_policy='open', workspace_creation='anyone'
 WHERE NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=5)
   AND EXISTS(SELECT 1 FROM memberships);
-- Un espace unique est l'espace par défaut : le client cesse de nommer un slug.
UPDATE instance_settings SET default_workspace_id=(SELECT id FROM workspaces)
 WHERE default_workspace_id IS NULL AND (SELECT count(*) FROM workspaces)=1;
INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
