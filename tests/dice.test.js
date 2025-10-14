import { describe, it, expect } from "vitest";
import {
  rollDie,
  rollDice,
  createDiceState,
  rollDiceWithLocked,
  toggleDiceLock,
  countFaces,
  maxOfAKind,
  isStraight,
  isFullHouse,
  isPoker,
  isYamb,
  sumDice,
} from "../scripts/dice.js";

describe("Dice Rolling", () => {
  it("should roll a die between 1 and 6", () => {
    for (let i = 0; i < 100; i++) {
      const value = rollDie();
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it("should roll 5 dice by default", () => {
    const dice = rollDice();
    expect(dice).toHaveLength(5);
    dice.forEach((die) => {
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(6);
    });
  });

  it("should create initial dice state", () => {
    const state = createDiceState();
    expect(state.values).toHaveLength(5);
    expect(state.locked).toHaveLength(5);
    expect(state.locked.every((l) => l === false)).toBe(true);
    expect(state.rollsRemaining).toBe(3);
    expect(state.announced).toBeNull();
  });

  it("should decrement rolls remaining when rolling", () => {
    let state = createDiceState();
    expect(state.rollsRemaining).toBe(3);

    state = rollDiceWithLocked(state);
    expect(state.rollsRemaining).toBe(2);

    state = rollDiceWithLocked(state);
    expect(state.rollsRemaining).toBe(1);

    state = rollDiceWithLocked(state);
    expect(state.rollsRemaining).toBe(0);
  });

  it("should not allow rolling when rolls remaining is 0", () => {
    let state = createDiceState();
    state = rollDiceWithLocked(state);
    state = rollDiceWithLocked(state);
    state = rollDiceWithLocked(state);

    const beforeRoll = state;
    state = rollDiceWithLocked(state);
    expect(state).toEqual(beforeRoll);
  });

  it("should keep locked dice values", () => {
    let state = createDiceState();
    state.values = [1, 2, 3, 4, 5];

    // Roll first time
    state = rollDiceWithLocked(state);

    // Lock first and last dice
    state = toggleDiceLock(state, 0);
    state = toggleDiceLock(state, 4);

    const lockedValues = [state.values[0], state.values[4]];

    // Roll again
    state = rollDiceWithLocked(state);

    // Check locked dice kept their values
    expect(state.values[0]).toBe(lockedValues[0]);
    expect(state.values[4]).toBe(lockedValues[1]);
  });

  it("should toggle dice lock state", () => {
    let state = createDiceState();
    expect(state.locked[0]).toBe(false);

    state = toggleDiceLock(state, 0);
    expect(state.locked[0]).toBe(true);

    state = toggleDiceLock(state, 0);
    expect(state.locked[0]).toBe(false);
  });
});

describe("Dice Calculations", () => {
  it("should sum dice correctly", () => {
    expect(sumDice([1, 2, 3, 4, 5])).toBe(15);
    expect(sumDice([6, 6, 6, 6, 6])).toBe(30);
    expect(sumDice([1, 1, 1, 1, 1])).toBe(5);
  });

  it("should count face occurrences", () => {
    const counts = countFaces([1, 1, 2, 3, 3]);
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBe(1);
    expect(counts[3]).toBe(2);
    expect(counts[4]).toBe(0);
  });

  it("should find max of a kind", () => {
    expect(maxOfAKind([1, 1, 1, 2, 3])).toBe(3);
    expect(maxOfAKind([6, 6, 6, 6, 5])).toBe(4);
    expect(maxOfAKind([2, 2, 2, 2, 2])).toBe(5);
    expect(maxOfAKind([1, 2, 3, 4, 5])).toBe(1);
  });

  it("should detect straights", () => {
    expect(isStraight([1, 2, 3, 4, 5])).toBe(true);
    expect(isStraight([2, 3, 4, 5, 6])).toBe(true);
    expect(isStraight([5, 4, 3, 2, 1])).toBe(true); // Order doesn't matter
    expect(isStraight([1, 2, 3, 4, 6])).toBe(false);
    expect(isStraight([1, 1, 2, 3, 4])).toBe(false);
  });

  it("should detect full house", () => {
    expect(isFullHouse([1, 1, 1, 2, 2])).toBe(true);
    expect(isFullHouse([3, 3, 5, 5, 5])).toBe(true);
    expect(isFullHouse([1, 1, 1, 1, 2])).toBe(false);
    expect(isFullHouse([1, 2, 3, 4, 5])).toBe(false);
  });

  it("should detect poker (4 of a kind)", () => {
    expect(isPoker([1, 1, 1, 1, 2])).toBe(true);
    expect(isPoker([3, 3, 3, 3, 6])).toBe(true);
    expect(isPoker([5, 5, 5, 5, 5])).toBe(true); // Yamb is also poker
    expect(isPoker([1, 1, 1, 2, 3])).toBe(false);
  });

  it("should detect yamb (5 of a kind)", () => {
    expect(isYamb([1, 1, 1, 1, 1])).toBe(true);
    expect(isYamb([6, 6, 6, 6, 6])).toBe(true);
    expect(isYamb([3, 3, 3, 3, 6])).toBe(false);
    expect(isYamb([1, 2, 3, 4, 5])).toBe(false);
  });
});
