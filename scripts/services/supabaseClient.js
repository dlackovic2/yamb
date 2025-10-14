/**
 * Supabase Client
 *
 * Initializes and exports a singleton Supabase client instance
 * for database and real-time operations.
 */

import { createClient } from "@supabase/supabase-js";

// Supabase configuration from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase environment variables!");
  console.error("Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local");
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // We're not using auth for MVP
  },
  realtime: {
    params: {
      eventsPerSecond: 10, // Rate limit for real-time events
    },
  },
});

/**
 * Check if Supabase client is properly initialized
 * @returns {boolean} True if client is ready
 */
export function isSupabaseReady() {
  return !!(supabaseUrl && supabaseAnonKey);
}

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
  try {
    const { data, error } = await supabase.from("games").select("count").limit(1);

    if (error) {
      console.error("Supabase connection test failed:", error);
      return false;
    }

    //console.log('✅ Supabase connection successful');
    return true;
  } catch (err) {
    console.error("Supabase connection error:", err);
    return false;
  }
}

/**
 * Get connection status
 * @returns {object} Connection status information
 */
export function getConnectionStatus() {
  return {
    isConfigured: isSupabaseReady(),
    url: supabaseUrl || "Not configured",
    hasKey: !!supabaseAnonKey,
  };
}

export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

// Log initialization status
if (isSupabaseReady()) {
  //console.log('🟢 Supabase client initialized');
  //console.log('📍 URL:', supabaseUrl);
} else {
  console.warn("🔴 Supabase client not properly configured");
  console.warn("ℹ️ Online multiplayer features will be disabled");
}

export default supabase;
