-- EVOLUTION V3 initial PostgreSQL schema.
-- Apply only after provisioning and reviewing a dedicated database. This file is not auto-applied.
CREATE TABLE IF NOT EXISTS ev3_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ev3_workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES ev3_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ev3_memberships (
  workspace_id UUID NOT NULL REFERENCES ev3_workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ev3_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS ev3_sites (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES ev3_workspaces(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, origin)
);
CREATE TABLE IF NOT EXISTS ev3_audits (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES ev3_sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  score_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ev3_evidence (
  id UUID PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES ev3_audits(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ev3_repair_proposals (
  id UUID PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES ev3_audits(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES ev3_evidence(id),
  status TEXT NOT NULL CHECK (status IN ('PROPOSED','APPROVED_FOR_REVIEW','REJECTED','APPLIED')),
  risk TEXT NOT NULL CHECK (risk IN ('low','medium','high','critical')),
  patch JSONB NOT NULL,
  approved_by UUID REFERENCES ev3_users(id),
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ev3_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ev3_subscriptions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES ev3_workspaces(id),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ev3_audit_log (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID REFERENCES ev3_workspaces(id),
  actor_user_id UUID REFERENCES ev3_users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ev3_audits_site_created_idx ON ev3_audits(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ev3_evidence_audit_idx ON ev3_evidence(audit_id);
CREATE INDEX IF NOT EXISTS ev3_audit_log_workspace_created_idx ON ev3_audit_log(workspace_id, created_at DESC);
