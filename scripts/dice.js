/**
 * Dice rolling system with cryptographically secure randomness
 * Ensures true randomness and prevents manipulation
 */

const DICE_COUNT = 5;
const DICE_FACES = 6;

/**
 * Generate cryptographically secure random number
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {number} Random number between min and max
 */
function secureRandom(min, max) {
  const range = max - min + 1;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8);
  const maxValue = Math.pow(256, bytesNeeded);
  const rejectionThreshold = Math.floor(maxValue / range) * range;
  
  let randomValue;
  const randomBytes = new Uint8Array(bytesNeeded);
  
  do {
    crypto.getRandomValues(randomBytes);
    randomValue = 0;
    for (let i = 0; i < bytesNeeded; i++) {
      randomValue = randomValue * 256 + randomBytes[i];
    }
  } while (randomValue >= rejectionThreshold);
  
  return min + (randomValue % range);
}

/**
 * Roll a single die
 * @returns {number} Die value (1-6)
 */
export function rollDie() {
  return secureRandom(1, DICE_FACES);
}

/**
 * Roll multiple dice
 * @param {number} count - Number of dice to roll
 * @returns {number[]} Array of die values
 */
export function rollDice(count = DICE_COUNT) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(rollDie());
  }
  return results;
}

/**
 * Create initial dice state
 * @returns {Object} Dice state
 */
export function createDiceState() {
  return {
    values: [1, 2, 3, 4, 5], // Initial values
    locked: [false, false, false, false, false], // Which dice are locked/kept
    rollsRemaining: 3,
    announced: null, // Category announced (for announce column)
    history: [] // History of all rolls in this turn
  };
}

/**
 * Roll dice, keeping locked ones
 * @param {Object} state - Current dice state
 * @returns {Object} Updated dice state
 */
export function rollDiceWithLocked(state) {
  if (state.rollsRemaining <= 0) {
    return state;
  }
  
  const newValues = state.values.map((value, index) => {
    return state.locked[index] ? value : rollDie();
  });
  
  const newState = {
    ...state,
    values: newValues,
    rollsRemaining: state.rollsRemaining - 1,
    history: [...state.history, {
      roll: state.rollsRemaining,
      values: [...newValues],
      locked: [...state.locked]
    }]
  };
  
  return newState;
}

/**
 * Toggle lock state of a die
 * @param {Object} state - Current dice state
 * @param {number} index - Die index (0-4)
 * @returns {Object} Updated dice state
 */
export function toggleDiceLock(state, index) {
  if (index < 0 || index >= DICE_COUNT) {
    return state;
  }
  
  const newLocked = [...state.locked];
  newLocked[index] = !newLocked[index];
  
  return {
    ...state,
    locked: newLocked
  };
}

/**
 * Reset dice state for a new turn
 * @returns {Object} Fresh dice state
 */
export function resetDiceState() {
  return createDiceState();
}

/**
 * Set announcement for announce column
 * @param {Object} state - Current dice state
 * @param {string} category - Category key
 * @returns {Object} Updated dice state
 */
export function setAnnouncement(state, category) {
  return {
    ...state,
    announced: category
  };
}

/**
 * Calculate sum of dice
 * @param {number[]} values - Dice values
 * @returns {number} Sum
 */
export function sumDice(values) {
  return values.reduce((sum, val) => sum + val, 0);
}

/**
 * Count occurrences of each face
 * @param {number[]} values - Dice values
 * @returns {Object} Object with counts for each face (1-6)
 */
export function countFaces(values) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  values.forEach(val => {
    if (val >= 1 && val <= 6) {
      counts[val]++;
    }
  });
  return counts;
}

/**
 * Find the maximum count of any single face
 * @param {number[]} values - Dice values
 * @returns {number} Maximum count
 */
export function maxOfAKind(values) {
  const counts = countFaces(values);
  return Math.max(...Object.values(counts));
}

/**
 * Check if values form a straight
 * @param {number[]} values - Dice values
 * @returns {boolean} True if straight
 */
export function isStraight(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const unique = [...new Set(sorted)];
  
  if (unique.length !== 5) return false;
  
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] !== unique[i - 1] + 1) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if values form a full house (3 of one kind + 2 of another)
 * @param {number[]} values - Dice values
 * @returns {boolean} True if full house
 */
export function isFullHouse(values) {
  const counts = Object.values(countFaces(values)).filter(c => c > 0).sort();
  return counts.length === 2 && counts[0] === 2 && counts[1] === 3;
}

/**
 * Check if values form a poker (4 of a kind)
 * @param {number[]} values - Dice values
 * @returns {boolean} True if poker
 */
export function isPoker(values) {
  return maxOfAKind(values) >= 4;
}

/**
 * Check if values form a yamb (5 of a kind)
 * @param {number[]} values - Dice values
 * @returns {boolean} True if yamb
 */
export function isYamb(values) {
  return maxOfAKind(values) === 5;
}

/**
 * Get all possible scoring options for current dice
 * @param {number[]} values - Dice values
 * @param {Object} currentScores - Current score state
 * @param {string} column - Current column
 * @returns {Object[]} Array of possible scoring options
 */
export function getPossibleScores(values, currentScores, column) {
  const options = [];
  const counts = countFaces(values);
  const total = sumDice(values);
  const columnData = currentScores?.columns?.[column] || {};
  
  // Upper section (1-6)
  for (let face = 1; face <= 6; face++) {
    const key = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'][face - 1];
    if (columnData[key] === null || columnData[key] === undefined) {
      options.push({
        category: key,
        label: `${face}'s`,
        value: counts[face] * face,
        description: `${counts[face]} × ${face} = ${counts[face] * face}`
      });
    }
  }
  
  // Middle section
  if ((columnData.max === null || columnData.max === undefined)) {
    options.push({
      category: 'max',
      label: 'Max',
      value: total,
      description: `Sum: ${total}`
    });
  }
  
  if ((columnData.min === null || columnData.min === undefined)) {
    options.push({
      category: 'min',
      label: 'Min',
      value: total,
      description: `Sum: ${total}`,
      warning: total < 5 ? 'Must be at least 5' : null
    });
  }
  
  // Lower section
  if ((columnData.tris === null || columnData.tris === undefined)) {
    const canScore = maxOfAKind(values) >= 3;
    options.push({
      category: 'tris',
      label: 'Tris',
      value: canScore ? total + 10 : 0,
      description: canScore ? `Sum + 10 = ${total + 10}` : 'No 3-of-a-kind',
      available: canScore
    });
  }
  
  if ((columnData.straight === null || columnData.straight === undefined)) {
    const canScore = isStraight(values);
    options.push({
      category: 'straight',
      label: 'Straight',
      value: canScore ? total + 20 : 0,
      description: canScore ? `Sum + 20 = ${total + 20}` : 'Not a straight',
      available: canScore
    });
  }
  
  if ((columnData.full === null || columnData.full === undefined)) {
    const canScore = isFullHouse(values);
    options.push({
      category: 'full',
      label: 'Full House',
      value: canScore ? total + 30 : 0,
      description: canScore ? `Sum + 30 = ${total + 30}` : 'Not a full house',
      available: canScore
    });
  }
  
  if ((columnData.poker === null || columnData.poker === undefined)) {
    const canScore = isPoker(values);
    options.push({
      category: 'poker',
      label: 'Poker',
      value: canScore ? total + 40 : 0,
      description: canScore ? `Sum + 40 = ${total + 40}` : 'No 4-of-a-kind',
      available: canScore
    });
  }
  
  if ((columnData.yamb === null || columnData.yamb === undefined)) {
    const canScore = isYamb(values);
    options.push({
      category: 'yamb',
      label: 'Yamb',
      value: canScore ? total + 50 : 0,
      description: canScore ? `Sum + 50 = ${total + 50}` : 'No 5-of-a-kind',
      available: canScore
    });
  }
  
  return options;
}

export const DICE_CONSTANTS = {
  DICE_COUNT,
  DICE_FACES,
  MAX_ROLLS: 3
};
