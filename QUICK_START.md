# Quick Start Guide - Virtual Dice Features

### 🎲 Virtual Dice Rolling
- **Cryptographically secure random rolls** - no cheating possible!
- **3-roll system** - just like real Yamb
- **Lock/unlock dice** - click dice to keep them between rolls
- **Smart suggestions** - see all possible scores after each roll
- **Beautiful UI** - animated dice with visual feedback

### 🎮 Game Modes
- **Local vs Online** - choose your play style (online ready for Phase 2)
- **Physical vs Virtual dice** - use real dice or virtual ones
- **Easy switching** - change modes anytime via Game Mode button

## 🎯 Next Steps (Phase 2: Online Features)

### Required: Supabase Setup
1. Create a Supabase project at https://supabase.com
2. Create `.env.local` file:
   ```
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your_anon_key_here
   ```

### Features to Implement
- [ ] Room creation and joining
- [ ] Real-time game state sync
- [ ] Turn management
- [ ] Player presence tracking
- [ ] Live updates across players

**Note:** The database schema and integration points are documented in `IMPLEMENTATION.md`

## 🎨 UI Features

### Game Mode Dialog
- Radio button selection for location (Local/Online)
- Radio button selection for dice type (Physical/Virtual)
- Player name input (for online play)
- Room creation/joining (ready for online)

### Virtual Dice Dialog
- 5 beautiful dice with dot patterns
- Click to lock/unlock (shows 🔒 indicator)
- Rolls remaining counter
- "Roll" button (disabled when appropriate)
- Possible scores grid with:
  - Category name
  - Calculated value
  - Description
  - Warnings for invalid moves

## 🔒 Security Features

**Virtual dice are fair and secure:**
- Uses `crypto.getRandomValues()` - true cryptographic randomness
- Rejection sampling ensures uniform distribution
- No way to manipulate or predict rolls
- Client-side only (no server manipulation in offline mode)

## 🎮 Gameplay Features

### Upper Section (1-6)
- Shows count × face value for each
- Example: "3 × 5 = 15" for fives

### Middle Section
- **Max**: Sum of all dice
- **Min**: Sum of all dice (warns if < 5)

### Lower Section
- **Tris**: Sum + 10 (needs 3-of-a-kind)
- **Straight**: Sum + 20 (needs 1-2-3-4-5 or 2-3-4-5-6)
- **Full House**: Sum + 30 (needs 3-of-a-kind + pair)
- **Poker**: Sum + 40 (needs 4-of-a-kind)
- **Yamb**: Sum + 50 (needs 5-of-a-kind)

All automatically detected and displayed!

## 💡 Tips

1. **Lock strategy**: After first roll, lock the dice you want to keep
2. **Scoring options**: Available options show automatically - no mental math needed!
3. **Announce column**: System will prompt you to announce after first roll
4. **Multiple rolls**: You can roll up to 3 times, stop anytime
5. **Visual feedback**: Locked dice turn yellow/gold
6. **Dark mode**: All virtual dice features work in dark mode too!

## 🐛 Troubleshooting

**Q: Dice won't roll?**
- Make sure you haven't used all 3 rolls
- Check that you're in virtual dice mode

**Q: Can't lock dice?**
- You can only lock after the first roll
- You can't lock after using all rolls

**Q: Scores not showing?**
- Make sure you've rolled at least once
- Some categories may already be filled

**Q: Dialog won't open?**
- Check browser console for errors
- Make sure JavaScript is enabled
- Try refreshing the page

## 📱 Mobile Support

Fully responsive! Works great on:
- ✅ iPhone/iPad
- ✅ Android phones/tablets
- ✅ Desktop browsers
- ✅ Touch and mouse input

## 🎨 Customization

Want to customize? Check these files:

- **Colors/themes**: `assets/styles.css` (CSS variables at top)
- **Dice logic**: `scripts/dice.js`
- **UI layout**: `scripts/virtualDiceUI.js`
- **Game modes**: `scripts/gameMode.js`