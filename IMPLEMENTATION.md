# Yamb App - Virtual Dice & Game Modes Implementation

## Phase 2: Online Features - TODO

The following features will be implemented next:

### Supabase Integration
- [ ] Create Supabase client setup
- [ ] Define database schema (rooms, players, game_state)
- [ ] Set up real-time subscriptions

### Room/Lobby System
- [ ] Create room in database
- [ ] Join existing room
- [ ] Room code validation
- [ ] Player management

### Turn Management
- [ ] Track current player
- [ ] Turn rotation logic
- [ ] Turn timeout (optional)

### Real-time Updates
- [ ] Sync game state across players
- [ ] Broadcast score updates
- [ ] Handle player disconnections

### Live Player Status
- [ ] Show who's currently rolling
- [ ] Display other players' progress
- [ ] Indicate when players finish turns

### Database Schema (Planned)

```sql
-- Rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(6) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  status VARCHAR(20) DEFAULT 'waiting', -- waiting, playing, finished
  settings JSONB
);

-- Players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id),
  player_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100),
  joined_at TIMESTAMP DEFAULT NOW(),
  is_connected BOOLEAN DEFAULT true
);

-- Game state table
CREATE TABLE game_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id),
  player_id VARCHAR(50) REFERENCES players(player_id),
  current_turn VARCHAR(50),
  scores JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Turn events table
CREATE TABLE turn_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id),
  player_id VARCHAR(50),
  event_type VARCHAR(50), -- roll, lock, score, announce
  event_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Environment Setup for Phase 2

Create `.env.local` with:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Notes

- All code is modular and follows existing project patterns
- Virtual dice UI is a reusable component
- Game mode manager is a singleton for easy access
- CSS maintains the existing glassmorphism design
- Dark mode fully supported
- Mobile responsive
- Accessibility considered (ARIA labels, keyboard navigation ready)

## Performance Considerations

- Virtual dice use requestAnimationFrame for smooth animations
- Cryptographic random generation is fast (< 1ms per roll)
- State management is efficient (immutable updates)
- No memory leaks (proper cleanup on dialog close)

## Browser Compatibility

- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)
- ⚠️ Requires Web Crypto API support (available in all modern browsers)

## Future Enhancements (Ideas)

- [ ] Dice roll animations (3D CSS transforms)
- [ ] Sound effects for dice rolls
- [ ] Vibration feedback on mobile
- [ ] Undo last roll
- [ ] Dice roll history viewer
- [ ] Custom dice skins/themes
- [ ] Statistics tracking (roll distribution, best scores)
- [ ] Achievement system
- [ ] Tournament mode
