-- VoxDrop Database Schema
-- Run this in your Supabase SQL Editor

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_auth_id UUID UNIQUE NOT NULL,
  username TEXT,
  avatar_url TEXT,
  is_revealed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_auth_id ON users(supabase_auth_id);

-- Voice notes
CREATE TABLE voice_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  audio_path TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 30),
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'delivered', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_voice_notes_status ON voice_notes(status);
CREATE INDEX idx_voice_notes_sender ON voice_notes(sender_id);

-- Deliveries
CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_note_id UUID REFERENCES voice_notes(id) ON DELETE CASCADE NOT NULL,
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  response_emoji TEXT,
  response_text TEXT CHECK (response_text IS NULL OR char_length(response_text) <= 40),
  listened_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(voice_note_id)
);

CREATE INDEX idx_deliveries_recipient ON deliveries(recipient_id);
CREATE INDEX idx_deliveries_voice_note ON deliveries(voice_note_id);

-- Reveal requests
CREATE TABLE reveal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID REFERENCES deliveries(id) ON DELETE CASCADE NOT NULL,
  requester_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(delivery_id, requester_id)
);

CREATE INDEX idx_reveal_requests_delivery ON reveal_requests(delivery_id);

-- Matches (mutual reveal + payment)
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID REFERENCES deliveries(id) ON DELETE CASCADE NOT NULL UNIQUE,
  user1_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  user2_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  stripe_payment_intent_id TEXT,
  unlocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_matches_users ON matches(user1_id, user2_id);

-- Delivery history (prevent repeat sends to same pair)
CREATE TABLE delivery_history (
  sender_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (sender_id, recipient_id)
);

-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE reveal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can read their own data
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  USING (supabase_auth_id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (supabase_auth_id = auth.uid());

CREATE POLICY "Service role can manage all users"
  ON users FOR ALL
  USING (auth.role() = 'service_role');

-- Voice notes: users can see their own sent notes
CREATE POLICY "Users can read own voice notes"
  ON voice_notes FOR SELECT
  USING (sender_id IN (SELECT id FROM users WHERE supabase_auth_id = auth.uid()));

CREATE POLICY "Service role can manage all voice notes"
  ON voice_notes FOR ALL
  USING (auth.role() = 'service_role');

-- Deliveries: recipients can see their deliveries
CREATE POLICY "Recipients can read their deliveries"
  ON deliveries FOR SELECT
  USING (recipient_id IN (SELECT id FROM users WHERE supabase_auth_id = auth.uid()));

CREATE POLICY "Recipients can update their deliveries"
  ON deliveries FOR UPDATE
  USING (recipient_id IN (SELECT id FROM users WHERE supabase_auth_id = auth.uid()));

CREATE POLICY "Service role can manage all deliveries"
  ON deliveries FOR ALL
  USING (auth.role() = 'service_role');

-- Reveal requests: involved users can see
CREATE POLICY "Users can read own reveal requests"
  ON reveal_requests FOR SELECT
  USING (requester_id IN (SELECT id FROM users WHERE supabase_auth_id = auth.uid()));

CREATE POLICY "Service role can manage all reveal requests"
  ON reveal_requests FOR ALL
  USING (auth.role() = 'service_role');

-- Matches: involved users can see
CREATE POLICY "Users can read own matches"
  ON matches FOR SELECT
  USING (
    user1_id IN (SELECT id FROM users WHERE supabase_auth_id = auth.uid())
    OR user2_id IN (SELECT id FROM users WHERE supabase_auth_id = auth.uid())
  );

CREATE POLICY "Service role can manage all matches"
  ON matches FOR ALL
  USING (auth.role() = 'service_role');

-- Storage bucket for voice notes
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-notes', 'voice-notes', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: authenticated users can upload
CREATE POLICY "Authenticated users can upload voice notes"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'voice-notes' AND auth.role() = 'authenticated');

-- Storage policy: authenticated users can read voice notes
CREATE POLICY "Authenticated users can read voice notes"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'voice-notes' AND auth.role() = 'authenticated');

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Supabase Realtime: enable for deliveries and matches
ALTER PUBLICATION supabase_realtime ADD TABLE deliveries;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE reveal_requests;
