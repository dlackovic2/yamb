/**
 * Game Sync Service
 *
 * Handles synchronization of game state between players:
 * - Dice rolls
 * - Score entries
 * - Turn management
 */

import { supabase } from "./supabaseClient.js";

/**
 * Sync dice roll to database
 * @param {string} gameId - Game ID
 * @param {string} playerId - Player ID
 * @param {number[]} diceValues - Array of 5 dice values
 * @param {boolean[]} diceLocked - Array of 5 lock states
 * @param {number} rollsRemaining - Number of rolls remaining
 * @returns {Promise<void>}
 */
export async function syncDiceRoll(
  gameId,
  playerId,
  diceValues,
  diceLocked,
  rollsRemaining,
  options = {}
) {
  try {
    const normalizedAction = options.action === "lock" ? "lock" : "roll";
    const actionLabel = normalizedAction === "lock" ? "dice lock state" : "dice roll";
    const lastAction = normalizedAction === "lock" ? "lock_dice" : "roll_dice";
    const actionType = normalizedAction === "lock" ? "dice_locked" : "dice_rolled";
    const shouldLogAction = options.logAction ?? normalizedAction !== "lock";
    const timestamp = new Date().toISOString();

    /*
    console.log(
      normalizedAction === 'lock' ? '🔒 Syncing dice lock state...' : '🎲 Syncing dice roll...',
      { gameId, playerId, diceValues, diceLocked, rollsRemaining, action: normalizedAction }
    );
    */

    // Update game state
    const { error: stateError } = await supabase
      .from("game_state")
      .update({
        dice_values: diceValues,
        dice_locked: diceLocked,
        rolls_remaining: rollsRemaining,
        last_action: lastAction,
        last_action_at: timestamp,
      })
      .eq("game_id", gameId)
      .eq("player_id", playerId);

    if (stateError) {
      console.error(`Error syncing ${actionLabel}:`, stateError);
      throw new Error(`Failed to sync ${actionLabel}`);
    }

    if (shouldLogAction) {
      await supabase.from("game_actions").insert({
        game_id: gameId,
        player_id: playerId,
        action_type: actionType,
        action_data: {
          dice_values: diceValues,
          dice_locked: diceLocked,
          rolls_remaining: rollsRemaining,
        },
      });
    }

    //console.log(`✅ ${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)} synced`);
  } catch (error) {
    console.error(`Sync dice error:`, error);
    throw error;
  }
}

/**
 * Sync score entry to database
 * @param {string} gameId - Game ID
 * @param {string} playerId - Player ID
 * @param {object} scorecard - Complete scorecard object
 * @param {string} category - Category that was just filled
 * @param {number} value - Score value entered
 * @returns {Promise<void>}
 */
export async function syncScoreEntry(
  gameId,
  playerId,
  scorecard,
  category,
  column,
  value,
  options = {}
) {
  try {
    const { supportsPendingAnnouncements = true } = options;
    //console.log('📝 Syncing score entry...', { gameId, playerId, column, category, value });

    const updatePayload = {
      scorecard: scorecard,
      last_action: "score_entered",
      last_action_at: new Date().toISOString(),
    };

    if (supportsPendingAnnouncements && column === "announce") {
      updatePayload.pending_announcement = null;
    }

    const isMissingColumnError = (err) =>
      Boolean(
        err?.code === "42703" ||
          (typeof err?.message === "string" && err.message.includes("pending_announcement"))
      );

    const { error: stateError } = await supabase
      .from("game_state")
      .update(updatePayload)
      .eq("game_id", gameId)
      .eq("player_id", playerId);

    if (stateError) {
      if (
        supportsPendingAnnouncements &&
        column === "announce" &&
        isMissingColumnError(stateError)
      ) {
        console.warn(
          "Pending announcement column missing during score sync; falling back to legacy behaviour."
        );
        const { error: fallbackError } = await supabase
          .from("game_state")
          .update({
            scorecard: scorecard,
            last_action: "score_entered",
            last_action_at: new Date().toISOString(),
          })
          .eq("game_id", gameId)
          .eq("player_id", playerId);

        if (fallbackError) {
          console.error("Fallback score sync failed:", fallbackError);
          throw new Error("Failed to sync score entry");
        }
      } else {
        console.error("Error syncing score entry:", stateError);
        throw new Error("Failed to sync score entry");
      }
    }

    // Log action
    await supabase.from("game_actions").insert({
      game_id: gameId,
      player_id: playerId,
      action_type: "score_entered",
      action_data: {
        column: column,
        category: category,
        value: value,
        scorecard: scorecard,
      },
    });

    //console.log('✅ Score entry synced');
  } catch (error) {
    console.error("Sync score entry error:", error);
    throw error;
  }
}

/**
 * End current player's turn and advance to next player
 * @param {string} gameId - Game ID
 * @param {string} currentPlayerId - Current player ID
 * @returns {Promise<string>} Next player ID
 */
export async function syncTurnEnd(gameId, currentPlayerId) {
  try {
    //console.log('🔄 Ending turn...', { gameId, currentPlayerId });

    // Get all players in order
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, player_order")
      .eq("game_id", gameId)
      .order("player_order", { ascending: true });

    if (playersError || !players || players.length === 0) {
      throw new Error("Failed to get players");
    }

    // Find current player index
    const currentIndex = players.findIndex((p) => p.id === currentPlayerId);
    if (currentIndex === -1) {
      throw new Error("Current player not found");
    }

    // Get next player (wrap around to first player)
    const nextIndex = (currentIndex + 1) % players.length;
    const nextPlayerId = players[nextIndex].id;

    //console.log('Next player:', nextPlayerId);

    // Update game with next player's turn
    const { error: gameError } = await supabase
      .from("games")
      .update({
        current_turn_player_id: nextPlayerId,
      })
      .eq("id", gameId);

    if (gameError) {
      console.error("Error updating turn:", gameError);
      throw new Error("Failed to update turn");
    }

    // Reset dice and rolls for next player
    const { error: stateError } = await supabase
      .from("game_state")
      .update({
        dice_values: [1, 2, 3, 4, 5],
        dice_locked: [false, false, false, false, false],
        rolls_remaining: 3,
        last_action: "turn_started",
        last_action_at: new Date().toISOString(),
      })
      .eq("game_id", gameId)
      .eq("player_id", nextPlayerId);

    if (stateError) {
      console.error("Error resetting next player state:", stateError);
    }

    // Log action
    await supabase.from("game_actions").insert({
      game_id: gameId,
      player_id: currentPlayerId,
      action_type: "turn_ended",
      action_data: {
        next_player_id: nextPlayerId,
      },
    });

    //console.log('✅ Turn ended, next player:', nextPlayerId);

    return nextPlayerId;
  } catch (error) {
    console.error("Sync turn end error:", error);
    throw error;
  }
}

/**
 * Mark game as completed
 * @param {string} gameId - Game ID
 * @param {string} winnerId - Winner player ID
 * @returns {Promise<void>}
 */
export async function syncGameComplete(gameId, winnerId) {
  try {
    //console.log('🏁 Completing game...', { gameId, winnerId });

    // Update game status
    const { error: gameError } = await supabase
      .from("games")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        winner_id: winnerId,
      })
      .eq("id", gameId);

    if (gameError) {
      console.error("Error completing game:", gameError);
      throw new Error("Failed to complete game");
    }

    // Log action
    await supabase.from("game_actions").insert({
      game_id: gameId,
      player_id: winnerId,
      action_type: "game_completed",
      action_data: {
        winner_id: winnerId,
      },
    });

    //console.log('✅ Game completed');
  } catch (error) {
    console.error("Sync game complete error:", error);
    throw error;
  }
}

/**
 * Get current game state for a player
 * @param {string} gameId - Game ID
 * @param {string} playerId - Player ID
 * @returns {Promise<object>} Game state
 */
export async function getGameState(gameId, playerId) {
  try {
    const { data, error } = await supabase
      .from("game_state")
      .select("*")
      .eq("game_id", gameId)
      .eq("player_id", playerId)
      .single();

    if (error) {
      throw new Error("Failed to get game state");
    }

    return data;
  } catch (error) {
    console.error("Get game state error:", error);
    throw error;
  }
}

/**
 * Get all players' game states
 * @param {string} gameId - Game ID
 * @returns {Promise<object[]>} Array of game states
 */
export async function getAllGameStates(gameId) {
  try {
    const { data, error } = await supabase
      .from("game_state")
      .select(
        `
        *,
        players (
          id,
          player_name,
          player_order,
          is_host
        )
      `
      )
      .eq("game_id", gameId)
      .order("player_order", { ascending: true, foreignTable: "players" });

    if (error) {
      throw new Error("Failed to get all game states");
    }

    return data;
  } catch (error) {
    console.error("Get all game states error:", error);
    throw error;
  }
}

export default {
  syncDiceRoll,
  syncScoreEntry,
  syncTurnEnd,
  syncGameComplete,
  getGameState,
  getAllGameStates,
};
