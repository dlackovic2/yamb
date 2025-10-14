/**
 * Online Game Service
 *
 * Handles all game-related operations for online multiplayer:
 * - Creating new games
 * - Joining existing games
 * - Starting games
 * - Managing game state
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

/**
 * Generate a unique 6-character room code
 * @returns {Promise<string>} Room code
 */
async function generateUniqueRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    // Generate random 6-character code
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Check if code already exists
    const { data, error } = await supabase
      .from("games")
      .select("id")
      .eq("room_code", code)
      .single();

    if (error && error.code === "PGRST116") {
      // Code doesn't exist, we can use it
      return code;
    }

    attempts++;
  }

  throw new Error("Failed to generate unique room code");
}

/**
 * Create a new online game
 * @param {string} hostName - Host player's name
 * @param {object} gameMode - Game mode settings
 * @returns {Promise<{gameId: string, roomCode: string, hostPlayerId: string}>}
 */
export async function createGame(hostName, gameMode = {}) {
  try {
    //console.log('Creating game...', { hostName, gameMode });

    // Generate unique room code
    const roomCode = await generateUniqueRoomCode();
    //console.log('Generated room code:', roomCode);

    // Default game mode for online
    const defaultGameMode = {
      location: "online",
      dice: "virtual",
      columns: "announce",
      ...gameMode,
    };

    // STEP 1: Create game with NULL host_player_id initially
    // Note: host_player_id column must be nullable in Supabase
    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .insert({
        room_code: roomCode,
        host_player_id: null, // Will be set after creating player
        status: "waiting",
        game_mode: defaultGameMode,
        max_players: 2,
      })
      .select()
      .single();

    if (gameError) {
      console.error("Error creating game:", gameError);

      // Check if it's a NOT NULL constraint error
      if (gameError.code === "23502" && gameError.message.includes("host_player_id")) {
        throw new Error(
          "Database setup error: Please make host_player_id nullable in Supabase. See SUPABASE_FIX.md for instructions."
        );
      }

      throw new Error(`Failed to create game: ${gameError.message}`);
    }

    //console.log('Game created:', gameData);

    // STEP 2: Create host player
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .insert({
        game_id: gameData.id,
        player_name: hostName,
        player_order: 1,
        is_host: true,
        connection_status: "connected",
      })
      .select()
      .single();

    if (playerError) {
      console.error("Error creating host player:", playerError);
      // Rollback: delete the game
      await supabase.from("games").delete().eq("id", gameData.id);
      throw new Error(`Failed to create host player: ${playerError.message}`);
    }

    //console.log('Host player created:', playerData);

    // STEP 3: Update game with actual host player ID
    const { error: updateError } = await supabase
      .from("games")
      .update({ host_player_id: playerData.id })
      .eq("id", gameData.id);

    if (updateError) {
      console.error("Error updating game with host:", updateError);
      // This is not critical, continue anyway
    }

    // STEP 4: Create initial game state for host
    const { error: stateError } = await supabase.from("game_state").insert({
      game_id: gameData.id,
      player_id: playerData.id,
      scorecard: {},
      dice_values: [1, 2, 3, 4, 5],
      dice_locked: [false, false, false, false, false],
      rolls_remaining: 3,
    });

    if (stateError) {
      console.error("Error creating game state:", stateError);
    }

    //console.log('✅ Game created successfully!');

    return {
      gameId: gameData.id,
      roomCode: roomCode,
      hostPlayerId: playerData.id,
      playerOrder: 1,
    };
  } catch (error) {
    console.error("Create game error:", error);
    throw error;
  }
}

/**
 * Join an existing game
 * @param {string} roomCode - 6-character room code
 * @param {string} playerName - Player's name
 * @returns {Promise<{gameId: string, playerId: string, playerOrder: number}>}
 */
export async function joinGame(roomCode, playerName) {
  try {
    //console.log('Joining game...', { roomCode, playerName });

    // Find game by room code
    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .select("*")
      .eq("room_code", roomCode.toUpperCase())
      .single();

    if (gameError || !gameData) {
      console.error("Game not found:", gameError);
      throw new Error("Invalid room code. Game not found.");
    }

    //console.log('Game found:', gameData);

    // Check if game is in waiting status
    if (gameData.status !== "waiting") {
      throw new Error("Game has already started or is completed.");
    }

    // Check how many players are already in the game
    const { data: existingPlayers, error: playersError } = await supabase
      .from("players")
      .select("player_order")
      .eq("game_id", gameData.id)
      .order("player_order", { ascending: true });

    if (playersError) {
      console.error("Error fetching players:", playersError);
      throw new Error("Failed to check game capacity.");
    }

    //console.log('Existing players:', existingPlayers);

    // Check if game is full
    if (existingPlayers.length >= gameData.max_players) {
      throw new Error("Game is full.");
    }

    // Determine player order (next available)
    const playerOrder = existingPlayers.length + 1;

    // Create player
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .insert({
        game_id: gameData.id,
        player_name: playerName,
        player_order: playerOrder,
        is_host: false,
        connection_status: "connected",
      })
      .select()
      .single();

    if (playerError) {
      console.error("Error creating player:", playerError);
      throw new Error(`Failed to join game: ${playerError.message}`);
    }

    //console.log('Player created:', playerData);

    // Create initial game state for player
    const { error: stateError } = await supabase.from("game_state").insert({
      game_id: gameData.id,
      player_id: playerData.id,
      scorecard: {},
      dice_values: [1, 2, 3, 4, 5],
      dice_locked: [false, false, false, false, false],
      rolls_remaining: 3,
    });

    if (stateError) {
      console.error("Error creating game state:", stateError);
    }

    //console.log('✅ Joined game successfully!');

    return {
      gameId: gameData.id,
      playerId: playerData.id,
      playerOrder: playerOrder,
      gameMode: gameData.game_mode,
    };
  } catch (error) {
    console.error("Join game error:", error);
    throw error;
  }
}

/**
 * Start a game (host only)
 * @param {string} gameId - Game ID
 * @param {string} hostPlayerId - Host player ID
 * @returns {Promise<void>}
 */
export async function startGame(gameId, hostPlayerId) {
  try {
    //console.log('Starting game...', { gameId, hostPlayerId });
    //console.log('GameId type:', typeof gameId, 'value:', gameId);
    //console.log('HostPlayerId type:', typeof hostPlayerId, 'value:', hostPlayerId);

    // Verify the caller is the host by checking the players table
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select("is_host")
      .eq("id", hostPlayerId)
      .eq("game_id", gameId)
      .single();

    //console.log('Player query result:', { playerData, playerError });

    if (playerError || !playerData) {
      console.error("Player not found:", playerError);
      throw new Error("Player not found in this game.");
    }

    if (!playerData.is_host) {
      throw new Error("Only the host can start the game.");
    }

    // Check game status
    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .select("status")
      .eq("id", gameId)
      .single();

    //console.log('Game query result:', { gameData, gameError });

    if (gameError || !gameData) {
      console.error("Game not found:", gameError);
      throw new Error("Game not found.");
    }

    if (gameData.status !== "waiting") {
      throw new Error("Game has already started.");
    }

    // Get all players to set the first player's turn
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, player_order")
      .eq("game_id", gameId)
      .order("player_order", { ascending: true });

    //console.log('Players query result:', { players, playersError });

    if (playersError || !players || players.length < 2) {
      throw new Error("Need at least 2 players to start the game.");
    }

    //console.log('About to update game with first player ID:', players[0].id);

    // Update game status to in_progress and set first player's turn
    const { error: updateError } = await supabase
      .from("games")
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
        current_turn_player_id: players[0].id, // First player goes first
      })
      .eq("id", gameId);

    //console.log('Update result:', { updateError });

    if (updateError) {
      console.error("Error starting game:", updateError);
      throw new Error("Failed to start game.");
    }

    // Log game action
    await supabase.from("game_actions").insert({
      game_id: gameId,
      player_id: hostPlayerId,
      action_type: "game_started",
      action_data: { first_player_id: players[0].id },
    });

    //console.log('✅ Game started successfully!');
  } catch (error) {
    console.error("Start game error:", error);
    throw error;
  }
}

/**
 * Get game details
 * @param {string} gameId - Game ID
 * @returns {Promise<object>} Game data with players
 */
export async function getGame(gameId) {
  try {
    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .select(
        `
        *,
        players:players(*)
      `
      )
      .eq("id", gameId)
      .order("player_order", { ascending: true, foreignTable: "players" })
      .single();

    if (gameError) {
      throw new Error("Game not found.");
    }

    const normalizedPlayers = Array.isArray(gameData?.players)
      ? gameData.players.filter(Boolean)
      : [];

    return {
      ...gameData,
      players: normalizedPlayers,
    };
  } catch (error) {
    console.error("Get game error:", error);
    throw error;
  }
}

/**
 * Leave a game
 * @param {string} gameId - Game ID
 * @param {string} playerId - Player ID
 * @returns {Promise<void>}
 */
export async function leaveGame(gameId, playerId) {
  try {
    //console.log('Leaving game...', { gameId, playerId });

    const { data: existingPlayers, error: fetchError } = await supabase
      .from("players")
      .select("id, player_name")
      .eq("id", playerId)
      .eq("game_id", gameId);

    if (fetchError) {
      throw new Error("Failed to verify player while leaving the game.");
    }

    if (!existingPlayers || existingPlayers.length === 0) {
      console.warn("No player record found while leaving; assuming already removed.", {
        gameId,
        playerId,
      });
      return;
    }

    const playerMeta = existingPlayers[0] ?? null;

    // Delete player (will cascade delete game_state) via RPC to bypass RLS
    const { error } = await supabase.rpc("leave_game_player", {
      p_game: gameId,
      p_player: playerId,
    });

    if (error) {
      console.error("leave_game_player RPC error:", error);
      throw new Error("Failed to leave game.");
    }

    const { error: deleteFallbackError } = await supabase
      .from("players")
      .delete()
      .eq("id", playerId)
      .eq("game_id", gameId);

    if (deleteFallbackError && deleteFallbackError.code !== "PGRST116") {
      console.warn("Player delete fallback failed (ignored).", {
        gameId,
        playerId,
        deleteFallbackError,
      });
    }

    const baseAction = {
      game_id: gameId,
      player_id: playerId,
      action_type: "player_left",
      action_data: {
        player_id: playerId,
        player_name: playerMeta?.player_name ?? null,
      },
    };

    const { error: actionError } = await supabase.from("game_actions").insert(baseAction);

    if (actionError) {
      if (actionError.code === "23503") {
        console.warn("Logging leave action without player_id due to missing player record.", {
          gameId,
          playerId,
          actionError,
        });

        const { error: fallbackError } = await supabase.from("game_actions").insert({
          ...baseAction,
          player_id: null,
        });

        if (fallbackError) {
          console.error("Failed to log player leave action (fallback).", fallbackError);
        }
      } else if (actionError.code === "PGRST116" || actionError.code === "409") {
        console.warn("Duplicate leave action detected; ignoring conflict.", {
          gameId,
          playerId,
          actionError,
        });
      } else {
        console.error("Failed to log player leave action.", actionError);
      }
    }

    //console.log('✅ Left game successfully!');
  } catch (error) {
    console.error("Leave game error:", error);
    throw error;
  }
}

/**
 * Update a player's connection status
 * @param {string} gameId
 * @param {string} playerId
 * @param {'connected'|'disconnected'} status
 */
export async function updatePlayerConnectionStatus(gameId, playerId, status) {
  try {
    const normalizedStatus = status === "disconnected" ? "disconnected" : "connected";
    const { error } = await supabase
      .from("players")
      .update({
        connection_status: normalizedStatus,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", playerId)
      .eq("game_id", gameId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("Failed to update player connection status:", {
      gameId,
      playerId,
      status,
      error,
    });
    throw new Error("Failed to update player connection status.");
  }
}

export function updatePlayerConnectionStatusKeepalive(gameId, playerId, status) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !gameId || !playerId) {
      return;
    }

    const normalizedStatus = status === "disconnected" ? "disconnected" : "connected";
    const url = `${SUPABASE_URL}/rest/v1/players?id=eq.${encodeURIComponent(playerId)}&game_id=eq.${encodeURIComponent(gameId)}`;
    const payload = JSON.stringify({
      connection_status: normalizedStatus,
      last_seen_at: new Date().toISOString(),
    });

    fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: payload,
      keepalive: true,
    }).catch((error) => {
      console.warn("Keepalive connection status update failed (ignored).", error);
    });
  } catch (error) {
    console.warn("Failed to queue keepalive connection status update.", error);
  }
}

export default {
  createGame,
  joinGame,
  startGame,
  getGame,
  leaveGame,
  updatePlayerConnectionStatus,
  updatePlayerConnectionStatusKeepalive,
};
