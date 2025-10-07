/**
 * UI Controller for virtual dice rolling
 */

import {
  createDiceState,
  rollDiceWithLocked,
  toggleDiceLock,
  resetDiceState,
  setAnnouncement,
  countFaces,
  sumDice,
  isStraight,
  isFullHouse,
  isPoker,
  isYamb,
  DICE_CONSTANTS
} from './dice.js';

import {
  canFillCategory,
  getAvailableCategories,
  getColumnIcon,
  getColumnLabel,
  getCategoryOrder
} from './columnRules.js';

import { categories } from './scoring.js';

export class VirtualDiceUI {
  constructor(container, onScoreSelect) {
    this.container = container;
    this.onScoreSelect = onScoreSelect;
    this.state = createDiceState();
    this.currentState = null; // Full game state
    this.announced = null; // Announced category
    this.sortBy = 'value'; // 'value' or 'scorecard'
    this.showZeroOptions = false;
    this.ignoreNextClick = false; // Suppress synthetic clicks after touch
    this.touchClickResetTimer = null;
    this.touchAnimationTimers = {};
    
    this.render();
    this.attachEventListeners();
  }
  
  /**
   * Set the current game state
   */
  setGameState(gameState) {
    this.currentState = gameState;
  }
  
  /**
   * Start a new turn
   */
  startTurn(gameState) {
    this.state = resetDiceState();
    this.currentState = gameState;
    // Preserve announcement from game state (if any)
    this.announced = gameState.announcement || null;
    this.render();
  }
  
  /**
   * Check if can announce (only before first roll or after first roll)
   */
  canAnnounce() {
    return this.state.rollsRemaining === 3 || this.state.rollsRemaining === 2;
  }
  
  /**
   * Announce a category
   */
  announceCategory(category) {
    this.announced = category;
    this.state = setAnnouncement(this.state, category);
    this.render();
    this.updatePossibleScores();
  }
  
  /**
   * Perform initial roll (manual, not automatic)
   */
  performInitialRoll() {
    if (this.state.rollsRemaining !== 3) return;
    this.roll();
  }
  
  /**
   * Roll the dice
   */
  async roll() {
    if (this.state.rollsRemaining <= 0) return;
    
    // If announcement is needed and not announced yet, prevent rolling
    const needsAnnouncement = this.checkIfAnnouncementNeeded();
    const canAnnounce = this.canAnnounce() && !this.announced;
    if (needsAnnouncement && canAnnounce && this.state.rollsRemaining === 2) {
      // After first roll, must announce before continuing
      alert('⚠️ You must announce a category before rolling again!');
      return;
    }
    
    // Add rolling animation
    const diceElements = this.container.querySelectorAll('.die');
    const previousLockedState = [...this.state.locked];
    
    diceElements.forEach((die, index) => {
      const wasLocked = previousLockedState[index];
      if (!wasLocked) {
        die.classList.add('rolling');
      }
    });
    
    // Wait for animation to complete
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Update dice values
    this.state = rollDiceWithLocked(this.state);
    
    // Re-render with new values
    this.render();
    
    // Add settling animation
    const newDiceElements = this.container.querySelectorAll('.die');
    newDiceElements.forEach((die, index) => {
      const wasLocked = previousLockedState[index];
      const isNowLocked = this.state.locked[index];
      
      if (!wasLocked) {
        // Dice that were rolled
        if (isNowLocked) {
          die.classList.add('settling-stay');
        } else {
          die.classList.add('settling-unlock');
        }
        
        // Remove settling class after animation
        setTimeout(() => {
          die.classList.remove('settling-stay', 'settling-unlock');
        }, 300);
      }
    });
    
    this.updatePossibleScores();
  }
  
  /**
   * Toggle lock on a specific die
   */
  toggleLock(index, preserveAnimation = false) {
    // Can lock/unlock after first roll and before all rolls used
    if (this.state.rollsRemaining === 3 || this.state.rollsRemaining === 0) return;
    
    let remainingAnimation = 0;
    if (preserveAnimation) {
      remainingAnimation = this.pauseTouchAnimation(index);
    }

    this.state = toggleDiceLock(this.state, index);
    this.render();

    if (preserveAnimation && remainingAnimation > 0) {
      // Leave a minimum hold so the user can finish perceiving the animation
      const duration = Math.max(200, remainingAnimation);
      this.startTouchAnimation(index, duration);
    }
    
    // Update scoring options after toggling lock
    this.updatePossibleScores();
  }
  
  /**
   * Toggle sort order
   */
  toggleSort() {
    this.sortBy = this.sortBy === 'value' ? 'scorecard' : 'value';
    this.updatePossibleScores();
  }
  
  /**
   * Toggle zero options visibility
   */
  toggleZeroOptions() {
    this.showZeroOptions = !this.showZeroOptions;
    this.updatePossibleScores();
  }
  
  /**
   * Check if announcement is needed (only announce column available)
   */
  checkIfAnnouncementNeeded() {
    if (!this.currentState?.scores) return false;
    
    const columns = ['down', 'up', 'free'];
    // Check if all other columns are full
    const otherColumnsFull = columns.every(col => {
      const availableCategories = getAvailableCategories(col, this.currentState.scores);
      return availableCategories.length === 0;
    });
    
    // Check if announce column has available categories
    const announceAvailable = getAvailableCategories('announce', this.currentState.scores, this.announced);
    
    return otherColumnsFull && announceAvailable.length > 0;
  }
  
  /**
   * Get category label from key
   */
  getCategoryLabel(categoryKey) {
    const category = categories.find(c => c.key === categoryKey);
    return category?.label || categoryKey;
  }
  
  /**
   * Update the display of possible scoring options
   */
  updatePossibleScores() {
    if (!this.currentState || this.state.rollsRemaining === 3) {
      // No options before first roll
      this.renderPossibleScores([]);
      return;
    }
    
    const options = this.calculateScoringOptions(this.state.values);
    this.renderPossibleScores(options);
  }
  
  /**
   * Calculate all possible scoring options for current dice
   * Respects column rules and shows which column will be filled
   */
  calculateScoringOptions(values) {
    const options = [];
    const counts = countFaces(values);
    const total = sumDice(values);
    
    const inputCategories = categories
      .filter(cat => cat.input)
      .map(cat => cat.key);
    
    // Determine which columns to check based on announcement status and roll number
    let columnsToCheck = [];
    let categoriesToShow = inputCategories;
    
    if (this.announced) {
      // If announced, only show announced category for announce column
      columnsToCheck = ['announce'];
      categoriesToShow = inputCategories.filter(cat => cat === this.announced);
    } else {
      // Not announced - check all columns except announce (unless it's first roll)
      columnsToCheck = ['down', 'up', 'free'];
      
      // Only include announce column on first roll (before any dice are rolled)
      // OR if player has explicitly announced
      if (this.state.rollsRemaining >= 2) {
        columnsToCheck.push('announce');
      }
    }
    
    // For each category, check which columns can accept it
    categoriesToShow.forEach(categoryKey => {
      const categoryInfo = categories.find(c => c.key === categoryKey);
      const scoreValue = this.calculateCategoryScore(categoryKey, values, counts, total);
      
      columnsToCheck.forEach(columnKey => {
        // Check if this category can be filled in this column
        const canFill = canFillCategory(
          columnKey,
          categoryKey,
          this.currentState?.scores || {},
          this.currentState?.announcement || this.announced
        );
        
        if (canFill) {
          // Get the count for upper section categories
          let diceCount = 0;
          if (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(categoryKey)) {
            const faceValue = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 }[categoryKey];
            diceCount = counts[faceValue] || 0;
          }
          
          options.push({
            category: categoryKey,
            column: columnKey,
            label: categoryInfo?.label || categoryKey,
            value: scoreValue,
            description: this.getScoreDescription(categoryKey, values, counts, total, scoreValue),
            available: scoreValue > 0 || categoryKey === 'min' || this.showZeroOptions,
            columnIcon: getColumnIcon(columnKey),
            columnLabel: getColumnLabel(columnKey),
            diceCount: diceCount // Add dice count for sorting
          });
        }
      });
    });
    
    // Sort options
    return this.sortOptions(options);
  }
  
  /**
   * Calculate score for a specific category
   */
  calculateCategoryScore(category, values, counts, total) {
    // Upper section
    if (category === 'ones') return counts[1] ? counts[1] * 1 : 0;
    if (category === 'twos') return counts[2] ? counts[2] * 2 : 0;
    if (category === 'threes') return counts[3] ? counts[3] * 3 : 0;
    if (category === 'fours') return counts[4] ? counts[4] * 4 : 0;
    if (category === 'fives') return counts[5] ? counts[5] * 5 : 0;
    if (category === 'sixes') return counts[6] ? counts[6] * 6 : 0;
    
    // Middle section
    if (category === 'max') return total;
    if (category === 'min') return total;
    
    // Lower section - Calculate based on actual Yamb rules
    const maxKind = Math.max(...Object.values(counts));
    
    if (category === 'tris') {
      // Three of a kind: sum of the 3 matching dice + 10 bonus
      if (maxKind >= 3) {
        const tripleValue = Object.keys(counts).find(key => counts[key] >= 3);
        return (parseInt(tripleValue) * 3) + 10;
      }
      return 0;
    }
    
    if (category === 'straight') {
      // Straight: 35 for small (1-2-3-4-5), 45 for big (2-3-4-5-6)
      if (!isStraight(values)) return 0;
      
      // Determine which straight it is by checking the sorted unique values
      const sorted = [...values].sort((a, b) => a - b);
      const unique = [...new Set(sorted)];
      
      // Small straight: [1, 2, 3, 4, 5] = sum is 15, score is 35
      // Big straight: [2, 3, 4, 5, 6] = sum is 20, score is 45
      if (unique[0] === 1) {
        return 35; // Small straight (1-2-3-4-5)
      } else {
        return 45; // Big straight (2-3-4-5-6)
      }
    }
    
    if (category === 'full') {
      // Full house: sum of all 5 dice + 30 bonus
      return isFullHouse(values) ? total + 30 : 0;
    }
    
    if (category === 'poker') {
      // Poker (four of a kind): sum of the 4 matching dice + 40 bonus
      if (isPoker(values)) {
        const pokerValue = Object.keys(counts).find(key => counts[key] >= 4);
        return (parseInt(pokerValue) * 4) + 40;
      }
      return 0;
    }
    
    if (category === 'yamb') {
      // Yamb (five of a kind): sum of all 5 dice + 50 bonus
      if (isYamb(values)) {
        return total + 50;
      }
      return 0;
    }
    
    return 0;
  }
  
  /**
   * Get description for a score
   */
  getScoreDescription(category, values, counts, total, scoreValue) {
    if (category === 'ones') return `${counts[1] || 0} × 1 = ${scoreValue}`;
    if (category === 'twos') return `${counts[2] || 0} × 2 = ${scoreValue}`;
    if (category === 'threes') return `${counts[3] || 0} × 3 = ${scoreValue}`;
    if (category === 'fours') return `${counts[4] || 0} × 4 = ${scoreValue}`;
    if (category === 'fives') return `${counts[5] || 0} × 5 = ${scoreValue}`;
    if (category === 'sixes') return `${counts[6] || 0} × 6 = ${scoreValue}`;
    
    if (category === 'max' || category === 'min') {
      const warning = category === 'min' && total < 5 ? ' ⚠️ Must be ≥5' : '';
      return `Sum: ${total}${warning}`;
    }
    
    const maxKind = Math.max(...Object.values(counts));
    
    if (category === 'tris') {
      return maxKind >= 3 ? `Sum + 10 = ${scoreValue}` : 'No 3-of-a-kind';
    }
    if (category === 'straight') {
      if (!isStraight(values)) return 'Not a straight';
      
      // Determine which straight it is
      const sorted = [...values].sort((a, b) => a - b);
      const unique = [...new Set(sorted)];
      
      if (unique[0] === 1) {
        return `Small (1-5) = 35`;
      } else {
        return `Big (2-6) = 45`;
      }
    }
    if (category === 'full') {
      return isFullHouse(values) ? `Sum + 30 = ${scoreValue}` : 'Not a full house';
    }
    if (category === 'poker') {
      return isPoker(values) ? `Sum + 40 = ${scoreValue}` : 'No 4-of-a-kind';
    }
    if (category === 'yamb') {
      return isYamb(values) ? `Sum + 50 = ${scoreValue}` : 'No 5-of-a-kind';
    }
    
    return `${scoreValue}`;
  }
  
  /**
   * Sort scoring options
   */
  sortOptions(options) {
    if (this.sortBy === 'value') {
      // Smart strategic sorting:
      // - Calculate priority for each option
      // - Upper section: dice count is a bonus (more dice = better)
      // - Lower section: base value, BUT with penalties for bad strategic choices
      //   * min > 10 gets heavy penalty (bad to waste min on high values)
      //   * max < 20 gets heavy penalty (bad to waste max on low values)
      // - Sort by strategic priority (highest first)
      
      const upperSection = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
      const lowerSection = ['max', 'min', 'tris', 'straight', 'full', 'poker', 'yamb'];
      
      return options.sort((a, b) => {
        const aIsUpper = upperSection.includes(a.category);
        const bIsUpper = upperSection.includes(b.category);
        
        // Calculate strategic priority for ANY option
        const getStrategicPriority = (opt) => {
          let priority = opt.value;
          
          // Upper section: add bonus based on dice count
          if (upperSection.includes(opt.category)) {
            // Each matching die adds value to priority
            priority = opt.value + (opt.diceCount * 3); // Bonus for having more matching dice
          }
          
          // Lower section penalties for bad strategic choices
          if (opt.category === 'min' && opt.value > 10) {
            // Very heavy penalty - push these way down
            priority = priority - (opt.value - 10) * 20;
          }
          
          if (opt.category === 'max' && opt.value < 20) {
            // Very heavy penalty - push these way down
            priority = priority - (20 - opt.value) * 20;
          }
          
          return priority;
        };
        
        const aPriority = getStrategicPriority(a);
        const bPriority = getStrategicPriority(b);
        
        // Sort by strategic priority (highest first)
        if (bPriority !== aPriority) return bPriority - aPriority;
        
        // If same priority, prefer upper section options (more consistent)
        if (aIsUpper && !bIsUpper) return -1;
        if (!aIsUpper && bIsUpper) return 1;
        
        // If still tied, sort by actual value
        if (b.value !== a.value) return b.value - a.value;
        
        // Last resort: alphabetical
        return a.label.localeCompare(b.label);
      });
    } else {
      // Sort by scorecard order
      const categoryOrder = categories
        .filter(c => c.input)
        .map(c => c.key);
      
      return options.sort((a, b) => {
        const aIndex = categoryOrder.indexOf(a.category);
        const bIndex = categoryOrder.indexOf(b.category);
        return aIndex - bIndex;
      });
    }
  }
  
  /**
   * Render the dice UI
   */
  render() {
    const canAnnounce = this.canAnnounce() && !this.announced;
    const hasRolled = this.state.rollsRemaining < 3;
    const needsAnnouncement = this.checkIfAnnouncementNeeded();
    
    const html = `
      <div class="virtual-dice-container">
        <div class="dice-status">
          <div class="rolls-remaining">
            <strong>Rolls remaining:</strong> ${this.state.rollsRemaining}/3
          </div>
          ${this.announced ? `
            <div class="announced">
              <span class="announce-icon">📢</span>
              <strong>Announced: ${this.getCategoryLabel(this.announced)}</strong>
            </div>
          ` : ''}
        </div>
        
        ${needsAnnouncement && canAnnounce ? `
          <div class="announce-prompt announce-required">
            <p>⚠️ Only Announce column available - you must announce a category!</p>
            <button class="btn-announce" data-action="show-announce">
              📢 Announce Category
            </button>
          </div>
        ` : canAnnounce ? `
          <div class="announce-prompt">
            <button class="btn-announce" data-action="show-announce">
              📢 Announce Category
            </button>
          </div>
        ` : !this.announced && hasRolled ? `
          <div class="announce-prompt">
            <button class="btn-announce" disabled title="Can only announce before or after first roll">
              📢 Announce Category
            </button>
          </div>
        ` : ''}
        
        <div class="dice-display">
          ${this.state.values.map((value, index) => this.renderDie(value, index)).join('')}
        </div>
        
        <div class="dice-controls">
          <button 
            class="btn-roll" 
            ${this.state.rollsRemaining <= 0 || (needsAnnouncement && canAnnounce && this.state.rollsRemaining === 2) ? 'disabled' : ''}
            data-action="roll"
            ${needsAnnouncement && canAnnounce && this.state.rollsRemaining === 2 ? 'title="You must announce a category before rolling again!"' : ''}
          >
            ${this.state.rollsRemaining === 3 ? '🎲 Roll Dice' : `🎲 Roll Again (${this.state.rollsRemaining} left)`}
          </button>
          
          ${needsAnnouncement && canAnnounce && this.state.rollsRemaining === 2 ? `
            <p class="dice-hint" style="color: var(--danger); font-weight: 600;">⚠️ You must announce a category to continue!</p>
          ` : hasRolled && this.state.rollsRemaining > 0 ? `
            <p class="dice-hint">💡 Click dice to lock/unlock them, or select a score below</p>
          ` : hasRolled ? `
            <p class="dice-hint">💡 Select a score below to finish your turn</p>
          ` : ''}
        </div>
        
        <div class="possible-scores" id="possible-scores-list">
          <!-- Populated by updatePossibleScores() -->
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
  }
  
  /**
   * Render a single die
   */
  renderDie(value, index) {
    const locked = this.state.locked[index];
    const canToggle = this.state.rollsRemaining < 3 && this.state.rollsRemaining > 0;
    
    return `
      <div 
        class="die ${locked ? 'locked' : ''} ${canToggle ? 'clickable' : ''}" 
        data-index="${index}"
        data-action="${canToggle ? 'toggle-lock' : ''}"
      >
        <div class="die-face">${this.renderDieFace(value)}</div>
        ${locked ? '<div class="lock-indicator">🔒</div>' : ''}
      </div>
    `;
  }
  
  /**
   * Render die face with dots
   */
  renderDieFace(value) {
    const dots = [];
    for (let i = 0; i < value; i++) {
      dots.push('<span class="dot"></span>');
    }
    return `<div class="die-dots die-${value}">${dots.join('')}</div>`;
  }
  
  /**
   * Render possible scoring options
   */
  renderPossibleScores(options) {
    const container = this.container.querySelector('#possible-scores-list');
    if (!container) return;
    
    // If no options provided, recalculate from current state
    if (!options) {
      if (this.state.rollsRemaining === 3 || this.state.values.length === 0) {
        container.innerHTML = '<p class="no-options">🎲 Roll the dice to see scoring options</p>';
        return;
      }
      options = this.calculateScoringOptions(this.state.values);
    }
    
    if (options.length === 0) {
      container.innerHTML = '<p class="no-options">🎲 Roll the dice to see scoring options</p>';
      return;
    }
    
    // Filter out zero options unless showZeroOptions is true
    const filteredOptions = this.showZeroOptions 
      ? options 
      : options.filter(opt => opt.value > 0);
    
    // If filtering removed all options, show a message with toggle
    if (filteredOptions.length === 0) {
      container.innerHTML = `
        <div class="no-visible-options">
          <p class="no-options">All available scores are zero</p>
          <button class="btn-toggle-zeros" data-action="toggle-zeros">
            👁️ Show Zero Scores
          </button>
        </div>
      `;
      return;
    }
    
    const hasZeroOptions = options.some(opt => opt.value === 0);
    
    const html = `
      <div class="scores-header">
        <h3>Available Scores:</h3>
        <div class="scores-controls">
          <button class="btn-sort btn-sort-${this.sortBy}" data-action="toggle-sort" title="Change sort order">
            ${this.sortBy === 'value' ? '🔽 By Value' : '📋 By Scorecard'}
          </button>
          ${hasZeroOptions ? `
            <button class="btn-toggle-zeros ${this.showZeroOptions ? 'active' : ''}" data-action="toggle-zeros" title="Show/hide zero scores">
              ${this.showZeroOptions ? '👁️ Hide Zeros' : '👁️ Show All'}
            </button>
          ` : ''}
        </div>
      </div>
      <div class="score-options">
        ${filteredOptions.map(opt => `
          <div class="score-option ${opt.value === 0 ? 'zero-value' : ''}" 
               data-category="${opt.category}"
               data-column="${opt.column}"
               data-value="${opt.value}"
               title="Fill ${opt.label} in ${opt.columnLabel} column">
            <div class="option-header">
              <div class="option-label">${opt.label}</div>
              <div class="option-column" title="${opt.columnLabel} column">
                ${opt.columnIcon}
              </div>
            </div>
            <div class="option-value">${opt.value}</div>
            <div class="option-description">${opt.description}</div>
            <!--<div class="option-column-label">${opt.columnLabel}</div>-->
          </div>
        `).join('')}
      </div>
    `;
    
    container.innerHTML = html;
  }
  
  /**
   * Prompt for announcement (announce column only)
   */
  /**
   * Prompt for announcement
   */
  promptForAnnouncement() {
    // Get available categories for announce column
    const availableCategories = getAvailableCategories(
      'announce',
      this.currentState?.scores || {},
      null // No announcement yet
    );
    
    if (availableCategories.length === 0) {
      alert('No categories available for announcement!');
      return;
    }
    
    // Get the dialog
    const dialog = document.getElementById('virtual-announce-select-dialog');
    if (!dialog) {
      console.error('Virtual announce dialog not found');
      return;
    }
    
    // Populate the category list
    const categoriesContainer = document.getElementById('virtual-announce-categories');
    if (!categoriesContainer) return;
    
    categoriesContainer.innerHTML = availableCategories
      .map(key => {
        const cat = categories.find(c => c.key === key);
        return `
          <button 
            type="button" 
            class="announce-category-option" 
            data-category="${key}"
            value="select"
          >
            <span class="category-name">${cat?.label || key}</span>
            <span class="category-icon">→</span>
          </button>
        `;
      })
      .join('');
    
    // Add click handlers
    const buttons = categoriesContainer.querySelectorAll('.announce-category-option');
    buttons.forEach(button => {
      button.addEventListener('click', (e) => {
        const category = e.currentTarget.dataset.category;
        this.announceCategory(category);
        dialog.close('select');
      }, { once: true });
    });
    
    // Show the dialog
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  
  /**
   * Attach event listeners
   */
  attachEventListeners() {
  // Track the active dice index for touch interactions
  let activeTouchIndex = null;
    
    this.container.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;

      if (action === 'toggle-lock' && this.ignoreNextClick) {
        this.ignoreNextClick = false;
        if (this.touchClickResetTimer) {
          clearTimeout(this.touchClickResetTimer);
          this.touchClickResetTimer = null;
        }
        return;
      }
      
      if (action === 'roll') {
        this.roll();
      } else if (action === 'show-announce') {
        this.promptForAnnouncement();
      } else if (action === 'toggle-lock') {
        if (this.touchClickResetTimer) {
          clearTimeout(this.touchClickResetTimer);
          this.touchClickResetTimer = null;
        }
        this.ignoreNextClick = false;

        const index = parseInt(e.target.closest('[data-index]')?.dataset.index);
        if (!isNaN(index)) {
          this.toggleLock(index);
        }
      }
    });
    
    // Add touch feedback for dice on mobile using CSS animations
    this.container.addEventListener('touchstart', (e) => {
      const die = e.target.closest('[data-action="toggle-lock"]');
      if (!die || !die.classList.contains('clickable')) return;

      const index = parseInt(die.dataset.index);
      if (isNaN(index)) return;

      this.ignoreNextClick = true;
      if (this.touchClickResetTimer) {
        clearTimeout(this.touchClickResetTimer);
      }
      this.touchClickResetTimer = setTimeout(() => {
        this.ignoreNextClick = false;
        this.touchClickResetTimer = null;
      }, 500);

      activeTouchIndex = index;
      this.startTouchAnimation(index, 1200);
    }, { passive: true });

    this.container.addEventListener('touchend', (e) => {
      const die = e.target.closest('[data-action="toggle-lock"]');
      let index = die ? parseInt(die.dataset.index) : NaN;
      if (isNaN(index) && activeTouchIndex !== null) {
        index = activeTouchIndex;
      }

      if (!isNaN(index)) {
        this.toggleLock(index, true);
      }

      activeTouchIndex = null;
    }, { passive: true });

    this.container.addEventListener('touchcancel', (e) => {
      const die = e.target.closest('[data-action="toggle-lock"]');
      let index = die ? parseInt(die.dataset.index) : NaN;
      if (isNaN(index) && activeTouchIndex !== null) {
        index = activeTouchIndex;
      }

      if (!isNaN(index)) {
        this.clearTouchAnimation(index);
      }

      activeTouchIndex = null;
      this.ignoreNextClick = false;
      if (this.touchClickResetTimer) {
        clearTimeout(this.touchClickResetTimer);
        this.touchClickResetTimer = null;
      }
    }, { passive: true });
    
    // Handle score option selection
    this.container.addEventListener('click', (e) => {
      const option = e.target.closest('.score-option');
      if (option && !option.classList.contains('unavailable')) {
        const category = option.dataset.category;
        const column = option.dataset.column;
        const value = parseInt(option.dataset.value);
        if (this.onScoreSelect && !isNaN(value)) {
          this.onScoreSelect(category, column, value);
        }
      }
      
      // Handle sort button clicks
      if (e.target.closest('[data-action="toggle-sort"]')) {
        this.sortBy = this.sortBy === 'value' ? 'order' : 'value';
        this.renderPossibleScores(); // Will recalculate
      }
      
      // Handle show zero toggle
      if (e.target.closest('[data-action="toggle-zeros"]')) {
        this.showZeroOptions = !this.showZeroOptions;
        this.renderPossibleScores(); // Will recalculate
      }
    });
  }
  
  /**
   * Get current dice state
   */
  getState() {
    return this.state;
  }
  
  /**
   * Set announcement callback
   */
  setAnnounceCallback(callback) {
    this.onAnnounce = callback;
  }

  getDieElement(index) {
    return this.container.querySelector(`[data-index="${index}"]`);
  }

  startTouchAnimation(index, duration = 1200) {
    const element = this.getDieElement(index);
    if (!element) return;

    if (this.touchAnimationTimers[index]) {
      clearTimeout(this.touchAnimationTimers[index].timeoutId);
    }

    element.classList.remove('touch-active');
    void element.offsetWidth;
    element.classList.add('touch-active');

    const timeoutId = setTimeout(() => {
      const current = this.getDieElement(index);
      if (current) {
        current.classList.remove('touch-active');
      }
      delete this.touchAnimationTimers[index];
    }, duration);

    this.touchAnimationTimers[index] = {
      timeoutId,
      expiresAt: performance.now() + duration,
    };
  }

  pauseTouchAnimation(index) {
    const info = this.touchAnimationTimers[index];
    if (!info) return 0;

    clearTimeout(info.timeoutId);
    delete this.touchAnimationTimers[index];

    const remaining = info.expiresAt - performance.now();
    return remaining > 0 ? remaining : 0;
  }

  clearTouchAnimation(index) {
    const info = this.touchAnimationTimers[index];
    if (info) {
      clearTimeout(info.timeoutId);
      delete this.touchAnimationTimers[index];
    }

    const element = this.getDieElement(index);
    if (element) {
      element.classList.remove('touch-active');
    }
  }
}
