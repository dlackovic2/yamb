/**
 * Online Lobby UI
 * 
 * Handles the user interface for:
 * - Creating a new online game
 * - Joining an existing game
 * - Waiting room before game starts
 */

import { createGame, joinGame, startGame, getGame, leaveGame, updatePlayerConnectionStatus, updatePlayerConnectionStatusKeepalive } from './services/onlineGameService.js';
import { subscribeToGame } from './services/realtimeService.js';

export class OnlineLobbyUI {
  constructor(gameModeManager = null) {
    this.gameModeManager = gameModeManager;
    this.currentGameId = null;
    this.currentPlayerId = null;
    this.currentRoomCode = null;
    this.isHost = false;
    this.unsubscribe = null;
    this.isClosing = false;
    this.presenceStatusCache = new Map();
    this.latestPlayers = [];
    this.presenceUpdateInFlight = false;
    this.pendingPresenceIds = null;
    this.connectionStaleThresholdMs = 12000;
    this.presenceMonitorIntervalMs = 5000;
    this.presenceMonitorTimer = null;
    this.connectionHeartbeatIntervalMs = 6000;
    this.heartbeatTimer = null;
    this.refreshPlayersPromise = null;
    this.lastPlayersFetchAt = 0;
    this.minimumPlayerRefreshIntervalMs = 2000;
  this.cleanupPromise = null;
    this.pendingChannelReadyListener = null;
    this.pendingChannelReadyTimeout = null;
    this.pendingChannelCleanupInFlight = false;
    
    this.createDialog();
    this.attachEventListeners();
  }
  
  /**
   * Create the lobby dialog HTML
   */
  createDialog() {
    const dialogHTML = `
      <!-- Online Lobby Dialog -->
      <dialog id="online-lobby-dialog" class="app-dialog online-lobby-dialog">
        <button class="dialog-close-btn" id="lobby-close-btn" aria-label="Close">×</button>
        <div class="dialog-content">
          <h2 class="dialog-title">🌐 Online Multiplayer</h2>
          
          <!-- Initial Choice: Create or Join -->
          <div id="lobby-choice" class="lobby-section">
            <p class="lobby-description">Play Yamb with a friend online in real-time!</p>
            <div class="lobby-buttons">
              <button id="btn-create-game" class="btn btn-primary btn-large">
                <span class="btn-icon">➕</span>
                Create New Game
              </button>
              <button id="btn-join-game" class="btn btn-secondary btn-large">
                <span class="btn-icon">🔗</span>
                Join Game
              </button>
            </div>
          </div>
          
          <!-- Create Game Form -->
          <div id="lobby-create" class="lobby-section" style="display: none;">
            <button class="btn-back" id="btn-back-from-create">← Back</button>
            <h3>Create New Game</h3>
            <form id="form-create-game">
              <div class="form-group">
                <label for="input-host-name">Your Name</label>
                <input 
                  type="text" 
                  id="input-host-name" 
                  class="form-input"
                  placeholder="Enter your name"
                  maxlength="20"
                  required
                />
              </div>
              <button type="submit" class="btn btn-primary btn-large">
                Create Game Room
              </button>
            </form>
          </div>
          
          <!-- Join Game Form -->
          <div id="lobby-join" class="lobby-section" style="display: none;">
            <button class="btn-back" id="btn-back-from-join">← Back</button>
            <h3>Join Game</h3>
            <form id="form-join-game">
              <div class="form-group">
                <label for="input-player-name">Your Name</label>
                <input 
                  type="text" 
                  id="input-player-name" 
                  class="form-input"
                  placeholder="Enter your name"
                  maxlength="20"
                  required
                />
              </div>
              <div class="form-group">
                <label for="input-room-code">Room Code</label>
                <input 
                  type="text" 
                  id="input-room-code" 
                  class="form-input room-code-input"
                  placeholder="ABC123"
                  maxlength="6"
                  required
                />
              </div>
              <button type="submit" class="btn btn-primary btn-large">
                Join Game
              </button>
            </form>
            <div id="join-error" class="error-message" style="display: none;"></div>
          </div>
          
          <!-- Waiting Room -->
          <div id="lobby-waiting" class="lobby-section" style="display: none;">
            <h3>Waiting Room</h3>
            
            <div class="room-code-display">
              <div class="room-code-label">Room Code:</div>
              <div class="room-code-value" id="display-room-code">------</div>
              <button class="btn btn-small" id="btn-copy-code">
                📋 Copy
              </button>
            </div>
            
            <div class="players-list">
              <h4>Players (<span id="player-count">0</span>/2)</h4>
              <div id="players-container"></div>
            </div>
            
            <div class="waiting-actions">
              <button class="btn btn-primary btn-large" id="btn-start-game" style="display: none;">
                Start Game
              </button>
              <button class="btn btn-secondary" id="btn-leave-game">
                Leave Game
              </button>
            </div>
            
            <div class="waiting-message" id="waiting-message">
              Waiting for players to join...
            </div>
          </div>
          
          <!-- Loading Indicator -->
          <div id="lobby-loading" class="lobby-loading" style="display: none;">
            <div class="spinner"></div>
            <p>Loading...</p>
          </div>
        </div>
      </dialog>
    `;
    
    // Inject into the page
    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    this.dialog = document.getElementById('online-lobby-dialog');
  }
  
  /**
   * Attach event listeners to lobby UI elements
   */
  attachEventListeners() {
  // Close button
    document.getElementById('lobby-close-btn').addEventListener('click', () => this.handleLeaveGame());
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.handleLeaveGame({ skipConfirm: true });
    });
    
    // Navigation buttons
    document.getElementById('btn-create-game').addEventListener('click', () => this.showCreateForm());
    document.getElementById('btn-join-game').addEventListener('click', () => this.showJoinForm());
    document.getElementById('btn-back-from-create').addEventListener('click', () => this.showChoice());
    document.getElementById('btn-back-from-join').addEventListener('click', () => this.showChoice());
    
    // Form submissions
    document.getElementById('form-create-game').addEventListener('submit', (e) => this.handleCreateGame(e));
    document.getElementById('form-join-game').addEventListener('submit', (e) => this.handleJoinGame(e));
    
    // Room code input - auto-uppercase
    const roomCodeInput = document.getElementById('input-room-code');
    roomCodeInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
    
    // Waiting room actions
    document.getElementById('btn-copy-code').addEventListener('click', () => this.copyRoomCode());
    document.getElementById('btn-start-game').addEventListener('click', () => this.handleStartGame());
    document.getElementById('btn-leave-game').addEventListener('click', () => this.handleLeaveGame());
  }
  
  /**
   * Show the lobby dialog
   */
  show() {
    this.showChoice();
    this.dialog.showModal();
  }

  openJoinFlow() {
    this.show();
    this.showJoinForm();
  }

  openCreateFlow() {
    this.show();
    this.showCreateForm();
  }
  
  /**
   * Hide the lobby dialog
   */
  async hide() {
    if (this.dialog?.open) {
      this.dialog.close();
    }
    await this.cleanup();
  }
  
  /**
   * Show initial choice (create or join)
   */
  showChoice() {
    this.hideAllSections();
    document.getElementById('lobby-choice').style.display = 'block';
  }
  
  /**
   * Show create game form
   */
  showCreateForm() {
    this.hideAllSections();
    document.getElementById('lobby-create').style.display = 'block';
    document.getElementById('input-host-name').focus();
  }
  
  /**
   * Show join game form
   */
  showJoinForm() {
    this.hideAllSections();
    document.getElementById('lobby-join').style.display = 'block';
    document.getElementById('input-player-name').focus();
  }
  
  /**
   * Show waiting room
   */
  showWaitingRoom() {
    this.hideAllSections();
    document.getElementById('lobby-waiting').style.display = 'block';
  }
  
  /**
   * Show loading indicator
   */
  showLoading() {
    document.getElementById('lobby-loading').style.display = 'flex';
  }
  
  /**
   * Hide loading indicator
   */
  hideLoading() {
    document.getElementById('lobby-loading').style.display = 'none';
  }
  
  /**
   * Hide all lobby sections
   */
  hideAllSections() {
    document.getElementById('lobby-choice').style.display = 'none';
    document.getElementById('lobby-create').style.display = 'none';
    document.getElementById('lobby-join').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'none';
    document.getElementById('join-error').style.display = 'none';
    this.hideLoading();
  }
  
  /**
   * Handle create game form submission
   */
  async handleCreateGame(event) {
    event.preventDefault();
    
    const hostName = document.getElementById('input-host-name').value.trim();
    if (!hostName) return;
    
    this.showLoading();
    
    try {
      const modePayload = this.getSelectedGameModePayload();
      const result = await createGame(hostName, modePayload);
      
      this.currentGameId = result.gameId;
      this.currentPlayerId = result.hostPlayerId;
      this.currentRoomCode = result.roomCode;
      this.isHost = true;
      
      // Subscribe to real-time updates
  await this.subscribeToGameUpdates();
      
      // Show waiting room
      this.displayRoomCode(result.roomCode);
      await this.refreshPlayers();
      this.showWaitingRoom();
      
      // Show start button for host
      document.getElementById('btn-start-game').style.display = 'block';
      
    } catch (error) {
      console.error('Failed to create game:', error);
      alert('Failed to create game: ' + error.message);
    } finally {
      this.hideLoading();
    }
  }
  
  /**
   * Handle join game form submission
   */
  async handleJoinGame(event) {
    event.preventDefault();
    
    const playerName = document.getElementById('input-player-name').value.trim();
    const roomCode = document.getElementById('input-room-code').value.trim();
    
    if (!playerName || !roomCode) return;
    
    this.showLoading();
    document.getElementById('join-error').style.display = 'none';
    
    try {
      const result = await joinGame(roomCode, playerName);
      
      this.currentGameId = result.gameId;
      this.currentPlayerId = result.playerId;
      this.currentRoomCode = roomCode;
      this.isHost = false;

      if (result.gameMode && this.gameModeManager?.applyOnlineGameMode) {
        this.gameModeManager.applyOnlineGameMode(result.gameMode);
      }
      
      // Subscribe to real-time updates
  await this.subscribeToGameUpdates();
      
      // Show waiting room
      this.displayRoomCode(roomCode);
      await this.refreshPlayers();
      this.showWaitingRoom();
      
    } catch (error) {
      console.error('Failed to join game:', error);
      const errorDiv = document.getElementById('join-error');
      errorDiv.textContent = error.message;
      errorDiv.style.display = 'block';
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Build the payload that captures the selected dice mode for the online game
   */
  getSelectedGameModePayload() {
    if (!this.gameModeManager?.getMode) {
      return { location: 'online', dice: 'virtual' };
    }

    const mode = this.gameModeManager.getMode();
    return {
      location: 'online',
      dice: mode?.dice ?? 'virtual'
    };
  }

  async subscribeToGameUpdates() {
    if (this.unsubscribe) {
      try {
        await this.unsubscribe();
      } catch (error) {
        console.warn('Failed to unsubscribe existing lobby channel before resubscribing:', error);
      }
    }

    this.unsubscribe = subscribeToGame(this.currentGameId, {
      playerId: this.currentPlayerId,
      onGameUpdate: (payload) => this.handleGameUpdate(payload),
      onPlayerUpdate: (payload) => this.handlePlayerUpdate(payload),
      onPresenceSync: (state) => this.handlePresenceSync(state),
      onPresenceJoin: (_payload, state) => this.handlePresenceSync(state),
      onPresenceLeave: (_payload, state) => this.handlePresenceSync(state)
    });

    this.startPresenceMonitor();
    this.startConnectionHeartbeat();
  }
  
  /**
   * Handle game update from real-time
   */
  async handleGameUpdate(payload) {
    //console.log('Game updated:', payload);
    
    if (payload.new && payload.new.status === 'in_progress') {
      // Game has started!
      // Store values before hiding (hide() clears them)
      const gameId = this.currentGameId;
      const playerId = this.currentPlayerId;
      const isHost = this.isHost;
      const roomCode = payload.new?.room_code ?? null;

      this.showLoading();

      const finalizeCleanup = async (reason = 'channel-ready') => {
        if (this.pendingChannelCleanupInFlight) {
          return;
        }
        this.pendingChannelCleanupInFlight = true;

        if (this.pendingChannelReadyTimeout) {
          clearTimeout(this.pendingChannelReadyTimeout);
          this.pendingChannelReadyTimeout = null;
        }

        if (this.pendingChannelReadyListener) {
          window.removeEventListener('onlineGameChannelReady', this.pendingChannelReadyListener);
          this.pendingChannelReadyListener = null;
        }

        try {
          this.isClosing = true;
          await this.hide();
        } catch (error) {
          console.error('Failed to hide lobby after game start:', error);
        } finally {
          this.isClosing = false;
          this.pendingChannelCleanupInFlight = false;
          this.hideLoading();
        }
      };

      const handleChannelReady = async (event) => {
        if (!event || event.detail?.gameId !== gameId) {
          return;
        }
        await finalizeCleanup('channel-ready');
      };

      this.pendingChannelReadyListener = handleChannelReady;
      window.addEventListener('onlineGameChannelReady', handleChannelReady, { once: true });

      this.pendingChannelReadyTimeout = setTimeout(() => {
        finalizeCleanup('timeout').catch(() => {});
      }, 10000);

      // Trigger game start (will be handled by onlineGameManager)
      window.dispatchEvent(new CustomEvent('onlineGameStarted', {
        detail: {
          gameId,
          playerId,
          isHost,
          roomCode
        }
      }));

      return;
    }
  }
  
  /**
   * Handle player update from real-time
   */
  async handlePlayerUpdate(payload) {
    //console.log('Player updated:', payload);

    const eventType = payload?.eventType || payload?.type || payload?.action || null;

    if (eventType === 'DELETE') {
      await this.removePlayerFromLobby(payload?.old);
      return;
    }

    if (eventType === 'INSERT') {
      this.upsertPlayerSnapshot(payload?.new);
      await this.refreshPlayers({ force: true });
      return;
    }

    if (eventType === 'UPDATE') {
      const updatedPlayer = payload?.new;
      const previousPlayer = payload?.old;
      const index = (this.latestPlayers || []).findIndex(player => player?.id === updatedPlayer?.id);
      const existingPlayer = index >= 0 ? this.latestPlayers[index] : null;

      if (!this.isPlayerActive(updatedPlayer)) {
        await this.removePlayerFromLobby(updatedPlayer);
        await this.refreshPlayers({ force: true });
        return;
      }

      if (!this.didPlayerChangeMeaningfully(previousPlayer ?? existingPlayer, updatedPlayer)) {
        return;
      }

      this.upsertPlayerSnapshot(updatedPlayer);
      await this.refreshPlayers({ force: true });
      return;
    }

    await this.refreshPlayers();
  }

  handlePresenceSync(presenceState) {
    if (!this.currentGameId) {
      return;
    }

    const connectedIds = this.extractConnectedIdsFromPresence(presenceState);
    this.queuePresenceStatusUpdate(connectedIds);
  }

  extractConnectedIdsFromPresence(presenceState) {
    const connected = new Set();
    if (!presenceState || typeof presenceState !== 'object') {
      return connected;
    }

    for (const [key, presences] of Object.entries(presenceState)) {
      if (key) {
        connected.add(key);
      }
      if (Array.isArray(presences)) {
        presences.forEach(entry => {
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
    Promise.resolve()
      .then(async () => {
        while (this.pendingPresenceIds) {
          const idsToProcess = this.pendingPresenceIds;
          this.pendingPresenceIds = null;
          try {
            await this.applyPresenceStatuses(idsToProcess);
          } catch (error) {
            console.error('Failed to apply presence statuses in lobby:', error);
          }
        }
      })
      .finally(() => {
        this.presenceUpdateInFlight = false;
      });
  }

  async applyPresenceStatuses(connectedIds) {
    if (!this.currentGameId) {
      return;
    }

    const activeIds = connectedIds instanceof Set
      ? connectedIds
      : new Set(Array.isArray(connectedIds) ? connectedIds : []);

    if (!Array.isArray(this.latestPlayers) || this.latestPlayers.length === 0) {
      await this.refreshPlayers({ force: true });
    }

    const updates = [];
    let statusesChanged = false;
    const now = Date.now();

    (this.latestPlayers || []).forEach(player => {
      if (!player || !player.id) {
        return;
      }

      const cachedStatus = this.presenceStatusCache.get(player.id) ?? player.connection_status ?? 'connected';
      let desiredStatus = cachedStatus;
      const lastSeenAt = typeof player.last_seen_at === 'string'
        ? Date.parse(player.last_seen_at)
        : null;

      if (activeIds.has(player.id)) {
        desiredStatus = 'connected';
      } else if (Number.isFinite(lastSeenAt)) {
        desiredStatus = (now - lastSeenAt) > this.connectionStaleThresholdMs ? 'disconnected' : 'connected';
      } else {
        desiredStatus = cachedStatus;
      }

      if (cachedStatus !== desiredStatus) {
        this.presenceStatusCache.set(player.id, desiredStatus);
        player.connection_status = desiredStatus;
        player.last_seen_at = new Date().toISOString();
        statusesChanged = true;
        updates.push(updatePlayerConnectionStatus(this.currentGameId, player.id, desiredStatus));
      }
    });

    if (updates.length === 0) {
      if (statusesChanged) {
        this.displayPlayers(this.latestPlayers);
      }
      return;
    }

    try {
      await Promise.all(updates);
      if (statusesChanged) {
        this.displayPlayers(this.latestPlayers);
      }
    } catch (error) {
      console.error('Failed to sync player connection statuses:', error);
    }
  }
  
  /**
   * Refresh the players list
   */
  async refreshPlayers(options = {}) {
    const { force = false } = options;

    if (!this.currentGameId) {
      return [];
    }

    const now = Date.now();

    if (this.refreshPlayersPromise) {
      return this.refreshPlayersPromise;
    }

    if (
      !force &&
      this.lastPlayersFetchAt > 0 &&
      now - this.lastPlayersFetchAt < this.minimumPlayerRefreshIntervalMs &&
      Array.isArray(this.latestPlayers) &&
      this.latestPlayers.length > 0
    ) {
      return this.latestPlayers;
    }

    const fetchPromise = (async () => {
      try {
        const game = await getGame(this.currentGameId);
        this.lastPlayersFetchAt = Date.now();
        const activePlayers = this.filterActivePlayers(game.players);
        this.displayPlayers(activePlayers);
        return activePlayers;
      } catch (error) {
        console.error('Failed to refresh players:', error);
        return this.latestPlayers;
      } finally {
        this.refreshPlayersPromise = null;
      }
    })();

    this.refreshPlayersPromise = fetchPromise;
    return fetchPromise;
  }
  
  /**
   * Display room code
   */
  displayRoomCode(roomCode) {
    document.getElementById('display-room-code').textContent = roomCode;
  }
  
  /**
   * Display players in waiting room
   */
  displayPlayers(players) {
    const container = document.getElementById('players-container');
    const countSpan = document.getElementById('player-count');
    
    const activePlayers = this.filterActivePlayers(players);
    this.latestPlayers = activePlayers;

    const knownIds = new Set(activePlayers.map(player => player?.id).filter(Boolean));
    for (const existingId of Array.from(this.presenceStatusCache.keys())) {
      if (!knownIds.has(existingId)) {
        this.presenceStatusCache.delete(existingId);
      }
    }

    activePlayers.forEach(player => {
      if (player && player.id) {
        const status = player.connection_status || 'connected';
        this.presenceStatusCache.set(player.id, status);
      }
    });

    countSpan.textContent = activePlayers.length;
    
    container.innerHTML = activePlayers.map(player => `
      <div class="player-item ${player.is_host ? 'player-host' : ''}">
        <span class="player-name">${player.player_name}</span>
        ${player.is_host ? '<span class="player-badge">Host</span>' : ''}
        <span class="player-status ${player.connection_status === 'connected' ? 'status-connected' : 'status-disconnected'}">
          ${player.connection_status === 'connected' ? '🟢' : '🔴'}
        </span>
      </div>
    `).join('');
    
    // Update waiting message
    const waitingMsg = document.getElementById('waiting-message');
    if (activePlayers.length < 2) {
      waitingMsg.textContent = 'Waiting for another player to join...';
      waitingMsg.style.display = 'block';
    } else {
      waitingMsg.textContent = 'Ready to start!';
      waitingMsg.style.display = this.isHost ? 'block' : 'none';
    }
  }
  
  /**
   * Copy room code to clipboard
   */
  async copyRoomCode() {
    try {
      await navigator.clipboard.writeText(this.currentRoomCode);
      const btn = document.getElementById('btn-copy-code');
      const originalText = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('Room code: ' + this.currentRoomCode);
    }
  }
  
  /**
   * Handle start game button click
   */
  async handleStartGame() {
    if (!this.isHost) return;
    
    //console.log('🎮 handleStartGame called');
    //console.log('  currentGameId:', this.currentGameId, 'type:', typeof this.currentGameId);
    //console.log('  currentPlayerId:', this.currentPlayerId, 'type:', typeof this.currentPlayerId);
    
    this.showLoading();
    
    try {
      await startGame(this.currentGameId, this.currentPlayerId);
      // Game update will trigger via real-time subscription
    } catch (error) {
      console.error('Failed to start game:', error);
      alert('Failed to start game: ' + error.message);
      this.hideLoading();
    }
  }
  
  /**
   * Handle leave game
   */
  async handleLeaveGame({ skipConfirm = false } = {}) {
    if (this.isClosing) {
      return;
    }

    const hasJoinedGame = this.currentGameId && this.currentPlayerId;

    if (hasJoinedGame && !skipConfirm) {
      const confirmed = confirm('Are you sure you want to leave the game?');
      if (!confirmed) {
        return;
      }
    }

    this.isClosing = true;

    if (!hasJoinedGame) {
      await this.hide();
      this.isClosing = false;
      return;
    }

    try {
      this.showLoading();
      await leaveGame(this.currentGameId, this.currentPlayerId);
    } catch (error) {
      console.error('Failed to leave game:', error);
      alert('Failed to leave game. Please try again.');
      this.hideLoading();
      this.isClosing = false;
      return;
    }

    this.hideLoading();
    await this.hide();
    this.isClosing = false;
  }
  
  /**
   * Cleanup when closing dialog
   */
  cleanup() {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }

    this.cleanupPromise = (async () => {
      try {
        if (this.pendingChannelReadyTimeout) {
          clearTimeout(this.pendingChannelReadyTimeout);
          this.pendingChannelReadyTimeout = null;
        }

        if (this.pendingChannelReadyListener) {
          window.removeEventListener('onlineGameChannelReady', this.pendingChannelReadyListener);
          this.pendingChannelReadyListener = null;
        }

        this.pendingChannelCleanupInFlight = false;

        if (this.unsubscribe) {
          try {
            await this.unsubscribe();
          } catch (error) {
            console.warn('Failed to unsubscribe lobby channel during cleanup:', error);
          }
          this.unsubscribe = null;
        }

        this.stopPresenceMonitor();
        this.stopConnectionHeartbeat();

        this.currentGameId = null;
        this.currentPlayerId = null;
        this.currentRoomCode = null;
        this.isHost = false;
        this.isClosing = false;
        this.presenceStatusCache.clear();
        this.latestPlayers = [];
        this.presenceUpdateInFlight = false;
        this.pendingPresenceIds = null;
        this.refreshPlayersPromise = null;
        this.lastPlayersFetchAt = 0;

        // Reset forms safely if elements exist
        document.getElementById('form-create-game')?.reset();
        document.getElementById('form-join-game')?.reset();

        this.hideLoading();
      } finally {
        this.cleanupPromise = null;
      }
    })();

    return this.cleanupPromise;
  }

  isPlayerActive(player) {
    if (!player || typeof player !== 'object') {
      return false;
    }

    if (player.deleted_at || player.deletedAt || player.removed_at || player.removedAt || player.left_at || player.leftAt) {
      return false;
    }

    if (player.has_left === true) {
      return false;
    }

    if (player.is_active === false) {
      return false;
    }

    const state = player.status || player.state || null;
    if (state === 'left') {
      return false;
    }

    if (player.connection_status === 'left') {
      return false;
    }

    return true;
  }

  filterActivePlayers(players) {
    if (!Array.isArray(players)) {
      return [];
    }

    const filtered = players.filter(player => this.isPlayerActive(player));
    return filtered;
  }

  upsertPlayerSnapshot(player) {
    if (!player || !player.id) {
      return;
    }

    if (!this.isPlayerActive(player)) {
      void this.removePlayerFromLobby(player);
      return;
    }

    if (!Array.isArray(this.latestPlayers)) {
      this.latestPlayers = [];
    }

    const nextPlayers = [...this.latestPlayers];
    const existingIndex = nextPlayers.findIndex(existing => existing?.id === player.id);

    if (existingIndex >= 0) {
      nextPlayers[existingIndex] = {
        ...nextPlayers[existingIndex],
        ...player
      };
    } else {
      nextPlayers.push(player);
    }

    this.latestPlayers = this.filterActivePlayers(nextPlayers);
    this.displayPlayers(this.latestPlayers);
  }

  async removePlayerFromLobby(playerLike) {
    const removedId = typeof playerLike === 'string' ? playerLike : playerLike?.id;
    if (!removedId) {
      return;
    }

    this.latestPlayers = (this.latestPlayers || []).filter(player => player?.id !== removedId);
    this.presenceStatusCache.delete(removedId);

    if (this.pendingPresenceIds && typeof this.pendingPresenceIds.delete === 'function') {
      this.pendingPresenceIds.delete(removedId);
    }

    this.displayPlayers(this.latestPlayers);

    if (removedId === this.currentPlayerId) {
      await this.hide();
    }
  }

  didPlayerChangeMeaningfully(previousPlayer, updatedPlayer) {
    if (!updatedPlayer) {
      return false;
    }

    if (!previousPlayer) {
      return true;
    }

    const trackedFields = [
      'connection_status',
      'player_name',
      'player_order',
      'is_host'
    ];

    return trackedFields.some((field) => previousPlayer[field] !== updatedPlayer[field]);
  }

  startConnectionHeartbeat() {
    this.stopConnectionHeartbeat();

    if (!this.currentGameId || !this.currentPlayerId) {
      return;
    }

    const tick = () => {
      if (!this.currentGameId || !this.currentPlayerId) {
        return;
      }

      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      const status = isOnline ? 'connected' : 'disconnected';
      updatePlayerConnectionStatusKeepalive(this.currentGameId, this.currentPlayerId, status);
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
      if (!this.currentGameId) {
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
    (this.latestPlayers || []).forEach(player => {
      if (!player || !player.id) {
        return;
      }

      const status = this.presenceStatusCache.get(player.id) ?? player.connection_status ?? 'connected';
      if (status === 'connected') {
        const lastSeenAt = typeof player.last_seen_at === 'string'
          ? Date.parse(player.last_seen_at)
          : null;

        if (!Number.isFinite(lastSeenAt) || (now - lastSeenAt) <= this.connectionStaleThresholdMs) {
          ids.add(player.id);
        }
      }
    });

    return ids;
  }
}

export default OnlineLobbyUI;
