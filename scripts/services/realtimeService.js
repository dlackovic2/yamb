/**
 * Real-time Service
 *
 * Handles real-time subscriptions for live game updates using Supabase Realtime
 */

import { supabase } from "./supabaseClient.js";

// Store active subscriptions
const activeSubscriptions = new Map();

function createSubscriptionId(gameId) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${gameId}:${Date.now()}:${random}`;
}

/**
 * Subscribe to real-time updates for a specific game
 * @param {string} gameId - Game ID to subscribe to
 * @param {object} callbacks - Callback functions for different events
 * @param {function} callbacks.onGameUpdate - Called when game data changes
 * @param {function} callbacks.onPlayerUpdate - Called when players change
 * @param {function} callbacks.onStateUpdate - Called when game state changes
 * @param {function} callbacks.onActionUpdate - Called when new actions occur
 * @returns {function} Unsubscribe function
 */
export function subscribeToGame(gameId, callbacks = {}) {
  /*
  console.log('🔔 Subscribing to game:', gameId, {
    timestamp: new Date().toISOString(),
    existingChannels: typeof supabase.getChannels === 'function' ? supabase.getChannels().length : undefined
  });
  */

  const {
    playerId = null,
    onGameUpdate = () => {},
    onPlayerUpdate = () => {},
    onStateUpdate = () => {},
    onActionUpdate = () => {},
    onPresenceSync = () => {},
    onPresenceJoin = () => {},
    onPresenceLeave = () => {},
    onStatusChange = () => {},
  } = callbacks;

  // Create a channel for this game
  const subscriptionId = createSubscriptionId(gameId);
  const channelTopic = `game:${subscriptionId.replace(/:/g, "-")}`;

  const channel = playerId
    ? supabase.channel(channelTopic, {
        config: {
          presence: { key: playerId },
        },
      })
    : supabase.channel(channelTopic);

  if (playerId) {
    channel.on("presence", { event: "sync" }, () => {
      try {
        const presenceState = channel.presenceState();
        onPresenceSync(presenceState);
      } catch (error) {
        console.error("Failed to process presence sync:", error);
      }
    });

    channel.on("presence", { event: "join" }, (payload) => {
      try {
        onPresenceJoin(payload, channel.presenceState());
      } catch (error) {
        console.error("Failed to process presence join:", error);
      }
    });

    channel.on("presence", { event: "leave" }, (payload) => {
      try {
        onPresenceLeave(payload, channel.presenceState());
      } catch (error) {
        console.error("Failed to process presence leave:", error);
      }
    });
  }

  // Subscribe to games table changes
  channel.on(
    "postgres_changes",
    {
      event: "*", // Listen to all events (INSERT, UPDATE, DELETE)
      schema: "public",
      table: "games",
      filter: `id=eq.${gameId}`,
    },
    (payload) => {
      //console.log('📊 Game update:', payload);
      onGameUpdate(payload);
    }
  );

  // Subscribe to players table changes
  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "players",
      filter: `game_id=eq.${gameId}`,
    },
    (payload) => {
      //console.log('👥 Player update:', payload);
      onPlayerUpdate(payload);
    }
  );

  // Subscribe to game_state table changes
  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "game_state",
      filter: `game_id=eq.${gameId}`,
    },
    (payload) => {
      //console.log('🎲 State update:', payload);
      onStateUpdate(payload);
    }
  );

  // Subscribe to game_actions table changes
  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "game_actions",
      filter: `game_id=eq.${gameId}`,
    },
    (payload) => {
      //console.log('🎬 Action update:', payload);
      onActionUpdate(payload);
    }
  );

  // Subscribe to the channel
  channel.subscribe((status, err) => {
    const channelState = channel?.state ?? "unknown";
    const socketState =
      typeof channel?.socket?.connectionState === "function"
        ? channel.socket.connectionState()
        : (channel?.socket?.state ?? null);

    /*
    console.log(`📡 Subscription status: ${status}`, {
      gameId,
      playerId,
      channelState,
      socketState,
      timestamp: new Date().toISOString(),
      error: err ?? null,
      subscriptionId,
      channelTopic
    });
    */

    if (typeof onStatusChange === "function") {
      try {
        onStatusChange(status, {
          error: err ?? null,
          subscriptionId,
          channelTopic,
          socketState,
          channelState,
        });
      } catch (error) {
        console.error("Realtime status handler failed:", error);
      }
    }

    if (status === "SUBSCRIBED") {
      //console.log('✅ Successfully subscribed to game updates');
      if (playerId) {
        channel
          .track({
            playerId,
            connectedAt: new Date().toISOString(),
          })
          .catch((error) => {
            console.error("Failed to track presence:", error);
          });
      }
    }
  });

  // Store the subscription
  activeSubscriptions.set(subscriptionId, { channel, gameId, channelTopic });

  // Return unsubscribe function
  const unsubscribe = async () => {
    /*console.log('🔕 Unsubscribing from game:', gameId, {
      timestamp: new Date().toISOString(),
      subscriptionId,
      channelTopic
    });
    */
    try {
      if (typeof channel.untrack === "function") {
        await channel.untrack();
      }
    } catch (error) {
      console.warn("Failed to untrack presence during unsubscribe:", error);
    }
    await supabase.removeChannel(channel);
    activeSubscriptions.delete(subscriptionId);
  };

  unsubscribe.subscriptionId = subscriptionId;
  unsubscribe.channelTopic = channelTopic;
  unsubscribe.channel = channel;

  return unsubscribe;
}

/**
 * Unsubscribe from a specific game
 * @param {string} gameId - Game ID to unsubscribe from
 */
export async function unsubscribeFromGame(gameId) {
  for (const [subscriptionId, entry] of activeSubscriptions.entries()) {
    if (entry.gameId !== gameId) {
      continue;
    }

    const { channel, channelTopic } = entry;
    /*console.log('🔕 Unsubscribing from game:', gameId, {
      timestamp: new Date().toISOString(),
      subscriptionId,
      channelTopic
    });
    */
    try {
      if (typeof channel.untrack === "function") {
        await channel.untrack();
      }
    } catch (error) {
      console.warn("Failed to untrack presence during explicit unsubscribe:", error);
    }
    await supabase.removeChannel(channel);
    activeSubscriptions.delete(subscriptionId);
  }
}

/**
 * Unsubscribe from all active subscriptions
 */
export async function unsubscribeAll() {
  //console.log('🔕 Unsubscribing from all games');
  for (const [subscriptionId, entry] of activeSubscriptions.entries()) {
    const { gameId, channel, channelTopic } = entry;
    try {
      if (typeof channel.untrack === "function") {
        await channel.untrack();
      }
    } catch (error) {
      console.warn(`Failed to untrack presence for game ${gameId}:`, error);
    }
    await supabase.removeChannel(channel);
  }
  activeSubscriptions.clear();
}

/**
 * Get the number of active subscriptions
 * @returns {number}
 */
export function getActiveSubscriptionsCount() {
  return activeSubscriptions.size;
}

/**
 * Check if subscribed to a specific game
 * @param {string} gameId - Game ID
 * @returns {boolean}
 */
export function isSubscribed(gameId) {
  for (const entry of activeSubscriptions.values()) {
    if (entry.gameId === gameId) {
      return true;
    }
  }
  return false;
}

export default {
  subscribeToGame,
  unsubscribeFromGame,
  unsubscribeAll,
  getActiveSubscriptionsCount,
  isSubscribed,
};
