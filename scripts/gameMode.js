/**
 * Game mode management
 * Handles selection between local/online and physical/virtual dice
 */

export const GameMode = {
  LOCATION: {
    LOCAL: "local",
    ONLINE: "online",
  },
  DICE: {
    PHYSICAL: "physical",
    VIRTUAL: "virtual",
  },
};

const GAME_MODE_STORAGE_KEY = "yamb-game-mode";

/**
 * Create default game mode configuration
 * @returns {Object} Default game mode
 */
export function createDefaultGameMode() {
  return {
    location: GameMode.LOCATION.LOCAL,
    dice: GameMode.DICE.PHYSICAL,
    roomCode: null,
    playerId: null,
    playerName: null,
  };
}

/**
 * Load game mode from storage
 * @returns {Object} Game mode configuration
 */
export function loadGameMode() {
  try {
    const stored = localStorage.getItem(GAME_MODE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...createDefaultGameMode(), ...parsed };
    }
  } catch (error) {
    console.error("Failed to load game mode:", error);
  }
  return createDefaultGameMode();
}

/**
 * Save game mode to storage
 * @param {Object} mode - Game mode configuration
 */
export function saveGameMode(mode) {
  try {
    localStorage.setItem(GAME_MODE_STORAGE_KEY, JSON.stringify(mode));
  } catch (error) {
    console.error("Failed to save game mode:", error);
  }
}

/**
 * Update game mode
 * @param {Object} updates - Partial game mode updates
 * @returns {Object} Updated game mode
 */
export function updateGameMode(updates) {
  const current = loadGameMode();
  const updated = { ...current, ...updates };
  saveGameMode(updated);
  return updated;
}

/**
 * Check if currently using virtual dice
 * @returns {boolean} True if virtual dice mode
 */
export function isVirtualDiceMode() {
  const mode = loadGameMode();
  return mode.dice === GameMode.DICE.VIRTUAL;
}

/**
 * Check if currently in online mode
 * @returns {boolean} True if online mode
 */
export function isOnlineMode() {
  const mode = loadGameMode();
  return mode.location === GameMode.LOCATION.ONLINE;
}

/**
 * Reset game mode to defaults
 */
export function resetGameMode() {
  saveGameMode(createDefaultGameMode());
}

/**
 * Generate a unique room code
 * @returns {string} 6-character room code
 */
export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous characters
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Generate a unique player ID
 * @returns {string} Player ID
 */
export function generatePlayerId() {
  return `player_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Validate room code format
 * @param {string} code - Room code to validate
 * @returns {boolean} True if valid format
 */
export function isValidRoomCode(code) {
  return typeof code === "string" && /^[A-Z0-9]{6}$/.test(code);
}
