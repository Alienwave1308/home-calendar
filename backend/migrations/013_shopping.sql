-- Shopping list items shared within a family
CREATE TABLE IF NOT EXISTS shopping_items (
  id SERIAL PRIMARY KEY,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  is_bought BOOLEAN NOT NULL DEFAULT false,
  added_by INTEGER NOT NULL REFERENCES users(id),
  bought_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  bought_at TIMESTAMP
);

-- Index for quick lookup by family
CREATE INDEX IF NOT EXISTS idx_shopping_family ON shopping_items(family_id);
