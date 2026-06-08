// Castling — the stateless, NO-CHECK variant. A king on its home square with a
// same-color rook on the matching a/h home square and an empty path may castle;
// there are deliberately NO check / through-check / into-check restrictions, and
// castling never captures. Because it is purely position-derived, the "right"
// revives whenever the home positions are recreated.
import { describe, expect, test } from "bun:test";
import type { BoardId } from "../shared/board";
import type { GameState } from "../shared/engine";
import { applyMove, legalMovesFrom } from "../shared/engine";
import { emptyBoards, pc, put, sq, stateFrom } from "./helpers";

function expectAwaitingMove(s: GameState) {
  if (s.phase.kind !== "awaitingMove")
    throw new Error(`expected awaitingMove, got ${s.phase.kind}`);
}

describe("castling — white", () => {
  test("kingside: e1->g1 relocates the h1 rook to f1, flips the turn, no capture", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "king"));
    put(boards[0], "h1", pc("white", "rook"));
    const s = stateFrom(boards, "white");

    expect(legalMovesFrom(s, 0, sq("e1"))).toContain(sq("g1"));

    const after = applyMove(s, { board: 0, from: sq("e1"), to: sq("g1") });
    expectAwaitingMove(after);
    expect(after.turn).toBe("black");
    expect(after.enPassant).toBeNull();
    expect(after.boards[0][sq("g1")]).toEqual({ type: "king", color: "white" });
    expect(after.boards[0][sq("f1")]).toEqual({ type: "rook", color: "white" });
    expect(after.boards[0][sq("e1")]).toBeNull();
    expect(after.boards[0][sq("h1")]).toBeNull();
  });

  test("queenside: e1->c1 relocates the a1 rook to d1", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "king"));
    put(boards[0], "a1", pc("white", "rook"));
    const s = stateFrom(boards, "white");

    expect(legalMovesFrom(s, 0, sq("e1"))).toContain(sq("c1"));

    const after = applyMove(s, { board: 0, from: sq("e1"), to: sq("c1") });
    expect(after.boards[0][sq("c1")]).toEqual({ type: "king", color: "white" });
    expect(after.boards[0][sq("d1")]).toEqual({ type: "rook", color: "white" });
    expect(after.boards[0][sq("a1")]).toBeNull();
    expect(after.boards[0][sq("e1")]).toBeNull();
  });

  test("both sides offered when both rooks present and the path is clear", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "king"));
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "h1", pc("white", "rook"));
    const dests = legalMovesFrom(stateFrom(boards, "white"), 0, sq("e1"));
    expect(dests).toContain(sq("c1"));
    expect(dests).toContain(sq("g1"));
  });
});

describe("castling — black", () => {
  test("kingside e8->g8 and queenside e8->c8 relocate the matching rook", () => {
    const boards = emptyBoards();
    put(boards[0], "e8", pc("black", "king"));
    put(boards[0], "h8", pc("black", "rook"));
    put(boards[0], "a8", pc("black", "rook"));
    const s = stateFrom(boards, "black");

    const king = applyMove(s, { board: 0, from: sq("e8"), to: sq("g8") });
    expect(king.boards[0][sq("g8")]).toEqual({ type: "king", color: "black" });
    expect(king.boards[0][sq("f8")]).toEqual({ type: "rook", color: "black" });
    expect(king.turn).toBe("white");

    const queen = applyMove(s, { board: 0, from: sq("e8"), to: sq("c8") });
    expect(queen.boards[0][sq("c8")]).toEqual({ type: "king", color: "black" });
    expect(queen.boards[0][sq("d8")]).toEqual({ type: "rook", color: "black" });
  });
});

describe("castling — preconditions", () => {
  test("blocked path removes that castling on both sides", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "king"));
    put(boards[0], "h1", pc("white", "rook"));
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "g1", pc("white", "knight")); // blocks kingside
    put(boards[0], "b1", pc("white", "knight")); // blocks queenside
    const dests = legalMovesFrom(stateFrom(boards, "white"), 0, sq("e1"));
    expect(dests).not.toContain(sq("g1"));
    expect(dests).not.toContain(sq("c1"));
  });

  test("missing rook: no castling on that side", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "king"));
    put(boards[0], "h1", pc("white", "rook")); // only kingside available
    const dests = legalMovesFrom(stateFrom(boards, "white"), 0, sq("e1"));
    expect(dests).toContain(sq("g1"));
    expect(dests).not.toContain(sq("c1"));
  });

  test("wrong-color or wrong-type piece on the rook square: no castling", () => {
    const wrongColor = emptyBoards();
    put(wrongColor[0], "e1", pc("white", "king"));
    put(wrongColor[0], "h1", pc("black", "rook")); // enemy rook
    expect(legalMovesFrom(stateFrom(wrongColor, "white"), 0, sq("e1"))).not.toContain(sq("g1"));

    const wrongType = emptyBoards();
    put(wrongType[0], "e1", pc("white", "king"));
    put(wrongType[0], "h1", pc("white", "queen")); // not a rook
    expect(legalMovesFrom(stateFrom(wrongType, "white"), 0, sq("e1"))).not.toContain(sq("g1"));
  });

  test("a king NOT on its color's home square cannot castle (home is color-keyed)", () => {
    // A black king parked on e1 (white's home) with a black rook on h1 must NOT
    // castle: black's home is e8. A white king in the identical layout would.
    const black = emptyBoards();
    put(black[0], "e1", pc("black", "king"));
    put(black[0], "h1", pc("black", "rook"));
    expect(legalMovesFrom(stateFrom(black, "black"), 0, sq("e1"))).not.toContain(sq("g1"));

    const white = emptyBoards();
    put(white[0], "e1", pc("white", "king"));
    put(white[0], "h1", pc("white", "rook"));
    expect(legalMovesFrom(stateFrom(white, "white"), 0, sq("e1"))).toContain(sq("g1"));
  });
});

describe("castling — variant-specific behavior", () => {
  test("NO-CHECK variant: castling out of / through / into attacked squares is legal", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "king"));
    put(boards[0], "h1", pc("white", "rook"));
    put(boards[0], "e8", pc("black", "rook")); // "checks" e1 along the open e-file
    put(boards[0], "g8", pc("black", "rook")); // attacks g1, the king's destination
    const s = stateFrom(boards, "white");
    expect(legalMovesFrom(s, 0, sq("e1"))).toContain(sq("g1"));
    const after = applyMove(s, { board: 0, from: sq("e1"), to: sq("g1") });
    expect(after.boards[0][sq("g1")]).toEqual({ type: "king", color: "white" });
  });

  test("castling works on board 1 (the initially-empty board) once homes exist", () => {
    const boards = emptyBoards();
    put(boards[1], "e1", pc("white", "king"));
    put(boards[1], "h1", pc("white", "rook"));
    const board: BoardId = 1;
    const after = applyMove(stateFrom(boards, "white"), { board, from: sq("e1"), to: sq("g1") });
    expect(after.boards[1][sq("g1")]).toEqual({ type: "king", color: "white" });
    expect(after.boards[1][sq("f1")]).toEqual({ type: "rook", color: "white" });
  });

  test("rights REVIVE: a king that moved away and returned home can still castle", () => {
    // Orthodox chess forfeits castling permanently once the king moves. This
    // variant is stateless, so returning the king home restores the right.
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "king"));
    put(boards[0], "h1", pc("white", "rook"));
    put(boards[0], "a8", pc("black", "rook")); // black's throwaway shuffle piece
    let s = stateFrom(boards, "white");

    s = applyMove(s, { board: 0, from: sq("e1"), to: sq("f1") }); // king leaves home
    s = applyMove(s, { board: 0, from: sq("a8"), to: sq("a7") }); // black shuffles
    s = applyMove(s, { board: 0, from: sq("f1"), to: sq("e1") }); // king returns home
    s = applyMove(s, { board: 0, from: sq("a7"), to: sq("a8") }); // black shuffles back

    expect(legalMovesFrom(s, 0, sq("e1"))).toContain(sq("g1"));
    const after = applyMove(s, { board: 0, from: sq("e1"), to: sq("g1") });
    expect(after.boards[0][sq("g1")]).toEqual({ type: "king", color: "white" });
    expect(after.boards[0][sq("f1")]).toEqual({ type: "rook", color: "white" });
  });
});
