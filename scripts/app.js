import {
  columns,
  categories,
  createEmptyState,
  computeColumnDerived,
  getCategoryValue,
  isCategoryValueAllowed,
  getValidationMessage
} from "./scoring.js";

import { gameModeManager } from "./gameModeManager.js";

const STORAGE_KEY = "yamb-scorekeeper-v1";
const THEME_KEY = "yamb-scorekeeper-theme";

const tableBody = document.querySelector("#score-table tbody");
const summaryList = document.getElementById("summary-list");
const resetButton = document.getElementById("reset-all");
const themeToggle = document.getElementById("theme-toggle");
const settingsButton = document.getElementById("settings-button");
const overallGrandTotalCell = document.getElementById("overall-grand-total");

const exportDialog = document.getElementById("export-dialog");
const exportTextarea = document.getElementById("export-textarea");

const infoDialog = document.getElementById("info-dialog");
const infoDialogTitle = document.getElementById("info-dialog-title");
const infoDialogBody = document.getElementById("info-dialog-body");

const straightDialog = document.getElementById("straight-dialog");
const straightDialogTitle = document.getElementById("straight-dialog-title");
const straightDialogDescription = document.getElementById("straight-dialog-description");

const announceDialog = document.getElementById("announce-dialog");
const announceDialogTitle = document.getElementById("announce-dialog-title");
const announceDialogMessage = document.getElementById("announce-dialog-message");
const announceDialogInput = document.getElementById("announce-dialog-input");
const announceDialogClear = document.getElementById("announce-dialog-clear");
const announceDialogForm = announceDialog?.querySelector("form");
const announceRoller = document.getElementById("announce-roller");

const settingsDialog = document.getElementById("settings-dialog");
const settingsDialogActions = settingsDialog
  ? Array.from(settingsDialog.querySelectorAll("[data-settings-action]"))
  : [];

const importDialog = document.getElementById("import-dialog");
const importDialogForm = importDialog?.querySelector("form");
const importTextarea = document.getElementById("import-textarea");

const resetDialog = document.getElementById("reset-dialog");
const resetDialogForm = resetDialog?.querySelector("form");

const completionDialog = document.getElementById("completion-dialog");
const completionDialogTitle = document.getElementById("completion-dialog-title");
const completionSummaryList = document.getElementById("completion-summary");
const completionMessage = document.getElementById("completion-message");
const confettiStage = document.getElementById("confetti-stage");
const wakeLockToggle = document.getElementById("wake-lock-toggle");
const wakeLockSupportNote = document.getElementById("wake-lock-support-note");
const wakeLockSupportNoteDefault = wakeLockSupportNote?.textContent ?? "";
const prefersDesktopInteraction =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? !window.matchMedia("(pointer: coarse)").matches
    : true;

// Parallax disabled - keeping elements for static background only
// const parallaxScene = document.querySelector("[data-parallax-scene]");
// const parallaxLayers = parallaxScene ? Array.from(parallaxScene.querySelectorAll("[data-depth]")) : [];
// const prefersReducedMotionQuery =
//   typeof window !== "undefined" && typeof window.matchMedia === "function"
//     ? window.matchMedia("(prefers-reduced-motion: reduce)")
//     : null;
// const parallaxState = {
//   scrollY: 0,
//   ticking: false
// };
// let parallaxEnabled = false;

const WAKE_LOCK_STORAGE_KEY = "yamb-keep-awake";
const AudioContextClass =
  typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
const speechSynthesisSupported =
  typeof window !== "undefined" && "speechSynthesis" in window &&
  typeof window.speechSynthesis?.speak === "function";

let wakeLockDesired = false;
let wakeLockSentinel = null;
let wakeLockInitialized = false;
let announceAudioContext = null;

const appDialogs = document.querySelectorAll("dialog.app-dialog");
appDialogs.forEach((dialog) => {
  if (dialog instanceof HTMLDialogElement && !dialog.hasAttribute("tabindex")) {
    dialog.setAttribute("tabindex", "-1");
  }
});

const scrollLockState = {
  count: 0,
  value: 0
};

let pendingStraightInput = null;
let pendingAnnounceInput = null;
let announceRollerInterval = null;

const cellRegistry = new Map();
const inputRegistry = new Map();

let state = loadState();
let derivedByColumn = {};
let lastCompletionSignature = null;

const DIE_PIP_COORDINATES = [
  [20, 20],
  [50, 20],
  [80, 20],
  [20, 50],
  [50, 50],
  [80, 50],
  [20, 80],
  [50, 80],
  [80, 80]
];

const DIE_FACE_MAP = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

const sequentialOrders = new Map([
  [
    "down",
    [
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
      "yamb"
    ]
  ],
  [
    "up",
    [
      "yamb",
      "poker",
      "full",
      "straight",
      "tris",
      "min",
      "max",
      "sixes",
      "fives",
      "fours",
      "threes",
      "twos",
      "ones"
    ]
  ]
]);

const sequentialErrorMessages = {
  down: "Down column must be filled from top to bottom without skipping categories.",
  up: "Up column must be filled from bottom to top without skipping categories."
};

// Parallax functions disabled - background is now static
/*
function applyParallaxTransforms() {
  parallaxState.ticking = false;
  if (!parallaxEnabled || !parallaxScene) return;

  const scrollY = parallaxState.scrollY;
  const viewportHeight = window.innerHeight || 1;
  const maxScrollable = Math.max(document.body.scrollHeight - viewportHeight, 1);
  const progress = Math.min(scrollY / maxScrollable, 1);
  parallaxScene.style.setProperty("--parallax-progress", progress.toFixed(4));

  parallaxLayers.forEach((layer) => {
    const depth = Number.parseFloat(layer.dataset.depth ?? "0");
    if (!Number.isFinite(depth) || depth <= 0) {
      layer.style.transform = "translate3d(-50%, -50%, 0)";
      return;
    }
    const translate = scrollY * depth * -0.3;
    const scale = 1 + depth * 0.2;
    layer.style.transform = `translate3d(-50%, calc(-50% + ${translate}px), 0) scale(${scale.toFixed(3)})`;
  });
}

function scheduleParallaxUpdate() {
  if (!parallaxEnabled || parallaxState.ticking) return;
  parallaxState.ticking = true;
  window.requestAnimationFrame(applyParallaxTransforms);
}

function handleParallaxScroll() {
  if (!parallaxEnabled) return;
  parallaxState.scrollY = window.scrollY ?? window.pageYOffset ?? 0;
  scheduleParallaxUpdate();
}

function resetParallaxTransforms() {
  parallaxScene?.style.removeProperty("--parallax-progress");
  parallaxLayers.forEach((layer) => {
    layer.style.transform = "translate3d(-50%, -50%, 0)";
  });
}

function setParallaxEnabled(enabled) {
  parallaxEnabled = Boolean(enabled) && !!parallaxScene && parallaxLayers.length > 0;
  if (!parallaxEnabled) {
    resetParallaxTransforms();
    return;
  }
  parallaxState.scrollY = window.scrollY ?? window.pageYOffset ?? 0;
  scheduleParallaxUpdate();
}

function setupParallaxScene() {
  if (!parallaxScene || parallaxLayers.length === 0) return;

  const onScroll = () => handleParallaxScroll();
  const onResize = () => scheduleParallaxUpdate();

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);

  if (prefersReducedMotionQuery) {
    setParallaxEnabled(!prefersReducedMotionQuery.matches);
    const handleMotionChange = (event) => {
      setParallaxEnabled(!event.matches);
    };
    if (typeof prefersReducedMotionQuery.addEventListener === "function") {
      prefersReducedMotionQuery.addEventListener("change", handleMotionChange);
    } else if (typeof prefersReducedMotionQuery.addListener === "function") {
      prefersReducedMotionQuery.addListener(handleMotionChange);
    }
  } else {
    setParallaxEnabled(true);
  }
}
*/

const inputCategories = categories.filter((category) => category.input);

const demoCompletionSheet = {
  down: {
    ones: 3,
    twos: 8,
    threes: 12,
    fours: 12,
    fives: 15,
    sixes: 24,
    max: 25,
    min: 8,
    tris: 28,
    straight: 45,
    full: 58,
    poker: 64,
    yamb: 80
  },
  up: {
    ones: 2,
    twos: 6,
    threes: 9,
    fours: 12,
    fives: 20,
    sixes: 18,
    max: 24,
    min: 6,
    tris: 25,
    straight: 35,
    full: 58,
    poker: 60,
    yamb: 75
  },
  free: {
    ones: 4,
    twos: 10,
    threes: 9,
    fours: 16,
    fives: 25,
    sixes: 30,
    max: 27,
    min: 7,
    tris: 22,
    straight: 45,
    full: 58,
    poker: 64,
    yamb: 80
  },
  announce: {
    ones: 5,
    twos: 10,
    threes: 12,
    fours: 8,
    fives: 20,
    sixes: 24,
    max: 26,
    min: 9,
    tris: 19,
    straight: 35,
    full: 58,
    poker: 56,
    yamb: 70
  }
};

function hasCategoryValue(columnState, categoryKey) {
  return Object.prototype.hasOwnProperty.call(columnState, categoryKey);
}

function getSequentialFailure(columnKey, categoryKey, columnState) {
  const order = sequentialOrders.get(columnKey);
  if (!order) return null;
  const index = order.indexOf(categoryKey);
  if (index === -1) return null;

  if (hasCategoryValue(columnState, categoryKey)) {
    return null;
  }

  const firstOpenIndex = order.findIndex((key) => !hasCategoryValue(columnState, key));

  if (firstOpenIndex === -1) {
    return null;
  }

  if (firstOpenIndex !== index) {
    return {
      message: sequentialErrorMessages[columnKey] ?? "This column must be filled sequentially."
    };
  }

  return null;
}

function lockScroll() {
  if (scrollLockState.count === 0) {
    scrollLockState.value = window.scrollY ?? window.pageYOffset ?? 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollLockState.value}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.setAttribute("data-scroll-locked", "true");
  }
  scrollLockState.count += 1;
}

function unlockScroll() {
  if (scrollLockState.count === 0) return;
  scrollLockState.count -= 1;
  if (scrollLockState.count <= 0) {
    scrollLockState.count = 0;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.removeAttribute("data-scroll-locked");
    window.scrollTo(0, scrollLockState.value);
  }
}

function showDialog(dialog) {
  if (!dialog || typeof dialog.showModal !== "function") {
    return false;
  }

  dialog.returnValue = "";
  if (dialog.open) {
    return true;
  }

  lockScroll();
  dialog.showModal();
  return true;
}

function registerDialog(dialog, { onClose } = {}) {
  if (!dialog) return;

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close("cancel");
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close("cancel");
    }
  });

  dialog.addEventListener("close", () => {
    unlockScroll();
    if (typeof onClose === "function") {
      onClose(dialog.returnValue ?? "");
    }
  });
}

registerDialog(infoDialog, {
  onClose: () => {
    if (infoDialogBody) {
      infoDialogBody.textContent = "";
    }
  }
});

registerDialog(straightDialog, {
  onClose: () => {
    pendingStraightInput = null;
  }
});

registerDialog(announceDialog, {
  onClose: handleAnnounceDialogClose
});

registerDialog(exportDialog, {
  onClose: () => {
    if (exportTextarea) {
      exportTextarea.value = "";
    }
  }
});

registerDialog(settingsDialog);

registerDialog(importDialog, {
  onClose: () => {
    if (importTextarea) {
      importTextarea.value = "";
    }
  }
});

registerDialog(resetDialog, {
  onClose: handleResetDialogClose
});

registerDialog(completionDialog, {
  onClose: () => {
    clearConfetti();
  }
});

// Register game mode dialog
const gameModeDialog = document.getElementById('game-mode-dialog');
registerDialog(gameModeDialog);

// Register virtual dice dialog
const virtualDiceDialog = document.getElementById('virtual-dice-dialog');
registerDialog(virtualDiceDialog);

// Register virtual announce select dialog (from virtualDiceUI)
const virtualAnnounceDialog = document.getElementById('virtual-announce-select-dialog');
registerDialog(virtualAnnounceDialog);

if (announceDialogClear) {
  announceDialogClear.addEventListener("click", () => {
    if (announceDialogInput) {
      announceDialogInput.value = "";
    }
    announceDialog?.close("clear");
  });
}

if (announceDialogForm) {
  announceDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    announceDialog?.close("confirm");
  });
}

let straightDialogButtons = [];
if (straightDialog) {
  straightDialogButtons = Array.from(straightDialog.querySelectorAll("button[data-value]"));
}

straightDialogButtons.forEach((button) => {
  button.addEventListener("click", () => {
    handleStraightSelection(button.dataset.value ?? "");
  });
});

function createDieElement(face) {
  const wrapper = document.createElement("span");
  wrapper.className = "die";
  wrapper.dataset.face = String(face);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const pipIndexes = DIE_FACE_MAP[face] ?? [];
  pipIndexes.forEach((index) => {
    const position = DIE_PIP_COORDINATES[index];
    if (!position) return;
    const [cx, cy] = position;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", "9");
    svg.appendChild(circle);
  });

  wrapper.appendChild(svg);
  return wrapper;
}

function refreshAnnounceDice() {
  if (!announceRoller) return;
  announceRoller.innerHTML = "";
  for (let index = 0; index < 3; index += 1) {
    const face = Math.floor(Math.random() * 6) + 1;
    const die = createDieElement(face);
    die.classList.add("rolling-die");
    die.style.animationDelay = `${index * 0.12}s`;
    announceRoller.appendChild(die);
  }
}

function startAnnounceRolling() {
  if (!announceRoller) return;
  stopAnnounceRolling();
  refreshAnnounceDice();
  announceRollerInterval = window.setInterval(refreshAnnounceDice, 700);
}

function stopAnnounceRolling() {
  if (announceRollerInterval !== null) {
    window.clearInterval(announceRollerInterval);
    announceRollerInterval = null;
  }
}

function isWakeLockSupported() {
  return typeof navigator !== "undefined" &&
    typeof navigator.wakeLock?.request === "function";
}

function getStoredWakeLockPreference() {
  try {
    return localStorage.getItem(WAKE_LOCK_STORAGE_KEY) === "true";
  } catch (error) {
    return false;
  }
}

function setWakeLockPreference(enabled) {
  wakeLockDesired = enabled;
  try {
    localStorage.setItem(WAKE_LOCK_STORAGE_KEY, enabled ? "true" : "false");
  } catch (error) {
    /* ignore storage errors */
  }
}

async function ensureWakeLock() {
  if (!wakeLockDesired || !isWakeLockSupported()) {
    return false;
  }

  if (wakeLockSentinel || document.visibilityState === "hidden") {
    return wakeLockSentinel !== null;
  }

  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
      if (wakeLockDesired && document.visibilityState === "visible") {
        void ensureWakeLock();
      }
    });
    return true;
  } catch (error) {
    console.warn("Could not acquire screen wake lock", error);
    wakeLockSentinel = null;
    return false;
  }
}

async function releaseWakeLock() {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch (error) {
    console.warn("Could not release screen wake lock", error);
  }
  wakeLockSentinel = null;
}

function setupWakeLockControl() {
  if (wakeLockInitialized || !wakeLockToggle) return;
  wakeLockInitialized = true;

  const supported = isWakeLockSupported();
  if (!supported) {
    wakeLockToggle.checked = false;
    wakeLockToggle.disabled = true;
    if (wakeLockSupportNote) {
      wakeLockSupportNote.hidden = false;
    }
    setWakeLockPreference(false);
    return;
  }

  if (wakeLockSupportNote) {
    wakeLockSupportNote.textContent = wakeLockSupportNoteDefault;
    wakeLockSupportNote.hidden = true;
  }

  const storedPreference = getStoredWakeLockPreference();
  setWakeLockPreference(storedPreference);
  wakeLockToggle.checked = wakeLockDesired;

  if (wakeLockDesired) {
    void ensureWakeLock();
  }

  wakeLockToggle.addEventListener("change", async () => {
    const enabled = wakeLockToggle.checked;
    setWakeLockPreference(enabled);
    if (enabled) {
      const success = await ensureWakeLock();
      if (!success) {
        setWakeLockPreference(false);
        wakeLockToggle.checked = false;
        if (wakeLockSupportNote) {
          wakeLockSupportNote.textContent = "Unable to keep the screen awake on this device.";
          wakeLockSupportNote.hidden = false;
        }
      } else if (wakeLockSupportNote) {
        wakeLockSupportNote.textContent = wakeLockSupportNoteDefault;
        wakeLockSupportNote.hidden = true;
      }
    } else {
      await releaseWakeLock();
      if (wakeLockSupportNote) {
        wakeLockSupportNote.textContent = wakeLockSupportNoteDefault;
        wakeLockSupportNote.hidden = true;
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeLockDesired) {
      void ensureWakeLock();
    }
  });
}

function getAnnounceAudioContext() {
  if (!AudioContextClass) return null;
  if (!announceAudioContext) {
    try {
      announceAudioContext = new AudioContextClass();
    } catch (error) {
      console.warn("Could not start audio context", error);
      announceAudioContext = null;
    }
  }
  return announceAudioContext;
}

function playAnnounceChime() {
  const context = getAnnounceAudioContext();
  if (!context) return;

  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.4);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.16, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.6);
}

function speakAnnouncement(categoryLabel, columnLabel) {
  if (!speechSynthesisSupported || typeof SpeechSynthesisUtterance === "undefined") return;
  try {
    window.speechSynthesis.cancel();
  } catch (error) {
    /* ignore speech cancellation errors */
  }

  const categoryText = categoryLabel ?? "your announced category";
  const columnText = columnLabel ? ` in the ${columnLabel} column` : "";
  const utterance = new SpeechSynthesisUtterance(`Announcement — ${categoryText}.`);
  const documentLang = document.documentElement?.lang;
  if (documentLang) {
    utterance.lang = documentLang;
  }
  utterance.rate = 0.80;
  utterance.pitch = 1.00;

  try {
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.warn("Could not speak announcement", error);
  }
}

function triggerAnnounceAudio(category, column) {
  playAnnounceChime();
  speakAnnouncement(category, column);
}

// Parallax disabled - background is now static
// setupParallaxScene();
renderTable();
restoreTheme();
updateUI();
attachEvents();
setupWakeLockControl();
setupBackToDiceButton();

// Pass setScore callback to gameModeManager to avoid circular dependency
gameModeManager.setSetScoreCallback(setScore);

// Initialize game mode on page load
if (gameModeManager.isVirtualMode()) {
  gameModeManager.showVirtualDicePanel();
  gameModeManager.disableScorecardInputs();
}

/**
 * Setup the "Back to Virtual Dice" floating action button
 * Shows on mobile when scrolled past the virtual dice panel
 */
function setupBackToDiceButton() {
  const backButton = document.getElementById('back-to-dice-button');
  if (!backButton) return;
  
  let scrollTimeout;
  let isVirtualMode = false;
  let isScrollingToPanel = false; // Flag to prevent showing during scroll animation
  
  // Check if we're in virtual mode
  const checkVirtualMode = () => {
    isVirtualMode = gameModeManager && gameModeManager.isVirtualMode();
    return isVirtualMode;
  };
  
  // Update button visibility based on scroll position
  const updateButtonVisibility = () => {
    // Don't show button if we're currently scrolling to panel
    if (isScrollingToPanel) {
      backButton.classList.remove('visible');
      return;
    }
    
    // Always check current mode first
    const inVirtualMode = checkVirtualMode();
    
    if (!inVirtualMode) {
      backButton.classList.remove('visible');
      return;
    }
    
    const virtualPanel = document.getElementById('virtual-dice-main-panel');
    if (!virtualPanel || virtualPanel.style.display === 'none') {
      backButton.classList.remove('visible');
      return;
    }
    
    // Get the bottom position of the virtual dice panel
    const panelRect = virtualPanel.getBoundingClientRect();
    const panelBottom = panelRect.bottom;
    
    // Show button if we've scrolled past the virtual dice panel
    // Reduced buffer to 50px so it appears sooner
    if (panelBottom < 50) {
      backButton.classList.add('visible');
    } else {
      backButton.classList.remove('visible');
    }
  };
  
  // Handle scroll events with throttling
  const handleScroll = () => {
    if (scrollTimeout) {
      window.cancelAnimationFrame(scrollTimeout);
    }
    scrollTimeout = window.requestAnimationFrame(() => {
      updateButtonVisibility();
    });
  };
  
  // Handle button click - scroll to virtual dice panel
  backButton.addEventListener('click', () => {
    const virtualPanel = document.getElementById('virtual-dice-main-panel');
    if (!virtualPanel) return;
    
    // Set flag to prevent button from showing during scroll
    isScrollingToPanel = true;
    backButton.classList.remove('visible');
    
    const panelTop = virtualPanel.getBoundingClientRect().top + window.pageYOffset;
    const offset = 20; // Small offset from top
    
    window.scrollTo({
      top: panelTop - offset,
      behavior: 'smooth'
    });
    
    // Reset flag after scroll animation completes (smooth scroll takes ~500-800ms)
    setTimeout(() => {
      isScrollingToPanel = false;
    }, 1000);
  });
  
  // Listen to scroll events
  window.addEventListener('scroll', handleScroll, { passive: true });
  
  // Initial check after a short delay to allow virtual panel to be created
  setTimeout(() => {
    updateButtonVisibility();
  }, 100);
  
  // Re-check when game mode might change
  const observer = new MutationObserver(() => {
    // Debounce the update
    setTimeout(updateButtonVisibility, 50);
  });
  
  // Watch for changes in the layout (e.g., virtual panel being added/removed)
  const layout = document.querySelector('.layout');
  if (layout) {
    observer.observe(layout, {
      childList: true,
      subtree: false
    });
  }
  
  // Also check on window resize (viewport changes)
  window.addEventListener('resize', () => {
    if (scrollTimeout) {
      window.cancelAnimationFrame(scrollTimeout);
    }
    scrollTimeout = window.requestAnimationFrame(updateButtonVisibility);
  }, { passive: true });
}

function renderTable() {
  tableBody.innerHTML = "";

  categories.forEach((category) => {
    const row = document.createElement("tr");
    if (category.style === "total") row.classList.add("total-row");
    if (category.style === "total-strong") row.classList.add("total-row", "total-strong");

    const headerCell = document.createElement("th");
    headerCell.scope = "row";
    if (category.hint) headerCell.title = category.hint;

    const labelWrapper = document.createElement("div");
    labelWrapper.className = "category-label";

    if (category.dieFace) {
      const die = createDieElement(category.dieFace);
      labelWrapper.appendChild(die);
    }

    const textContainer = document.createElement("div");
    textContainer.className = "label-content";

    const textWrapper = document.createElement("span");
    textWrapper.className = "label-text";
    textWrapper.textContent = category.label;
    textContainer.appendChild(textWrapper);

    if (category.subLabel) {
      const detailLines = Array.isArray(category.subLabel)
        ? category.subLabel
        : [category.subLabel];
      detailLines.forEach((line) => {
        if (!line) return;
        const detail = document.createElement("span");
        detail.className = "label-detail";
        detail.textContent = line;
        textContainer.appendChild(detail);
      });
    }

    labelWrapper.appendChild(textContainer);

    if (category.dieFace) {
      labelWrapper.classList.add("die-only");
    }

    if (category.hint) {
      const openHint = () => openHintDialog(category.label, category.hint);
      labelWrapper.classList.add("has-hint");
      labelWrapper.tabIndex = 0;
      labelWrapper.setAttribute("role", "button");
      labelWrapper.setAttribute("aria-label", `${category.label} details`);
      labelWrapper.addEventListener("click", openHint);
      labelWrapper.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openHint();
        }
      });
    }

    headerCell.appendChild(labelWrapper);
    row.appendChild(headerCell);

    columns.forEach((column) => {
      const key = `${category.key}:${column.key}`;
      const cell = document.createElement("td");
      cell.dataset.column = column.key;

      if (category.input) {
        const input = document.createElement("input");
        input.type = "number";
        input.min = category.key === "min" ? "5" : "0";
        input.step = "1";
        input.inputMode = "numeric";
        input.pattern = "[0-9]*";
        input.className = "score-input";
        input.dataset.category = category.key;
        input.dataset.column = column.key;
        input.placeholder = category.key === "straight" ? "-" : "–";
        const entryMode =
          category.key === "straight"
            ? "straight"
            : column.key === "announce"
              ? "announce"
              : "numeric";
        input.dataset.entryMode = entryMode;
        input.addEventListener("focus", handleInputFocus);

        if (category.key === "straight") {
          input.readOnly = true;
          input.addEventListener("click", handleStraightTrigger);
          input.addEventListener("keydown", handleStraightKeydown);
        } else if (entryMode === "announce") {
          input.readOnly = true;
          input.addEventListener("click", handleAnnounceTrigger);
          input.addEventListener("keydown", handleAnnounceKeydown);
        } else {
          input.addEventListener("input", handleTyping);
          input.addEventListener("blur", handleCommit);
          input.addEventListener("keydown", handleInputKeydown);
        }

        cell.appendChild(input);
        inputRegistry.set(key, input);
      }

      cell.dataset.category = category.key;

      cellRegistry.set(key, cell);
      row.appendChild(cell);
    });

    tableBody.appendChild(row);
  });
}

function attachEvents() {
  const gameModeButton = document.getElementById("game-mode-button");
  gameModeButton?.addEventListener("click", () => {
    gameModeManager.showGameModeDialog();
  });

  resetButton?.addEventListener("click", openResetDialog);

  settingsButton?.addEventListener("click", openSettingsDialog);

  settingsDialogActions.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.settingsAction;
      if (settingsDialog?.open) {
        settingsDialog.close(action ?? "cancel");
      }
      if (action === "export") {
        window.setTimeout(() => {
          openExportDialog();
        }, 0);
      } else if (action === "import") {
        window.setTimeout(() => {
          openImportDialog();
        }, 0);
      }
    });
  });

  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      const value = themeToggle.checked ? "dark" : "light";
      applyTheme(value);
      try {
        localStorage.setItem(THEME_KEY, value);
      } catch (error) {
        console.warn("Could not persist theme preference", error);
      }
    });
  }

  if (importDialogForm) {
    importDialogForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleImportSubmit();
    });
  }

  if (resetDialogForm) {
    resetDialogForm.addEventListener("submit", (event) => {
      event.preventDefault();
      resetDialog?.close("confirm");
    });
  }
}

function handleInputFocus(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  input.dataset.error = "false";
  input.setCustomValidity("");
  if (input.dataset.entryMode !== "straight" && !input.readOnly) {
    requestAnimationFrame(() => {
      try {
        input.select();
      } catch (error) {
        /* ignore selection errors, e.g. on mobile */
      }
    });
  }
}

function handleTyping(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  input.dataset.error = "false";
  input.setCustomValidity("");
}

function handleCommit(event) {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    commitInput(input);
  }
}

function handleInputKeydown(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  if (event.key === "Enter") {
    event.preventDefault();
    commitInput(input);
    input.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    const columnState = state[input.dataset.column ?? ""] ?? {};
    const previousValue = columnState[input.dataset.category ?? ""];
    input.value = previousValue ?? "";
    input.blur();
  }
}

function handleStraightTrigger(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  openStraightDialogForInput(input);
}

function handleStraightKeydown(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openStraightDialogForInput(input);
  } else if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    input.value = "";
    commitInput(input);
  } else if (event.key === "Escape") {
    event.preventDefault();
    input.blur();
  }
}

function commitInput(input) {
  if (!(input instanceof HTMLInputElement)) return;

  const columnKey = input.dataset.column;
  const categoryKey = input.dataset.category;
  if (!columnKey || !categoryKey) return;

  const columnState = state[columnKey] ?? (state[columnKey] = {});
  const previousValue = columnState[categoryKey];
  const raw = input.value.trim();

  if (raw === "") {
    if (previousValue !== undefined) {
      delete columnState[categoryKey];
      saveState();
      updateUI();
    } else {
      input.dataset.isFilled = "false";
    }
    return;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    const category = categories.find((cat) => cat.key === categoryKey);
    openInfoDialog(category?.label ?? "Invalid entry", "Please enter a valid number.");
    input.value = previousValue ?? "";
    updateUI();
    return;
  }

  if (!isCategoryValueAllowed(categoryKey, numeric)) {
    const category = categories.find((cat) => cat.key === categoryKey);
    const message = getValidationMessage(categoryKey);
    openInfoDialog(category?.label ?? "Invalid combination", message);
    input.value = previousValue ?? "";
    updateUI();
    return;
  }

  const sequentialIssue = getSequentialFailure(columnKey, categoryKey, columnState);
  if (sequentialIssue) {
    input.dataset.error = "true";
    input.setCustomValidity(sequentialIssue.message);
    const column = columns.find((col) => col.key === columnKey);
    const title = column ? `${column.label} column rule` : "Sequence rule";
    openInfoDialog(title, sequentialIssue.message);
    input.value = previousValue ?? "";
    updateUI();
    return;
  }

  if (previousValue === numeric) {
    return;
  }

  columnState[categoryKey] = numeric;
  saveState();
  updateUI();
}

function openStraightDialogForInput(input) {
  if (!(input instanceof HTMLInputElement)) return;
  
  // Check if virtual dice mode is active
  if (gameModeManager && gameModeManager.shouldUseVirtualDice()) {
    // Virtual dice mode - don't open dialog, inputs are disabled
    return;
  }
  
  const columnKey = input.dataset.column;
  const column = columns.find((item) => item.key === columnKey);
  const shouldAnnounce = column?.key === "announce";

  if (!straightDialog || typeof straightDialog.showModal !== "function") {
    if (shouldAnnounce) {
      triggerAnnounceAudio("Straight", column?.label);
    }
    openInfoDialog(
      "Straight scoring",
      "Small straight: 1-2-3-4-5 → 35 pts\nBig straight: 2-3-4-5-6 → 45 pts\nMissed straight: 0 pts"
    );
    return;
  }

  pendingStraightInput = input;
  if (straightDialogTitle) {
    straightDialogTitle.textContent = column ? `Straight — ${column.label}` : "Select straight type";
  }
  if (straightDialogDescription) {
    straightDialogDescription.textContent = column
      ? `You're filling the ${column.label} column. Pick the straight you rolled.`
      : "Pick the straight you rolled for this column.";
  }

  if (straightDialog.open) {
    return;
  }

  if (shouldAnnounce) {
    triggerAnnounceAudio("Straight", column?.label);
  }
  showDialog(straightDialog);
}

function handleStraightSelection(value) {
  const input = pendingStraightInput;
  if (straightDialog?.open) {
    straightDialog.close();
  }
  pendingStraightInput = null;

  if (!(input instanceof HTMLInputElement)) return;

  input.value = value;

  commitInput(input);
}

function openAnnounceDialogForInput(input) {
  if (!(input instanceof HTMLInputElement)) return;

  if (!announceDialog || typeof announceDialog.showModal !== "function") {
    const category = categories.find((cat) => cat.key === input.dataset.category);
    const promptLabel = category ? `Enter score for ${category.label}:` : "Enter announced score:";
    const response = window.prompt(promptLabel, input.value ?? "");
    if (response === null) return;
    input.value = response.trim();
    commitInput(input);
    return;
  }

  pendingAnnounceInput = input;

  const column = columns.find((col) => col.key === input.dataset.column);
  const category = categories.find((cat) => cat.key === input.dataset.category);

  if (announceDialogTitle) {
    const label = category?.label;
    announceDialogTitle.textContent = label ? `Announce — ${label}` : "Announce roll";
  }

  if (announceDialogMessage) {
    if (category) {
      const columnHint = column ? ` in the ${column.label} column` : "";
      announceDialogMessage.textContent = `Waiting for your announced roll for ${category.label}${columnHint}. Enter the score once you're ready.`;
    } else {
      announceDialogMessage.textContent = "Waiting for your announced roll. Enter the score once you're ready.";
    }
  }

  if (announceDialogInput) {
    announceDialogInput.value = input.value ?? "";
    announceDialogInput.dataset.column = input.dataset.column ?? "";
    announceDialogInput.dataset.category = input.dataset.category ?? "";
    announceDialogInput.setCustomValidity("");
    if (!prefersDesktopInteraction) {
      announceDialogInput.blur();
    }
  }

  if (announceDialog) {
    announceDialog.scrollTop = 0;
  }

  startAnnounceRolling();
  triggerAnnounceAudio(category?.label, column?.label);
  showDialog(announceDialog);

  if (prefersDesktopInteraction) {
    requestAnimationFrame(() => {
      if (announceDialogInput) {
        try {
          announceDialogInput.focus();
          announceDialogInput.select();
        } catch (error) {
          /* ignore focus errors */
        }
      }
    });
  } else if (announceDialog) {
    requestAnimationFrame(() => {
      try {
        announceDialog.focus({ preventScroll: true });
      } catch (error) {
        try {
          announceDialog.focus();
        } catch (focusError) {
          /* ignore focus errors */
        }
      }
    });
  }
}

function handleAnnounceTrigger(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  
  // Check if virtual dice mode is active
  if (gameModeManager && gameModeManager.shouldUseVirtualDice()) {
    // Virtual dice mode - don't open dialog, inputs are disabled
    event.preventDefault();
    return;
  }
  
  openAnnounceDialogForInput(input);
}

function handleAnnounceKeydown(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openAnnounceDialogForInput(input);
  } else if (event.key === "Escape") {
    event.preventDefault();
    input.blur();
  } else if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    input.value = "";
    commitInput(input);
  }
}

function handleAnnounceDialogClose() {
  stopAnnounceRolling();

  if (announceRoller) {
    announceRoller.innerHTML = "";
  }

  const input = pendingAnnounceInput;
  if (!(input instanceof HTMLInputElement)) {
    pendingAnnounceInput = null;
    if (announceDialogInput) announceDialogInput.value = "";
    return;
  }

  const action = announceDialog?.returnValue ?? "";
  if (action === "confirm" || action === "clear") {
    const value = action === "clear" ? "" : announceDialogInput?.value.trim() ?? "";
    input.value = value;
    commitInput(input);
  }

  pendingAnnounceInput = null;

  if (announceDialogInput) {
    announceDialogInput.value = "";
    announceDialogInput.dataset.column = "";
    announceDialogInput.dataset.category = "";
  }
}

function openSettingsDialog() {
  if (!showDialog(settingsDialog)) {
    openInfoDialog("Settings unavailable", "Dialogs are not supported in this browser.");
    return;
  }

  requestAnimationFrame(() => {
    const firstAction = settingsDialogActions[0];
    try {
      firstAction?.focus();
    } catch (error) {
      /* ignore focus issues */
    }
  });
}

function openResetDialog() {
  if (!showDialog(resetDialog)) {
    const shouldReset = window.confirm("Clear every column and start fresh?");
    if (!shouldReset) return;
    performReset();
  }
}

function handleResetDialogClose(result) {
  if (result === "confirm") {
    performReset();
  }
}

function performReset() {
  state = createEmptyState();
  lastCompletionSignature = null;
  saveState();
  updateUI();
}

function openExportDialog() {
  const payload = {
    exportedAt: new Date().toISOString(),
    state
  };

  if (exportTextarea) {
    exportTextarea.value = JSON.stringify(payload, null, 2);
  }

  if (!showDialog(exportDialog)) {
    window.alert("Dialog not supported. Copy the JSON from the text area: \n\n" + (exportTextarea?.value ?? ""));
    return;
  }

  requestAnimationFrame(() => {
    try {
      exportTextarea?.focus();
      exportTextarea?.select();
    } catch (error) {
      /* ignore focus issues */
    }
  });
}

function openImportDialog() {
  if (importTextarea) {
    importTextarea.value = "";
  }
  if (!showDialog(importDialog)) {
    const pasted = window.prompt("Paste the exported JSON to import:", "");
    if (!pasted) return;
    if (processImportPayload(pasted)) {
      openInfoDialog("Import complete", "Your sheet has been updated with the imported scores.");
    }
  }
}

function handleImportSubmit() {
  if (!importTextarea) return;
  const raw = importTextarea.value.trim();
  if (!raw) {
    openInfoDialog("No data", "Paste an exported JSON payload before importing.");
    return;
  }

  if (!processImportPayload(raw)) {
    return;
  }

  importDialog?.close("confirm");
  openInfoDialog("Import complete", "Your sheet has been updated with the imported scores.");
}

function processImportPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    openInfoDialog("Import failed", "The provided JSON could not be parsed. Please check the format and try again.");
    return false;
  }

  const stateCandidate = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.state ?? parsed : null;
  if (!stateCandidate || typeof stateCandidate !== "object") {
    openInfoDialog("Import failed", "The JSON must contain a root object with a 'state' property or column data.");
    return false;
  }

  const normalized = normalizeImportedState(stateCandidate);
  const errors = validateImportedState(normalized);

  if (errors.length > 0) {
    const message = `Some entries were invalid and prevented the import:\n\n${errors
      .slice(0, 8)
      .map((item) => `• ${item}`)
      .join("\n")}${errors.length > 8 ? "\n\n…and more" : ""}`;
    openInfoDialog("Import failed", message);
    return false;
  }

  state = normalized;
  lastCompletionSignature = null;
  saveState();
  updateUI();
  return true;
}

function normalizeImportedState(rawState) {
  const result = createEmptyState();

  columns.forEach((column) => {
    const source = rawState[column.key];
    if (!source || typeof source !== "object") return;
    inputCategories.forEach((category) => {
      if (!Object.prototype.hasOwnProperty.call(source, category.key)) return;
      const rawValue = source[category.key];
      if (rawValue === "" || rawValue === null || rawValue === undefined) return;
      const numeric = Number(rawValue);
      if (Number.isFinite(numeric)) {
        result[column.key][category.key] = numeric;
      }
    });
  });

  return result;
}

function validateImportedState(candidateState) {
  const errors = [];
  columns.forEach((column) => {
    const columnState = candidateState[column.key] ?? {};
    inputCategories.forEach((category) => {
      if (!hasCategoryValue(columnState, category.key)) return;
      const value = columnState[category.key];
      if (!isCategoryValueAllowed(category.key, value)) {
        errors.push(`${column.label} — ${category.label} (${value})`);
      }
    });
  });
  return errors;
}

function maybeShowCompletion() {
  if (!completionDialog) return;
  if (!isBoardComplete(state)) {
    lastCompletionSignature = null;
    return;
  }

  const signature = computeStateSignature(state);
  if (signature === lastCompletionSignature) {
    return;
  }

  lastCompletionSignature = signature;
  openCompletionDialog();
}

function isBoardComplete(currentState) {
  return columns.every((column) => {
    const columnState = currentState[column.key] ?? {};
    return inputCategories.every((category) => {
      if (!hasCategoryValue(columnState, category.key)) return false;
      const value = columnState[category.key];
      return value !== "" && value !== null && value !== undefined;
    });
  });
}

function computeStateSignature(currentState) {
  const snapshot = columns.map((column) => {
    const columnState = currentState[column.key] ?? {};
    const values = inputCategories.map((category) => columnState[category.key] ?? null);
    return { column: column.key, values };
  });
  return JSON.stringify(snapshot);
}

function openCompletionDialog() {
  const totals = columns.map((column) => {
    const derived = derivedByColumn[column.key] ?? computeColumnDerived(state[column.key] ?? {});
    return {
      key: column.key,
      label: column.label,
      total: derived?.grandTotal ?? 0,
      upper: derived?.upperTotal ?? 0,
      lower: derived?.lowerSubtotal ?? 0
    };
  });

  renderCompletionSummary(totals);

  const champion = [...totals].sort((a, b) => b.total - a.total)[0];
  const overallTotal = totals.reduce((sum, entry) => sum + (entry.total ?? 0), 0);

  if (completionDialogTitle) {
    completionDialogTitle.textContent = `Grand total — ${formatScore(overallTotal)}`;
  }

  if (completionMessage) {
    const overallLine = `All columns are locked in. Your grand total is ${formatScore(overallTotal)} points.`;
    completionMessage.textContent = champion
      ? `${overallLine} ${champion.label} led with ${formatScore(champion.total)}.`
      : overallLine;
  }

  if (!completionDialog || typeof completionDialog.showModal !== "function") {
    const highest = champion ? `Top column: ${champion.label} — ${formatScore(champion.total)} pts` : "";
    window.alert(`Grand total: ${formatScore(overallTotal)} pts${highest ? `\n${highest}` : ""}`);
    return;
  }

  launchConfetti();
  showDialog(completionDialog);
}

function renderCompletionSummary(totals) {
  if (!completionSummaryList) return;
  completionSummaryList.innerHTML = "";

  const sorted = [...totals].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label);
  });

  sorted.forEach((entry, index) => {
    const item = document.createElement("li");
    if (index === 0) {
      item.dataset.placement = "top";
    }

    const labelWrapper = document.createElement("div");
    labelWrapper.className = "summary-label";
    const name = document.createElement("span");
    name.className = "summary-name";
    name.textContent = entry.label;
    const detail = document.createElement("span");
    detail.className = "summary-detail";
    detail.textContent = `Upper ${formatScore(entry.upper)} • Lower ${formatScore(entry.lower)}`;
    labelWrapper.append(name, detail);

    const score = document.createElement("span");
    score.className = "summary-score";
    score.textContent = formatScore(entry.total);

    item.append(labelWrapper, score);
    completionSummaryList.appendChild(item);
  });
}

function launchConfetti() {
  if (!confettiStage) return;
  clearConfetti();
  const colors = ["#4f46e5", "#a855f7", "#22d3ee", "#f97316", "#facc15", "#34d399", "#ec4899"];
  const pieces = 36;
  for (let index = 0; index < pieces; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    const color = colors[index % colors.length];
    piece.style.setProperty("--confetti-color", color);
    piece.style.setProperty("--confetti-left", `${Math.random() * 100}%`);
    piece.style.setProperty("--confetti-delay", `${Math.random() * 0.8}s`);
    piece.style.setProperty("--confetti-duration", `${2.5 + Math.random()}s`);
    piece.style.setProperty("--confetti-rotate", `${Math.random() * 360}deg`);
    confettiStage.appendChild(piece);
  }
}

function clearConfetti() {
  if (!confettiStage) return;
  confettiStage.innerHTML = "";
}

function playCompletionDemo() {
  const nextState = createEmptyState();
  columns.forEach((column) => {
    const demoColumn = demoCompletionSheet[column.key];
    if (!demoColumn) return;
    nextState[column.key] = { ...demoColumn };
  });

  state = nextState;
  lastCompletionSignature = null;
  saveState();
  updateUI();
}

window.playCompletionDemo = playCompletionDemo;

function updateUI() {
  derivedByColumn = {};

  columns.forEach((column) => {
    const columnState = state[column.key] ?? (state[column.key] = {});
    const derived = computeColumnDerived(columnState);
    derivedByColumn[column.key] = derived;

    categories.forEach((category) => {
      const cellKey = `${category.key}:${column.key}`;
      const cell = cellRegistry.get(cellKey);

      if (!cell) return;

      if (category.input) {
        const input = inputRegistry.get(cellKey);
        if (!input) return;
        const rawValue = columnState[category.key];
        input.value = rawValue ?? "";
        input.dataset.isFilled = rawValue !== undefined && rawValue !== "" ? "true" : "false";
        input.dataset.error = "false";
        input.setCustomValidity("");
      } else {
        const value = getCategoryValue(columnState, derived, category.key);
        cell.textContent = formatScore(value);
      }
    });
  });

  updateSummary();
  updateOverallGrandTotal();
  maybeShowCompletion();
}

function updateOverallGrandTotal() {
  if (!overallGrandTotalCell) return;
  const total = columns.reduce((sum, column) => {
    const derived = derivedByColumn[column.key];
    return sum + (derived?.grandTotal ?? 0);
  }, 0);
  overallGrandTotalCell.textContent = formatScore(total);
}

function updateSummary() {
  summaryList.innerHTML = "";
  const totals = columns.map((column) => ({ key: column.key, total: derivedByColumn[column.key]?.grandTotal ?? 0 }));
  const maxTotal = Math.max(...totals.map(({ total }) => total));
  const minTotal = Math.min(...totals.map(({ total }) => total));

  columns.forEach((column) => {
    const derived = derivedByColumn[column.key];
    const upper = derived?.upperTotal ?? 0;
    const lower = derived?.lowerSubtotal ?? 0;
    const total = derived?.grandTotal ?? 0;

    const item = document.createElement("li");
    item.className = "summary-item";

    if (total === maxTotal && maxTotal !== minTotal) item.dataset.trend = "up";
    if (total === minTotal && maxTotal !== minTotal) item.dataset.trend = "down";

    const title = document.createElement("h3");
    title.textContent = column.label;

    const value = document.createElement("span");
  value.className = "summary-value";
    value.textContent = formatScore(total);

    const detail = document.createElement("small");
  detail.className = "summary-detail";
    detail.textContent = `Upper ${formatScore(upper)} • Lower ${formatScore(lower)}`;

    item.append(title, value, detail);
    summaryList.appendChild(item);
  });
}

function openHintDialog(label, message) {
  if (!message) return;
  openInfoDialog(label ?? "Tip", message);
}

function openInfoDialog(title, message) {
  if (!message) return;

  if (!infoDialog || typeof infoDialog.showModal !== "function") {
    const heading = title ?? "Info";
    window.alert(`${heading}\n\n${message}`);
    return;
  }

  if (infoDialogTitle) {
    infoDialogTitle.textContent = title ?? "Info";
  }
  if (infoDialogBody) {
    infoDialogBody.textContent = message;
  }

  showDialog(infoDialog);
}

function formatScore(number) {
  const value = Number(number);
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toLocaleString();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not persist Yamb scores", error);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    const parsed = JSON.parse(raw);
    return columns.reduce((acc, column) => {
      acc[column.key] = parsed[column.key] ?? {};
      return acc;
    }, createEmptyState());
  } catch (error) {
    console.warn("Could not load saved Yamb scores", error);
    return createEmptyState();
  }
}

function restoreTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored) {
      applyTheme(stored);
      if (themeToggle) themeToggle.checked = stored === "dark";
    }
  } catch (error) {
    console.warn("Could not restore theme preference", error);
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
}

/**
 * Public API for programmatically setting scores (used by virtual dice)
 * @param {string} categoryKey - The category key (e.g., 'ones', 'tris', 'full')
 * @param {string} columnKey - The column key (e.g., 'down', 'up', 'free', 'announce')
 * @param {number} value - The score value
 * @returns {boolean} - True if successful, false if validation failed
 */
export function setScore(categoryKey, columnKey, value) {
  if (!columnKey || !categoryKey) {
    console.error('Invalid category or column key');
    return false;
  }

  const columnState = state[columnKey] ?? (state[columnKey] = {});
  const numeric = Number(value);
  
  if (!Number.isFinite(numeric)) {
    console.error('Invalid numeric value:', value);
    return false;
  }

  if (!isCategoryValueAllowed(categoryKey, numeric)) {
    console.error('Value not allowed for category:', categoryKey, numeric);
    return false;
  }

  const sequentialIssue = getSequentialFailure(columnKey, categoryKey, columnState);
  if (sequentialIssue) {
    console.error('Sequential validation failed:', sequentialIssue.message);
    return false;
  }

  // Set the value in state
  columnState[categoryKey] = numeric;
  
  // Update the input element to reflect the change
  const input = document.querySelector(
    `.score-input[data-category="${categoryKey}"][data-column="${columnKey}"]`
  );
  if (input) {
    input.value = numeric;
    input.dataset.isFilled = "true";
    input.dataset.error = "false";
    input.setCustomValidity("");
  }
  
  // Save and update UI
  saveState();
  updateUI();
  
  return true;
}
