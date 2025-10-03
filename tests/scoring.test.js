import { describe, it, expect } from "vitest";
import {
  computeColumnDerived,
  getCategoryValue,
  createEmptyState,
  categories,
  columns,
  isCategoryValueAllowed
} from "../scripts/scoring.js";

describe("computeColumnDerived", () => {
  it("calculates upper totals, bonus, and grand total", () => {
    const column = {
      ones: 5,
      twos: 12,
      threes: 15,
      fours: 16,
      fives: 20,
      sixes: 24,
      max: 50,
      min: 10,
      tris: 28,
      straight: 45,
      full: 58,
      poker: 64,
      yamb: 80
    };

    const derived = computeColumnDerived(column);

    expect(derived.upperSubtotal).toBe(92);
    expect(derived.bonus).toBe(30);
    expect(derived.upperTotal).toBe(122);
    expect(derived.diff).toBe((50 - 10) * 5);
    expect(derived.lowerSubtotal).toBe(28 + 45 + 58 + 64 + 80);
    expect(derived.grandTotal).toBe(derived.upperTotal + derived.diff + derived.lowerSubtotal);
  });

  it("handles missing values gracefully", () => {
    const derived = computeColumnDerived({});
    expect(derived.upperSubtotal).toBe(0);
    expect(derived.bonus).toBe(0);
    expect(derived.diff).toBe(0);
    expect(derived.lowerSubtotal).toBe(0);
    expect(derived.grandTotal).toBe(0);
  });

  it("returns zero diff when max or min missing", () => {
    const derived = computeColumnDerived({ ones: 4, max: 60 });
    expect(derived.diff).toBe(0);
  });
});

describe("getCategoryValue", () => {
  it("pulls raw value or derived values correctly", () => {
    const columnState = { ones: 3, twos: 6 };
    const derived = computeColumnDerived(columnState);

    expect(getCategoryValue(columnState, derived, "ones")).toBe(3);
    expect(getCategoryValue(columnState, derived, "upperSubtotal")).toBe(9);
  });
});

describe("createEmptyState", () => {
  it("creates an object with keys for each column", () => {
    const state = createEmptyState();
    expect(Object.keys(state)).toEqual(columns.map((column) => column.key));
  });

  it("does not share references between columns", () => {
    const state = createEmptyState();
    state.down.ones = 5;
    expect(state.up.ones).toBeUndefined();
  });
});

describe("isCategoryValueAllowed", () => {
  it("allows only valid upper-section totals", () => {
    expect(isCategoryValueAllowed("ones", 3)).toBe(true);
    expect(isCategoryValueAllowed("ones", 7)).toBe(false);
    expect(isCategoryValueAllowed("sixes", 24)).toBe(true);
    expect(isCategoryValueAllowed("sixes", 26)).toBe(false);
  });

  it("enforces tris, straight, full, poker, and yamb options", () => {
    expect(isCategoryValueAllowed("tris", 28)).toBe(true);
    expect(isCategoryValueAllowed("tris", 14)).toBe(false);
    expect(isCategoryValueAllowed("straight", 0)).toBe(true);
    expect(isCategoryValueAllowed("straight", 35)).toBe(true);
    expect(isCategoryValueAllowed("straight", 45)).toBe(true);
    expect(isCategoryValueAllowed("straight", 30)).toBe(false);
    expect(isCategoryValueAllowed("full", 58)).toBe(true);
    expect(isCategoryValueAllowed("full", 40)).toBe(false);
    expect(isCategoryValueAllowed("poker", 64)).toBe(true);
    expect(isCategoryValueAllowed("poker", 100)).toBe(false);
    expect(isCategoryValueAllowed("yamb", 80)).toBe(true);
    expect(isCategoryValueAllowed("yamb", 90)).toBe(false);
  });

  it("permits valid max/min ranges", () => {
    expect(isCategoryValueAllowed("max", 25)).toBe(true);
    expect(isCategoryValueAllowed("max", 45)).toBe(false);
    expect(isCategoryValueAllowed("min", 5)).toBe(true);
    expect(isCategoryValueAllowed("min", 4)).toBe(false);
  });
});
