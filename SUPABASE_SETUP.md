# Supabase Setup Guide for Yamb Online Multiplayer

## Phase 1: Supabase Account & Project Setup

### Step 1: Create Supabase Account
1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project" or "Sign In"
3. Sign up using GitHub, Google, or email
4. Verify your email if required

### Step 2: Create a New Project
1. Click "New Project" in your Supabase dashboard
2. Fill in the project details:
   - **Name**: `yamb-game` (or your preferred name)
   - **Database Password**: Choose a strong password (SAVE THIS!)
   - **Region**: Choose closest to your users (e.g., `us-east-1`, `eu-central-1`)
   - **Pricing Plan**: Free tier is fine for development
3. Click "Create new project"
4. Wait 2-3 minutes for the project to be provisioned

### Step 3: Get Your Project Credentials
Once your project is ready:
1. Go to **Project Settings** (gear icon in left sidebar)
2. Click **API** in the settings menu
3. Copy and save these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)

⚠️ **IMPORTANT**: Never commit these to version control! We'll use environment variables.

---

## Phase 2: Database Schema Setup

### Step 4: Create Database Tables

Go to **SQL Editor** in your Supabase dashboard and run these SQL commands:

#### 1. Enable UUID Extension (if not already enabled)
```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

#### 2. Create Games Table
```sql
-- Games table: stores game metadata and state
CREATE TABLE games (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_code VARCHAR(6) UNIQUE NOT NULL,
  host_player_id UUID NOT NULL,
  status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'completed', 'abandoned')),
  current_turn_player_id UUID,
  current_round INTEGER DEFAULT 1,
  max_players INTEGER DEFAULT 2,
  game_mode JSONB NOT NULL DEFAULT '{
    "location": "online",
    "dice": "virtual",
    "columns": "announce"
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  winner_id UUID
);

-- Indexes for performance
CREATE INDEX idx_games_room_code ON games(room_code);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_created_at ON games(created_at DESC);
```

#### 3. Create Players Table
```sql
-- Players table: stores player info for each game
CREATE TABLE players (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name VARCHAR(50) NOT NULL,
  player_order INTEGER NOT NULL,
  is_host BOOLEAN DEFAULT FALSE,
  connection_status VARCHAR(20) DEFAULT 'connected' CHECK (connection_status IN ('connected', 'disconnected')),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: unique player order within a game
  UNIQUE(game_id, player_order)
);

-- Indexes
CREATE INDEX idx_players_game_id ON players(game_id);
CREATE INDEX idx_players_connection ON players(connection_status);
```

#### 4. Create Game State Table
```sql
-- Game state table: stores the scorecard and dice state for each player
CREATE TABLE game_state (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  scorecard JSONB NOT NULL DEFAULT '{}'::jsonb,
  dice_values INTEGER[] DEFAULT ARRAY[1,1,1,1,1],
  dice_locked BOOLEAN[] DEFAULT ARRAY[false,false,false,false,false],
  rolls_remaining INTEGER DEFAULT 3,
  last_action VARCHAR(50),
  last_action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: one state per player per game
  UNIQUE(game_id, player_id)
);

-- Indexes
CREATE INDEX idx_game_state_game_id ON game_state(game_id);
CREATE INDEX idx_game_state_player_id ON game_state(player_id);
CREATE INDEX idx_game_state_updated_at ON game_state(updated_at DESC);
```

#### 5. Create Game Actions Log Table (Optional but recommended)
```sql
-- Game actions: audit log of all game actions
CREATE TABLE game_actions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL,
  action_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_game_actions_game_id ON game_actions(game_id, created_at DESC);
CREATE INDEX idx_game_actions_type ON game_actions(action_type);
```

#### 6. Create Helper Functions
```sql
-- Function to generate unique room codes
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS VARCHAR(6) AS $$
DECLARE
  chars VARCHAR(36) := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Avoid confusing chars
  result VARCHAR(6) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update game_state.updated_at
CREATE TRIGGER update_game_state_updated_at
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Phase 3: Enable Real-time Subscriptions

### Step 5: Enable Real-time for Tables

In Supabase Dashboard:
1. Go to **Database** → **Replication** (in left sidebar)
2. Find and enable real-time for these tables:
   - ✅ `games`
   - ✅ `players`
   - ✅ `game_state`
   - ✅ `game_actions`
3. Click "Save"

---

## Phase 4: Set Up Row Level Security (RLS)

### Step 6: Enable and Configure RLS Policies

Run these SQL commands in **SQL Editor**:

```sql
-- Enable RLS on all tables
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_actions ENABLE ROW LEVEL SECURITY;

-- Games: Anyone can read active games, anyone can create
CREATE POLICY "Games are viewable by everyone"
  ON games FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create a game"
  ON games FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Host can update their game"
  ON games FOR UPDATE
  USING (true); -- We'll restrict this in app logic

-- Players: Anyone can read players in a game
CREATE POLICY "Players are viewable by everyone"
  ON players FOR SELECT
  USING (true);

CREATE POLICY "Anyone can join a game"
  ON players FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Players can update their own record"
  ON players FOR UPDATE
  USING (true);

-- Game State: Anyone can read game state
CREATE POLICY "Game state is viewable by everyone"
  ON game_state FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create game state"
  ON game_state FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Game state can be updated"
  ON game_state FOR UPDATE
  USING (true);

-- Game Actions: Anyone can read and create actions
CREATE POLICY "Game actions are viewable by everyone"
  ON game_actions FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create game actions"
  ON game_actions FOR INSERT
  WITH CHECK (true);
```

**Note**: These are permissive policies for MVP. In production, you'd want to add authentication and restrict based on user roles.

---

## Phase 5: Test Your Setup

### Step 7: Test Database Connection

In SQL Editor, run:
```sql
-- Test query
SELECT 
  (SELECT COUNT(*) FROM games) as games_count,
  (SELECT COUNT(*) FROM players) as players_count,
  (SELECT COUNT(*) FROM game_state) as game_state_count;
```

Expected result: All counts should be 0 (empty tables).

---

## Phase 6: Local Environment Setup

### Step 8: Create Environment File

In your project root, create `.env.local`:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...your-key-here
```

Replace with your actual values from Step 3.

### Step 9: Update .gitignore

Make sure `.env.local` is in your `.gitignore`:

```
.env.local
.env*.local
```

---

## Next Steps

Once you've completed all these steps, you're ready to:
1. ✅ Install Supabase client library (`npm install @supabase/supabase-js`)
2. ✅ Create Supabase service module
3. ✅ Implement online game creation and joining
4. ✅ Implement real-time synchronization
5. ✅ Build the online multiplayer UI

---

## Troubleshooting

### Issue: Tables not appearing in Table Editor
- Go to SQL Editor and run `\dt` to list tables
- Check for errors in SQL execution

### Issue: Real-time not working
- Verify replication is enabled for your tables
- Check browser console for WebSocket connection errors
- Ensure your Supabase project is not paused (free tier pauses after 1 week of inactivity)

### Issue: RLS blocking all queries
- Temporarily disable RLS for testing: `ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;`
- Check policies with: `SELECT * FROM pg_policies WHERE tablename = 'your_table';`

---

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
