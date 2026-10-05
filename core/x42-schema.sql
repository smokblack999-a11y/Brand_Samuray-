-- X42 Veto Audit
-- PostgreSQL is the authoritative audit store for VETO/EXECUTE decisions.

CREATE TABLE IF NOT EXISTS x42_veto_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  policy_version BIGINT NOT NULL,
  decision BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  veto_level TEXT NOT NULL,
  risk_size_micro BIGINT NOT NULL CHECK (risk_size_micro >= 0),
  previous_hash TEXT,
  record_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT x42_unique_tenant_decision UNIQUE (tenant_id, decision_id),
  CONSTRAINT x42_unique_tenant_hash UNIQUE (tenant_id, record_hash)
);

CREATE INDEX IF NOT EXISTS idx_x42_audit_tenant_time
  ON x42_veto_audit(tenant_id, audit_id);

CREATE OR REPLACE FUNCTION x42_reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'X42 veto audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS x42_audit_immutable ON x42_veto_audit;
CREATE TRIGGER x42_audit_immutable
BEFORE UPDATE OR DELETE ON x42_veto_audit
FOR EACH ROW EXECUTE FUNCTION x42_reject_audit_mutation();
