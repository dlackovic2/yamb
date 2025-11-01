# Yamb Scorekeeper

A minimal-yet-polished web app for manually logging Yamb dice results. Roll your own dice, drop the numbers into the grid, and the sheet keeps every subtotal, bonus, and grand total fresh for you.

**NEW: Virtual Dice & Online Multiplayer!** Choose between physical dice or virtual on-screen dice rolling. Play locally or online with up to 6 players!

> **Key scoring rules baked in**
>
> - Bonus: +30 points once the subtotal for ones–sixes reaches 60.
> - Difference: computed as `(Max − Min) × Ones`, the classic Yamb multiplier.

## ✨ Highlights

- Beautiful glassmorphism inspired layout with light/dark toggle
- Four standard columns: Down, Up, Free, and Announce
- Automatic subtotal, bonus, difference, and grand total calculations
- **🎲 Virtual Dice Mode**: Cryptographically secure random dice rolls with 3-roll system
- **🎮 Game Modes**: Choose between local or online play with either virtual dice or manual score entry
- Turn-locked online manual mode ensures only the active player can edit their scorecard
- **🔒 Lock Dice**: Keep specific dice between rolls when using virtual mode
- **💡 Smart Suggestions**: See all possible scoring options for your current dice
- Persistent storage via `localStorage`, plus quick export to JSON
- Mobile-first column switcher keeps inputs roomy on phones
- Dice-styled labels and built-in tips for tricky combos
- Input validation prevents impossible scores from being saved
- Sequential play guards for the Up and Down columns keep entries in the correct order
- Announce column launchpad with a dice-roll modal makes logging declared throws feel immersive
- Settings menu bundles export/import tools and a polished reset confirmation dialog
- Completing the sheet triggers a celebratory summary modal so you can compare totals at a glance

## 🎲 Virtual Dice Features

When you enable **Virtual Dice Mode**, you get:

1. **True Randomness**: Cryptographically secure random number generation (using `crypto.getRandomValues()`) ensures fair, unpredictable rolls
2. **3-Roll System**: Roll up to 3 times per turn, just like traditional Yamb
3. **Lock/Unlock Dice**: After the first roll, click any die to lock/unlock it. Locked dice keep their values on subsequent rolls
4. **Scoring Suggestions**: After each roll, see all available scoring options with calculated values
5. **Announcement Integration**: When playing the Announce column, you must announce your intended category after the first roll
6. **Visual Feedback**: Beautiful die animations, lock indicators, and roll history

## 🎮 Game Modes

### Location Modes

- **🏠 Local**: Play on a single device (default)
- **🌐 Online**: Play with remote friends via room code—supports 2-6 players with both virtual dice and manual score entry

### Dice Modes

- **🎲 Physical**: Use real dice and manually enter results (original mode)
- **💻 Virtual**: Roll dice on screen with full digital assistance

## 🚀 Getting started

```powershell
# install dependencies
npm install

# run the dev server (opens automatically)
npm run dev

# create a production build (optional)
npm run build

# preview the production build on a local server
npm run preview

# execute the scoring unit tests
npm test
```

The project uses [Vite](https://vitejs.dev/) for speedy development/build tooling and [`vitest`](https://vitest.dev) for fast test execution.

## 🎯 How to Use Virtual Dice

1. Click the **Game Mode** button in the header
2. Select **Virtual** under Dice Type
3. Click **Start Game**
4. When you click on an empty cell in the score table:
   - Virtual dice will automatically roll for the first time
   - Click individual dice to lock/unlock them
   - Click **Roll** to roll again (unlocked dice only)
   - Available scoring options appear below the dice
   - Click a scoring option to fill in that category
5. For the **Announce** column:
   - You must announce your intended category after the first roll
   - Then complete your 3 rolls
   - Only the announced category can be filled

## 🔒 Security & Fairness

Virtual dice use **cryptographic randomness** via the Web Crypto API (`crypto.getRandomValues()`), ensuring:

- **True randomness**: Not pseudo-random or predictable
- **No manipulation**: Values cannot be influenced or cheated
- **Fair play**: Each roll is independent and unbiased
- **Rejection sampling**: Ensures uniform distribution across all die faces

## 🧠 Customisation tips

- Update scoring logic in `scripts/scoring.js` if your house rules tweak bonuses or the difference multiplier.
- The color palette and layout live in `assets/styles.css`; adjust CSS variables at the top to rebrand quickly.
- Add or remove columns by editing the `columns` array in `scripts/scoring.js`. The UI and storage adapt automatically.
- Modify dice behavior in `scripts/dice.js` for custom dice mechanics.
- Adjust game modes in `scripts/gameMode.js` for different play styles.

## 📁 Project structure

```
.
├── assets
│   └── styles.css          # Global styling, responsive layout, and virtual dice UI
├── scripts
│   ├── app.js              # Main UI wiring, state management, storage, theme
│   ├── scoring.js          # Scoring model, calculations, configuration
│   ├── dice.js             # Virtual dice rolling logic and calculations
│   ├── gameMode.js         # Game mode management (local/online, physical/virtual)
│   ├── gameModeManager.js  # UI controller for game modes
│   └── virtualDiceUI.js    # Virtual dice UI component
├── tests
│   ├── scoring.test.js     # Vitest specs for scoring helpers
│   └── dice.test.js        # Vitest specs for dice logic
├── index.html
├── package.json
├── .env.local              # Supabase configuration (for online features)
└── README.md
```

## 🌐 Online Multiplayer

Online multiplayer is now available! Play Yamb with up to 5 friends (6 players total) in real-time.

### Features

- **Room System**: Create or join game rooms with shareable codes
- **2-6 Players**: Support for 2 to 6 players in a single game
- **Turn Management**: Track whose turn it is in real-time
- **Live Updates**: See other players' progress as they play
- **Player Status**: View when others are rolling, thinking, or have finished
- **Connection Monitoring**: See when players go offline or reconnect

### Getting Started

To enable online features, the app requires Supabase integration. Create a `.env.local` file with:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

See `SUPABASE_SETUP.md` for detailed setup instructions.

## 🧪 Quality gates

- ✅ `npm test` — validates scoring calculations stay correct

## �📜 License

Released under the MIT License — enjoy and adapt freely.
