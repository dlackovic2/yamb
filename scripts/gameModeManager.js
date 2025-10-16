/**
 * Integration layer for virtual dice and game modes
 * This extends the main app with new features
 */

import { VirtualDiceUI } from "./virtualDiceUI.js";
import { OnlineLobbyUI } from "./onlineLobbyUI.js";
import { OnlineGameManager } from "./onlineGameManager.js";
import {
  loadGameMode,
  updateGameMode,
  GameMode,
  generateRoomCode,
  generatePlayerId,
} from "./gameMode.js";

export class GameModeManager {
  constructor() {
    this.mode = loadGameMode();
    this.virtualDiceUI = null;
    this.onlineLobby = null;
    this.onlineGameManager = null;
    this.currentTurnContext = null;
    this.setScoreCallback = null; // Will be set by app.js
    this.manualInputsEnabled = true;
    this.onNewGame = null;

    this.initializeUI();
    this.initializeOnlineGameManager();
  }

  /**
   * Initialize online game manager
   */
  initializeOnlineGameManager() {
    this.onlineGameManager = new OnlineGameManager(this);
  }

  /**
   * Set the score callback (called by app.js to avoid circular dependency)
   */
  setSetScoreCallback(callback) {
    this.setScoreCallback = callback;
  }

  setNewGameHandler(callback) {
    this.onNewGame = typeof callback === "function" ? callback : null;
  }

  /**
   * Initialize UI elements and event listeners
   */
  initializeUI() {
    // Get dialog elements
    this.gameModeDialog = document.getElementById("game-mode-dialog");
    this.virtualDiceDialog = document.getElementById("virtual-dice-dialog");
    this.virtualDiceContainer = document.getElementById("virtual-dice-container");

    // Get game mode form elements
    this.locationRadios = document.querySelectorAll('input[name="location"]');
    this.diceRadios = document.querySelectorAll('input[name="dice"]');
    this.onlineOptions = document.getElementById("online-options");
    this.playerNameInput = document.getElementById("player-name-input");
    this.createRoomBtn = document.getElementById("create-room-btn");
    this.joinRoomBtn = document.getElementById("join-room-btn");
    this.roomCodeSection = document.getElementById("room-code-section");
    this.roomCodeInput = document.getElementById("room-code-input");
    this.startGameBtn = document.getElementById("start-game-btn");

    this.setupEventListeners();
    this.updateUIFromMode();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Handle clicks on mode option labels (not just radio buttons)
    document.querySelectorAll(".mode-option").forEach((option) => {
      option.addEventListener("click", (e) => {
        const mode = option.dataset.mode;
        const value = option.dataset.value;
        const radio = option.querySelector('input[type="radio"]');

        if (radio && !radio.checked) {
          radio.checked = true;

          if (mode === "location") {
            this.handleLocationChange(value);
          } else if (mode === "dice") {
            this.handleDiceTypeChange(value);
          }
        }
      });
    });

    // Location radio buttons
    this.locationRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.handleLocationChange(e.target.value);
      });
    });

    // Dice type radio buttons
    this.diceRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.handleDiceTypeChange(e.target.value);
      });
    });

    // Online room buttons
    this.createRoomBtn?.addEventListener("click", () => {
      this.handleCreateRoom();
    });

    this.joinRoomBtn?.addEventListener("click", () => {
      this.handleJoinRoom();
    });

    // Game mode dialog
    this.gameModeDialog?.addEventListener("close", (e) => {
      if (e.target.returnValue === "confirm") {
        this.handleGameModeConfirm();
      }
    });

    // Make room code input uppercase
    this.roomCodeInput?.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  /**
   * Handle location mode change
   */
  handleLocationChange(value) {
    const isOnline = value === GameMode.LOCATION.ONLINE;
    if (this.onlineOptions) {
      this.onlineOptions.style.display = isOnline ? "block" : "none";
    }

    // Update mode options styling
    document.querySelectorAll('[data-mode="location"]').forEach((opt) => {
      opt.classList.toggle("selected", opt.dataset.value === value);
    });
  }

  /**
   * Handle dice type change
   */
  handleDiceTypeChange(value) {
    // Update mode options styling
    document.querySelectorAll('[data-mode="dice"]').forEach((opt) => {
      opt.classList.toggle("selected", opt.dataset.value === value);
    });
  }

  /**
   * Handle create room
   */
  handleCreateRoom() {
    const roomCode = generateRoomCode();
    this.roomCodeInput.value = roomCode;
    this.roomCodeSection.style.display = "block";
    this.roomCodeInput.readOnly = true;

    // TODO: In online implementation, create room in database
    //console.log('Room created:', roomCode);
  }

  /**
   * Handle join room
   */
  handleJoinRoom() {
    this.roomCodeSection.style.display = "block";
    this.roomCodeInput.readOnly = false;
    this.roomCodeInput.focus();
  }

  /**
   * Handle game mode confirmation
   */
  handleGameModeConfirm() {
    const location =
      document.querySelector('input[name="location"]:checked')?.value || GameMode.LOCATION.LOCAL;
    const dice =
      document.querySelector('input[name="dice"]:checked')?.value || GameMode.DICE.PHYSICAL;
    const playerName = this.playerNameInput?.value || null;
    const roomCode = this.roomCodeInput?.value || null;

    const updates = {
      location,
      dice,
      playerName,
      roomCode,
    };

    if (location === GameMode.LOCATION.ONLINE && !updates.playerId) {
      updates.playerId = generatePlayerId();
    }

    // Clean up any active online game
    if (this.onlineGameManager) {
      this.onlineGameManager.cleanup();
    }

    // Clean up any active lobby session
    if (this.onlineLobby) {
      this.onlineLobby.cleanup();
    }

    this.mode = updateGameMode(updates);

    if (typeof this.onNewGame === "function") {
      try {
        this.onNewGame({ ...this.mode });
      } catch (error) {
        console.error("New game handler failed:", error);
      }
    }

    // Handle online mode
    if (location === GameMode.LOCATION.ONLINE) {
      //console.log('🌐 Online mode selected');
      this.gameModeDialog.close();

      // Initialize online lobby if not already done
      if (!this.onlineLobby) {
        this.onlineLobby = new OnlineLobbyUI(this);
      }

      // Show online lobby
      this.onlineLobby.show();
      return;
    }

    // Initialize virtual dice if needed
    if (dice === GameMode.DICE.VIRTUAL) {
      this.showVirtualDicePanel({ forceControlsEnabled: true });
      this.disableScorecardInputs();
    } else {
      this.hideVirtualDicePanel();
      this.enableScorecardInputs();
    }

    // Trigger a scroll event to update back-to-dice button visibility
    window.dispatchEvent(new Event("scroll"));

    //console.log('Game mode updated:', this.mode);
  }

  /**
   * Update UI from current mode
   */
  updateUIFromMode() {
    // Set radio buttons and trigger their change events
    const locationRadio = document.querySelector(
      `input[name="location"][value="${this.mode.location}"]`
    );
    const diceRadio = document.querySelector(`input[name="dice"][value="${this.mode.dice}"]`);

    if (locationRadio) {
      locationRadio.checked = true;
      this.handleLocationChange(this.mode.location);
    }

    if (diceRadio) {
      diceRadio.checked = true;
      this.handleDiceTypeChange(this.mode.dice);
    }

    // Set player name
    if (this.playerNameInput && this.mode.playerName) {
      this.playerNameInput.value = this.mode.playerName;
    }

    // Set room code
    if (this.roomCodeInput && this.mode.roomCode) {
      this.roomCodeInput.value = this.mode.roomCode;
    }
  }

  /**
   * Show game mode dialog
   */
  showGameModeDialog() {
    this.updateUIFromMode();
    this.gameModeDialog?.showModal();
  }

  openJoinOnlineGame() {
    // Clean up any active online game
    if (this.onlineGameManager) {
      this.onlineGameManager.cleanup();
    }

    // Clean up any active lobby session
    if (this.onlineLobby) {
      this.onlineLobby.cleanup();
    }

    const updates = {
      location: GameMode.LOCATION.ONLINE,
      dice: this.mode?.dice ?? GameMode.DICE.PHYSICAL,
      roomCode: null,
    };

    if (!this.mode?.playerId) {
      updates.playerId = generatePlayerId();
    }

    this.mode = updateGameMode(updates);

    if (typeof this.onNewGame === "function") {
      try {
        this.onNewGame({ ...this.mode });
      } catch (error) {
        console.error("New game handler failed:", error);
      }
    }

    if (!this.onlineLobby) {
      this.onlineLobby = new OnlineLobbyUI(this);
    }

    this.onlineLobby.openJoinFlow();
  }

  /**
   * Initialize virtual dice UI
   */
  initializeVirtualDice() {
    if (!this.virtualDiceContainer) return;

    this.virtualDiceUI = new VirtualDiceUI(
      this.virtualDiceContainer,
      (category, column, diceValues) => this.handleVirtualScoreSelect(category, column, diceValues)
    );

    this.virtualDiceUI.setAnnounceCallback(() => {
      this.handleVirtualAnnouncement();
    });
  }

  /**
   * Check if should use virtual dice for this input
   */
  shouldUseVirtualDice() {
    return this.mode.dice === GameMode.DICE.VIRTUAL;
  }

  /**
   * Handle cell click - intercept if virtual dice mode
   */
  handleCellClick(category, column, currentScores, originalHandler) {
    if (!this.shouldUseVirtualDice()) {
      // Use original handler for physical dice
      originalHandler();
      return;
    }

    // Store context
    this.currentTurnContext = {
      category,
      column,
      currentScores,
      originalHandler,
    };

    // Show virtual dice dialog
    this.showVirtualDiceDialog(column, currentScores);
  }

  /**
   * Show virtual dice dialog
   */
  showVirtualDiceDialog(column, scores) {
    if (!this.virtualDiceUI) {
      this.initializeVirtualDice();
    }

    // Build game state object for virtualDiceUI
    const gameState = {
      currentColumn: column,
      scores: scores || {},
      announcement: null, // Will be set if player announces
    };

    this.virtualDiceUI.startTurn(gameState);
    // Note: First roll should be manual, not automatic
    // this.virtualDiceUI.performInitialRoll(); // REMOVED - user clicks roll button
    this.virtualDiceDialog?.showModal();
  }

  /**
   * Handle virtual score selection
   */
  handleVirtualScoreSelect(category, column, diceValues) {
    //console.log('Score selected:', category, column, diceValues);

    // Find the input for this category and column
    const input = document.querySelector(
      `.score-input[data-category="${category}"][data-column="${column}"]`
    );

    if (!input) {
      console.error("Input not found for", category, column);
      return;
    }

    // Check if already filled
    if (input.value !== "" && input.value !== null && input.value !== undefined) {
      console.warn("Category already filled:", category, column);
      // Don't close dialog - let user choose another option
      return;
    }

    // Calculate the score value
    const value = this.calculateScoreValue(category, diceValues);

    // Use the public API to set the score (handles validation and persistence)
    if (!this.setScoreCallback) {
      console.error("setScoreCallback not initialized");
      return;
    }

    const success = this.setScoreCallback(category, column, value);

    if (success) {
      // Close the dialog
      this.virtualDiceDialog?.close();
    } else {
      console.warn("Failed to set score - validation error");
      // Don't close dialog - let user choose another option
    }
  }

  /**
   * Handle virtual announcement (for announce column)
   */
  handleVirtualAnnouncement() {
    // Show announcement selection
    // This would integrate with the existing announce dialog
    //console.log('Announcement needed');
  }

  /**
   * Show virtual dice panel in the main view
   */
  showVirtualDicePanel(options = {}) {
    const {
      preserveState = false,
      initialStateOverride = null,
      initialDiceState = null,
      forceControlsEnabled,
    } = options || {};

    const hasExplicitControls = typeof forceControlsEnabled === "boolean";

    /*
    console.log("🎮 showVirtualDicePanel called with options:", {
      preserveState,
      hasInitialStateOverride: !!initialStateOverride,
      hasInitialDiceState: !!initialDiceState,
      initialDiceState,
      virtualDiceUIExists: !!this.virtualDiceUI,
    });
    */

    // Create or show the virtual dice panel in the layout
    let panel = document.getElementById("virtual-dice-main-panel");

    if (!panel) {
      // Create the panel
      const layout = document.querySelector(".layout");
      panel = document.createElement("section");
      panel.id = "virtual-dice-main-panel";
      panel.className = "virtual-dice-panel";
      panel.setAttribute("aria-label", "Virtual Dice");

      panel.innerHTML = `
        <header class="section-header">
          <h2>Virtual Dice</h2>
          <p>Roll the dice and select a scoring option to fill your scorecard.</p>
        </header>
        <div id="virtual-dice-main-container"></div>
      `;

      // Insert before the scorecard section
      const scorecard = document.querySelector(".scorecard");
      if (scorecard && layout) {
        layout.insertBefore(panel, scorecard);
      }
    } else {
      panel.style.display = "block";
    }

    // Initialize virtual dice UI in the panel if not already done
    const container = document.getElementById("virtual-dice-main-container");
    if (container && !this.virtualDiceUI) {
      //console.log("🆕 Creating new VirtualDiceUI instance");
      this.virtualDiceUI = new VirtualDiceUI(container, (category, column, diceValues) =>
        this.handleMainPanelScoreSelect(category, column, diceValues)
      );

      this.virtualDiceUI.setAnnounceCallback(() => {
        this.handleVirtualAnnouncement();
      });

      // If initialDiceState was provided, set it immediately after creation
      if (initialDiceState) {
        this.virtualDiceUI.state = initialDiceState;
      }
    }

    // Start with a fresh turn (default to free column, no scores yet)
    if (this.virtualDiceUI) {
      if (preserveState) {
        if (initialStateOverride) {
          this.virtualDiceUI.setGameState(initialStateOverride);
          this.virtualDiceUI.updatePossibleScores("showVirtualDicePanel:preserveOverride");
        } else {
          this.virtualDiceUI.updatePossibleScores("showVirtualDicePanel:preserve");
        }
      } else {
        const initialState = initialStateOverride || {
          currentColumn: "free",
          scores: this.getCurrentScores(), // Get current scores from scorecard
          announcement: null,
        };
        this.virtualDiceUI.startTurn(initialState);
        // First roll should be manual - user clicks the roll button
      }

      const shouldEnableControls = hasExplicitControls
        ? forceControlsEnabled
        : !this.isOnlineMode();

      if (shouldEnableControls) {
        this.virtualDiceUI.setControlsEnabled(true);
      } else if (hasExplicitControls) {
        this.virtualDiceUI.setControlsEnabled(forceControlsEnabled);
      }
    }
  }

  /**
   * Hide virtual dice panel
   */
  hideVirtualDicePanel() {
    const panel = document.getElementById("virtual-dice-main-panel");
    if (panel) {
      panel.style.display = "none";
    }
  }

  /**
   * Disable scorecard inputs (virtual dice mode)
   */
  disableScorecardInputs() {
    const inputs = document.querySelectorAll(".score-input");
    inputs.forEach((input) => {
      input.readOnly = true;
      input.style.cursor = "not-allowed";
      input.style.opacity = "0.6";
      input.title = "Use virtual dice to fill scores";
    });
  }

  /**
   * Enable scorecard inputs (physical dice mode)
   */
  enableScorecardInputs() {
    const inputs = document.querySelectorAll(".score-input");
    inputs.forEach((input) => {
      // Only re-enable if it wasn't originally read-only (like straight/announce)
      const entryMode = input.dataset.entryMode;
      if (entryMode === "numeric") {
        input.readOnly = false;
        input.style.cursor = "";
        input.style.opacity = "";
        input.title = "";
        input.classList.remove("turn-locked");
        input.dataset.turnLocked = "false";
      } else if (entryMode === "straight" || entryMode === "announce") {
        input.classList.remove("turn-locked");
        input.dataset.turnLocked = "false";
        input.title = "";
        input.style.cursor = "";
        input.style.opacity = "";
      }
    });
  }

  /**
   * Handle score selection from main panel
   */
  handleMainPanelScoreSelect(category, column, scoreValue) {
    //console.log('Main panel score selected:', category, column, scoreValue);

    // Find the input for this category and specified column
    const input = document.querySelector(
      `.score-input[data-category="${category}"][data-column="${column}"]`
    );

    if (!input) {
      console.error("Input not found for", category, column);
      return;
    }

    // Check if already filled
    if (input.value !== "" && input.value !== null && input.value !== undefined) {
      console.warn("Category already filled:", category, column);
      return;
    }

    // scoreValue is already calculated by virtualDiceUI, use it directly
    const value = scoreValue;

    // Use the public API to set the score (handles validation and persistence)
    if (!this.setScoreCallback) {
      console.error("setScoreCallback not initialized");
      return;
    }

    const success = this.setScoreCallback(category, column, value);

    if (!success) {
      console.warn("Failed to set score - validation error");
      return;
    }

    // Scroll to the input that was just filled (especially important on mobile)
    this.scrollToInput(input);

    // Get current announcement status
    const currentAnnouncement = this.virtualDiceUI.announced;

    // Clear announcement if we just filled the announce column
    const nextAnnouncement = column === "announce" ? null : currentAnnouncement;

    // Start a new turn with the column that was just filled
    const newState = {
      currentColumn: column,
      scores: this.getCurrentScores(), // Get all current scores
      announcement: nextAnnouncement,
    };
    this.virtualDiceUI.startTurn(newState);
    // First roll should be manual - user clicks the roll button
  }

  /**
   * Get current scores from the scorecard
   */
  getCurrentScores() {
    const scores = {};
    const columns = ["down", "up", "free", "announce"];
    const categories = [
      "ones",
      "twos",
      "threes",
      "fours",
      "fives",
      "sixes",
      "max",
      "min",
      "tris",
      "straight",
      "full",
      "poker",
      "yamb",
    ];

    columns.forEach((column) => {
      scores[column] = {};
      categories.forEach((category) => {
        const input = document.querySelector(
          `.score-input[data-category="${category}"][data-column="${column}"]`
        );
        if (input && input.value !== "") {
          scores[column][category] = parseInt(input.value, 10);
        }
      });
    });

    return scores;
  }

  /**
   * Calculate score value from dice
   */
  calculateScoreValue(category, diceValues) {
    const sum = diceValues.reduce((a, b) => a + b, 0);
    const counts = {};
    diceValues.forEach((val) => {
      counts[val] = (counts[val] || 0) + 1;
    });

    // Upper section
    if (category === "ones") return counts[1] ? counts[1] * 1 : 0;
    if (category === "twos") return counts[2] ? counts[2] * 2 : 0;
    if (category === "threes") return counts[3] ? counts[3] * 3 : 0;
    if (category === "fours") return counts[4] ? counts[4] * 4 : 0;
    if (category === "fives") return counts[5] ? counts[5] * 5 : 0;
    if (category === "sixes") return counts[6] ? counts[6] * 6 : 0;

    // Middle section
    if (category === "max" || category === "min") return sum;

    // Lower section - only count matching dice for tris/poker
    if (category === "tris") {
      const maxKind = Math.max(...Object.values(counts));
      if (maxKind >= 3) {
        const tripleValue = Object.keys(counts).find((key) => counts[key] >= 3);
        return parseInt(tripleValue) * 3 + 10;
      }
      return 0;
    }

    if (category === "poker") {
      const maxKind = Math.max(...Object.values(counts));
      if (maxKind >= 4) {
        const pokerValue = Object.keys(counts).find((key) => counts[key] >= 4);
        return parseInt(pokerValue) * 4 + 40;
      }
      return 0;
    }

    if (category === "straight") return sum + 20;
    if (category === "full") return sum + 30;
    if (category === "yamb") return sum + 50;

    return sum;
  }

  /**
   * Scroll to a specific input element (important for mobile)
   */
  scrollToInput(input) {
    if (!input) return;

    // Use requestAnimationFrame to ensure the DOM has updated
    requestAnimationFrame(() => {
      try {
        // Simple approach: scroll the input into view with some offset from top
        const rect = input.getBoundingClientRect();
        const currentScroll = window.pageYOffset || window.scrollY || 0;

        // Position the input 100px from the top of the viewport
        const offset = 160;
        const targetScroll = currentScroll + rect.top - offset;

        // Only scroll if needed (input is not already visible in a good position)
        const viewportHeight = window.innerHeight || 0;
        const isInView = rect.top >= offset && rect.bottom <= viewportHeight - 100;

        if (!isInView) {
          window.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: "smooth",
          });
        }

        // Optional: briefly highlight the input
        input.classList.add("score-highlight");
        setTimeout(() => {
          input.classList.remove("score-highlight");
        }, 3000);
      } catch (error) {
        console.warn("Could not scroll to input:", error);
      }
    });
  }

  /**
   * Set score selection callback
   */
  setScoreSelectCallback(callback) {
    this.onScoreSelect = callback;
  }

  /**
   * Get current game mode
   */
  getMode() {
    return this.mode;
  }

  /**
   * Check if in virtual dice mode
   */
  isVirtualMode() {
    return this.mode.dice === GameMode.DICE.VIRTUAL;
  }

  /**
   * Check if in online mode
   */
  isOnlineMode() {
    return this.mode.location === GameMode.LOCATION.ONLINE;
  }

  /**
   *Apply remote online game mode information (e.g., dice type) and update UI accordingly
   */
  applyOnlineGameMode(remoteMode = {}) {
    if (!remoteMode || typeof remoteMode !== "object") {
      return;
    }

    const merged = {
      ...this.mode,
      ...remoteMode,
    };

    if (!merged.location) {
      merged.location = GameMode.LOCATION.ONLINE;
    }

    this.mode = updateGameMode(merged);
    this.updateUIFromMode();
    this.applyDiceUiForMode();
    if (this.shouldHandleOnlineManual()) {
      this.manualInputsEnabled = false;
    }
    this.setOnlineManualInputEnabled(this.manualInputsEnabled);
  }

  /**
   * Synchronize dice/scorecard UI with the current mode
   */
  applyDiceUiForMode() {
    if (this.isVirtualMode()) {
      this.showVirtualDicePanel();
      this.disableScorecardInputs();
    } else {
      this.hideVirtualDicePanel();
      this.enableScorecardInputs();
    }
  }

  /**
   * Determine if online manual input handling should be active
   */
  shouldHandleOnlineManual() {
    return this.isOnlineMode() && !this.isVirtualMode();
  }

  /**
   * Enable or disable manual score inputs for turn-based online play
   */
  setOnlineManualInputEnabled(enabled) {
    this.manualInputsEnabled = Boolean(enabled);

    if (!this.shouldHandleOnlineManual()) {
      return;
    }

    const inputs = document.querySelectorAll(".score-input");
    inputs.forEach((input) => this.applyManualInputState(input, this.manualInputsEnabled));
  }

  /**
   * Apply manual state to a single input element
   */
  applyManualInputState(input, enabled) {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const entryMode = input.dataset.entryMode;
    const isLocked = !enabled;

    if (entryMode === "numeric") {
      input.readOnly = isLocked;
      input.style.cursor = isLocked ? "not-allowed" : "";
      input.style.opacity = isLocked ? "0.6" : "";
      input.title = isLocked ? "Wait for your turn!" : "";
      input.dataset.turnLocked = String(isLocked);
      input.classList.toggle("turn-locked", isLocked);
    } else if (entryMode === "straight" || entryMode === "announce") {
      input.dataset.turnLocked = String(isLocked);
      input.classList.toggle("turn-locked", isLocked);
      input.title = isLocked ? "Wait for your turn!" : "";
      input.style.cursor = isLocked ? "not-allowed" : "";
      input.style.opacity = isLocked ? "0.6" : "";
    }
  }

  /**
   * Forward manual score commitments to the online manager
   */
  handleOnlineManualScoreCommit(payload) {
    if (!this.shouldHandleOnlineManual() || !this.onlineGameManager) {
      return false;
    }
    this.onlineGameManager.handleManualScoreCommit(payload);
    return true;
  }

  /**
   * Notify the online manager that manual clearing is blocked
   */
  handleOnlineManualClearAttempt(input, previousValue) {
    if (!this.shouldHandleOnlineManual() || !this.onlineGameManager) {
      return false;
    }
    this.onlineGameManager.notifyManualClearBlocked(input, previousValue);
    return true;
  }

  /**
   * Surface a "wait for your turn" notice
   */
  notifyTurnLocked() {
    if (this.shouldHandleOnlineManual() && this.onlineGameManager) {
      this.onlineGameManager.showTurnLockedNotice();
    }
  }

  /**
   * Reapply the current online manual input lock state to the scorecard
   */
  refreshOnlineManualInputLock() {
    if (!this.shouldHandleOnlineManual()) {
      return;
    }
    this.setOnlineManualInputEnabled(this.manualInputsEnabled);
  }
}

// Create singleton instance
export const gameModeManager = new GameModeManager();
