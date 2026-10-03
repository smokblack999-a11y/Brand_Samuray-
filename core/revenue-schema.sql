CREATE TABLE IF NOT EXISTS samurai_revenue_ledger (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  previous_hash TEXT,
  record_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, record_type, record_key),
  UNIQUE (tenant_id, record_hash)
);
CREATE INDEX IF NOT EXISTS idx_samurai_revenue_tenant_time ON samurai_revenue_ledger (tenant_id, created_at DESC);
