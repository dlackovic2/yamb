/**
 * Column rules and validation for Yamb game
 */

import { categories } from './scoring.js';

/**
 * Get the order of categories for each column (matches app.js sequentialOrders)
 */
const categoryOrder = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'max', 'min', 'tris', 'straight', 'full', 'poker', 'yamb'
];

const sequentialOrders = {
  down: categoryOrder,
  up: [...categoryOrder].reverse()
};

/**
 * Check if a category has a value in the column state
 */
function hasCategoryValue(columnState, categoryKey) {
  return columnState && Object.prototype.hasOwnProperty.call(columnState, categoryKey);
}

/**
 * Check if a category can be filled in a specific column
 * This matches the logic in app.js getSequentialFailure
 */
export function canFillCategory(columnKey, categoryKey, currentScores, announcement = null) {
  const columnState = currentScores?.[columnKey] || {};
  
  // Check if already filled
  if (hasCategoryValue(columnState, categoryKey)) {
    return false;
  }
  
  // Free column: any empty category can be filled
  if (columnKey === 'free') {
    return true;
  }
  
  // Announce column: must match announcement, or any if no announcement yet
  if (columnKey === 'announce') {
    // If there's an announcement, must match
    if (announcement) {
      return categoryKey === announcement;
    }
    // No announcement yet - can fill any empty
    return true;
  }
  
  // Down/Up columns: must follow sequential order
  const order = sequentialOrders[columnKey];
  if (!order) {
    return true; // Unknown column, allow it
  }
  
  const index = order.indexOf(categoryKey);
  if (index === -1) {
    return false; // Category not in order
  }
  
  // Find first empty position
  const firstOpenIndex = order.findIndex((key) => !hasCategoryValue(columnState, key));
  
  if (firstOpenIndex === -1) {
    return false; // Column is full
  }
  
  // Can only fill if this is the first empty position
  return firstOpenIndex === index;
}

/**
 * Get all available categories for a column
 */
export function getAvailableCategories(columnKey, currentScores, announcement = null) {
  const inputCategories = categories
    .filter(cat => cat.input)
    .map(cat => cat.key);
  
  return inputCategories.filter(cat => 
    canFillCategory(columnKey, cat, currentScores, announcement)
  );
}

/**
 * Get column icon SVG
 */
export function getColumnIcon(columnKey) {
  const icons = {
    down: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="currentColor"><path d="M297.4 566.6C309.9 579.1 330.2 579.1 342.7 566.6L502.7 406.6C515.2 394.1 515.2 373.8 502.7 361.3C490.2 348.8 469.9 348.8 457.4 361.3L352 466.7L352 96C352 78.3 337.7 64 320 64C302.3 64 288 78.3 288 96L288 466.7L182.6 361.3C170.1 348.8 149.8 348.8 137.3 361.3C124.8 373.8 124.8 394.1 137.3 406.6L297.3 566.6z"/></svg>',
    up: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="currentColor"><path d="M342.6 81.4C330.1 68.9 309.8 68.9 297.3 81.4L137.3 241.4C124.8 253.9 124.8 274.2 137.3 286.7C149.8 299.2 170.1 299.2 182.6 286.7L288 181.3L288 552C288 569.7 302.3 584 320 584C337.7 584 352 569.7 352 552L352 181.3L457.4 286.7C469.9 299.2 490.2 299.2 502.7 286.7C515.2 274.2 515.2 253.9 502.7 241.4L342.7 81.4z"/></svg>',
    free: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="currentColor"><path d="M342.6 41.4C330.1 28.9 309.8 28.9 297.3 41.4L201.3 137.4C188.8 149.9 188.8 170.2 201.3 182.7C213.8 195.2 234.1 195.2 246.6 182.7L288 141.3L288 498.7L246.6 457.4C234.1 444.9 213.8 444.9 201.3 457.4C188.8 469.9 188.8 490.2 201.3 502.7L297.3 598.7C303.3 604.7 311.4 608.1 319.9 608.1C328.4 608.1 336.5 604.7 342.5 598.7L438.5 502.7C451 490.2 451 469.9 438.5 457.4C426 444.9 405.7 444.9 393.2 457.4L351.8 498.8L351.8 141.3L393.2 182.7C405.7 195.2 426 195.2 438.5 182.7C451 170.2 451 149.9 438.5 137.4L342.5 41.4z"/></svg>',
    announce: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="currentColor"><path d="M525.2 82.9C536.7 88 544 99.4 544 112L544 528C544 540.6 536.7 552 525.2 557.1C513.7 562.2 500.4 560.3 490.9 552L444.3 511.3C400.7 473.2 345.6 451 287.9 448.3L287.9 544C287.9 561.7 273.6 576 255.9 576L223.9 576C206.2 576 191.9 561.7 191.9 544L191.9 448C121.3 448 64 390.7 64 320C64 249.3 121.3 192 192 192L276.5 192C338.3 191.8 397.9 169.3 444.4 128.7L491 88C500.4 79.7 513.9 77.8 525.3 82.9zM288 384L288 384.2C358.3 386.9 425.8 412.7 480 457.6L480 182.3C425.8 227.2 358.3 253 288 255.7L288 384z"/></svg>'
  };
  return icons[columnKey] || '';
}

/**
 * Get column label
 */
export function getColumnLabel(columnKey) {
  const labels = {
    down: 'Down',
    up: 'Up',
    free: 'Free',
    announce: 'Announce'
  };
  return labels[columnKey] || columnKey;
}

/**
 * Get category display order for scorecard layout
 */
export function getCategoryOrder() {
  return {
    down: categoryOrder,
    up: [...categoryOrder].reverse(),
    free: categoryOrder,
    announce: categoryOrder
  };
}