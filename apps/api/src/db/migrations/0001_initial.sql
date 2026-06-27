CREATE TABLE IF NOT EXISTS networks (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  submitter_name VARCHAR(100) NOT NULL,
  file_url TEXT NOT NULL,
  neuron_count INTEGER NOT NULL,
  synapse_count INTEGER NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  run_count INTEGER NOT NULL DEFAULT 0,
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR(36) PRIMARY KEY,
  network_id VARCHAR(36) NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  params_used JSONB NOT NULL DEFAULT '{}',
  timesteps INTEGER NOT NULL,
  spike_count INTEGER NOT NULL,
  ip_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votes (
  id VARCHAR(36) PRIMARY KEY,
  network_id VARCHAR(36) NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ip_hash VARCHAR(64) NOT NULL,
  direction VARCHAR(4) NOT NULL CHECK (direction IN ('up', 'down')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(network_id, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_networks_run_count ON networks(run_count DESC);
CREATE INDEX IF NOT EXISTS idx_networks_created_at ON networks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_networks_name ON networks(name);
CREATE INDEX IF NOT EXISTS idx_runs_network_id ON runs(network_id);
CREATE INDEX IF NOT EXISTS idx_votes_network_id ON votes(network_id);
