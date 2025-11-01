# Migration Guide: Updating to 6-Player Support

If you have an existing Yamb game with Supabase already set up, follow these steps to enable 6-player support.

## For Existing Supabase Databases

### Step 1: Update the Default max_players Value

Run this SQL command in your Supabase SQL Editor:

```sql
-- Update the default value for max_players column
ALTER TABLE games ALTER COLUMN max_players SET DEFAULT 6;
```

### Step 2: (Optional) Update Existing Games

If you have existing games in the `waiting` status that you want to allow more players to join, run:

```sql
-- Update existing games to allow up to 6 players
UPDATE games 
SET max_players = 6 
WHERE status = 'waiting' 
  AND max_players < 6;
```

**Note:** Only update games that are still in the waiting room. Games that are already in progress or completed should not be modified.

## For New Installations

If you're setting up Supabase for the first time, simply follow the instructions in `SUPABASE_SETUP.md`. The database schema now defaults to 6 players.

## Verifying the Change

After running the migration, you can verify the change with:

```sql
-- Check the default value
SELECT column_default 
FROM information_schema.columns 
WHERE table_name = 'games' 
  AND column_name = 'max_players';
```

You should see `6` as the default value.

## What's Changed

- **Maximum players per game**: Increased from 2 to 6
- **Minimum players to start**: Still 2 players minimum
- **UI updates**: Lobby now shows "Players (X/6)" instead of "Players (X/2)"

## Rollback (if needed)

If you need to rollback to 2-player support:

```sql
-- Rollback to 2 players maximum
ALTER TABLE games ALTER COLUMN max_players SET DEFAULT 2;

-- Update any waiting games back to 2 players
UPDATE games 
SET max_players = 2 
WHERE status = 'waiting';
```

## Questions?

If you encounter any issues during migration, please open an issue on the GitHub repository.
