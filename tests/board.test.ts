import { describe, expect, test } from "bun:test";
import {
  STARTING_SQUARES,
  algebraicToSquare,
  cloneBoard,
  emptyBoard,
  fileOf,
  idx,
  initialBoard,
  rankOf,
  squareToAlgebraic,
} from "../shared/board";

describe("coordinate helpers", () => {
  test("known square indices", () => {
    expect(algebraicToSquare("a1")).toBe(0);
    expect(algebraicToSquare("h1")).toBe(7);
    expect(algebraicToSquare("a8")).toBe(56);
    expect(algebraicToSquare("h8")).toBe(63);
    expect(algebraicToSquare("e1")).toBe(4);
    expect(algebraicToSquare("e8")).toBe(60);
    expect(algebraicToSquare("d1")).toBe(3);
  });

  test("idx / fileOf / rankOf are consistent", () => {
    for (let s = 0; s < 64; s++) {
      expect(idx(fileOf(s), rankOf(s))).toBe(s);
    }
  });

  test("algebraic round-trips for all 64 squares", () => {
    for (let s = 0; s < 64; s++) {
      expect(algebraicToSquare(squareToAlgebraic(s))).toBe(s);
    }
  });

  test("algebraicToSquare rejects invalid input", () => {
    expect(() => algebraicToSquare("i1")).toThrow();
    expect(() => algebraicToSquare("a9")).toThrow();
    expect(() => algebraicToSquare("a0")).toThrow();
    expect(() => algebraicToSquare("aa")).toThrow();
    expect(() => algebraicToSquare("e")).toThrow();
    expect(() => algebraicToSquare("e12")).toThrow();
  });
});

describe("STARTING_SQUARES", () => {
  test("matches the PROMPT §4 table", () => {
    expect(STARTING_SQUARES.pawn.white).toEqual(
      ["a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2"].map(algebraicToSquare),
    );
    expect(STARTING_SQUARES.pawn.black).toEqual(
      ["a7", "b7", "c7", "d7", "e7", "f7", "g7", "h7"].map(algebraicToSquare),
    );
    expect(STARTING_SQUARES.rook.white).toEqual(["a1", "h1"].map(algebraicToSquare));
    expect(STARTING_SQUARES.rook.black).toEqual(["a8", "h8"].map(algebraicToSquare));
    expect(STARTING_SQUARES.knight.white).toEqual(["b1", "g1"].map(algebraicToSquare));
    expect(STARTING_SQUARES.knight.black).toEqual(["b8", "g8"].map(algebraicToSquare));
    expect(STARTING_SQUARES.bishop.white).toEqual(["c1", "f1"].map(algebraicToSquare));
    expect(STARTING_SQUARES.bishop.black).toEqual(["c8", "f8"].map(algebraicToSquare));
    expect(STARTING_SQUARES.queen.white).toEqual(["d1"].map(algebraicToSquare));
    expect(STARTING_SQUARES.queen.black).toEqual(["d8"].map(algebraicToSquare));
    expect(STARTING_SQUARES.king.white).toEqual(["e1"].map(algebraicToSquare));
    expect(STARTING_SQUARES.king.black).toEqual(["e8"].map(algebraicToSquare));
  });

  test("every starting-square list is sorted ascending", () => {
    for (const type of Object.keys(STARTING_SQUARES) as (keyof typeof STARTING_SQUARES)[]) {
      for (const color of ["white", "black"] as const) {
        const squares = STARTING_SQUARES[type][color];
        const sorted = [...squares].sort((a, b) => a - b);
        expect(squares).toEqual(sorted);
      }
    }
  });
});

describe("board construction", () => {
  test("emptyBoard is 64 nulls", () => {
    const b = emptyBoard();
    expect(b.length).toBe(64);
    expect(b.every((c) => c === null)).toBe(true);
  });

  test("initialBoard is a standard chess setup", () => {
    const b = initialBoard();
    expect(b[algebraicToSquare("a1")]).toEqual({ type: "rook", color: "white" });
    expect(b[algebraicToSquare("e1")]).toEqual({ type: "king", color: "white" });
    expect(b[algebraicToSquare("d1")]).toEqual({ type: "queen", color: "white" });
    expect(b[algebraicToSquare("e8")]).toEqual({ type: "king", color: "black" });
    expect(b[algebraicToSquare("d8")]).toEqual({ type: "queen", color: "black" });
    expect(b[algebraicToSquare("a2")]).toEqual({ type: "pawn", color: "white" });
    expect(b[algebraicToSquare("h7")]).toEqual({ type: "pawn", color: "black" });
    // Middle ranks empty.
    for (let rank = 2; rank <= 5; rank++) {
      for (let file = 0; file < 8; file++) {
        expect(b[idx(file, rank)]).toBeNull();
      }
    }
    // Piece counts.
    const whites = b.filter((c) => c?.color === "white").length;
    const blacks = b.filter((c) => c?.color === "black").length;
    expect(whites).toBe(16);
    expect(blacks).toBe(16);
  });

  test("cloneBoard is a deep, independent copy", () => {
    const b = initialBoard();
    const c = cloneBoard(b);
    expect(c).toEqual(b);
    c[0] = null;
    expect(b[0]).not.toBeNull();
    const e1 = algebraicToSquare("e1");
    c[e1]!.type = "pawn";
    expect(b[e1]!.type).toBe("king");
  });
});
