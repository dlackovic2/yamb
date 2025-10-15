/**
 * Online Game Manager
 *
 * Manages the actual online gameplay:
 * - Turn management
 * - Synchronizing dice rolls and scores
 * - UI updates based on game state
 * - Connection to existing game systems
 */

import { subscribeToGame } from "./services/realtimeService.js";
import {
  syncDiceRoll,
  syncScoreEntry,
  syncTurnEnd,
  syncGameComplete,
  getAllGameStates,
} from "./services/gameSyncService.js";
import {
  getGame,
  updatePlayerConnectionStatus,
  updatePlayerConnectionStatusKeepalive,
} from "./services/onlineGameService.js";
import { createDiceState, rollDiceWithLocked } from "./dice.js";
import {
  columns,
  categories,
  computeColumnDerived,
  getCategoryValue,
  createEmptyState,
} from "./scoring.js";
import { GameMode } from "./gameMode.js";

globalThis.__YAMB_DEBUG = true;
const TOTAL_INPUT_CELLS = columns.length * categories.filter((category) => category.input).length;
const DEBUG_LOGS_ENABLED = Boolean(globalThis?.__YAMB_DEBUG ?? import.meta?.env?.DEV ?? false);
const debugLog = (...args) => {
  if (!DEBUG_LOGS_ENABLED) {
    return;
  }
  console.log(...args);
};

export class OnlineGameManager {
  constructor(gameModeManager) {
    this.gameModeManager = gameModeManager;
    this.gameId = null;
    this.playerId = null;
    this.isHost = false;
    this.players = [];
    this.currentTurnPlayerId = null;
    this.isMyTurn = false;
    this.turnChangePending = false;
    this.unsubscribe = null;
    this.currentViewPlayerId = null; // Track which scorecard we're viewing
    this.lastOpponentRolls = {}; // Track last rolls_remaining for each opponent
    this.playerAnnouncements = new Map();
    this.gameCompletionHandled = false;
    this.gameResultsShown = false;
    this.latestStandings = [];
    this.usingVirtualDice = true;
    this.lastTurnLockNoticeAt = 0;
    this.turnAudioCtx = null;
    this.roomCode = null;
    this.playerStatusMap = new Map();
    this.presenceStatusCache = new Map();
    this.presenceUpdateInFlight = false;
    this.pendingPresenceIds = null;
    this.pendingDisconnectNotices = new Map();
    this.announcedDisconnects = new Set();
    this.disconnectNoticeDelayMs = 1500;
    this.supportsPendingAnnouncements = null;
    this.connectionHeartbeatIntervalMs = 6000;
    this.connectionStaleThresholdMs = 12000;
    this.presenceMonitorIntervalMs = 5000;
    this.heartbeatTimer = null;
    this.presenceMonitorTimer = null;
    this.localConnectionStatus = "connected";
    this.reconnectAttemptIntervalMs = 5000;
    this.reconnectCountdownTickMs = 1000;
    this.reconnectCountdownTimer = null;
    this.nextReconnectAttemptAt = null;
    this.reconnectAttemptInFlight = false;
    this.presenceMissingSince = new Map();
    this.presenceDisconnectGraceMs = 2500;
    this.presenceWarmupMs = 15000;
    this.presenceWarmupUntil = 0;
    this.realtimeConnectionState = "idle";
    this.lastRealtimeStatus = null;
    this.realtimeStatusChangedAt = 0;
    this.realtimeWarningCooldownMs = 12000;
    this.lastRealtimeWarningAt = 0;
    this.recoveringAfterReconnect = false;
    this.staleRealtimeSubscriptionIds = new Set();
    this.realtimeResubscribeTimer = null;
    this.realtimeResubscribeAttempts = 0;
    this.realtimeMaxResubscribeAttempts = 5;
    this.realtimeResubscribeDelayMs = 1500;
    this.activeRealtimeSubscriptionId = null;
    this.channelReadyNotified = false;
    this.realtimeDebugEnabled = true;
    this.boundManualReconnectHandler = (event) => {
      event.preventDefault();
      this.handleManualReconnectRequest();
    };
    this.isLikelyMobile =
      typeof navigator !== "undefined" &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    this.handleGameLeftEvent = (event) => this.handleGameLeft(event.detail);
    this.handleUnloadDisconnect = () => this.handleLifecycleDisconnect("unload");
    this.handleOfflineEvent = () => this.handleLifecycleDisconnect("offline");
    this.handleOnlineEvent = () => this.handleLifecycleReconnect("online");
    this.handleVisibilityChangeEvent = () => this.handleVisibilityChange();
    this.handleConnectionChangeEvent = () => this.handleNetworkChange();

    // Listen for game start event from lobby
    window.addEventListener("onlineGameStarted", (e) => this.handleGameStarted(e.detail));
    window.addEventListener("onlineGameLeft", this.handleGameLeftEvent);
    window.addEventListener("beforeunload", this.handleUnloadDisconnect);
    window.addEventListener("pagehide", this.handleUnloadDisconnect);
    window.addEventListener("offline", this.handleOfflineEvent);
    window.addEventListener("online", this.handleOnlineEvent);
    document.addEventListener("visibilitychange", this.handleVisibilityChangeEvent);
    if (
      navigator &&
      navigator.connection &&
      typeof navigator.connection.addEventListener === "function"
    ) {
      navigator.connection.addEventListener("change", this.handleConnectionChangeEvent);
    }
  }

  logRealtimeEvent(event, detail = {}) {
    if (!this.realtimeDebugEnabled) {
      return;
    }

    const payload = {
      event,
      gameId: this.gameId,
      playerId: this.playerId,
      connectionState: this.realtimeConnectionState,
      localStatus: this.localConnectionStatus,
      timestamp: new Date().toISOString(),
      ...detail,
    };

    debugLog("🛰️ realtime", payload);
  }

  handleGameLeft(detail = {}) {
    const { gameId: leftGameId, playerId: leftPlayerId } = detail;
    const samePlayer = Boolean(leftPlayerId && this.playerId && leftPlayerId === this.playerId);
    const sameGame = Boolean(leftGameId && this.gameId && leftGameId === this.gameId);

    if (!samePlayer && !sameGame) {
      return;
    }

    this.cleanup();

    if (this.gameModeManager?.hideVirtualDicePanel) {
      this.gameModeManager.hideVirtualDicePanel();
    }
  }

  handleLifecycleDisconnect(reason = "generic") {
    if (!this.gameId || !this.playerId) {
      return;
    }

    const shouldUpdateUi = reason === "offline" || reason === "network";
    if (shouldUpdateUi) {
      this.setLocalConnectionStatus("disconnected", { startReconnect: true });
    }

    updatePlayerConnectionStatusKeepalive(this.gameId, this.playerId, "disconnected");
  }

  handleLifecycleReconnect(reason = "generic") {
    if (!this.gameId || !this.playerId) {
      return;
    }

    if (this.localConnectionStatus === "disconnected") {
      this.attemptReconnect({ reason: reason || "auto-event" });
      return;
    }

    updatePlayerConnectionStatus(this.gameId, this.playerId, "connected").catch((error) => {
      console.warn("Failed to mark player connected after reconnect.", error);
    });
  }

  handleVisibilityChange() {
    if (!this.gameId || !this.playerId) {
      return;
    }

    if (!this.isLikelyMobile) {
      return;
    }

    if (document.visibilityState === "hidden") {
      this.handleLifecycleDisconnect("hidden");
    } else if (document.visibilityState === "visible") {
      this.handleLifecycleReconnect("visible");
    }
  }

  handleNetworkChange() {
    if (!this.gameId || !this.playerId) {
      return;
    }

    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

    if (isOnline) {
      this.handleLifecycleReconnect("network-online");
    } else {
      this.handleLifecycleDisconnect("network");
    }
  }

  handleManualReconnectRequest() {
    if (!this.gameId || !this.playerId) {
      return;
    }

    this.attemptReconnect({ reason: "manual" });
  }

  /**
   * Handle game started event from lobby
   */
  async handleGameStarted(detail) {
    debugLog("🎮 Online game starting...", detail);

    this.gameId = detail.gameId;
    this.playerId = detail.playerId;
    this.isHost = detail.isHost;
    this.currentViewPlayerId = detail.playerId; // Start by viewing own scorecard
    this.turnChangePending = false;
    this.supportsPendingAnnouncements = null;
    this.localConnectionStatus = "connected";
    this.reconnectAttemptInFlight = false;
    this.stopReconnectLoop();
    this.presenceMissingSince.clear();
    const startNow = Date.now();
    this.presenceWarmupUntil = startNow + this.presenceWarmupMs;
    this.realtimeConnectionState = "connecting";
    this.lastRealtimeStatus = null;
    this.realtimeStatusChangedAt = startNow;
    this.lastRealtimeWarningAt = 0;
    this.channelReadyNotified = false;
    this.logRealtimeEvent("game-started", {
      roomCode: this.roomCode,
      startNow,
    });

    // Save to localStorage for reconnection
    this.saveGameToLocalStorage();

    try {
      // Fetch game details
      const game = await getGame(this.gameId);
      if (game?.game_mode && this.gameModeManager?.applyOnlineGameMode) {
        this.gameModeManager.applyOnlineGameMode(game.game_mode);
      }

      const modeFromServer = game?.game_mode?.dice;
      const localMode = this.gameModeManager?.getMode ? this.gameModeManager.getMode() : null;
      const diceMode = modeFromServer ?? localMode?.dice ?? GameMode.DICE.VIRTUAL;
      this.usingVirtualDice = diceMode !== GameMode.DICE.PHYSICAL;

      this.roomCode = detail.roomCode ?? game?.room_code ?? null;
      this.players = this.filterActivePlayers(Array.isArray(game?.players) ? game.players : []);
      this.refreshPlayerStatusCache(this.players);
      this.applyInitialPresenceSnapshot(this.players);
      this.pendingPresenceIds = null;
      this.presenceUpdateInFlight = false;
      this.currentTurnPlayerId = game.current_turn_player_id;
      this.updateTurnState();
      this.startConnectionHeartbeat();
      this.startPresenceMonitor();

      // Subscribe to real-time updates
      await this.subscribeToGameUpdates();

      if (this.usingVirtualDice) {
        this.gameModeManager.showVirtualDicePanel();

        // Wait a tick for virtual dice to be initialized
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Setup virtual dice callbacks
        this.setupVirtualDiceCallbacks();

        // IMPORTANT: Update virtualDiceUI with game state IMMEDIATELY
        // so it knows what categories are filled before showing any scores
        await this.updateVirtualDiceGameState();
      } else {
        this.gameModeManager.hideVirtualDicePanel();
        this.gameModeManager.enableScorecardInputs();
        this.gameModeManager.setOnlineManualInputEnabled(this.isMyTurn);
      }

      // Restore game state (dice, scorecard) from server
      await this.restoreGameState();

      // Update UI to show online game state
      this.updateUI("handleGameStarted:init");

      debugLog("✅ Online game initialized");
    } catch (error) {
      console.error("Failed to initialize online game:", error);
      alert("Failed to start online game: " + error.message);
    }
  }

  /**
   * Subscribe to real-time game updates
   */
  async subscribeToGameUpdates(options = {}) {
    const { skipAttemptReset = false } = options;

    if (this.unsubscribe) {
      const previousUnsubscribe = this.unsubscribe;
      const previousSubscriptionId = previousUnsubscribe?.subscriptionId ?? null;
      if (previousSubscriptionId) {
        this.staleRealtimeSubscriptionIds.add(previousSubscriptionId);
      }
      try {
        await previousUnsubscribe();
      } catch (error) {
        console.warn("Failed to unsubscribe existing game channel before resubscribing:", error);
      }
      this.activeRealtimeSubscriptionId = null;
      this.unsubscribe = null;
    }

    if (this.realtimeResubscribeTimer) {
      clearTimeout(this.realtimeResubscribeTimer);
      this.realtimeResubscribeTimer = null;
    }

    if (!skipAttemptReset) {
      this.realtimeResubscribeAttempts = 0;
    }

    this.realtimeConnectionState = "connecting";
    this.lastRealtimeStatus = null;
    this.realtimeStatusChangedAt = Date.now();
    this.presenceWarmupUntil = Math.max(
      this.presenceWarmupUntil,
      Date.now() + this.presenceWarmupMs
    );

    this.logRealtimeEvent("subscribe-to-game", {
      gameId: this.gameId,
      playerId: this.playerId,
    });

    const unsubscribe = subscribeToGame(this.gameId, {
      playerId: this.playerId,
      onGameUpdate: (payload) => this.handleGameUpdate(payload),
      onPlayerUpdate: (payload) => this.handlePlayerUpdate(payload),
      onStateUpdate: (payload) => this.handleStateUpdate(payload),
      onActionUpdate: (payload) => this.handleActionUpdate(payload),
      onPresenceSync: (state) => this.handlePresenceSync(state),
      onPresenceJoin: (_payload, state) => this.handlePresenceSync(state),
      onPresenceLeave: (_payload, state) => this.handlePresenceSync(state),
      onStatusChange: (status, info) => this.handleRealtimeStatusChange(status, info),
    });

    const newSubscriptionId = unsubscribe?.subscriptionId ?? null;
    if (newSubscriptionId) {
      this.staleRealtimeSubscriptionIds.delete(newSubscriptionId);
    }
    this.activeRealtimeSubscriptionId = newSubscriptionId;
    this.unsubscribe = unsubscribe;
  }

  /**
   * Setup virtual dice callbacks to sync with server
   */
  setupVirtualDiceCallbacks() {
    const virtualDiceUI = this.gameModeManager.virtualDiceUI;

    if (!virtualDiceUI) {
      console.error("❌ Virtual dice UI not initialized");
      throw new Error("Virtual dice UI not available");
    }

    // Ensure we do not stack multiple layers of wrappers from previous games
    this.restoreVirtualDiceCallbacks();

    debugLog("🔗 Setting up virtual dice callbacks...");

    // CRITICAL: Ensure state has history property before doing anything
    if (!virtualDiceUI.state.history) {
      console.warn("⚠️ State missing history property, fixing...");
      virtualDiceUI.state = createDiceState();
    }

    // Store original methods (once) for restoration
    if (!virtualDiceUI.__onlineOriginals) {
      virtualDiceUI.__onlineOriginals = {
        roll: virtualDiceUI.roll,
        toggleLock: virtualDiceUI.toggleLock,
        onScoreSelect: virtualDiceUI.onScoreSelect,
        announceCategory: virtualDiceUI.announceCategory,
      };
    }

    const originals = virtualDiceUI.__onlineOriginals;

    this.originalRoll = originals.roll.bind(virtualDiceUI);
    this.originalToggleLock = originals.toggleLock.bind(virtualDiceUI);
    this.originalOnScoreSelect = originals.onScoreSelect?.bind
      ? originals.onScoreSelect.bind(virtualDiceUI)
      : originals.onScoreSelect;
    this.originalAnnounceCategory = originals.announceCategory.bind(virtualDiceUI);
    virtualDiceUI.__onlineCallbacksActive = true;

    // Hook into dice roll
    virtualDiceUI.roll = async () => {
      debugLog("🎲 Roll button clicked");
      debugLog("  - isMyTurn:", this.isMyTurn);
      debugLog("  - currentTurnPlayerId:", this.currentTurnPlayerId);
      debugLog("  - myPlayerId:", this.playerId);
      debugLog("  - rollsRemaining:", virtualDiceUI.state.rollsRemaining);

      if (!this.canInteractThisTurn()) {
        debugLog("❌ Not your turn, blocking roll");
        this.showTurnBlockedToast();
        return;
      }

      if (virtualDiceUI.state.rollsRemaining <= 0) {
        debugLog("❌ No rolls remaining");
        return;
      }

      if (virtualDiceUI.controlsEnabled === false) {
        debugLog("❌ Controls disabled, blocking roll");
        return;
      }

      if (!Array.isArray(virtualDiceUI.state.history)) {
        console.warn("⚠️ State missing history before roll, fixing...");
        virtualDiceUI.state.history = [];
      }

      const needsAnnouncement =
        typeof virtualDiceUI.checkIfAnnouncementNeeded === "function"
          ? virtualDiceUI.checkIfAnnouncementNeeded()
          : false;
      const canAnnounce =
        typeof virtualDiceUI.canAnnounce === "function" ? virtualDiceUI.canAnnounce() : false;

      if (
        needsAnnouncement &&
        canAnnounce &&
        !virtualDiceUI.announced &&
        virtualDiceUI.state.rollsRemaining === 2
      ) {
        alert("⚠️ You must announce a category before rolling again!");
        return;
      }

      const diceElements = virtualDiceUI.container?.querySelectorAll(".die") || [];
      const previousLockedState = Array.isArray(virtualDiceUI.state.locked)
        ? [...virtualDiceUI.state.locked]
        : [false, false, false, false, false];

      diceElements.forEach((die, index) => {
        if (!previousLockedState[index]) {
          die.classList.add("rolling");
        }
      });

      debugLog("✅ Rolling dice...");
      const nextState = rollDiceWithLocked(virtualDiceUI.state);

      let syncPromise = null;
      try {
        debugLog("✅ Dice rolled locally, syncing to server...");
        syncPromise = this.syncCurrentDiceState({ action: "roll", stateOverride: nextState });
      } catch (error) {
        console.error("❌ Failed to initiate dice sync:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      virtualDiceUI.state = nextState;
      virtualDiceUI.render();

      const newDiceElements = virtualDiceUI.container?.querySelectorAll(".die") || [];
      newDiceElements.forEach((die, index) => {
        const wasLocked = previousLockedState[index];
        const isNowLocked = nextState.locked[index];

        if (!wasLocked) {
          if (isNowLocked) {
            die.classList.add("settling-stay");
          } else {
            die.classList.add("settling-unlock");
          }

          setTimeout(() => {
            die.classList.remove("settling-stay", "settling-unlock");
          }, 300);
        }
      });

      virtualDiceUI.updatePossibleScores("roll:post-render");

      if (syncPromise) {
        try {
          await syncPromise;
          debugLog("✅ Dice synced to server");
        } catch (error) {
          console.error("❌ Error syncing dice roll:", error);
        }
      }

      try {
        await this.updateVirtualDiceGameState();
      } catch (error) {
        console.error("Failed to refresh virtual dice game state after roll:", error);
      }
    };

    // Hook into lock toggle
    virtualDiceUI.toggleLock = async (index, preserveAnimation = false) => {
      if (!this.canInteractThisTurn()) {
        this.showTurnBlockedToast();
        return;
      }

      // Toggle lock locally
      this.originalToggleLock(index, preserveAnimation);

      // Sync to server
      await this.syncCurrentDiceState({ action: "lock" });
    };

    // Hook into announce
    virtualDiceUI.announceCategory = async (category) => {
      if (!this.canInteractThisTurn()) {
        this.showTurnBlockedToast();
        return;
      }

      debugLog("📢 Category announced:", category);

      // Call original handler first
      this.originalAnnounceCategory(category);
      this.setPlayerAnnouncement(this.playerId, category, { skipUiUpdate: true });

      // Sync to server
      await this.syncAnnounce(category, "announce");
    };

    // Hook into score selection
    virtualDiceUI.onScoreSelect = async (category, column, value) => {
      if (!this.canInteractThisTurn()) {
        this.showTurnBlockedToast();
        return;
      }

      debugLog("📊 Score selected:", { category, column, value });

      // Call original handler to update DOM
      if (this.originalOnScoreSelect) {
        await this.originalOnScoreSelect(category, column, value);
      }

      // Sync to server and end turn
      await this.syncScoreAndEndTurn(category, column, value);
    };

    debugLog("✅ Virtual dice callbacks set up");
  }

  restoreVirtualDiceCallbacks() {
    const virtualDiceUI = this.gameModeManager?.virtualDiceUI;
    if (!virtualDiceUI || !virtualDiceUI.__onlineOriginals) {
      return;
    }

    const originals = virtualDiceUI.__onlineOriginals;
    if (originals.roll) {
      virtualDiceUI.roll = originals.roll;
    }
    if (originals.toggleLock) {
      virtualDiceUI.toggleLock = originals.toggleLock;
    }
    if (typeof originals.onScoreSelect === "function") {
      virtualDiceUI.onScoreSelect = originals.onScoreSelect;
    }
    if (originals.announceCategory) {
      virtualDiceUI.announceCategory = originals.announceCategory;
    }

    virtualDiceUI.__onlineCallbacksActive = false;
    this.originalRoll = null;
    this.originalToggleLock = null;
    this.originalOnScoreSelect = null;
    this.originalAnnounceCategory = null;
  }

  /**
   * Sync current dice state to server
   */
  async syncCurrentDiceState(options = {}) {
    try {
      const virtualDiceUI = this.gameModeManager.virtualDiceUI;
      const { stateOverride, ...syncOptions } = options;
      const state = stateOverride ?? virtualDiceUI?.state;

      if (!state) {
        console.warn("No dice state available to sync.");
        return;
      }

      await syncDiceRoll(
        this.gameId,
        this.playerId,
        Array.isArray(state.values) ? [...state.values] : [],
        Array.isArray(state.locked) ? [...state.locked] : [],
        Number.isFinite(state.rollsRemaining) ? state.rollsRemaining : 0,
        syncOptions
      );
    } catch (error) {
      console.error("Failed to sync dice state:", error);
      throw error;
    }
  }

  /**
   * Sync announce to server
   */
  async syncAnnounce(category, column) {
    try {
      const { supabase } = await import("./services/supabaseClient.js");

      debugLog("📢 Syncing announce...", { category, column });

      const announceUpdate = {
        last_action: "announce",
        last_action_at: new Date().toISOString(),
      };

      if (this.supportsPendingAnnouncements !== false) {
        announceUpdate.pending_announcement = category ?? null;
      }

      const isMissingColumnError = (err) =>
        Boolean(
          err?.code === "42703" ||
            (typeof err?.message === "string" && err.message.includes("pending_announcement"))
        );

      const { error: primaryError } = await supabase
        .from("game_state")
        .update(announceUpdate)
        .eq("game_id", this.gameId)
        .eq("player_id", this.playerId);

      if (primaryError) {
        if (this.supportsPendingAnnouncements !== false && isMissingColumnError(primaryError)) {
          this.supportsPendingAnnouncements = false;
          console.warn(
            "Pending announcement column not found; falling back to legacy announce persistence."
          );
          const { error: fallbackError } = await supabase
            .from("game_state")
            .update({
              last_action: "announce",
              last_action_at: new Date().toISOString(),
            })
            .eq("game_id", this.gameId)
            .eq("player_id", this.playerId);

          if (fallbackError) {
            throw fallbackError;
          }
        } else {
          throw primaryError;
        }
      } else if (this.supportsPendingAnnouncements === null) {
        this.supportsPendingAnnouncements = true;
      }

      await supabase.from("game_actions").insert({
        game_id: this.gameId,
        player_id: this.playerId,
        action_type: "announce",
        action_data: {
          category: category,
          column: column,
        },
      });

      debugLog("✅ Announce synced");
    } catch (error) {
      console.error("Failed to sync announce:", error);
    }
  }

  /**
   * Sync score entry and end turn
   */
  async syncScoreAndEndTurn(category, column, value) {
    let lockApplied = false;
    try {
      // Get current scorecard from the server FIRST to check what's filled
      const scorecard = await this.getCurrentScorecard();

      // Check if this category is already filled
      const key = `${column}_${category}`;
      if (scorecard[key] !== undefined) {
        console.error(
          `❌ Category ${category} in ${column} is already filled with ${scorecard[key]}`
        );
        alert(`This category is already filled with ${scorecard[key]}!`);
        return;
      }

      // Add the new score to scorecard
      scorecard[key] = value;

      debugLog("📋 Updated scorecard to sync:", scorecard);

      // Update local DOM
      const input = document.querySelector(
        `.score-input[data-category="${category}"][data-column="${column}"]`
      );

      if (input) {
        input.value = value;
        input.dataset.isFilled = "true";
        input.classList.add("has-value");
        debugLog(`✅ Updated DOM for ${category} in ${column}: ${value}`);
      } else {
        console.warn(
          `⚠️ Could not find input for ${category} in ${column} (this might be ok for some categories)`
        );
      }

      // Sync score entry to database
      this.turnChangePending = true;
      lockApplied = true;
      this.applyTurnBasedInputLock();
      this.updateUI();
      await syncScoreEntry(this.gameId, this.playerId, scorecard, category, column, value, {
        supportsPendingAnnouncements: this.supportsPendingAnnouncements !== false,
      });

      debugLog("✅ Score synced to database:", { category, column, value });

      if (column === "announce") {
        this.clearPlayerAnnouncement(this.playerId);
      }

      // Update local scorecard state and virtual dice options to reflect the saved score
      this.applyScorecardLocally(scorecard);
      await this.updateVirtualDiceGameState(scorecard);

      let gameFinished = false;
      if (this.isGameComplete(scorecard)) {
        await this.checkGameCompletion();
        gameFinished = this.gameCompletionHandled;
      }

      if (gameFinished) {
        debugLog("🏁 Game finished after this turn; waiting for results.");
        return;
      }

      // End turn and advance to next player
      const nextPlayerId = await syncTurnEnd(this.gameId, this.playerId);
      debugLog("✅ Turn ended, next player:", nextPlayerId);

      if (nextPlayerId) {
        this.currentTurnPlayerId = nextPlayerId;
        this.updateTurnState();
        this.updateUI();
      }

      // The turn update will come via real-time subscription
    } catch (error) {
      console.error("Failed to sync score and end turn:", error);
      alert("Failed to save score. Please try again.");
      this.turnChangePending = false;
      this.applyTurnBasedInputLock();
      this.updateUI();
      return;
    } finally {
      if (lockApplied) {
        this.turnChangePending = false;
        this.applyTurnBasedInputLock();
        this.updateUI();
      }
    }
  }

  /**
   * Get current scorecard from the game
   */
  async getCurrentScorecard() {
    // Fetch the latest scorecard from the server
    try {
      const allStates = await getAllGameStates(this.gameId);
      const myState = allStates.find((s) => s.player_id === this.playerId);

      if (myState && myState.scorecard) {
        debugLog("📋 Current scorecard from server:", myState.scorecard);
        return myState.scorecard;
      }

      debugLog("📋 No scorecard found, returning empty");
      return {};
    } catch (error) {
      console.error("Error getting current scorecard:", error);
      return {};
    }
  }

  /**
   * Check if game is complete (all scores filled)
   */
  isGameComplete(scorecard) {
    if (!scorecard || typeof scorecard !== "object") {
      return false;
    }

    const filledCount = Object.keys(scorecard).length;
    return filledCount >= TOTAL_INPUT_CELLS;
  }

  /**
   * Restore game state when reconnecting
   */
  async restoreGameState() {
    try {
      debugLog("🔄 Restoring game state...");

      // Get all game states
      const allStates = await getAllGameStates(this.gameId);

      const announcementHydration = this.hydrateAnnouncementsFromStates(allStates);
      if (!announcementHydration.supported || announcementHydration.missingPlayerIds.length) {
        await this.restoreAnnouncementsFromHistory(allStates, {
          onlyPlayerIds: announcementHydration.supported
            ? announcementHydration.missingPlayerIds
            : null,
          preserveExisting: announcementHydration.supported,
        });
      }

      // Restore my scorecard
      const myState = allStates.find((s) => s.player_id === this.playerId);
      if (myState) {
        debugLog("📊 Restoring my scorecard:", myState.scorecard);
        await this.showMyScorecard(myState.scorecard);
        await this.updateVirtualDiceGameState(myState.scorecard);

        const virtualDiceUI = this.gameModeManager.virtualDiceUI;
        if (virtualDiceUI) {
          if (this.isMyTurn && myState.dice_values) {
            const restoredState = createDiceState();
            restoredState.values = myState.dice_values;
            restoredState.locked = myState.dice_locked || [false, false, false, false, false];
            restoredState.rollsRemaining = myState.rolls_remaining ?? 3;
            virtualDiceUI.render();
            virtualDiceUI.updatePossibleScores("restoreGameState:myTurn");
            debugLog("🎲 Restored my dice state:", restoredState);
          } else {
            const resetState = createDiceState();
            virtualDiceUI.state = resetState;
            virtualDiceUI.render();
            virtualDiceUI.updatePossibleScores("restoreGameState:reset");
            debugLog("🎲 Reset my dice view to default (not my turn)");
          }
        }
      }

      // If it's opponent's turn, show their dice
      if (!this.isMyTurn) {
        const currentPlayerState = allStates.find((s) => s.player_id === this.currentTurnPlayerId);
        if (currentPlayerState) {
          debugLog("🎲 Showing opponent dice state");
          this.updateVirtualDiceFromOpponent(currentPlayerState, { cause: "restore" });
          await this.updateVirtualDiceWithOpponentScorecard(
            this.currentTurnPlayerId,
            currentPlayerState
          );
        }
      }

      debugLog("✅ Game state restored");
      this.applyAnnouncementToView(this.playerId, { force: true });
      if (this.currentTurnPlayerId && this.currentTurnPlayerId !== this.playerId) {
        this.applyAnnouncementToView(this.currentTurnPlayerId, { force: true });
      }
      this.applyTurnBasedInputLock();
    } catch (error) {
      console.error("Error restoring game state:", error);
    }
  }

  /**
      this.updateUI('handleGameStarted:init');
   */
  async handleGameUpdate(payload) {
    if (!this.gameId) {
      return;
    }

    const tableName = payload?.table || null;
    if (tableName && tableName !== "games") {
      debugLog("↩️ Ignoring non-game payload in handleGameUpdate", { tableName });
      return;
    }

    debugLog("🎮 Game update:", payload);

    if (payload.new) {
      // Update current turn player
      const hasTurnField = Object.prototype.hasOwnProperty.call(
        payload.new,
        "current_turn_player_id"
      );
      if (hasTurnField && payload.new.current_turn_player_id !== this.currentTurnPlayerId) {
        const oldTurnPlayerId = this.currentTurnPlayerId;
        this.currentTurnPlayerId = payload.new.current_turn_player_id;

        // Reset roll tracking for the player whose turn just ended
        if (oldTurnPlayerId && oldTurnPlayerId !== this.playerId) {
          this.lastOpponentRolls[oldTurnPlayerId] = 3; // Reset to 3 for next turn
        }

        if (this.currentTurnPlayerId && this.currentTurnPlayerId !== this.playerId) {
          this.lastOpponentRolls[this.currentTurnPlayerId] = 3;
        }

        this.updateTurnState();
        this.updateUI("handleGameUpdate:turnChange");
      }

      if (payload.new.room_code && payload.new.room_code !== this.roomCode) {
        this.roomCode = payload.new.room_code;
        this.updateOnlineStatusBanner();
      }

      // Check if game completed
      if (payload.new.status === "completed") {
        await this.handleGameCompleted(payload.new);
      }
    }
  }

  /**
   * Handle player update from real-time
   */
  handlePlayerUpdate(payload) {
    if (!this.gameId) {
      return;
    }

    //console.log('👥 Player update:', payload);

    const eventType = payload?.eventType || payload?.type || payload?.action || null;
    const updatedPlayer = payload?.new || null;
    const previousPlayer = payload?.old || null;

    if (eventType === "DELETE") {
      this.removePlayerFromGame(previousPlayer, { notify: previousPlayer?.id !== this.playerId });
      return;
    }

    if (!updatedPlayer || !updatedPlayer.id) {
      return;
    }

    const index = this.players.findIndex((player) => player.id === updatedPlayer.id);
    const existingPlayer = index >= 0 ? this.players[index] : null;
    const mergedPlayer = existingPlayer
      ? { ...existingPlayer, ...updatedPlayer }
      : { ...updatedPlayer };

    if (!this.isPlayerActive(mergedPlayer)) {
      this.removePlayerFromGame(mergedPlayer, { notify: mergedPlayer.id !== this.playerId });
      return;
    }

    if (index >= 0) {
      this.players[index] = mergedPlayer;
    } else {
      this.players.push(mergedPlayer);
    }

    const previousStatus = this.playerStatusMap.get(updatedPlayer.id) ?? "connected";
    const nextStatus = updatedPlayer.connection_status ?? previousStatus ?? "connected";
    this.presenceStatusCache.set(updatedPlayer.id, nextStatus);

    if (eventType === "INSERT" && updatedPlayer.id !== this.playerId) {
      const name = updatedPlayer.player_name || "A new player";
      this.showNotification(`👋 ${name} joined the game.`, "success");
    } else if (eventType === "UPDATE") {
      this.handleConnectionStatusChange(
        { ...mergedPlayer, connection_status: nextStatus },
        previousStatus
      );
    }

    this.playerStatusMap.set(updatedPlayer.id, nextStatus);

    const didMeaningfullyChange = this.didPlayerChangeMeaningfully(
      previousPlayer ?? existingPlayer,
      mergedPlayer
    );
    const shouldRefreshUi =
      eventType === "INSERT" ||
      (didMeaningfullyChange && eventType !== "UPDATE_PASSIVE") ||
      previousStatus !== nextStatus;

    if (shouldRefreshUi) {
      this.players.sort((a, b) => {
        const orderA = a?.player_order ?? 0;
        const orderB = b?.player_order ?? 0;
        return orderA - orderB;
      });

      this.updateUI("handlePlayerUpdate");
    }
  }

  removePlayerFromGame(playerLike, options = {}) {
    const removedId = typeof playerLike === "string" ? playerLike : playerLike?.id;
    if (!removedId) {
      return;
    }

    const { notify = true } = options;
    const previousName = typeof playerLike === "object" ? playerLike?.player_name || null : null;

    this.players = this.players.filter((player) => player?.id !== removedId);
    this.playerStatusMap.delete(removedId);
    this.presenceStatusCache.delete(removedId);
    this.presenceMissingSince.delete(removedId);

    const pendingTimeout = this.pendingDisconnectNotices.get(removedId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pendingDisconnectNotices.delete(removedId);
    }

    this.announcedDisconnects.delete(removedId);

    if (notify && removedId !== this.playerId) {
      const displayName = previousName || this.getPlayerName(removedId) || "A player";
      this.showNotification(`🚪 ${displayName} left the game.`, "warning");
    }

    if (this.currentViewPlayerId === removedId) {
      this.currentViewPlayerId = this.playerId;
    }

    if (removedId === this.playerId) {
      this.updateUI("removePlayerFromGame:self");
      this.handleGameLeft({ gameId: this.gameId, playerId: removedId });
      return;
    }

    this.players = this.filterActivePlayers(this.players);
    this.refreshPlayerStatusCache(this.players);
    this.updateOnlineStatusBanner();
    this.updateUI("removePlayerFromGame");
  }

  isPlayerActive(player) {
    if (!player || typeof player !== "object") {
      return false;
    }

    if (
      player.deleted_at ||
      player.deletedAt ||
      player.removed_at ||
      player.removedAt ||
      player.left_at ||
      player.leftAt
    ) {
      return false;
    }

    if (player.has_left === true) {
      return false;
    }

    if (player.is_active === false) {
      return false;
    }

    const state = player.status || player.state || null;
    if (state === "left") {
      return false;
    }

    if (player.connection_status === "left") {
      return false;
    }

    return true;
  }

  filterActivePlayers(players) {
    if (!Array.isArray(players)) {
      return [];
    }

    return players.filter((player) => this.isPlayerActive(player));
  }

  didPlayerChangeMeaningfully(previousPlayer, updatedPlayer) {
    if (!updatedPlayer) {
      return false;
    }

    if (!previousPlayer) {
      return true;
    }

    const trackedFields = ["connection_status", "player_name", "player_order", "is_host"];

    return trackedFields.some((field) => previousPlayer[field] !== updatedPlayer[field]);
  }

  handlePresenceSync(presenceState) {
    if (!this.gameId) {
      return;
    }

    this.logRealtimeEvent("presence-sync", {
      keys: presenceState ? Object.keys(presenceState) : null,
    });

    const connectedIds = this.extractConnectedIdsFromPresence(presenceState);
    this.queuePresenceStatusUpdate(connectedIds);
  }

  handleRealtimeStatusChange(status, meta = {}) {
    if (!this.gameId || !status) {
      return;
    }

    const normalized =
      typeof status === "string" ? status.toUpperCase() : String(status).toUpperCase();
    const now = Date.now();

    const subscriptionId = meta?.subscriptionId ?? null;
    if (subscriptionId && this.staleRealtimeSubscriptionIds.has(subscriptionId)) {
      this.logRealtimeEvent("channel-status-ignored", {
        status: normalized,
        subscriptionId,
        channelTopic: meta?.channelTopic ?? null,
        reason: "stale",
      });
      return;
    }
    if (
      subscriptionId &&
      this.activeRealtimeSubscriptionId &&
      subscriptionId !== this.activeRealtimeSubscriptionId
    ) {
      this.logRealtimeEvent("channel-status-ignored", {
        status: normalized,
        subscriptionId,
        activeSubscriptionId: this.activeRealtimeSubscriptionId,
        channelTopic: meta?.channelTopic ?? null,
      });
      return;
    }

    this.lastRealtimeStatus = normalized;
    this.realtimeStatusChangedAt = now;
    this.logRealtimeEvent("channel-status", {
      status: normalized,
      subscriptionId,
      channelTopic: meta?.channelTopic ?? null,
    });

    if (normalized === "SUBSCRIBED") {
      this.realtimeConnectionState = "connected";
      this.lastRealtimeWarningAt = 0;
      this.presenceWarmupUntil = Math.max(this.presenceWarmupUntil, now + this.presenceWarmupMs);
      this.presenceMissingSince.clear();
      this.realtimeResubscribeAttempts = 0;
      if (this.realtimeResubscribeTimer) {
        clearTimeout(this.realtimeResubscribeTimer);
        this.realtimeResubscribeTimer = null;
      }

      if (this.localConnectionStatus === "disconnected") {
        this.setLocalConnectionStatus("connected", {
          startReconnect: false,
          toast: false,
          suppressPresenceUpdate: true,
        });
      }

      this.queuePresenceStatusUpdate(this.buildConnectedIdSet());
      this.logRealtimeEvent("channel-stable");

      if (!this.channelReadyNotified) {
        this.channelReadyNotified = true;
        try {
          window.dispatchEvent(
            new CustomEvent("onlineGameChannelReady", {
              detail: {
                gameId: this.gameId,
                subscriptionId,
                channelTopic: meta?.channelTopic ?? null,
              },
            })
          );
        } catch (error) {
          console.warn("Failed to dispatch lobby cleanup event:", error);
        }
      }
      return;
    }

    if (normalized === "TIMED_OUT" || normalized === "CHANNEL_ERROR" || normalized === "ERROR") {
      this.realtimeConnectionState = "unstable";
      this.presenceWarmupUntil = now + this.presenceWarmupMs;
      this.presenceMissingSince.clear();
      this.logRealtimeEvent("channel-unstable", { status: normalized });

      if (now - this.lastRealtimeWarningAt > this.realtimeWarningCooldownMs) {
        this.showNotification("⚠️ Connection interrupted. Attempting to reconnect…", "warning");
        this.lastRealtimeWarningAt = now;
      }

      if (this.localConnectionStatus !== "disconnected") {
        this.logRealtimeEvent("local-offline", { reason: normalized });
        this.setLocalConnectionStatus("disconnected", { startReconnect: true });
      }

      this.scheduleRealtimeResubscribe(normalized);
      return;
    }

    if (normalized === "CLOSED") {
      this.realtimeConnectionState = "unstable";
      this.presenceWarmupUntil = now + this.presenceWarmupMs;
      this.presenceMissingSince.clear();
      this.logRealtimeEvent("channel-closed");

      if (this.localConnectionStatus !== "disconnected") {
        this.logRealtimeEvent("local-offline", { reason: normalized });
        this.setLocalConnectionStatus("disconnected", { startReconnect: true });
      }

      this.scheduleRealtimeResubscribe(normalized);
    }
  }

  scheduleRealtimeResubscribe(reason = "unknown") {
    if (!this.gameId) {
      return;
    }

    if (this.realtimeResubscribeTimer) {
      return;
    }

    if (this.realtimeResubscribeAttempts >= this.realtimeMaxResubscribeAttempts) {
      this.logRealtimeEvent("channel-resubscribe-giveup", {
        reason,
        attempts: this.realtimeResubscribeAttempts,
      });
      return;
    }

    const attempt = this.realtimeResubscribeAttempts + 1;
    const backoffMultiplier = Math.pow(2, attempt - 1);
    const delay = this.realtimeResubscribeDelayMs * backoffMultiplier;

    this.realtimeResubscribeAttempts = attempt;
    this.logRealtimeEvent("channel-resubscribe-scheduled", { reason, attempt, delay });

    this.realtimeResubscribeTimer = setTimeout(() => {
      this.realtimeResubscribeTimer = null;
      this.performRealtimeResubscribe(reason).catch((error) => {
        console.error("Realtime resubscribe failed:", error);
        this.scheduleRealtimeResubscribe("resubscribe-error");
      });
    }, delay);
  }

  async performRealtimeResubscribe(reason = "unknown") {
    if (!this.gameId) {
      return;
    }

    this.logRealtimeEvent("channel-resubscribe-start", {
      reason,
      attempt: this.realtimeResubscribeAttempts,
    });

    try {
      await this.subscribeToGameUpdates({ skipAttemptReset: true });
    } catch (error) {
      console.error("Failed to restart realtime subscription:", error);
      this.scheduleRealtimeResubscribe("resubscribe-exception");
    }
  }

  extractConnectedIdsFromPresence(presenceState) {
    const connected = new Set();
    if (!presenceState || typeof presenceState !== "object") {
      return connected;
    }

    for (const [key, presences] of Object.entries(presenceState)) {
      if (key) {
        connected.add(key);
      }
      if (Array.isArray(presences)) {
        presences.forEach((entry) => {
          if (entry && entry.playerId) {
            connected.add(entry.playerId);
          }
        });
      }
    }

    return connected;
  }

  queuePresenceStatusUpdate(connectedIds) {
    this.pendingPresenceIds = connectedIds;

    if (this.presenceUpdateInFlight) {
      return;
    }

    this.presenceUpdateInFlight = true;
    this.logRealtimeEvent("presence-update-scheduled", {
      pendingCount:
        connectedIds instanceof Set
          ? connectedIds.size
          : Array.isArray(connectedIds)
          ? connectedIds.length
          : null,
    });

    Promise.resolve()
      .then(async () => {
        while (this.pendingPresenceIds) {
          const idsToProcess = this.pendingPresenceIds;
          this.pendingPresenceIds = null;
          try {
            await this.applyPresenceStatuses(idsToProcess);
          } catch (error) {
            console.error("Failed to apply presence statuses in-game:", error);
          }
        }
      })
      .finally(() => {
        this.presenceUpdateInFlight = false;
      });
  }

  async applyPresenceStatuses(connectedIds) {
    if (!this.gameId || !Array.isArray(this.players)) {
      return;
    }

    const activeIds =
      connectedIds instanceof Set
        ? connectedIds
        : new Set(Array.isArray(connectedIds) ? connectedIds : []);

    const updates = [];
    let statusesChanged = false;
    const now = Date.now();

    this.players.forEach((player) => {
      if (!player || !player.id) {
        return;
      }

      const playerId = player.id;
      const cachedPresence =
        this.presenceStatusCache.get(playerId) ?? player.connection_status ?? "connected";
      const previousStatus = this.playerStatusMap.get(playerId) ?? cachedPresence;
      let desiredStatus = cachedPresence;

      if (playerId === this.playerId) {
        desiredStatus = this.localConnectionStatus;
      } else if (activeIds.has(playerId)) {
        desiredStatus = "connected";
        this.presenceMissingSince.delete(playerId);
      } else if (!this.isRealtimeLinkHealthy()) {
        desiredStatus = cachedPresence;
        this.presenceMissingSince.delete(playerId);
        this.logRealtimeEvent("presence-skip-unhealthy", { playerId });
      } else {
        let missingStart = this.presenceMissingSince.get(playerId);
        if (!missingStart) {
          missingStart = now;
          this.presenceMissingSince.set(playerId, missingStart);
        }

        const missingDuration = now - missingStart;
        const lastSeenAt =
          typeof player.last_seen_at === "string" ? Date.parse(player.last_seen_at) : null;

        if (missingDuration >= this.presenceDisconnectGraceMs) {
          desiredStatus = "disconnected";
        } else if (Number.isFinite(lastSeenAt)) {
          desiredStatus =
            now - lastSeenAt > this.connectionStaleThresholdMs ? "disconnected" : cachedPresence;
        } else {
          desiredStatus = cachedPresence;
        }
      }

      if (desiredStatus === "connected") {
        this.presenceMissingSince.delete(playerId);
      }

      if (cachedPresence !== desiredStatus) {
        statusesChanged = true;
        this.presenceStatusCache.set(playerId, desiredStatus);
      }

      if (player.connection_status !== desiredStatus) {
        player.connection_status = desiredStatus;
        if (desiredStatus === "connected") {
          player.last_seen_at = new Date().toISOString();
        }
      }

      if (previousStatus !== desiredStatus) {
        statusesChanged = true;

        updates.push({
          playerId,
          previousStatus,
          desiredStatus,
          promise: updatePlayerConnectionStatus(this.gameId, playerId, desiredStatus),
        });

        if (playerId !== this.playerId) {
          const snapshot = { ...player, connection_status: desiredStatus };
          this.handleConnectionStatusChange(snapshot, previousStatus);
        }
      }

      this.playerStatusMap.set(playerId, desiredStatus);
    });

    if (!updates.length) {
      if (statusesChanged) {
        this.updateOnlineStatusBanner();
      }
      return;
    }

    if (statusesChanged) {
      this.updateOnlineStatusBanner();
    }

    const results = await Promise.allSettled(updates.map((item) => item.promise));
    let bannerNeedsRefresh = false;

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const failedUpdate = updates[index];
        console.error("Presence status update failed:", result.reason);
        if (failedUpdate) {
          this.presenceStatusCache.set(failedUpdate.playerId, failedUpdate.previousStatus);
          this.playerStatusMap.set(failedUpdate.playerId, failedUpdate.previousStatus);
          const player = this.players.find((p) => p.id === failedUpdate.playerId);
          if (player) {
            player.connection_status = failedUpdate.previousStatus;
          }
          bannerNeedsRefresh = true;
        }
      }
    });

    if (bannerNeedsRefresh) {
      this.updateOnlineStatusBanner();
    }

    if (statusesChanged) {
      this.updateTurnIndicator();
    }
  }

  isRealtimeLinkHealthy() {
    return this.realtimeConnectionState === "connected";
  }

  isLocallyOnline() {
    return this.localConnectionStatus !== "disconnected";
  }

  setLocalConnectionStatus(status, options = {}) {
    const normalized = status === "disconnected" ? "disconnected" : "connected";
    const {
      startReconnect = true,
      force = false,
      toast = true,
      suppressPresenceUpdate = false,
    } = options;

    if (!force && this.localConnectionStatus === normalized) {
      if (normalized === "disconnected" && startReconnect) {
        this.scheduleNextReconnectAttempt(this.reconnectAttemptIntervalMs);
      }
      return;
    }

    this.logRealtimeEvent("local-status-change", {
      from: this.localConnectionStatus,
      to: normalized,
      startReconnect,
      force,
      toast,
      suppressPresenceUpdate,
    });

    this.localConnectionStatus = normalized;

    if (this.playerId) {
      this.playerStatusMap.set(this.playerId, normalized);
      this.presenceStatusCache.set(this.playerId, normalized);
      const selfPlayer = this.players.find((player) => player?.id === this.playerId);
      if (selfPlayer) {
        selfPlayer.connection_status = normalized;
      }
    }

    if (normalized === "disconnected") {
      if (startReconnect) {
        this.scheduleNextReconnectAttempt(this.reconnectAttemptIntervalMs);
      }
      if (toast) {
        this.showToast("Internet connection lost. Reconnect to keep playing.", "warning");
      }
    } else {
      this.stopReconnectLoop();
      this.reconnectAttemptInFlight = false;
      this.presenceMissingSince.delete(this.playerId);
    }

    if (this.gameId) {
      this.updateUI("localConnectionStatus");
    } else {
      this.updateTurnIndicator();
    }

    if (this.gameId && !suppressPresenceUpdate) {
      this.updateOnlineStatusBanner();
    }
  }

  scheduleNextReconnectAttempt(delayMs = this.reconnectAttemptIntervalMs) {
    if (!Number.isFinite(delayMs)) {
      delayMs = this.reconnectAttemptIntervalMs;
    }

    const now = Date.now();
    const normalizedDelay = Math.max(1000, delayMs);
    this.nextReconnectAttemptAt = now + normalizedDelay;
    this.ensureReconnectTimer();
    this.updateTurnIndicator();
  }

  ensureReconnectTimer() {
    if (this.reconnectCountdownTimer) {
      return;
    }

    this.reconnectCountdownTimer = setInterval(
      () => this.tickReconnectLoop(),
      this.reconnectCountdownTickMs
    );
  }

  tickReconnectLoop() {
    if (this.localConnectionStatus !== "disconnected") {
      this.stopReconnectLoop();
      return;
    }

    if (this.reconnectAttemptInFlight) {
      this.updateTurnIndicator();
      return;
    }

    if (!this.nextReconnectAttemptAt) {
      this.updateTurnIndicator();
      return;
    }

    const now = Date.now();
    if (now >= this.nextReconnectAttemptAt) {
      this.attemptReconnect({ reason: "auto" });
    } else {
      this.updateTurnIndicator();
    }
  }

  stopReconnectLoop() {
    if (this.reconnectCountdownTimer) {
      clearInterval(this.reconnectCountdownTimer);
      this.reconnectCountdownTimer = null;
    }
    this.nextReconnectAttemptAt = null;
  }

  getSecondsUntilReconnectAttempt() {
    if (!this.nextReconnectAttemptAt) {
      return null;
    }

    const diff = this.nextReconnectAttemptAt - Date.now();
    if (diff <= 0) {
      return 0;
    }

    return Math.ceil(diff / 1000);
  }

  async attemptReconnect(options = {}) {
    if (!this.gameId || !this.playerId) {
      return;
    }

    if (this.localConnectionStatus !== "disconnected") {
      return;
    }

    if (this.reconnectAttemptInFlight) {
      return;
    }

    const reason = options.reason || "auto";
    const isManual = reason === "manual";
    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

    if (!isOnline) {
      if (isManual) {
        this.showNotification(
          "No internet connection detected. Check your network and try again.",
          "warning"
        );
      }
      this.scheduleNextReconnectAttempt(this.reconnectAttemptIntervalMs);
      return;
    }

    this.reconnectAttemptInFlight = true;
    this.updateTurnIndicator();
    this.logRealtimeEvent("reconnect-attempt", {
      reason,
      isManual,
    });

    try {
      await updatePlayerConnectionStatus(this.gameId, this.playerId, "connected");
      this.setLocalConnectionStatus("connected", {
        startReconnect: false,
        force: true,
        suppressPresenceUpdate: true,
      });

      let needsRecovery = !this.isRealtimeLinkHealthy() || !this.unsubscribe;
      if (!needsRecovery && typeof options.forceRecovery === "boolean") {
        needsRecovery = options.forceRecovery;
      }

      if (needsRecovery) {
        await this.recoverAfterReconnect({ silent: true });
      }

      this.queuePresenceStatusUpdate(this.buildConnectedIdSet());
      this.showNotification("✅ Connection restored.", "success");
    } catch (error) {
      console.error("Reconnect attempt failed.", error);
      if (isManual) {
        this.showNotification("Reconnect failed. We'll retry automatically.", "error");
      }
      this.scheduleNextReconnectAttempt(this.reconnectAttemptIntervalMs);
    } finally {
      this.reconnectAttemptInFlight = false;
      if (this.localConnectionStatus === "disconnected") {
        this.updateTurnIndicator();
      }
    }
  }

  async recoverAfterReconnect(options = {}) {
    if (!this.gameId || !this.playerId) {
      return;
    }

    if (this.recoveringAfterReconnect) {
      return;
    }

    const { silent = true } = options || {};

    this.recoveringAfterReconnect = true;
    try {
      if (this.realtimeResubscribeTimer) {
        clearTimeout(this.realtimeResubscribeTimer);
        this.realtimeResubscribeTimer = null;
      }

      this.realtimeResubscribeAttempts = 0;

      this.logRealtimeEvent("post-reconnect-recovery-start", {
        silent,
        realtimeState: this.realtimeConnectionState,
      });

      await this.rejoinGame(this.gameId, this.playerId, {
        silent,
        preserveStorage: true,
      });

      this.logRealtimeEvent("post-reconnect-recovery-success");
    } catch (error) {
      this.logRealtimeEvent("post-reconnect-recovery-failed", {
        message: error?.message || "unknown",
      });
      throw error;
    } finally {
      this.recoveringAfterReconnect = false;
    }
  }

  startConnectionHeartbeat() {
    this.stopConnectionHeartbeat();

    if (!this.gameId || !this.playerId) {
      return;
    }

    const tick = () => {
      if (!this.gameId || !this.playerId) {
        return;
      }

      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (!isOnline) {
        this.setLocalConnectionStatus("disconnected");
        updatePlayerConnectionStatusKeepalive(this.gameId, this.playerId, "disconnected");
        return;
      }

      if (this.localConnectionStatus === "connected") {
        updatePlayerConnectionStatusKeepalive(this.gameId, this.playerId, "connected");
        const player = this.players.find((p) => p?.id === this.playerId);
        if (player) {
          const nowIso = new Date().toISOString();
          player.last_seen_at = nowIso;
        }
      }
    };

    tick();
    this.heartbeatTimer = setInterval(tick, this.connectionHeartbeatIntervalMs);
  }

  stopConnectionHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  startPresenceMonitor() {
    this.stopPresenceMonitor();

    if (!this.presenceMonitorIntervalMs) {
      return;
    }

    this.presenceMonitorTimer = setInterval(() => {
      if (!this.gameId) {
        this.stopPresenceMonitor();
        return;
      }

      const connectedIds = this.buildConnectedIdSet();
      this.queuePresenceStatusUpdate(connectedIds);
    }, this.presenceMonitorIntervalMs);
  }

  stopPresenceMonitor() {
    if (this.presenceMonitorTimer) {
      clearInterval(this.presenceMonitorTimer);
      this.presenceMonitorTimer = null;
    }
  }

  buildConnectedIdSet() {
    const ids = new Set();
    const now = Date.now();
    (this.players || []).forEach((player) => {
      if (!player || !player.id) {
        return;
      }

      const status =
        this.presenceStatusCache.get(player.id) ?? player.connection_status ?? "connected";
      if (status === "connected") {
        if (now < this.presenceWarmupUntil) {
          ids.add(player.id);
          return;
        }

        const lastSeenAt =
          typeof player.last_seen_at === "string" ? Date.parse(player.last_seen_at) : null;

        if (!Number.isFinite(lastSeenAt) || now - lastSeenAt <= this.connectionStaleThresholdMs) {
          ids.add(player.id);
        }
      }
    });

    return ids;
  }

  /**
   * Handle game state update from real-time
   */
  async handleStateUpdate(payload) {
    if (!this.gameId) {
      return;
    }

    const tableName = payload?.table || null;
    if (tableName && tableName !== "game_state") {
      debugLog("↩️ Ignoring non-state payload in handleStateUpdate", { tableName });
      return;
    }

    debugLog("🎲 State update:", payload);

    if (payload.new && payload.new.player_id) {
      if (Object.prototype.hasOwnProperty.call(payload.new, "pending_announcement")) {
        this.supportsPendingAnnouncements = true;
        const pending = payload.new.pending_announcement ?? null;
        const forceUpdate =
          payload.new.player_id === this.playerId ||
          payload.new.player_id === this.currentTurnPlayerId;
        this.setPlayerAnnouncement(payload.new.player_id, pending, { force: forceUpdate });
      } else if (Object.prototype.hasOwnProperty.call(payload.new, "announcement")) {
        this.supportsPendingAnnouncements = true;
        const pending = payload.new.announcement ?? null;
        const forceUpdate =
          payload.new.player_id === this.playerId ||
          payload.new.player_id === this.currentTurnPlayerId;
        this.setPlayerAnnouncement(payload.new.player_id, pending, { force: forceUpdate });
      }
    }

    let opponentScorecardUpdated = false;

    if (payload.new && payload.new.player_id !== this.playerId) {
      // Another player's state updated
      const playerName = this.getPlayerName(payload.new.player_id);
      const opponentId = payload.new.player_id;

      // Show notification based on action
      if (payload.new.last_action === "roll_dice") {
        // Check if rolls actually decreased (not just locking)
        const lastRolls = Object.prototype.hasOwnProperty.call(this.lastOpponentRolls, opponentId)
          ? this.lastOpponentRolls[opponentId]
          : undefined;
        const currentRolls = Number.isInteger(payload.new.rolls_remaining)
          ? payload.new.rolls_remaining
          : null;
        const rolledFromStart = currentRolls !== null && currentRolls < 3;
        const actuallyRolled =
          currentRolls !== null
            ? lastRolls === undefined
              ? rolledFromStart
              : currentRolls < lastRolls
            : false;

        debugLog("🎲 Dice action detected:", {
          lastRolls,
          currentRolls,
          actuallyRolled,
        });

        if (actuallyRolled) {
          this.showNotification(`🎲 ${playerName} rolled the dice`);
        }

        // Update tracked rolls for this opponent
        if (currentRolls !== null) {
          this.lastOpponentRolls[opponentId] = currentRolls;
        }

        const rollCause = actuallyRolled ? "roll" : "sync";
        // Update local virtual dice to show opponent's dice
        this.updateVirtualDiceFromOpponent(payload.new, {
          animate: actuallyRolled,
          cause: rollCause,
        });

        // Update virtualDiceUI with opponent's scorecard so it shows correct available options
        await this.updateVirtualDiceWithOpponentScorecard(opponentId, payload.new);
      } else if (payload.new.last_action === "lock_dice") {
        this.lastOpponentRolls[opponentId] = payload.new.rolls_remaining;
        this.updateVirtualDiceFromOpponent(payload.new, { cause: "lock" });
        await this.updateVirtualDiceWithOpponentScorecard(opponentId, payload.new);
        opponentScorecardUpdated = true;
      } else if (payload.new.last_action === "turn_started") {
        const initialRolls = Number.isInteger(payload.new.rolls_remaining)
          ? payload.new.rolls_remaining
          : 3;
        this.lastOpponentRolls[opponentId] = initialRolls;
      } else if (payload.new.last_action === "announce") {
        // Opponent announced a category - get details from recent action
        this.fetchRecentAction(opponentId, "announce").then((actionData) => {
          const categoryKey = actionData?.category ?? null;
          this.setPlayerAnnouncement(opponentId, categoryKey);

          if (categoryKey) {
            this.showNotification(`📢 ${playerName} announced: ${categoryKey}`);
          } else {
            this.showNotification(`📢 ${playerName} announced a category`);
          }
        });
      } else if (payload.new.last_action === "score_entered") {
        const actionData = await this.fetchRecentAction(payload.new.player_id, "score_entered");
        const category = actionData?.category || null;
        const column = actionData?.column || null;
        const value = actionData?.value ?? 0;
        const categoryLabel = category || "their scorecard";
        this.showNotification(`📊 ${playerName} scored ${value} in ${categoryLabel}`);

        this.pruneAnnouncementUsingScorecard(opponentId, payload.new.scorecard);

        const targetPlayerId = payload.new.player_id;
        let restoreViewCallback = null;

        if (this.currentViewPlayerId !== targetPlayerId) {
          const originalView = this.currentViewPlayerId;
          await this.switchScorecardView(targetPlayerId);
          restoreViewCallback = () => {
            setTimeout(async () => {
              await this.switchScorecardView(originalView);
            }, 2000);
          };
        }

        await this.updateOpponentScorecard(targetPlayerId);
        opponentScorecardUpdated = true;

        requestAnimationFrame(() => {
          this.highlightRecentScore(category, column, { playerId: targetPlayerId });
        });

        if (restoreViewCallback) {
          restoreViewCallback();
        }
      }

      if (!opponentScorecardUpdated) {
        await this.updateOpponentScorecard(payload.new.player_id);
      }
      this.applyAnnouncementToView(opponentId, { force: true });

      // Check if game is complete
      await this.checkGameCompletion();
    }

    this.updateUI("handleStateUpdate:final");
  }

  /**
   * Handle game action update from real-time
   */
  handleActionUpdate(payload) {
    const tableName = payload?.table || null;
    if (tableName && tableName !== "game_actions") {
      debugLog("↩️ Ignoring non-action payload in handleActionUpdate", { tableName });
      return;
    }

    debugLog("🎬 Action update:", payload);
    // Could show detailed action logs
  }

  /**
   * Update turn state (am I the current player?)
   */
  updateTurnState() {
    const wasMyTurn = this.isMyTurn;
    this.isMyTurn = this.currentTurnPlayerId === this.playerId;
    debugLog(`🎯 ${this.isMyTurn ? "Your turn!" : "Opponent's turn"}`);

    if (!wasMyTurn && this.isMyTurn) {
      this.turnChangePending = false;
      this.playTurnNotificationSound();
    }

    // When my turn ends, reset local dice to neutral state
    if (this.usingVirtualDice && wasMyTurn && !this.isMyTurn) {
      debugLog("🔄 Turn passed to opponent - showing default dice");
      const virtualDiceUI = this.gameModeManager.virtualDiceUI;
      if (virtualDiceUI) {
        virtualDiceUI.state = createDiceState();
        virtualDiceUI.setControlsEnabled(false);

        // Update spectator view with the new active player's scorecard
        if (this.currentTurnPlayerId) {
          this.updateVirtualDiceWithOpponentScorecard(this.currentTurnPlayerId).then(() => {
            virtualDiceUI.render();
            virtualDiceUI.updatePossibleScores("turnChange:spectating");
          });
        }
      }
    }

    // When it becomes your turn, reset dice to fresh state
    if (this.usingVirtualDice && !wasMyTurn && this.isMyTurn) {
      debugLog("🔄 Turn changed to me - resetting dice");
      const virtualDiceUI = this.gameModeManager.virtualDiceUI;
      if (virtualDiceUI) {
        // Use the imported createDiceState function
        virtualDiceUI.state = createDiceState();
        virtualDiceUI.setControlsEnabled(true);

        // Update virtualDiceUI with current game state (so it knows what's filled)
        // This will also trigger a render with the correct available columns
        this.updateVirtualDiceGameState().then(() => {
          // Force a render to ensure UI reflects the new turn state
          virtualDiceUI.render();
          virtualDiceUI.updatePossibleScores("turnChange:myTurn");
        });
      }
    }

    this.applyAnnouncementToView(this.currentTurnPlayerId, { force: true });
    this.applyTurnBasedInputLock();
    this.updateOnlineStatusBanner();
  }

  isManualMode() {
    return !this.usingVirtualDice;
  }

  applyTurnBasedInputLock() {
    if (!this.isManualMode() || !this.gameModeManager?.setOnlineManualInputEnabled) {
      return;
    }

    const viewingOwnSheet = this.currentViewPlayerId === this.playerId;
    const canEdit = viewingOwnSheet && this.canInteractThisTurn();
    this.gameModeManager.setOnlineManualInputEnabled(canEdit);
  }

  showTurnLockedNotice() {
    if (!this.isManualMode()) {
      return;
    }

    if (this.localConnectionStatus === "disconnected") {
      this.showNotification("Reconnect to continue playing.", "warning");
      return;
    }

    const now = Date.now();
    if (now - this.lastTurnLockNoticeAt < 1500) {
      return;
    }
    this.lastTurnLockNoticeAt = now;
    const message = this.turnChangePending
      ? "Saving your previous score..."
      : "⏳ Wait for your turn!";
    const type = this.turnChangePending ? "info" : "warning";
    this.showNotification(message, type);
  }

  canInteractThisTurn() {
    return (
      this.isMyTurn &&
      !this.turnChangePending &&
      !this.gameCompletionHandled &&
      this.localConnectionStatus === "connected"
    );
  }

  showTurnBlockedToast() {
    if (this.localConnectionStatus === "disconnected") {
      this.showToast("Reconnect to continue playing.", "warning");
      return;
    }

    const message = this.turnChangePending
      ? "Finishing your previous move..."
      : "Wait for your turn!";
    const type = this.turnChangePending ? "info" : "warning";
    this.showToast(message, type);
  }

  playTurnNotificationSound() {
    try {
      const AudioContextCtor = window?.AudioContext || window?.webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      if (!this.turnAudioCtx || this.turnAudioCtx.state === "closed") {
        this.turnAudioCtx = new AudioContextCtor();
      }

      const ctx = this.turnAudioCtx;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime || 0;
      const duration = 0.5;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const minGain = 0.0001;

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.linearRampToValueAtTime(660, now + 0.2);

      gain.gain.setValueAtTime(minGain, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(minGain, now + duration);

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start(now);
      oscillator.stop(now + duration);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch (error) {
      console.error("Failed to play turn notification sound:", error);
    }
  }

  refreshPlayerStatusCache(players = []) {
    this.playerStatusMap.clear();
    this.presenceStatusCache.clear();
    this.presenceMissingSince.clear();
    players.forEach((player) => {
      if (player && player.id) {
        const status = player.connection_status ?? "connected";
        this.playerStatusMap.set(player.id, status);
        this.presenceStatusCache.set(player.id, status);
      }
    });
  }

  applyInitialPresenceSnapshot(players = []) {
    if (!Array.isArray(players) || !this.gameId) {
      return;
    }

    const now = Date.now();

    players.forEach((player) => {
      if (!player || !player.id) {
        return;
      }

      const playerId = player.id;
      const isSelf = playerId === this.playerId;
      const rawStatus = player.connection_status ?? "connected";
      const lastSeenAt =
        typeof player.last_seen_at === "string" ? Date.parse(player.last_seen_at) : null;

      let desiredStatus = rawStatus;

      if (isSelf) {
        desiredStatus = this.localConnectionStatus;
      } else {
        if (Number.isFinite(lastSeenAt)) {
          const age = now - lastSeenAt;
          if (age > this.connectionStaleThresholdMs) {
            desiredStatus = "disconnected";
          }
        } else if (rawStatus === "connected") {
          desiredStatus = "disconnected";
        }
      }

      this.playerStatusMap.set(playerId, desiredStatus);
      this.presenceStatusCache.set(playerId, desiredStatus);
      player.connection_status = desiredStatus;

      if (desiredStatus === "disconnected" && !isSelf) {
        this.presenceMissingSince.set(playerId, now);
      } else if (!isSelf) {
        this.presenceMissingSince.delete(playerId);
      }
    });

    this.updateOnlineStatusBanner();
    this.updateTurnIndicator();
  }

  handleConnectionStatusChange(player, previousStatus) {
    if (!player || player.id === this.playerId) {
      return;
    }

    const currentStatus = player.connection_status ?? null;
    if (!previousStatus || previousStatus === currentStatus) {
      return;
    }

    const playerId = player.id;
    const name = player.player_name || this.getPlayerName(playerId);

    if (currentStatus === "disconnected") {
      if (this.pendingDisconnectNotices.has(playerId) || this.announcedDisconnects.has(playerId)) {
        return;
      }

      const timer = setTimeout(() => {
        this.pendingDisconnectNotices.delete(playerId);
        const confirmedStatus = this.playerStatusMap.get(playerId) ?? "connected";
        if (confirmedStatus === "disconnected") {
          this.announcedDisconnects.add(playerId);
          this.showNotification(`⚠️ ${name} lost connection.`, "warning");
        }
      }, this.disconnectNoticeDelayMs);

      this.pendingDisconnectNotices.set(playerId, timer);
    } else if (currentStatus === "connected") {
      const pendingTimer = this.pendingDisconnectNotices.get(playerId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.pendingDisconnectNotices.delete(playerId);
      }

      if (this.announcedDisconnects.has(playerId)) {
        this.announcedDisconnects.delete(playerId);
        this.showNotification(`✅ ${name} reconnected.`, "success");
      }
    }
  }

  updateOnlineStatusBanner() {
    const banner = document.getElementById("online-status-banner");
    const codeEl = document.getElementById("online-room-code");
    const listEl = document.getElementById("online-player-statuses");

    if (!banner || !codeEl || !listEl) {
      return;
    }

    if (!this.gameId) {
      banner.setAttribute("hidden", "true");
      codeEl.textContent = "------";
      listEl.innerHTML = "";
      return;
    }

    banner.removeAttribute("hidden");
    const formattedCode =
      (this.roomCode || "").trim() ||
      (this.gameId ? this.gameId.substring(0, 6).toUpperCase() : "------");
    codeEl.textContent = formattedCode;

    const players = Array.isArray(this.players) ? [...this.players] : [];
    players.sort((a, b) => {
      const orderA = a?.player_order ?? 0;
      const orderB = b?.player_order ?? 0;
      return orderA - orderB;
    });

    listEl.innerHTML = "";

    if (players.length === 0) {
      const placeholder = document.createElement("li");
      placeholder.className = "player-status-item";
      placeholder.textContent = "Waiting for players…";
      listEl.appendChild(placeholder);
      return;
    }

    players.forEach((player) => {
      if (!player || !player.id) {
        return;
      }

      const storedStatus = this.playerStatusMap.get(player.id);
      const statusValue = player.connection_status ?? storedStatus ?? "connected";
      const status = statusValue === "disconnected" ? "disconnected" : "connected";
      const item = document.createElement("li");
      item.classList.add("player-status-item", `status-${status}`);

      if (player.id === this.playerId) {
        item.classList.add("is-self");
      }

      if (player.id === this.currentTurnPlayerId) {
        item.classList.add("is-turn");
      }

      const indicator = document.createElement("span");
      indicator.className = `status-indicator status-${status}`;
      indicator.title = status === "connected" ? "Connected" : "Disconnected";
      item.appendChild(indicator);

      const nameSpan = document.createElement("span");
      const baseName = player.player_name || "Unknown";
      nameSpan.textContent = player.id === this.playerId ? `${baseName}` : baseName;
      item.appendChild(nameSpan);

      listEl.appendChild(item);
    });
  }

  notifyManualClearBlocked(input, previousValue) {
    if (!this.isManualMode()) {
      return;
    }

    if (previousValue !== undefined && previousValue !== null) {
      input.value = previousValue;
      input.dataset.isFilled = "true";
    } else {
      input.value = "";
      input.dataset.isFilled = "false";
    }

    this.showNotification("🛑 Clearing scores is disabled in online games.", "warning");
    this.applyTurnBasedInputLock();
  }

  async handleManualScoreCommit({ input, columnKey, categoryKey, value, previousValue }) {
    if (!this.isManualMode()) {
      return;
    }

    if (this.turnChangePending) {
      this.showNotification("Saving your previous score...", "info");
      input.value = previousValue ?? "";
      input.dataset.isFilled = previousValue !== undefined ? "true" : "false";
      return;
    }

    if (!this.isMyTurn) {
      this.showTurnLockedNotice();
      input.value = previousValue ?? "";
      input.dataset.isFilled = previousValue !== undefined ? "true" : "false";
      return;
    }

    if (this.currentViewPlayerId !== this.playerId) {
      this.showNotification("Switch back to your scorecard to record scores.", "info");
      input.value = previousValue ?? "";
      input.dataset.isFilled = previousValue !== undefined ? "true" : "false";
      return;
    }

    if (previousValue !== undefined && previousValue !== null) {
      this.showNotification("This category is already filled.", "warning");
      input.value = previousValue;
      input.dataset.isFilled = "true";
      return;
    }

    const existingScorecard = await this.getCurrentScorecard();
    const key = `${columnKey}_${categoryKey}`;
    if (existingScorecard && Object.prototype.hasOwnProperty.call(existingScorecard, key)) {
      const persistedValue = existingScorecard[key];
      input.value = persistedValue ?? "";
      input.dataset.isFilled = "true";
      this.showNotification("This category is already filled.", "warning");
      this.applyTurnBasedInputLock();
      return;
    }

    try {
      this.gameModeManager.setOnlineManualInputEnabled(false);
      await this.syncScoreAndEndTurn(categoryKey, columnKey, value);
    } catch (error) {
      console.error("Manual score commit failed:", error);
      input.value = "";
      input.dataset.isFilled = "false";
      this.showNotification("Failed to save score. Please try again.", "error");
    } finally {
      this.applyTurnBasedInputLock();
    }
  }

  /**
   * Update virtualDiceUI with opponent's scorecard
   */
  async updateVirtualDiceWithOpponentScorecard(opponentPlayerId, preloadedState = null) {
    if (!this.usingVirtualDice) {
      return;
    }

    if (!this.gameId) {
      return;
    }

    const virtualDiceUI = this.gameModeManager.virtualDiceUI;
    if (!virtualDiceUI) return;

    try {
      let opponentState = null;

      if (preloadedState && preloadedState.player_id === opponentPlayerId) {
        opponentState = preloadedState;
      } else {
        const allStates = await getAllGameStates(this.gameId);
        opponentState = allStates.find((s) => s.player_id === opponentPlayerId);
      }

      if (opponentState && opponentState.scorecard) {
        const pendingAnnouncement = this.getPlayerAnnouncement(opponentPlayerId) ?? null;
        const gameState = this.buildVirtualDiceGameStateFromScorecard(opponentState.scorecard, {
          announcement: pendingAnnouncement,
        });
        this.pruneAnnouncementUsingScorecard(opponentPlayerId, opponentState.scorecard);
        virtualDiceUI.setGameState(gameState);
        const announcement = pendingAnnouncement ?? gameState.announcement ?? null;
        virtualDiceUI.setAnnouncedCategory(announcement);
        if (!this.canInteractThisTurn()) {
          virtualDiceUI.setControlsEnabled(false);
        }
        //console.log('✅ Updated virtualDiceUI with opponent scorecard');
      }
    } catch (error) {
      console.error("Error updating virtualDiceUI with opponent scorecard:", error);
    }
  }

  /**
   * Update virtualDiceUI with current game state
   */
  async updateVirtualDiceGameState(scorecardOverride = null) {
    if (!this.usingVirtualDice) {
      return;
    }

    if (!this.gameId) {
      return;
    }

    const virtualDiceUI = this.gameModeManager.virtualDiceUI;
    if (!virtualDiceUI) {
      console.warn("⚠️ virtualDiceUI not available for game state update");
      return;
    }

    try {
      // Fetch latest scorecard
      const scorecard = scorecardOverride ?? (await this.getCurrentScorecard());

      //console.log('🎮 Updating virtualDiceUI with scorecard:', scorecard);

      const pendingAnnouncement = this.getPlayerAnnouncement(this.playerId);
      const gameState = this.buildVirtualDiceGameStateFromScorecard(scorecard, {
        announcement: pendingAnnouncement,
      });
      //console.log('🎮 Game state structure:', JSON.stringify(gameState, null, 2));

      // Set the game state in virtualDiceUI
      virtualDiceUI.setGameState(gameState);

      const activeAnnouncement = pendingAnnouncement ?? gameState.announcement ?? null;
      virtualDiceUI.setAnnouncedCategory(activeAnnouncement);
      virtualDiceUI.setControlsEnabled(this.canInteractThisTurn());

      //console.log('✅ Updated virtualDiceUI with game state - it now knows what categories are filled');
    } catch (error) {
      console.error("Error updating virtualDiceUI game state:", error);
    }
  }

  getPlayerAnnouncement(playerId) {
    return this.playerAnnouncements.get(playerId) ?? null;
  }

  setPlayerAnnouncement(playerId, category, options = {}) {
    const normalized = category ?? null;
    const previous = this.getPlayerAnnouncement(playerId);

    if (normalized === previous) {
      if (!options.skipUiUpdate) {
        this.applyAnnouncementToView(playerId, options);
      }
      return;
    }

    if (normalized) {
      this.playerAnnouncements.set(playerId, normalized);
    } else {
      this.playerAnnouncements.delete(playerId);
    }

    if (!options.skipUiUpdate) {
      this.applyAnnouncementToView(playerId, options);
    }
  }

  clearPlayerAnnouncement(playerId, options = {}) {
    this.setPlayerAnnouncement(playerId, null, options);
  }

  applyAnnouncementToView(playerId, options = {}) {
    if (!this.usingVirtualDice) {
      return;
    }

    const virtualDiceUI = this.gameModeManager.virtualDiceUI;
    if (!virtualDiceUI) return;

    const shouldUpdate =
      options.force ||
      playerId === this.currentTurnPlayerId ||
      playerId === this.currentViewPlayerId;

    if (!shouldUpdate) {
      return;
    }

    const announcement = this.getPlayerAnnouncement(playerId);
    const render = options.render;
    const force = Boolean(options.force);

    virtualDiceUI.setAnnouncedCategory(announcement, {
      render,
      force,
    });
  }

  pruneAnnouncementUsingScorecard(playerId, scorecard = {}) {
    const active = this.getPlayerAnnouncement(playerId);
    if (!active) return;

    const key = `announce_${active}`;
    if (scorecard && Object.prototype.hasOwnProperty.call(scorecard, key)) {
      this.clearPlayerAnnouncement(playerId);
    }
  }

  hydrateAnnouncementsFromStates(states) {
    const missingIds = new Set();
    const result = {
      supported: false,
      missingPlayerIds: [],
    };

    if (!Array.isArray(states) || states.length === 0) {
      this.playerAnnouncements.clear();
      if (this.supportsPendingAnnouncements === null) {
        this.supportsPendingAnnouncements = false;
      }
      return result;
    }

    this.playerAnnouncements.clear();
    let sawSupportedField = false;

    states.forEach((state) => {
      const playerId = state?.player_id;
      if (!playerId) {
        return;
      }

      if (Object.prototype.hasOwnProperty.call(state, "pending_announcement")) {
        sawSupportedField = true;
        this.setPlayerAnnouncement(playerId, state.pending_announcement, { skipUiUpdate: true });
        return;
      }

      if (Object.prototype.hasOwnProperty.call(state, "announcement")) {
        sawSupportedField = true;
        this.setPlayerAnnouncement(playerId, state.announcement, { skipUiUpdate: true });
        return;
      }

      missingIds.add(playerId);
    });

    if (sawSupportedField) {
      this.supportsPendingAnnouncements = true;
      result.supported = true;
      result.missingPlayerIds = Array.from(missingIds);
      return result;
    }

    if (this.supportsPendingAnnouncements === null) {
      this.supportsPendingAnnouncements = false;
    }

    // No direct support; request history for everyone
    this.playerAnnouncements.clear();
    states.forEach((state) => {
      const playerId = state?.player_id;
      if (playerId) {
        missingIds.add(playerId);
      }
    });

    result.missingPlayerIds = Array.from(missingIds);
    return result;
  }

  async restoreAnnouncementsFromHistory(states, options = {}) {
    const { onlyPlayerIds = null, preserveExisting = false } = options;

    if (!Array.isArray(states) || states.length === 0) {
      if (!preserveExisting) {
        this.playerAnnouncements.clear();
      }
      return;
    }

    const targets =
      Array.isArray(onlyPlayerIds) && onlyPlayerIds.length ? new Set(onlyPlayerIds) : null;

    if (!preserveExisting) {
      this.playerAnnouncements.clear();
    }

    const tasks = states.map(async (state) => {
      const playerId = state?.player_id;
      if (!playerId) {
        return;
      }

      if (targets && !targets.has(playerId)) {
        return;
      }

      if (preserveExisting && this.playerAnnouncements.has(playerId)) {
        return;
      }

      try {
        const actionData = await this.fetchRecentAction(playerId, "announce");
        const category = actionData?.category ?? null;
        const scorecard = state.scorecard || {};
        if (category) {
          const key = `announce_${category}`;
          if (!Object.prototype.hasOwnProperty.call(scorecard, key)) {
            this.playerAnnouncements.set(playerId, category);
          } else {
            this.playerAnnouncements.delete(playerId);
          }
        } else {
          this.playerAnnouncements.delete(playerId);
        }
      } catch (error) {
        console.error("Failed to restore announcement for player", playerId, error);
      }
    });

    await Promise.all(tasks);
  }

  /**
   * Update UI to reflect online game state
   */
  updateUI(reason = "unspecified") {
    if (typeof globalThis !== "undefined" && globalThis.__traceAvailableScores) {
      try {
        const includeStack = globalThis.__traceAvailableScores === "verbose";
        console.debug("[OnlineGameManager] updateUI", {
          reason,
          isMyTurn: this.isMyTurn,
          turnChangePending: this.turnChangePending,
          timestamp: new Date().toISOString(),
          stack: includeStack ? new Error().stack : undefined,
        });
      } catch (error) {
        console.warn("Failed to log updateUI diagnostics.", error);
      }
    }

    if (this.usingVirtualDice) {
      const canInteract = this.canInteractThisTurn();
      const virtualDiceUI = this.gameModeManager.virtualDiceUI;
      if (virtualDiceUI) {
        virtualDiceUI.setControlsEnabled(canInteract);
      }

      // Enable/disable controls based on turn
      const virtualDicePanel = document.getElementById("virtual-dice-main-panel");
      if (virtualDicePanel) {
        if (canInteract) {
          virtualDicePanel.classList.remove("disabled");
        } else {
          // Disable interaction but keep fully visible
          virtualDicePanel.classList.add("disabled");
        }

        // Keep pointer events enabled so spectators can use view controls like sorting toggles
        virtualDicePanel.style.pointerEvents = "auto";
      }

      // Disable ALL buttons when not your turn
      const rollButton = document.querySelector('[data-action="roll"]');
      if (rollButton) {
        rollButton.disabled = !canInteract || rollButton.disabled;
      }

      const announceButtons = document.querySelectorAll('[data-action="show-announce"]');
      announceButtons.forEach((btn) => {
        btn.disabled = btn.disabled || !canInteract;
        btn.title = canInteract ? "" : "Wait for your turn!";
      });

      // Disable lock buttons
      const lockButtons = document.querySelectorAll('[data-action="toggle-lock"]');
      lockButtons.forEach((btn) => {
        if (!canInteract) {
          btn.style.pointerEvents = "none";
          btn.style.opacity = "0.5";
        } else {
          btn.style.pointerEvents = "auto";
          btn.style.opacity = "1";
        }
      });

      // Show available scores panel always, but disable clicking when not your turn
      const possibleScoresPanel = document.querySelector(".possible-scores-panel");
      if (possibleScoresPanel) {
        possibleScoresPanel.style.display = ""; // Always show

        // Disable clicking on score options when not your turn
        const scoreOptions = possibleScoresPanel.querySelectorAll(".score-option");
        scoreOptions.forEach((option) => {
          if (!canInteract) {
            option.style.pointerEvents = "none";
            option.style.opacity = "0.7";
            option.classList.add("opponent-turn");
          } else {
            option.style.pointerEvents = "auto";
            option.style.opacity = "1";
            option.classList.remove("opponent-turn");
          }
        });
      }
    } else {
      this.applyTurnBasedInputLock();
    }

    this.applyAnnouncementToView(this.currentTurnPlayerId, { force: true });

    // Update turn indicator
    this.updateTurnIndicator();

    // Update scorecard view
    this.updateScorecardView();

    this.updateOnlineStatusBanner();
  }

  /**
   * Update turn indicator in UI
   */
  updateTurnIndicator() {
    // Add a turn indicator element
    let indicator = document.getElementById("turn-indicator");

    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "turn-indicator";
      indicator.className = "turn-indicator";
      // Append to body for proper stacking context
      document.body.appendChild(indicator);
    }

    const isDisconnected = this.localConnectionStatus === "disconnected";
    const isReconnectPending = isDisconnected && this.reconnectAttemptInFlight;
    const secondsUntilRetry =
      isDisconnected && !isReconnectPending ? this.getSecondsUntilReconnectAttempt() : null;

    const turnPlayerStatus = this.currentTurnPlayerId
      ? this.playerStatusMap.get(this.currentTurnPlayerId) ?? "connected"
      : "connected";
    const isTurnPlayerDisconnected =
      !isDisconnected &&
      this.currentTurnPlayerId &&
      this.currentTurnPlayerId !== this.playerId &&
      turnPlayerStatus === "disconnected";

    let text;
    if (isDisconnected) {
      if (isReconnectPending) {
        text = "📡 Reconnecting…";
      } else if (secondsUntilRetry !== null && secondsUntilRetry > 0) {
        text = `📡 Offline · retrying in ${secondsUntilRetry}s`;
      } else {
        text = "📡 Offline · retrying shortly";
      }
    } else if (isTurnPlayerDisconnected) {
      const currentPlayer = this.getPlayerName(this.currentTurnPlayerId);
      text = `🔌 ${currentPlayer} is offline`;
    } else if (this.isMyTurn) {
      text = "🎲 Your turn";
    } else {
      const currentPlayer = this.getPlayerName(this.currentTurnPlayerId);
      text = `⏳ ${currentPlayer}'s turn`;
    }

    indicator.className = "turn-indicator";
    if (isDisconnected || isTurnPlayerDisconnected) {
      indicator.classList.add("offline");
    } else if (this.isMyTurn) {
      indicator.classList.add("my-turn");
    } else {
      indicator.classList.add("their-turn");
    }

    const textSpan = document.createElement("span");
    textSpan.className = "turn-indicator-text";
    textSpan.textContent = text;

    if (isDisconnected) {
      const manualButton = document.createElement("button");
      manualButton.id = "turn-indicator-reconnect";
      manualButton.type = "button";
      manualButton.className = "turn-indicator-retry";
      manualButton.textContent = this.reconnectAttemptInFlight ? "Reconnecting…" : "Reconnect now";
      manualButton.disabled = this.reconnectAttemptInFlight;
      manualButton.addEventListener("click", this.boundManualReconnectHandler);

      indicator.replaceChildren(textSpan, manualButton);
    } else {
      indicator.replaceChildren(textSpan);
    }
  }

  /**
   * Update virtual dice UI with opponent's dice state
   */
  updateVirtualDiceFromOpponent(opponentState, options = {}) {
    if (!this.usingVirtualDice) {
      return;
    }

    const virtualDiceUI = this.gameModeManager.virtualDiceUI;

    if (!virtualDiceUI || this.isMyTurn) {
      // Don't update if it's our turn (we control the dice)
      return;
    }

    const config = typeof options === "boolean" ? { animate: options } : options || {};
    const animate = Boolean(config.animate);
    const cause = config.cause || (animate ? "roll" : "generic");
    const causeSuffix = cause ? `:${cause}` : "";
    const scoreReason = `updateVirtualDiceFromOpponent${causeSuffix}`;

    const previousState = virtualDiceUI.state
      ? {
          values: Array.isArray(virtualDiceUI.state.values)
            ? [...virtualDiceUI.state.values]
            : null,
          locked: Array.isArray(virtualDiceUI.state.locked)
            ? [...virtualDiceUI.state.locked]
            : null,
          rollsRemaining: Number.isInteger(virtualDiceUI.state.rollsRemaining)
            ? virtualDiceUI.state.rollsRemaining
            : null,
        }
      : null;

    debugLog("🎲 Updating dice display with opponent state:", {
      values: opponentState.dice_values,
      locked: opponentState.dice_locked,
      rolls: opponentState.rolls_remaining,
    });

    const announcement = this.getPlayerAnnouncement(opponentState.player_id) ?? null;
    const nextValues = Array.isArray(opponentState.dice_values)
      ? [...opponentState.dice_values]
      : [1, 2, 3, 4, 5];
    const nextLocked = Array.isArray(opponentState.dice_locked)
      ? [...opponentState.dice_locked]
      : [false, false, false, false, false];
    const nextRolls = Number.isInteger(opponentState.rolls_remaining)
      ? opponentState.rolls_remaining
      : 3;

    const applyState = () => {
      const newState = createDiceState();
      newState.values = nextValues;
      newState.locked = nextLocked;
      newState.rollsRemaining = nextRolls;
      virtualDiceUI.state = newState;
      virtualDiceUI.setAnnouncedCategory(announcement, { render: false });
      virtualDiceUI.render();
      virtualDiceUI.updatePossibleScores(scoreReason);
      virtualDiceUI.setControlsEnabled(false);
    };

    const rollDuration = 600;
    const settleDuration = 300;

    if (!animate && cause === "lock" && previousState && Array.isArray(previousState.locked)) {
      const diceElements = virtualDiceUI.container?.querySelectorAll(".die");

      if (diceElements && diceElements.length === nextLocked.length) {
        const updatedState = createDiceState();
        updatedState.values = nextValues;
        updatedState.locked = nextLocked;
        updatedState.rollsRemaining = nextRolls;
        virtualDiceUI.state = updatedState;
        virtualDiceUI.setAnnouncedCategory(announcement, { render: false });

        nextValues.forEach((value, index) => {
          if (previousState.values && previousState.values[index] === value) {
            return;
          }

          const die = diceElements[index];
          const face = die?.querySelector(".die-face");
          if (face) {
            face.innerHTML = virtualDiceUI.renderDieFace(value);
          }
        });

        nextLocked.forEach((locked, index) => {
          const prevLocked = previousState.locked[index] ?? false;
          const die = diceElements[index];
          if (!die) {
            return;
          }

          if (!virtualDiceUI.updateDieLockElement(index, locked)) {
            return;
          }

          if (prevLocked !== locked) {
            const animationClass = locked ? "settling-stay" : "settling-unlock";
            die.classList.add(animationClass);
            setTimeout(() => die.classList.remove(animationClass), settleDuration);
          }
        });

        if (previousState.rollsRemaining !== nextRolls) {
          const rollsEl = virtualDiceUI.container?.querySelector(".rolls-remaining");
          if (rollsEl) {
            rollsEl.innerHTML = `<strong>Rolls remaining:</strong> ${nextRolls}/3`;
          }
        }

        if (virtualDiceUI.controlsEnabled) {
          virtualDiceUI.controlsEnabled = false;
        }
        virtualDiceUI.applyControlClasses();
        virtualDiceUI.updatePossibleScores(scoreReason);
        return;
      }
    }

    // If animation requested, trigger a brief animation
    if (animate) {
      const diceElements = virtualDiceUI.container?.querySelectorAll(".die");

      if (diceElements && diceElements.length) {
        diceElements.forEach((die, index) => {
          const isLocked = Boolean(nextLocked[index]);
          if (isLocked) {
            die.classList.add("settling-stay");
            setTimeout(() => die.classList.remove("settling-stay"), settleDuration);
            return;
          }

          die.classList.add("rolling");
          setTimeout(() => {
            die.classList.remove("rolling");
            die.classList.add("settling-unlock");
            setTimeout(() => die.classList.remove("settling-unlock"), settleDuration);
          }, rollDuration);
        });
      }

      setTimeout(() => {
        applyState();
      }, rollDuration);
      return;
    }

    // Update the virtual dice state to show opponent's dice
    applyState();
  }

  /**
   * Highlight a recently scored cell
   */
  highlightRecentScore(category, column = null, options = {}) {
    if (!category) {
      return;
    }

    const { playerId = null } = options;
    if (playerId && this.currentViewPlayerId !== playerId) {
      return;
    }

    const scorecardSection = document.querySelector(".scorecard");
    if (!scorecardSection) return;

    let selector = `[data-category="${category}"]`;
    if (column) {
      selector += `[data-column="${column}"]`;
    }

    const cells = scorecardSection.querySelectorAll(selector);
    cells.forEach((cell) => {
      cell.classList.add("recent-score");
      setTimeout(() => {
        cell.classList.remove("recent-score");
      }, 2000);
    });
  }

  /**
   * Update scorecard view switcher
   */
  updateScorecardView() {
    // Add scorecard switcher if it doesn't exist
    let switcher = document.getElementById("scorecard-switcher");

    if (!switcher && this.players.length > 1) {
      const scorecardSection = document.querySelector(".scorecard");
      if (scorecardSection) {
        switcher = document.createElement("div");
        switcher.id = "scorecard-switcher";
        switcher.className = "scorecard-switcher";

        const switcherHTML = `
          <div class="switcher-label">Viewing:</div>
          <div class="switcher-buttons">
            ${this.players
              .map(
                (player, index) => `
              <button 
                class="switcher-btn ${player.id === this.playerId ? "active my-scorecard" : ""}"
                data-player-id="${player.id}"
                data-action="switch-scorecard">
                ${player.id === this.playerId ? "👤 " : ""}${player.player_name}
                ${player.id === this.currentTurnPlayerId ? " 🎲" : ""}
              </button>
            `
              )
              .join("")}
          </div>
        `;

        switcher.innerHTML = switcherHTML;

        // Insert before scorecard header
        const scorecardHeader = scorecardSection.querySelector(".section-header");
        if (scorecardHeader) {
          scorecardSection.insertBefore(switcher, scorecardHeader);
        }

        // Add event listener
        switcher.addEventListener("click", (e) => {
          const btn = e.target.closest('[data-action="switch-scorecard"]');
          if (btn) {
            const playerId = btn.dataset.playerId;
            this.switchScorecardView(playerId);
          }
        });
      }
    }

    // Update active states
    if (switcher) {
      switcher.querySelectorAll(".switcher-btn").forEach((btn) => {
        const isCurrentView = btn.dataset.playerId === this.currentViewPlayerId;
        const isCurrentTurn = btn.dataset.playerId === this.currentTurnPlayerId;

        btn.classList.toggle("active", isCurrentView);

        // Update turn indicator
        const turnIndicator = " 🎲";
        const text = btn.textContent.replace(turnIndicator, "");
        btn.textContent = text + (isCurrentTurn ? turnIndicator : "");
      });
    }

    this.applyTurnBasedInputLock();
  }

  /**
   * Switch scorecard view to different player
   */
  async switchScorecardView(playerId) {
    if (!this.gameId) {
      return;
    }

    this.currentViewPlayerId = playerId;

    if (playerId === this.playerId) {
      // Show own scorecard (editable)
      await this.showMyScorecard();
    } else {
      // Show opponent's scorecard (read-only)
      await this.showOpponentScorecard(playerId);
    }

    // Update switcher buttons
    this.updateScorecardView();
    this.applyAnnouncementToView(playerId, { force: true });
    this.applyTurnBasedInputLock();
  }

  /**
   * Show my scorecard
   */
  async showMyScorecard(scorecardOverride = null) {
    const scorecardSection = document.querySelector(".scorecard");
    if (!scorecardSection) return;

    if (!this.gameId) {
      return;
    }

    // Remove opponent view class
    scorecardSection.classList.remove("opponent-view");

    debugLog("📊 Showing my scorecard");

    let scorecard = scorecardOverride;

    try {
      if (!scorecard) {
        // Get my scorecard from server to ensure we have the latest
        const states = await getAllGameStates(this.gameId);
        const myState = states.find((s) => s.player_id === this.playerId);
        scorecard = myState?.scorecard ?? null;
      }

      if (scorecard) {
        debugLog("📊 Restoring my scorecard from server:", scorecard);
        this.applyScorecardLocally(scorecard, { rebuild: true });
      } else {
        debugLog("📊 No stored scores found for my scorecard, rebuilding empty sheet");
        this.applyScorecardLocally({}, { rebuild: true });
      }
    } catch (error) {
      console.error("Error restoring my scorecard:", error);
    }

    this.pruneAnnouncementUsingScorecard(this.playerId, scorecard || {});
    this.applyAnnouncementToView(this.playerId, { force: true });
    this.applyTurnBasedInputLock();
  }

  applyScorecardLocally(scorecard, options = {}) {
    try {
      const applyFn = window.applyServerScorecard;
      const { rebuild = false } = options || {};
      // Delegate to the shared app.js helper so the DOM, local state, and possible scores stay aligned.
      if (typeof applyFn === "function") {
        applyFn(scorecard || {}, options);
      } else {
        console.warn("applyServerScorecard helper not available; skipping local scorecard sync");
        if (rebuild && typeof window.renderTable === "function") {
          window.renderTable();
        }
        const normalizedState = this.convertScorecardToState(scorecard || {});
        this.updateGrandTotalDisplay(normalizedState);
        this.updateSummaryDisplay(normalizedState);
      }
    } catch (error) {
      console.error("Error applying scorecard locally:", error);
    }
  }

  convertScorecardToState(scorecard) {
    const normalized = createEmptyState();
    if (!scorecard || typeof scorecard !== "object") {
      return normalized;
    }
    Object.entries(scorecard).forEach(([key, rawValue]) => {
      if (typeof key !== "string") return;
      const separatorIndex = key.indexOf("_");
      if (separatorIndex <= 0) return;
      const columnKey = key.substring(0, separatorIndex);
      const categoryKey = key.substring(separatorIndex + 1);
      if (!Object.prototype.hasOwnProperty.call(normalized, columnKey)) return;
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) return;
      normalized[columnKey][categoryKey] = numericValue;
    });
    return normalized;
  }

  cloneScoreColumns(state) {
    const result = {};
    columns.forEach((column) => {
      result[column.key] = { ...state[column.key] };
    });
    return result;
  }

  buildVirtualDiceGameStateFromScorecard(scorecard, options = {}) {
    const normalized = this.convertScorecardToState(scorecard);
    return {
      scores: this.cloneScoreColumns(normalized),
      announcement: options.announcement ?? null,
    };
  }

  formatScoreValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "0";
    }
    return numeric === 0 ? "0" : numeric.toLocaleString();
  }

  updateGrandTotalDisplay(state) {
    let grandTotal = 0;
    columns.forEach((column) => {
      const derived = computeColumnDerived(state[column.key] ?? {});
      grandTotal += derived.grandTotal ?? 0;
    });
    const overallGrandTotalCell = document.getElementById("overall-grand-total");
    if (overallGrandTotalCell) {
      overallGrandTotalCell.textContent = this.formatScoreValue(grandTotal);
    }
  }

  updateSummaryDisplay(state) {
    const summaryList = document.getElementById("summary-list");
    if (!summaryList) return;

    summaryList.innerHTML = "";

    const columnSummaries = columns.map((column) => {
      const columnState = state[column.key] ?? {};
      const derived = computeColumnDerived(columnState);
      return { column, columnState, derived };
    });

    const totals = columnSummaries.map(({ derived }) => derived.grandTotal ?? 0);
    const maxTotal = Math.max(...totals);
    const minTotal = Math.min(...totals);

    columnSummaries.forEach(({ column, derived }) => {
      const total = derived.grandTotal ?? 0;
      const upper = derived.upperTotal ?? 0;
      const lower = derived.lowerSubtotal ?? 0;

      const item = document.createElement("li");
      item.className = "summary-item";

      if (totals.length > 1 && total === maxTotal && maxTotal !== minTotal) {
        item.dataset.trend = "up";
      }
      if (totals.length > 1 && total === minTotal && maxTotal !== minTotal) {
        item.dataset.trend = "down";
      }

      const title = document.createElement("h3");
      title.textContent = column.label;

      const value = document.createElement("span");
      value.className = "summary-value";
      value.textContent = this.formatScoreValue(total);

      const detail = document.createElement("small");
      detail.className = "summary-detail";
      detail.textContent = `Upper ${this.formatScoreValue(upper)} • Lower ${this.formatScoreValue(
        lower
      )}`;

      item.append(title, value, detail);
      summaryList.appendChild(item);
    });
  }

  /**
   * Show opponent's scorecard
   */
  async showOpponentScorecard(opponentPlayerId) {
    if (!this.gameId) {
      return;
    }

    try {
      // Fetch opponent's game state
      const allStates = await getAllGameStates(this.gameId);

      if (!allStates || allStates.length === 0) {
        console.error("No game states found");
        return;
      }

      const opponent = allStates.find((s) => s.player_id === opponentPlayerId);
      if (!opponent) {
        console.error("No state found for opponent:", opponentPlayerId);
        debugLog(
          "Available states:",
          allStates.map((s) => ({ playerId: s.player_id, name: s.players?.player_name }))
        );
        return;
      }

      debugLog("📊 Showing opponent scorecard:", opponent.players?.player_name, opponent.scorecard);

      // Update scorecard to show opponent's scores (read-only)
      this.renderOpponentScorecard(opponent.scorecard, opponentPlayerId);
    } catch (error) {
      console.error("Error showing opponent scorecard:", error);
    }
  }

  /**
   * Render opponent's scorecard (read-only view)
   */
  renderOpponentScorecard(scorecard, opponentPlayerId) {
    const scorecardSection = document.querySelector(".scorecard");
    if (!scorecardSection) return;

    scorecardSection.classList.add("opponent-view");

    // Get opponent name
    const opponentName = this.getPlayerName(opponentPlayerId);
    const normalizedState = this.convertScorecardToState(scorecard);

    columns.forEach((column) => {
      const columnState = normalizedState[column.key] ?? {};
      const derived = computeColumnDerived(columnState);
      categories.forEach((category) => {
        const cell = scorecardSection.querySelector(
          `[data-category="${category.key}"][data-column="${column.key}"]`
        );
        if (!cell) return;
        cell.classList.remove("available");
        if (category.input) {
          const hasValue = Object.prototype.hasOwnProperty.call(columnState, category.key);
          if (hasValue) {
            cell.textContent = this.formatScoreValue(columnState[category.key]);
            cell.classList.add("filled");
            cell.classList.remove("unavailable");
          } else {
            cell.textContent = "-";
            cell.classList.remove("filled");
            cell.classList.add("unavailable");
          }
        } else {
          const value = getCategoryValue(columnState, derived, category.key);
          cell.textContent = this.formatScoreValue(value);
          cell.classList.add("filled");
          cell.classList.remove("unavailable");
        }
      });
    });

    this.updateGrandTotalDisplay(normalizedState);
    this.updateSummaryDisplay(normalizedState);

    debugLog(`📊 Rendered ${opponentName}'s scorecard`);
    this.applyTurnBasedInputLock();
  }

  /**
   * Update opponent's scorecard display
   */
  async updateOpponentScorecard(opponentPlayerId) {
    // If we're currently viewing this opponent, refresh the view
    if (this.currentViewPlayerId === opponentPlayerId) {
      await this.showOpponentScorecard(opponentPlayerId);
    }
  }

  /**
   * Get player name by ID
   */
  getPlayerName(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    return player ? player.player_name : "Unknown";
  }

  /**
   * Show notification to user
   */
  showNotification(message, type = "info") {
    debugLog(`📢 ${message}`);

    // Create toast notification
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => toast.classList.add("show"), 10);

    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Handle game completed
   */
  async handleGameCompleted(gameData) {
    try {
      this.gameCompletionHandled = true;
      this.applyTurnBasedInputLock();

      if (this.gameResultsShown) {
        return;
      }

      const allStates = await getAllGameStates(this.gameId);
      const standings = this.buildStandingsFromStates(allStates);
      const winnerId = gameData?.winner_id ?? standings[0]?.id ?? null;

      this.showWinnerScreen({
        winnerId,
        standings: standings.length > 0 ? standings : this.latestStandings,
      });
    } catch (error) {
      console.error("Error handling completed game update:", error);
    }
  }

  /**
   * Fetch recent action details from game_actions table
   */
  async fetchRecentAction(playerId, actionType) {
    try {
      const { supabase } = await import("./services/supabaseClient.js");

      const { data, error } = await supabase
        .from("game_actions")
        .select("action_data")
        .eq("game_id", this.gameId)
        .eq("player_id", playerId)
        .eq("action_type", actionType)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Error fetching recent action:", error);
        return null;
      }

      return data?.action_data ?? null;
    } catch (error) {
      console.error("Error in fetchRecentAction:", error);
      return null;
    }
  }

  /**
   * Show a toast notification
   */
  showToast(message, type = "info") {
    // Reuse existing toast system or create inline
    const existingToast = document.getElementById("game-toast");
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement("div");
    toast.id = "game-toast";
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  hasActiveGame() {
    return Boolean(this.gameId);
  }

  /**
   * Cleanup when leaving game
   */
  cleanup() {
    this.restoreVirtualDiceCallbacks();
    this.stopConnectionHeartbeat();
    this.stopPresenceMonitor();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.activeRealtimeSubscriptionId = null;
    this.channelReadyNotified = false;
    this.logRealtimeEvent("cleanup-complete");

    this.gameId = null;
    this.playerId = null;
    this.players = [];
    this.currentTurnPlayerId = null;
    this.isMyTurn = false;
    this.roomCode = null;
    this.playerStatusMap.clear();
    this.presenceStatusCache.clear();
    this.pendingPresenceIds = null;
    this.presenceUpdateInFlight = false;
    this.presenceMissingSince.clear();
    this.presenceWarmupUntil = 0;
    if (this.realtimeResubscribeTimer) {
      clearTimeout(this.realtimeResubscribeTimer);
      this.realtimeResubscribeTimer = null;
    }
    this.realtimeResubscribeAttempts = 0;
    this.realtimeConnectionState = "idle";
    this.lastRealtimeStatus = null;
    this.realtimeStatusChangedAt = 0;
    this.lastRealtimeWarningAt = 0;
    this.recoveringAfterReconnect = false;
    this.staleRealtimeSubscriptionIds.clear();
    this.stopReconnectLoop();
    this.localConnectionStatus = "connected";
    for (const timer of this.pendingDisconnectNotices.values()) {
      clearTimeout(timer);
    }
    this.pendingDisconnectNotices.clear();
    this.announcedDisconnects.clear();
    this.updateOnlineStatusBanner();
    this.supportsPendingAnnouncements = null;

    if (this.turnAudioCtx) {
      const ctx = this.turnAudioCtx;
      try {
        const closeResult = ctx.close?.();
        if (closeResult && typeof closeResult.catch === "function") {
          closeResult.catch(() => {});
        }
      } catch (error) {
        console.error("Failed to close audio context:", error);
      }
      this.turnAudioCtx = null;
    }

    // Remove turn indicator
    const indicator = document.getElementById("turn-indicator");
    if (indicator) {
      indicator.remove();
    }

    const switcher = document.getElementById("scorecard-switcher");
    if (switcher) {
      switcher.remove();
    }

    // Remove any toasts
    const toast = document.getElementById("game-toast");
    if (toast) {
      toast.remove();
    }

    // Clear localStorage
    localStorage.removeItem("yamb_online_game");
  }

  /**
   * Save game state to localStorage for reconnection
   */
  saveGameToLocalStorage() {
    try {
      localStorage.setItem(
        "yamb_online_game",
        JSON.stringify({
          gameId: this.gameId,
          playerId: this.playerId,
          timestamp: Date.now(),
        })
      );
      debugLog("💾 Game state saved to localStorage");
    } catch (error) {
      console.error("Failed to save game to localStorage:", error);
    }
  }

  /**
   * Check for existing game in localStorage and offer reconnection
   */
  async checkForExistingGame() {
    const saved = localStorage.getItem("yamb_online_game");
    if (!saved) return false;

    try {
      const { gameId, playerId, timestamp } = JSON.parse(saved);

      // Don't rejoin if too old (> 24 hours)
      if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem("yamb_online_game");
        return false;
      }

      // Check if game still exists and is in progress
      const game = await getGame(gameId);

      if (game && game.status === "in_progress") {
        return await this.autoReconnectToGame(gameId, playerId, game);
      } else {
        // Game ended or doesn't exist, clear storage
        localStorage.removeItem("yamb_online_game");
        return false;
      }
    } catch (error) {
      console.error("Failed to check for existing game:", error);
      localStorage.removeItem("yamb_online_game");
      return false;
    }
  }

  /**
   * Show reconnection prompt to user
   */
  async autoReconnectToGame(gameId, playerId, game) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "reconnect-modal";

      const roomCode = (game?.room_code || "").toString().trim();
      const formattedCode = roomCode || "------";
      const playersList = Array.isArray(game?.players)
        ? game.players.map((p) => p.player_name).join(", ")
        : "Unknown players";

      modal.innerHTML = `
        <div class="reconnect-content">
          <h2>🔄 Rejoining Game</h2>
          <p class="reconnect-status">Reconnecting you to room <strong>${formattedCode}</strong>…</p>
          <div class="game-info">
            <div>Room Code: ${formattedCode}</div>
            <div>Players: ${playersList}</div>
          </div>
          <div class="reconnect-actions">
            <button class="btn-new-game">❌ Start New</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const statusEl = modal.querySelector(".reconnect-status");
      const actionsEl = modal.querySelector(".reconnect-actions");
      let isAttemptingReconnect = false;

      const ensureRetryButton = () => {
        if (modal.querySelector(".btn-retry")) {
          return modal.querySelector(".btn-retry");
        }

        const retryBtn = document.createElement("button");
        retryBtn.className = "btn-retry";
        retryBtn.type = "button";
        retryBtn.textContent = "🔁 Retry";
        retryBtn.addEventListener("click", () => {
          statusEl.innerHTML = `Reconnecting you to room <strong>${formattedCode}</strong>…`;
          retryBtn.disabled = true;
          attemptReconnect().finally(() => {
            retryBtn.disabled = false;
          });
        });
        actionsEl.insertBefore(retryBtn, actionsEl.firstChild);
        return retryBtn;
      };

      const attemptReconnect = async () => {
        if (isAttemptingReconnect) {
          return;
        }

        isAttemptingReconnect = true;
        try {
          await this.rejoinGame(gameId, playerId);
          modal.remove();
          resolve(true);
        } catch (error) {
          console.error("Auto reconnect failed:", error);
          if (statusEl) {
            statusEl.textContent =
              "Failed to reconnect automatically. You can retry or start a new game.";
          }
          ensureRetryButton();
        }
        isAttemptingReconnect = false;
      };

      const startNew = () => {
        localStorage.removeItem("yamb_online_game");
        modal.remove();
        resolve(false);
      };

      modal.querySelector(".btn-new-game").addEventListener("click", startNew);

      attemptReconnect();
    });
  }

  /**
   * Rejoin an existing game
   */
  async rejoinGame(gameId, playerId, options = {}) {
    const { silent = false, preserveStorage = false } = options || {};
    try {
      debugLog("🔄 Rejoining game...", { gameId, playerId, silent });

      const game = await getGame(gameId);
      if (game?.game_mode && this.gameModeManager?.applyOnlineGameMode) {
        this.gameModeManager.applyOnlineGameMode(game.game_mode);
      }

      const modeFromServer = game?.game_mode?.dice;
      const localMode = this.gameModeManager?.getMode ? this.gameModeManager.getMode() : null;
      const diceMode = modeFromServer ?? localMode?.dice ?? GameMode.DICE.VIRTUAL;
      this.usingVirtualDice = diceMode !== GameMode.DICE.PHYSICAL;

      // Restore state
      this.gameId = gameId;
      this.playerId = playerId;
      this.roomCode = game?.room_code ?? null;
      this.players = this.filterActivePlayers(Array.isArray(game?.players) ? game.players : []);
      this.supportsPendingAnnouncements = null;
      this.currentTurnPlayerId = game.current_turn_player_id;
      this.currentViewPlayerId = playerId;
      this.turnChangePending = false;
      this.refreshPlayerStatusCache(this.players);
      const rejoinNow = Date.now();
      this.presenceWarmupUntil = rejoinNow + this.presenceWarmupMs;
      this.realtimeConnectionState = "connecting";
      this.lastRealtimeStatus = null;
      this.realtimeStatusChangedAt = rejoinNow;
      this.lastRealtimeWarningAt = 0;
      this.applyInitialPresenceSnapshot(this.players);
      this.logRealtimeEvent("rejoin-start", {
        rejoinNow,
      });
      this.pendingPresenceIds = null;
      this.presenceUpdateInFlight = false;
      this.startConnectionHeartbeat();
      this.startPresenceMonitor();

      const me = game.players.find((p) => p.id === playerId);
      this.isHost = me?.is_host || false;

      this.updateTurnState();

      // Subscribe to updates
      await this.subscribeToGameUpdates();

      if (this.usingVirtualDice) {
        this.gameModeManager.showVirtualDicePanel();
        await new Promise((resolve) => setTimeout(resolve, 0));
        this.setupVirtualDiceCallbacks();
      } else {
        this.gameModeManager.hideVirtualDicePanel();
        this.gameModeManager.enableScorecardInputs();
      }

      // Fetch and restore game state
      const states = await getAllGameStates(gameId);
      const myState = states.find((s) => s.player_id === playerId);
      const currentPlayerState = states.find((s) => s.player_id === this.currentTurnPlayerId);
      const virtualDiceUI = this.gameModeManager.virtualDiceUI;

      const hydration = this.hydrateAnnouncementsFromStates(states);
      if (!hydration.supported || hydration.missingPlayerIds.length) {
        await this.restoreAnnouncementsFromHistory(states, {
          onlyPlayerIds: hydration.supported ? hydration.missingPlayerIds : null,
          preserveExisting: hydration.supported,
        });
      }

      await this.showMyScorecard(myState?.scorecard ?? {});
      if (this.usingVirtualDice) {
        await this.updateVirtualDiceGameState(myState?.scorecard ?? {});
      } else {
        this.applyTurnBasedInputLock();
      }

      this.applyAnnouncementToView(this.playerId, { force: true });
      if (this.currentTurnPlayerId && this.currentTurnPlayerId !== this.playerId) {
        this.applyAnnouncementToView(this.currentTurnPlayerId, { force: true });
      }

      if (this.usingVirtualDice && virtualDiceUI) {
        const buildDiceStateFromServer = (state) => {
          const base = createDiceState();
          if (!state) return base;
          if (Array.isArray(state.dice_values) && state.dice_values.length === 5) {
            base.values = state.dice_values;
          }
          if (Array.isArray(state.dice_locked) && state.dice_locked.length === 5) {
            base.locked = state.dice_locked;
          }
          if (typeof state.rolls_remaining === "number") {
            base.rollsRemaining = state.rolls_remaining;
          }
          return base;
        };

        if (this.isMyTurn) {
          const myDiceState = buildDiceStateFromServer(myState);
          virtualDiceUI.state = myDiceState;
          virtualDiceUI.render();
          virtualDiceUI.updatePossibleScores("rejoinGame:myTurn");
          virtualDiceUI.setControlsEnabled(true);
        } else if (currentPlayerState) {
          const pendingAnnouncement =
            this.getPlayerAnnouncement(currentPlayerState.player_id) ?? null;
          const opponentGameState = this.buildVirtualDiceGameStateFromScorecard(
            currentPlayerState.scorecard || {},
            {
              announcement: pendingAnnouncement,
            }
          );
          virtualDiceUI.setGameState(opponentGameState);
          this.updateVirtualDiceFromOpponent(currentPlayerState, { cause: "rejoin" });
          await this.updateVirtualDiceWithOpponentScorecard(
            this.currentTurnPlayerId,
            currentPlayerState
          );
        } else {
          virtualDiceUI.state = createDiceState();
          virtualDiceUI.render();
          virtualDiceUI.updatePossibleScores("rejoinGame:idle");
          virtualDiceUI.setControlsEnabled(false);
        }
      }

      debugLog("✅ Game state restored");

      this.updateUI("rejoinGame:success");
      if (!silent) {
        this.showNotification("Reconnected successfully!", "success");
      }

      debugLog("✅ Rejoined game successfully");
    } catch (error) {
      console.error("Failed to rejoin game:", error);
      if (!silent) {
        this.showNotification("Failed to reconnect: " + error.message, "error");
      }
      if (!preserveStorage) {
        localStorage.removeItem("yamb_online_game");
      }
      throw error;
    }
  }

  /**
   * Check if game is complete (all players filled all categories)
   */
  async checkGameCompletion() {
    try {
      if (this.gameCompletionHandled) {
        return;
      }

      const allStates = await getAllGameStates(this.gameId);

      if (!Array.isArray(allStates) || allStates.length === 0) {
        return;
      }

      // Check if all players have filled every input cell
      const allComplete = allStates.every((state) => {
        const scorecard = state.scorecard || {};
        const filledCount = Object.keys(scorecard).length;
        return filledCount >= TOTAL_INPUT_CELLS;
      });

      if (allComplete) {
        debugLog("🎉 Game complete! Calculating winner...");
        await this.endGame(allStates);
      }
    } catch (error) {
      console.error("Error checking game completion:", error);
    }
  }

  /**
   * End game and show winner
   */
  async endGame(allStates) {
    try {
      if (this.gameCompletionHandled) {
        return;
      }

      this.gameCompletionHandled = true;

      const sortedByScore = this.buildStandingsFromStates(allStates);
      const winnerEntry = sortedByScore[0];
      const winnerId = winnerEntry?.id ?? null;

      if (winnerId && (this.playerId === winnerId || this.isHost)) {
        try {
          await syncGameComplete(this.gameId, winnerId);
        } catch (error) {
          console.error("Error marking game complete:", error);
        }
      }

      this.showWinnerScreen({
        winnerId,
        standings: sortedByScore,
      });
    } catch (error) {
      console.error("Error ending game:", error);
    }
  }

  /**
   * Calculate final score with upper section bonus
   */
  calculateFinalScore(scorecard) {
    const normalized = this.convertScorecardToState(scorecard || {});

    let total = 0;
    let filledCells = 0;
    const columnsSummary = {};

    columns.forEach((column) => {
      const columnState = normalized[column.key] ?? {};
      filledCells += Object.keys(columnState).length;

      const derived = computeColumnDerived(columnState);
      const columnTotal = derived.grandTotal ?? 0;

      columnsSummary[column.key] = {
        total: columnTotal,
        upperSubtotal: derived.upperSubtotal ?? 0,
        upperTotal: derived.upperTotal ?? 0,
        bonus: derived.bonus ?? 0,
        diff: derived.diff ?? 0,
        lowerSubtotal: derived.lowerSubtotal ?? 0,
      };

      total += columnTotal;
    });

    return {
      total,
      columns: columnsSummary,
      filledCells,
    };
  }

  buildStandingsFromStates(states) {
    if (!Array.isArray(states)) {
      return [];
    }

    const standings = states.map((state) => {
      const finalScore = this.calculateFinalScore(state.scorecard);
      const meta = state.players ||
        this.players.find((player) => player.id === state.player_id) || {
          player_name: this.getPlayerName(state.player_id),
        };

      return {
        id: state.player_id,
        name: meta?.player_name ?? this.getPlayerName(state.player_id),
        total: finalScore.total,
        columns: finalScore.columns,
        filledCells: finalScore.filledCells,
      };
    });

    standings.sort((a, b) => b.total - a.total);

    return standings;
  }

  /**
   * Show winner screen
   */
  showWinnerScreen({ winnerId, standings }) {
    if (this.gameResultsShown) {
      return;
    }

    const orderedStandings = Array.isArray(standings) && standings.length > 0 ? standings : [];

    if (orderedStandings.length === 0) {
      console.warn("No standings available to render game results");
      return;
    }

    this.gameResultsShown = true;
    this.latestStandings = orderedStandings;

    const winnerEntry =
      orderedStandings.find((entry) => entry.id === winnerId) ?? orderedStandings[0];
    const winnerScore = winnerEntry?.total ?? 0;
    const runnerUpEntry = orderedStandings.find((entry) => entry.id !== winnerEntry?.id) ?? null;
    const viewerEntry = orderedStandings.find((entry) => entry.id === this.playerId) ?? null;
    const viewerIsWinner = Boolean(viewerEntry && winnerEntry && viewerEntry.id === winnerEntry.id);

    const decorateStandings = orderedStandings.map((entry, index) => {
      const diff = winnerEntry ? Math.max(0, winnerScore - entry.total) : 0;
      const breakdown = columns
        .map((column) => {
          const columnSummary = entry.columns?.[column.key];
          const columnTotal = columnSummary?.total ?? 0;
          return `${column.label}: ${columnTotal}`;
        })
        .join(" • ");

      return {
        ...entry,
        rank: index + 1,
        diffFromWinner: diff,
        breakdown,
      };
    });

    const formatPoints = (value) => {
      const rounded = Number(value) || 0;
      return `${rounded} point${Math.abs(rounded) === 1 ? "" : "s"}`;
    };

    const winnerName = winnerEntry?.name ?? "Unknown";
    let heading = "Game Complete";
    let subheading = `${winnerName} wins with ${formatPoints(winnerScore)}.`;

    if (viewerEntry) {
      if (viewerIsWinner) {
        heading = "You Win!";
        if (runnerUpEntry) {
          const margin = winnerScore - runnerUpEntry.total;
          if (margin === 0) {
            subheading = `You and ${runnerUpEntry.name} finish tied at ${formatPoints(
              winnerScore
            )}.`;
          } else {
            subheading = `You beat ${runnerUpEntry.name} by ${formatPoints(
              margin
            )} with ${formatPoints(winnerScore)}.`;
          }
        } else {
          subheading = `You finish with ${formatPoints(winnerScore)}.`;
        }
      } else {
        heading = "Game Over";
        const margin = winnerScore - viewerEntry.total;
        if (margin === 0) {
          subheading = `${winnerName} wins on tie-breakers at ${formatPoints(
            winnerScore
          )}. You matched the score.`;
        } else {
          subheading = `${winnerName} wins with ${formatPoints(
            winnerScore
          )}. You scored ${formatPoints(viewerEntry.total)} (${formatPoints(margin)} behind).`;
        }
      }
    } else if (runnerUpEntry) {
      const margin = winnerScore - runnerUpEntry.total;
      if (margin === 0) {
        subheading = `${winnerName} and ${runnerUpEntry.name} tie at ${formatPoints(winnerScore)}.`;
      } else {
        subheading = `${winnerName} wins with ${formatPoints(winnerScore)}, ahead of ${
          runnerUpEntry.name
        } by ${formatPoints(margin)}.`;
      }
    }

    const modal = document.createElement("div");
    modal.className = "winner-modal";

    modal.innerHTML = `
      <div class="winner-content">
        <h1>🎉 ${heading}</h1>
        <p class="winner-subheading">${subheading}</p>
        <div class="final-scores">
          ${decorateStandings
            .map((entry) => {
              const rankBadge = entry.rank === 1 ? "🏆" : `#${entry.rank}`;
              const diffLabel =
                entry.diffFromWinner === 0
                  ? entry.id === winnerEntry?.id
                    ? "Winner"
                    : "Tie"
                  : `-${entry.diffFromWinner} pts`;
              return `
              <div class="player-score ${entry.id === winnerEntry?.id ? "winner" : ""}">
                <div class="player-rank">${rankBadge}</div>
                <div class="player-info">
                  <div class="player-name">${entry.name}</div>
                  <div class="player-breakdown">${entry.breakdown}</div>
                </div>
                <div class="player-results">
                  <div class="player-total">${entry.total}</div>
                  <div class="player-diff">${diffLabel}</div>
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
        <div class="winner-actions">
          <button class="btn-lobby">🏠 Back to Lobby</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    if (viewerIsWinner) {
      this.showConfetti();
    }

    const lobbyButton = modal.querySelector(".btn-lobby");
    if (lobbyButton) {
      lobbyButton.addEventListener("click", () => {
        modal.remove();
        this.cleanup();
        if (this.gameModeManager?.onlineLobby) {
          this.gameModeManager.onlineLobby.show();
        } else if (this.gameModeManager?.showGameModeDialog) {
          this.gameModeManager.showGameModeDialog();
        }
      });
    }
  }

  /**
   * Show confetti animation
   */
  showConfetti() {
    // Simple confetti effect using CSS
    const confettiCount = 50;
    for (let i = 0; i < confettiCount; i++) {
      const confetti = document.createElement("div");
      confetti.className = "confetti";
      confetti.style.left = Math.random() * 100 + "%";
      confetti.style.animationDelay = Math.random() * 3 + "s";
      confetti.style.backgroundColor = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981"][
        Math.floor(Math.random() * 4)
      ];
      document.body.appendChild(confetti);

      setTimeout(() => confetti.remove(), 5000);
    }
  }
}

export default OnlineGameManager;
