-- One finished daily run per player per mode.
CREATE TABLE IF NOT EXISTS scores (
  date TEXT NOT NULL,        -- the player's local puzzle date, YYYY-MM-DD
  mode TEXT NOT NULL,        -- batters-season | batters-career | pitchers-season | pitchers-career
  uid TEXT NOT NULL,         -- anonymous random id from the player's browser
  score INTEGER NOT NULL,    -- correct calls, recomputed server-side
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, mode, uid)
);

CREATE INDEX IF NOT EXISTS scores_by_day ON scores (date, mode, score);
