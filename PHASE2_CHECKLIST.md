# Phase 2: Online Multiplayer Implementation Checklist

## Prerequisites
- [ ] Phase 1 committed and tested
- [ ] Supabase account created
- [ ] `.env.local` file configured with Supabase credentials

## 1. Supabase Setup

### Database Schema
- [ ] Create `rooms` table
- [ ] Create `players` table  
- [ ] Create `game_state` table
- [ ] Create `turn_events` table
- [ ] Set up Row Level Security (RLS) policies
- [ ] Create indexes for performance

### Real-time Configuration
- [ ] Enable real-time for `game_state` table
- [ ] Enable real-time for `turn_events` table
- [ ] Configure broadcast settings

### SQL Script
```sql
-- See IMPLEMENTATION.md for full schema
```

## 2. Supabase Client Integration

### Files to Create
- [ ] `scripts/services/supabaseClient.js` - Supabase client singleton
- [ ] `scripts/services/roomService.js` - Room CRUD operations
- [ ] `scripts/services/gameStateService.js` - Game state sync
- [ ] `scripts/services/playerService.js` - Player management
- [ ] `scripts/services/realtimeService.js` - Real-time subscriptions

### Features
- [ ] Initialize Supabase client
- [ ] Environment variable loading
- [ ] Error handling
- [ ] Connection status monitoring

## 3. Room/Lobby System

### UI Components
- [ ] Room creation flow
- [ ] Room joining flow
- [ ] Room code validation and display
- [ ] Player list display
- [ ] "Waiting for players" screen
- [ ] "Start game" button (host only)
- [ ] Room settings (optional)

### Backend Integration
- [ ] Create room in database
- [ ] Generate unique room code
- [ ] Validate room code on join
- [ ] Add player to room
- [ ] Remove player on disconnect
- [ ] Delete empty rooms

### Files to Modify
- [ ] `scripts/gameModeManager.js` - Add room service calls
- [ ] `index.html` - Update online options UI

## 4. Turn Management

### Features to Implement
- [ ] Track current player's turn
- [ ] Turn rotation logic
- [ ] Turn start/end events
- [ ] Turn timeout (optional)
- [ ] Skip inactive players
- [ ] End game detection

### UI Updates
- [ ] "Your turn" indicator
- [ ] "Waiting for [player]" message
- [ ] Turn timer display (optional)
- [ ] Disable input when not your turn

### Files to Create/Modify
- [ ] `scripts/turnManager.js` - Turn logic
- [ ] Update `scripts/gameModeManager.js`

## 5. Real-time Game State Sync

### Subscription Handlers
- [ ] Subscribe to room's game state
- [ ] Handle score updates from other players
- [ ] Handle turn changes
- [ ] Handle player join/leave events
- [ ] Handle game completion

### Conflict Resolution
- [ ] Optimistic updates
- [ ] Server reconciliation
- [ ] Error recovery
- [ ] Network disconnection handling

### Files to Create
- [ ] `scripts/syncManager.js` - Coordinate local and remote state

## 6. Live Player Status

### Status Types
- [ ] Idle (waiting)
- [ ] Rolling (virtual dice active)
- [ ] Thinking (dice rolled, choosing score)
- [ ] Finished turn
- [ ] Disconnected

### UI Indicators
- [ ] Player status badges
- [ ] Color coding
- [ ] Icons for each status
- [ ] Last activity timestamp

### Real-time Updates
- [ ] Broadcast status changes
- [ ] Subscribe to status updates
- [ ] Auto-update UI

## 7. Virtual Dice in Online Mode

### Synchronization
- [ ] Broadcast dice rolls to all players
- [ ] Show other players' dice (read-only)
- [ ] Sync locked dice state
- [ ] Share announcement selection

### UI Updates
- [ ] "Player is rolling..." indicator
- [ ] View other players' current dice
- [ ] Spectator mode for dice

## 8. Player Experience

### Lobby Features
- [ ] Chat system (optional)
- [ ] Ready/Not Ready status
- [ ] Kick player (host only)
- [ ] Leave room button
- [ ] Room settings

### In-Game Features
- [ ] View all players' score sheets
- [ ] Switch between score sheet views
- [ ] Highlight active player
- [ ] Show player avatars/names
- [ ] Display connection status

## 9. Error Handling

### Scenarios to Handle
- [ ] Network disconnection
- [ ] Room not found
- [ ] Player kicked
- [ ] Room full
- [ ] Invalid turn
- [ ] Duplicate actions
- [ ] Database errors

### User Feedback
- [ ] Toast notifications
- [ ] Error dialogs
- [ ] Reconnection prompts
- [ ] Graceful degradation

## 10. Testing

### Unit Tests
- [ ] Room service tests
- [ ] Player service tests
- [ ] Turn manager tests
- [ ] Sync logic tests

### Integration Tests
- [ ] Create and join room flow
- [ ] Turn rotation
- [ ] Real-time updates
- [ ] Disconnection handling

### Manual Testing Checklist
- [ ] Create room with 2+ devices
- [ ] Join room with code
- [ ] Take turns
- [ ] Disconnect and reconnect
- [ ] Complete full game
- [ ] Test with 4 players
- [ ] Test on mobile devices

## 11. Performance Optimization

### Considerations
- [ ] Debounce real-time updates
- [ ] Batch database writes
- [ ] Optimize subscription filters
- [ ] Lazy load player data
- [ ] Cache room information

### Monitoring
- [ ] Log database query times
- [ ] Track real-time latency
- [ ] Monitor connection drops

## 12. Security

### Validation
- [ ] Validate all user inputs
- [ ] Verify turn ownership
- [ ] Prevent score manipulation
- [ ] Rate limit requests

### RLS Policies
- [ ] Players can only update their own state
- [ ] Only host can delete room
- [ ] Only current player can submit turn
- [ ] Read access for all room members

## 13. Documentation

### Update Files
- [ ] `README.md` - Add online features guide
- [ ] `IMPLEMENTATION.md` - Document Phase 2
- [ ] Create `ONLINE_GUIDE.md` - How to play online
- [ ] Update `QUICK_START.md`

### Code Documentation
- [ ] JSDoc comments for all services
- [ ] API documentation
- [ ] Database schema docs

## 14. Deployment Preparation

### Environment Setup
- [ ] Production Supabase project
- [ ] Environment variables for production
- [ ] CORS configuration
- [ ] SSL certificates

### Build Configuration
- [ ] Update Vite config for production
- [ ] Environment variable handling
- [ ] Build script optimization

## 15. Polish & UX

### Nice-to-Have Features
- [ ] Sound effects for turns
- [ ] Confetti on game completion
- [ ] Player statistics
- [ ] Game history
- [ ] Rematch functionality
- [ ] Invite friends via link

### Accessibility
- [ ] Screen reader support
- [ ] Keyboard navigation
- [ ] High contrast mode
- [ ] Focus indicators

## Implementation Order Recommendation

**Week 1: Foundation**
1. Supabase setup and schema ✓
2. Supabase client integration ✓
3. Room creation/joining ✓

**Week 2: Core Multiplayer**
4. Turn management ✓
5. Real-time state sync ✓
6. Player status tracking ✓

**Week 3: Polish & Testing**
7. Error handling ✓
8. Testing (unit + integration) ✓
9. Documentation ✓

**Week 4: Deployment**
10. Performance optimization ✓
11. Security hardening ✓
12. Production deployment ✓

## Quick Start for Phase 2

When ready to start Phase 2:

```powershell
# 1. Set up Supabase
# - Go to supabase.com
# - Create new project
# - Copy credentials to .env.local

# 2. Run database migrations
# - Open Supabase SQL Editor
# - Paste schema from IMPLEMENTATION.md
# - Execute

# 3. Create service files
# - Create scripts/services/ directory
# - Implement supabaseClient.js first
# - Test connection

# 4. Implement incrementally
# - Start with room creation
# - Then joining
# - Then turn management
# - Then real-time sync

# 5. Test frequently
npm test
npm run dev
```

## Resources

- **Supabase Docs**: https://supabase.com/docs
- **Supabase JS Client**: https://supabase.com/docs/reference/javascript
- **Real-time**: https://supabase.com/docs/guides/realtime
- **RLS Policies**: https://supabase.com/docs/guides/auth/row-level-security

## Success Criteria

Phase 2 is complete when:
- [ ] 2+ players can join same room
- [ ] Players see each other's scores in real-time
- [ ] Turn rotation works correctly
- [ ] Virtual dice sync across players
- [ ] Players can complete full game together
- [ ] Disconnection handled gracefully
- [ ] All tests passing
- [ ] Documentation complete

---

**Good luck with Phase 2! The foundation is solid.** 🚀
