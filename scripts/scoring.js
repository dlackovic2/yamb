export const columns = [
  { key: "down", label: "Down" },
  { key: "up", label: "Up" },
  { key: "free", label: "Free" },
  { key: "announce", label: "Announce" },
];

export const categories = [
  {
    key: "ones",
    label: "Ones",
    section: "upper",
    input: true,
    dieFace: 1,
    hint: "Possible totals: 0, 1, 2, 3, 4, or 5 (count of rolled ones)",
    invalidMessage: "Ones can only total 0, 1, 2, 3, 4, or 5.",
  },
  {
    key: "twos",
    label: "Twos",
    section: "upper",
    input: true,
    dieFace: 2,
    hint: "Possible totals: 0, 2, 4, 6, 8, or 10",
    invalidMessage: "Twos can only total 0, 2, 4, 6, 8, or 10.",
  },
  {
    key: "threes",
    label: "Threes",
    section: "upper",
    input: true,
    dieFace: 3,
    hint: "Possible totals: 0, 3, 6, 9, 12, or 15",
    invalidMessage: "Threes can only total 0, 3, 6, 9, 12, or 15.",
  },
  {
    key: "fours",
    label: "Fours",
    section: "upper",
    input: true,
    dieFace: 4,
    hint: "Possible totals: 0, 4, 8, 12, 16, or 20",
    invalidMessage: "Fours can only total 0, 4, 8, 12, 16, or 20.",
  },
  {
    key: "fives",
    label: "Fives",
    section: "upper",
    input: true,
    dieFace: 5,
    hint: "Possible totals: 0, 5, 10, 15, 20, or 25",
    invalidMessage: "Fives can only total 0, 5, 10, 15, 20, or 25.",
  },
  {
    key: "sixes",
    label: "Sixes",
    section: "upper",
    input: true,
    dieFace: 6,
    hint: "Possible totals: 0, 6, 12, 18, 24, or 30",
    invalidMessage: "Sixes can only total 0, 6, 12, 18, 24, or 30.",
  },
  {
    key: "upperSubtotal",
    label: "Subtotal",
    subLabel: "1-6",
    section: "upperTotal",
    computed: true,
    style: "total",
    hint: "Sum of the ones–sixes rows",
  },
  {
    key: "bonus",
    label: "Bonus",
    subLabel: "+30 ≥ 60",
    section: "upperTotal",
    computed: true,
    style: "total",
    hint: "Earn +30 when subtotal reaches 60",
  },
  {
    key: "upperTotal",
    label: "Upper",
    subLabel: "total",
    section: "upperTotal",
    computed: true,
    style: "total-strong",
  },
  { key: "max", label: "Max", section: "middle", input: true, hint: "Best high roll score" },
  {
    key: "min",
    label: "Min",
    section: "middle",
    input: true,
    hint: "Lowest roll score — must be at least 5.",
  },
  {
    key: "diff",
    label: "Diff × Ones",
    subLabel: "(Max − Min) × Ones",
    section: "middle",
    computed: true,
    style: "total",
    hint: "Classic Yamb difference rule",
  },
  {
    key: "tris",
    label: "Three of a Kind",
    subLabel: "+ 10",
    section: "lower",
    input: true,
    hint: "Three matching dice — ignore the other dice. Example: 3,3,3,4,5 → enter 19 (9 + 10 bonus).",
    invalidMessage: "Three of a kind scores must equal the triple sum plus 10 bonus points.",
  },
  {
    key: "straight",
    label: "Straight",
    subLabel: ["Small 35", "Big 45"],
    section: "lower",
    input: true,
    hint: "Straights score 35 (1-2-3-4-5) or 45 (2-3-4-5-6). Enter 0 if you missed the straight.",
    invalidMessage: "Straight scores can only be 0, 35, or 45.",
  },
  {
    key: "full",
    label: "Full House",
    subLabel: "+ 30",
    section: "lower",
    input: true,
    hint: "Three of a kind plus a pair. Example: 6,6,6,5,5 → enter 58 (28 + 30 bonus).",
    invalidMessage: "Full house scores must be the triple-plus-pair sum plus 30 bonus points.",
  },
  {
    key: "poker",
    label: "Poker",
    subLabel: "+ 40",
    section: "lower",
    input: true,
    hint: "Four of a kind. Example: 6,6,6,6,2 → enter 64 (24 + 40 bonus).",
    invalidMessage: "Poker scores must be the four-of-a-kind sum plus 40 bonus points.",
  },
  {
    key: "yamb",
    label: "Yamb",
    subLabel: "+ 50",
    section: "lower",
    input: true,
    hint: "Five of a kind. Example: 4,4,4,4,4 → enter 70 (20 + 50 bonus).",
    invalidMessage: "Yamb scores must be the five-of-a-kind sum plus 50 bonus points.",
  },
  {
    key: "lowerSubtotal",
    label: "Lower",
    subLabel: "sum",
    section: "lowerTotal",
    computed: true,
    style: "total",
    hint: "Sum of tris, straight, full, poker, and yamb (excludes diff).",
  },
  {
    key: "grandTotal",
    label: "Column",
    subLabel: "total",
    section: "grandTotal",
    computed: true,
    style: "total-strong",
  },
];

const categoryValidation = new Map();
const categoryValidationMessages = new Map();
const categoryByKey = new Map(categories.map((category) => [category.key, category]));

const UPPER_FACES = [
  { key: "ones", face: 1 },
  { key: "twos", face: 2 },
  { key: "threes", face: 3 },
  { key: "fours", face: 4 },
  { key: "fives", face: 5 },
  { key: "sixes", face: 6 },
];

function createUpperAllowed(face) {
  const values = new Set([0]);
  for (let count = 1; count <= 5; count += 1) {
    values.add(face * count);
  }
  return values;
}

function createFullAllowed() {
  const values = new Set([0]);
  for (let triple = 1; triple <= 6; triple += 1) {
    for (let pair = 1; pair <= 6; pair += 1) {
      if (pair === triple) continue;
      const base = triple * 3 + pair * 2;
      values.add(base + 30);
    }
  }
  return values;
}

function createPokerAllowed() {
  const values = new Set([0]);
  for (let quad = 1; quad <= 6; quad += 1) {
    const base = quad * 4;
    values.add(base + 40);
  }
  return values;
}

function createYambAllowed() {
  const values = new Set([0]);
  for (let face = 1; face <= 6; face += 1) {
    const base = face * 5;
    values.add(base + 50);
  }
  return values;
}

function createTrisAllowed() {
  const values = new Set([0]);
  for (let triple = 1; triple <= 6; triple += 1) {
    const base = triple * 3;
    values.add(base + 10);
  }
  return values;
}

const straightAllowed = new Set([0, 35, 45]);
const trisAllowed = createTrisAllowed();
const fullAllowed = createFullAllowed();
const pokerAllowed = createPokerAllowed();
const yambAllowed = createYambAllowed();

function registerValidation(key, config) {
  categoryValidation.set(key, config);
  if (config.message) {
    categoryValidationMessages.set(key, config.message);
  }
}

UPPER_FACES.forEach(({ key, face }) => {
  const allowed = createUpperAllowed(face);
  const category = categoryByKey.get(key);
  const message =
    category?.invalidMessage ??
    `Enter one of: ${Array.from(allowed)
      .sort((a, b) => a - b)
      .join(", ")}.`;
  registerValidation(key, { type: "set", allowed, message });
});

registerValidation("max", {
  type: "range",
  min: 5,
  max: 30,
  message: "Max must be an integer between 5 and 30.",
});
registerValidation("min", {
  type: "range",
  min: 5,
  max: 30,
  message: "Min must be an integer between 5 and 30.",
});
registerValidation("tris", {
  type: "set",
  allowed: trisAllowed,
  message:
    categoryByKey.get("tris")?.invalidMessage ??
    "Three of a kind scores must equal the dice total plus 10.",
});
registerValidation("straight", {
  type: "set",
  allowed: straightAllowed,
  message:
    categoryByKey.get("straight")?.invalidMessage ?? "Straight scores can only be 0, 35, or 45.",
});
registerValidation("full", {
  type: "set",
  allowed: fullAllowed,
  message:
    categoryByKey.get("full")?.invalidMessage ??
    "Full house scores must equal the dice total plus 30 bonus points.",
});
registerValidation("poker", {
  type: "set",
  allowed: pokerAllowed,
  message:
    categoryByKey.get("poker")?.invalidMessage ??
    "Poker scores must equal the dice total plus 40 bonus points.",
});
registerValidation("yamb", {
  type: "set",
  allowed: yambAllowed,
  message:
    categoryByKey.get("yamb")?.invalidMessage ??
    "Yamb scores must equal the dice total plus 50 bonus points.",
});

const upperKeys = ["ones", "twos", "threes", "fours", "fives", "sixes"];
const lowerScoringKeys = categories
  .filter((category) => category.section === "lower")
  .map((category) => category.key);

export function isCategoryValueAllowed(categoryKey, value) {
  if (!Number.isFinite(value)) return false;
  const rule = categoryValidation.get(categoryKey);
  if (!rule) return true;

  if (rule.type === "set") {
    return rule.allowed.has(value);
  }

  if (rule.type === "range") {
    return value >= rule.min && value <= rule.max && Number.isInteger(value);
  }

  if (typeof rule.validate === "function") {
    return Boolean(rule.validate(value));
  }

  return true;
}

export function getValidationMessage(categoryKey) {
  return categoryValidationMessages.get(categoryKey) ?? "Invalid value for this category.";
}

export function createEmptyState() {
  return columns.reduce((acc, column) => {
    acc[column.key] = {};
    return acc;
  }, {});
}

export function numericValue(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function computeColumnDerived(columnState) {
  const derived = {};
  const safe = (key) => numericValue(columnState[key]);

  const upperSubtotal = upperKeys.reduce((sum, key) => sum + safe(key), 0);
  derived.upperSubtotal = upperSubtotal;

  const bonus = upperSubtotal >= 60 ? 30 : 0;
  derived.bonus = bonus;

  derived.upperTotal = upperSubtotal + bonus;

  const max = safe("max");
  const min = safe("min");
  const ones = safe("ones");
  const hasMax = columnState.max !== undefined && columnState.max !== "";
  const hasMin = columnState.min !== undefined && columnState.min !== "";
  const diff = hasMax && hasMin ? (max - min) * ones : 0;
  derived.diff = diff;

  const lowerSubtotal = lowerScoringKeys.reduce((sum, key) => sum + safe(key), 0);
  derived.lowerSubtotal = lowerSubtotal;

  derived.grandTotal = derived.upperTotal + diff + lowerSubtotal;

  return derived;
}

export function getCategoryValue(columnState, derived, key) {
  if (Object.prototype.hasOwnProperty.call(derived, key)) {
    return derived[key];
  }
  return numericValue(columnState[key]);
}

export function calculateAllTotals(state) {
  return columns.reduce((acc, column) => {
    const derived = computeColumnDerived(state[column.key] ?? {});
    acc[column.key] = derived.grandTotal;
    return acc;
  }, {});
}
