-- Identity/Auth (PostgreSQL)
CREATE TABLE users (
  user_id UUID PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  did TEXT,
  reputation_score NUMERIC(5,2) DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id),
  device_fingerprint TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

-- Media/Video
CREATE TABLE media_assets (
  asset_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(user_id),
  media_type TEXT NOT NULL,
  object_uri TEXT NOT NULL,
  moderation_state TEXT NOT NULL,
  ai_caption JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE video_variants (
  variant_id UUID PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES media_assets(asset_id),
  bitrate_kbps INT NOT NULL,
  codec TEXT NOT NULL,
  playlist_uri TEXT NOT NULL,
  is_vr BOOLEAN DEFAULT false
);

-- Messaging
CREATE TABLE conversation_channels (
  channel_id UUID PRIMARY KEY,
  channel_type TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(user_id),
  e2ee_mode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channel_members (
  channel_id UUID NOT NULL REFERENCES conversation_channels(channel_id),
  user_id UUID NOT NULL REFERENCES users(user_id),
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- Monetization
CREATE TABLE wallet_accounts (
  wallet_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_ledger_entries (
  entry_id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallet_accounts(wallet_id),
  event_type TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Location Intelligence
CREATE TABLE geo_events (
  event_id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(user_id),
  event_type TEXT NOT NULL,
  geohash TEXT NOT NULL,
  payload JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_geo_events_geohash_time ON geo_events(geohash, captured_at DESC);
