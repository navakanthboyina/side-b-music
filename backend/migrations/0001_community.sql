CREATE TABLE IF NOT EXISTS community (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_refresh INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO community(id, data) VALUES
  (1, '{"songRatings":{},"shown":{},"rotation":0,"batch":null,"seedArtists":[],"familiar":{}}');
CREATE TABLE IF NOT EXISTS limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
