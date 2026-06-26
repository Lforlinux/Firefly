-- Firefly Portfolio Tracker PostgreSQL Schema
-- Stage 1: Auth + Holdings management

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token VARCHAR(512) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  sector VARCHAR(100),
  shares DECIMAL(20, 8) NOT NULL,
  avg_cost DECIMAL(15, 4) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_value DECIMAL(15, 2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holding_id UUID NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  transaction_type VARCHAR(50) NOT NULL,
  shares DECIMAL(20, 8) NOT NULL,
  price DECIMAL(15, 4) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
  transaction_date DATE NOT NULL,
  notes TEXT,
  source_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(50) NOT NULL,
  price DECIMAL(15, 4) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticker, currency)
);

CREATE TABLE IF NOT EXISTS fx_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(15, 8) NOT NULL,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(from_currency, to_currency)
);

CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
  theme VARCHAR(50) DEFAULT 'dark',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_holdings_user_id ON holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_id ON snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_holding_id ON transactions(holding_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_source_id_unique ON transactions(user_id, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_sessions_user_id ON users_sessions(user_id);

-- Migrations: align price_cache / fx_cache with API schema
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS as_of TIMESTAMPTZ;
UPDATE price_cache SET as_of = last_updated WHERE as_of IS NULL;
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE fx_cache ADD COLUMN IF NOT EXISTS pair TEXT;
UPDATE fx_cache SET pair = from_currency || '-' || to_currency WHERE pair IS NULL;
ALTER TABLE fx_cache ADD COLUMN IF NOT EXISTS as_of TIMESTAMPTZ;
UPDATE fx_cache SET as_of = last_updated WHERE as_of IS NULL;
ALTER TABLE fx_cache ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_fx_cache_pair ON fx_cache(pair);

-- Daily movement: store previous trading day's closing price
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS prev_close DECIMAL(15, 4);
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS prev_close_as_of TIMESTAMPTZ;

-- ISA deposit tracking (T212, AJBell, manual)
CREATE TABLE IF NOT EXISTS isa_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  source TEXT NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  deposit_date DATE NOT NULL,
  notes TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_isa_deposits_source_id ON isa_deposits(user_id, source_id) WHERE source_id IS NOT NULL;

-- Daily market movement tracking (one row per user + date + owner)
CREATE TABLE IF NOT EXISTS daily_movements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movement_date DATE NOT NULL,
  owner TEXT NOT NULL DEFAULT 'all',
  movement_gbp NUMERIC NOT NULL,
  portfolio_value_gbp NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, movement_date, owner)
);
CREATE INDEX IF NOT EXISTS idx_daily_movements_user_date ON daily_movements(user_id, movement_date DESC);

-- Price refresh run history: makes silent cron failures checkable.
-- (UI's "Last refresh" badge takes MAX(as_of) across price_cache, so it stays
-- looking fresh even when a subset of tickers — e.g. all US stocks — silently
-- stop updating. This table records every refresh-prices run so per-run error
-- counts can be queried directly: SELECT * FROM refresh_log ORDER BY run_at DESC LIMIT 20;)
CREATE TABLE IF NOT EXISTS refresh_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_cron BOOLEAN NOT NULL DEFAULT FALSE,
  tickers_total INT NOT NULL,
  tickers_refreshed INT NOT NULL,
  error_count INT NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_refresh_log_run_at ON refresh_log(run_at DESC);
