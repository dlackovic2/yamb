# Yamb Scorekeeper

A minimal-yet-polished web app for manually logging Yamb dice results. Roll your own dice, drop the numbers into the grid, and the sheet keeps every subtotal, bonus, and grand total fresh for you.

> **Key scoring rules baked in**
>
> - Bonus: +30 points once the subtotal for ones–sixes reaches 60.
> - Difference: computed as `(Max − Min) × Ones`, the classic Yamb multiplier.

## ✨ Highlights

- Beautiful glassmorphism inspired layout with light/dark toggle
- Four standard columns: Down, Up, Free, and Announce
- Automatic subtotal, bonus, difference, and grand total calculations
- Persistent storage via `localStorage`, plus quick export to JSON
- Mobile-first column switcher keeps inputs roomy on phones
- Dice-styled labels and built-in tips for tricky combos
- Input validation prevents impossible scores from being saved
- Sequential play guards for the Up and Down columns keep entries in the correct order
- Announce column launchpad with a dice-roll modal makes logging declared throws feel immersive
- Settings menu bundles export/import tools and a polished reset confirmation dialog
- Completing the sheet triggers a celebratory summary modal so you can compare totals at a glance

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

## 🧠 Customisation tips

- Update scoring logic in `scripts/scoring.js` if your house rules tweak bonuses or the difference multiplier.
- The color palette and layout live in `assets/styles.css`; adjust CSS variables at the top to rebrand quickly.
- Add or remove columns by editing the `columns` array in `scripts/scoring.js`. The UI and storage adapt automatically.

## 📁 Project structure

```
.
├── assets
│   └── styles.css      # Global styling and responsive layout
├── scripts
│   ├── app.js          # UI wiring, state management, storage, theme
│   └── scoring.js      # Scoring model, calculations, configuration
├── tests
│   └── scoring.test.js # Vitest specs for scoring helpers
├── index.html
├── package.json
└── README.md
```

## 🧪 Quality gates

- ✅ `npm test` — validates scoring calculations stay correct

## 📜 License

Released under the MIT License — enjoy and adapt freely.
