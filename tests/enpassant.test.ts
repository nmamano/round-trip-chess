// En passant — same-board, immediate, stateless beyond the single armed right.
// A pawn double-step arms `enPassant`; only the immediately-following move may use
// it; the captured pawn (on `pawnSquare`, NOT the destination) enters the normal
// placement/chain mechanic.
import { describe, expect, test } from "bun:test";
import type { GameState } from "../shared/engine";
import { applyMove, applyPlacement, legalMovesFrom, placementOptions } from "../shared/engine";
import { STARTING_SQUARES } from "../shared/board";
import { emptyBoards, pc, put, sq, stateFrom } from "./helpers";

function asPlacement(s: GameState) {
  if (s.phase.kind !== "awaitingPlacement") {
    throw new Error(`expected awaitingPlacement, got ${s.phase.kind}`);
  }
  return s.phase;
}

describe("en passant — arming", () => {
  test("a white pawn double-step arms enPassant with the passed square and the pawn square", () => {
    const boards = emptyBoards();
    put(boards[0], "e2", pc("white", "pawn"));
    const after = applyMove(stateFrom(boards, "white"), { board: 0, from: sq("e2"), to: sq("e4") });
    expect(after.enPassant).toEqual({ board: 0, square: sq("e3"), pawnSquare: sq("e4") });
    expect(after.turn).toBe("black");
  });

  test("a black pawn double-step arms enPassant symmetrically", () => {
    const boards = emptyBoards();
    put(boards[0], "d7", pc("black", "pawn"));
    const after = applyMove(stateFrom(boards, "black"), { board: 0, from: sq("d7"), to: sq("d5") });
    expect(after.enPassant).toEqual({ board: 0, square: sq("d6"), pawnSquare: sq("d5") });
  });

  test("a single pawn step does NOT arm enPassant", () => {
    const boards = emptyBoards();
    put(boards[0], "e2", pc("white", "pawn"));
    const after = applyMove(stateFrom(boards, "white"), { board: 0, from: sq("e2"), to: sq("e3") });
    expect(after.enPassant).toBeNull();
  });

  test("the right expires: any non-double-step move clears a previously-armed right", () => {
    const boards = emptyBoards();
    put(boards[0], "d7", pc("black", "pawn")); // black will double-step to arm
    put(boards[0], "h1", pc("white", "rook")); // white's unrelated reply
    let s = applyMove(stateFrom(boards, "black"), { board: 0, from: sq("d7"), to: sq("d5") });
    expect(s.enPassant).not.toBeNull();
    s = applyMove(s, { board: 0, from: sq("h1"), to: sq("h5") });
    expect(s.enPassant).toBeNull();
  });
});

describe("en passant — capture", () => {
  // White pawn on e5, black pawn on d5 as if it just double-stepped d7->d5.
  function armed(): GameState {
    const boards = emptyBoards();
    put(boards[0], "e5", pc("white", "pawn"));
    put(boards[0], "d5", pc("black", "pawn"));
    return stateFrom(
      boards,
      "white",
      { white: 0, black: 0 },
      {
        board: 0,
        square: sq("d6"),
        pawnSquare: sq("d5"),
      },
    );
  }

  test("the EP target is a legal destination for the adjacent pawn", () => {
    expect(legalMovesFrom(armed(), 0, sq("e5"))).toContain(sq("d6"));
  });

  test("EP capture advances the pawn, removes ONLY the pawnSquare pawn, and routes it to placement", () => {
    const after = applyMove(armed(), { board: 0, from: sq("e5"), to: sq("d6") });
    const phase = asPlacement(after);
    expect(after.boards[0][sq("d6")]).toEqual({ type: "pawn", color: "white" }); // pawn advanced
    expect(after.boards[0][sq("d5")]).toBeNull(); // captured pawn removed (not the destination)
    expect(after.boards[0][sq("e5")]).toBeNull();
    expect(phase.pending.piece).toEqual({ type: "pawn", color: "black" });
    expect(phase.pending.board).toBe(1); // travels to the other board
    expect(after.turn).toBe("white"); // resolver keeps the turn mid-chain
    expect(after.enPassant).toBeNull(); // cleared; never dangles into a chain
    expect(placementOptions(after)).toEqual(STARTING_SQUARES.pawn.black);
  });

  test("placing the EP-captured pawn on an empty square ends the chain and flips the turn", () => {
    let s = applyMove(armed(), { board: 0, from: sq("e5"), to: sq("d6") });
    s = applyPlacement(s, sq("a7")); // empty black-pawn start on board 1
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.turn).toBe("black");
    expect(s.enPassant).toBeNull();
    expect(s.boards[1][sq("a7")]).toEqual({ type: "pawn", color: "black" });
  });

  test("the EP-captured pawn can itself start a chain", () => {
    const boards = emptyBoards();
    put(boards[0], "e5", pc("white", "pawn"));
    put(boards[0], "d5", pc("black", "pawn"));
    put(boards[1], "a7", pc("black", "pawn")); // sits on a black-pawn start square
    const s0 = stateFrom(
      boards,
      "white",
      { white: 0, black: 0 },
      {
        board: 0,
        square: sq("d6"),
        pawnSquare: sq("d5"),
      },
    );
    let s = applyMove(s0, { board: 0, from: sq("e5"), to: sq("d6") });
    s = applyPlacement(s, sq("a7")); // lands on the occupied start -> chain continues
    const phase = asPlacement(s);
    expect(phase.pending.piece).toEqual({ type: "pawn", color: "black" });
    expect(phase.pending.board).toBe(0); // alternated 1 -> 0
  });
});

describe("en passant — scope", () => {
  test("same-board only: an armed right on board 0 is invisible to board 1", () => {
    const boards = emptyBoards();
    put(boards[1], "e5", pc("white", "pawn")); // a pawn on board 1, same squares
    const s = stateFrom(
      boards,
      "white",
      { white: 0, black: 0 },
      {
        board: 0, // armed on board 0
        square: sq("d6"),
        pawnSquare: sq("d5"),
      },
    );
    expect(legalMovesFrom(s, 1, sq("e5"))).not.toContain(sq("d6"));
  });

  test("defensive guard: a corrupted EP right (victim not an opposing pawn) throws", () => {
    // Only reachable via a malformed state — the public API never produces this —
    // but the engine verifies the victim rather than trusting stored state.
    const boards = emptyBoards();
    put(boards[0], "e5", pc("white", "pawn"));
    put(boards[0], "d5", pc("black", "rook")); // NOT a pawn
    const s = stateFrom(
      boards,
      "white",
      { white: 0, black: 0 },
      {
        board: 0,
        square: sq("d6"),
        pawnSquare: sq("d5"),
      },
    );
    expect(() => applyMove(s, { board: 0, from: sq("e5"), to: sq("d6") })).toThrow(/en-passant/);
  });
});
