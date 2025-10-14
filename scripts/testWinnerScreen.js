/**
 * Test helper for winner screen
 * 
 * Usage in browser console:
 * 1. Include this script in index.html temporarily, OR
 * 2. Copy-paste this entire file into the browser console
 * 3. Call testWinnerScreen() with optional mock data
 */

import { OnlineGameManager } from './onlineGameManager.js';

/**
 * Test the winner screen with mock data
 */
window.testWinnerScreen = function(mockData) {
  // Create a minimal mock game mode manager
  const mockGameModeManager = {
    virtualDiceUI: null,
    currentMode: { location: 'online', diceType: 'virtual' }
  };
  
  // Create a temporary OnlineGameManager instance
  const tempManager = new OnlineGameManager(mockGameModeManager);
  
  // Set minimal required state
  tempManager.playerId = mockData?.viewerId || 'playerA';
  tempManager.gameId = 'test-game';
  tempManager.players = mockData?.standings?.map(s => ({
    id: s.id,
    player_name: s.name
  })) || [];
  
  // Use provided data or defaults
  const testData = mockData || {
    winnerId: 'playerA',
    standings: [
      {
        id: 'playerA',
        name: 'Player A',
        total: 325,
        columns: {
          down: { total: 110, upperSubtotal: 45, bonus: 30, upperTotal: 75, diff: 20, lowerSubtotal: 15 },
          up: { total: 95, upperSubtotal: 40, bonus: 0, upperTotal: 40, diff: 30, lowerSubtotal: 25 },
          free: { total: 60, upperSubtotal: 30, bonus: 0, upperTotal: 30, diff: 10, lowerSubtotal: 20 },
          announce: { total: 60, upperSubtotal: 35, bonus: 0, upperTotal: 35, diff: 5, lowerSubtotal: 20 }
        },
        filledCells: 52
      },
      {
        id: 'playerB',
        name: 'Player B',
        total: 301,
        columns: {
          down: { total: 100, upperSubtotal: 42, bonus: 0, upperTotal: 42, diff: 18, lowerSubtotal: 40 },
          up: { total: 88, upperSubtotal: 38, bonus: 0, upperTotal: 38, diff: 25, lowerSubtotal: 25 },
          free: { total: 63, upperSubtotal: 33, bonus: 0, upperTotal: 33, diff: 12, lowerSubtotal: 18 },
          announce: { total: 50, upperSubtotal: 30, bonus: 0, upperTotal: 30, diff: 5, lowerSubtotal: 15 }
        },
        filledCells: 52
      }
    ]
  };
  
  console.log('🎮 Testing winner screen with data:', testData);
  
  // Show the winner screen
  tempManager.showWinnerScreen(testData);
  
  console.log('✅ Winner screen should now be visible!');
  console.log('💡 To test as loser, call: testWinnerScreen({ viewerId: "playerB", ...data })');
};

/**
 * Quick test as winner
 */
window.testAsWinner = function() {
  testWinnerScreen({
    viewerId: 'playerA',
    winnerId: 'playerA',
    standings: [
      {
        id: 'playerA',
        name: 'You',
        total: 325,
        columns: {
          down: { total: 110 },
          up: { total: 95 },
          free: { total: 60 },
          announce: { total: 60 }
        }
      },
      {
        id: 'playerB',
        name: 'Opponent',
        total: 301,
        columns: {
          down: { total: 100 },
          up: { total: 88 },
          free: { total: 63 },
          announce: { total: 50 }
        }
      }
    ]
  });
};

/**
 * Quick test as loser
 */
window.testAsLoser = function() {
  testWinnerScreen({
    viewerId: 'playerB',
    winnerId: 'playerA',
    standings: [
      {
        id: 'playerA',
        name: 'Winner Name',
        total: 325,
        columns: {
          down: { total: 110 },
          up: { total: 95 },
          free: { total: 60 },
          announce: { total: 60 }
        }
      },
      {
        id: 'playerB',
        name: 'You',
        total: 301,
        columns: {
          down: { total: 100 },
          up: { total: 88 },
          free: { total: 63 },
          announce: { total: 50 }
        }
      }
    ]
  });
};

/**
 * Test with a tie scenario
 */
window.testTie = function() {
  testWinnerScreen({
    viewerId: 'playerA',
    winnerId: 'playerA',
    standings: [
      {
        id: 'playerA',
        name: 'Player A',
        total: 320,
        columns: {
          down: { total: 110 },
          up: { total: 90 },
          free: { total: 60 },
          announce: { total: 60 }
        }
      },
      {
        id: 'playerB',
        name: 'Player B',
        total: 320,
        columns: {
          down: { total: 105 },
          up: { total: 95 },
          free: { total: 60 },
          announce: { total: 60 }
        }
      }
    ]
  });
};

console.log('🎯 Winner screen test helpers loaded!');
console.log('Available commands:');
console.log('  - testWinnerScreen()     // Test with default data');
console.log('  - testAsWinner()         // See winner view with confetti');
console.log('  - testAsLoser()          // See loser view');
console.log('  - testTie()              // See tied game scenario');
