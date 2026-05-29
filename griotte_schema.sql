-- GRIOTTE Schema v2.0
-- Exécuter sur Railway PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'reader',
  status VARCHAR(20) DEFAULT 'active',
  credits INTEGER DEFAULT 0,
  country VARCHAR(100),
  earnings DECIMAL(12,2) DEFAULT 0,
  withdrawn DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  synopsis TEXT,
  genre VARCHAR(100),
  cover VARCHAR(10) DEFAULT '📖',
  free_pages INTEGER DEFAULT 3,
  status VARCHAR(20) DEFAULT 'published',
  featured BOOLEAN DEFAULT false,
  series_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content TEXT,
  UNIQUE(story_id, page_number)
);

CREATE TABLE page_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  story_id UUID REFERENCES stories(id),
  page_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, story_id, page_number)
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  type VARCHAR(20),
  amount DECIMAL(12,2),
  label VARCHAR(255),
  status VARCHAR(20) DEFAULT 'completed',
  provider VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  story_id UUID REFERENCES stories(id),
  stars INTEGER CHECK(stars BETWEEN 1 AND 5),
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, story_id)
);

CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID REFERENCES users(id),
  amount DECIMAL(12,2),
  method VARCHAR(50),
  phone VARCHAR(30),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id UUID REFERENCES users(id),
  to_user_id UUID REFERENCES users(id),
  rewarded BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE series (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255),
  description TEXT,
  cover VARCHAR(10),
  author_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_stories_status ON stories(status);
CREATE INDEX idx_stories_author ON stories(author_id);
CREATE INDEX idx_pages_story ON pages(story_id, page_number);
CREATE INDEX idx_reads_user ON page_reads(user_id);
CREATE INDEX idx_tx_user ON transactions(user_id);
CREATE INDEX idx_reviews_story ON reviews(story_id);

-- ADMIN USER (mot de passe: admin123)
INSERT INTO users (name, email, password_hash, role, status)
VALUES ('Admin GRIOTTE', 'admin@griotte.app', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 'active');

SELECT 'Schema GRIOTTE créé avec succès' as message;
