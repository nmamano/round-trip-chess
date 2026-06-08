// Promotion — atomic on the move. A pawn reaching its last rank promotes as part
// of `applyMove` (no separate phase): the move carries the chosen piece. A
// promoting CAPTURE promotes the pawn AND routes the captured occupant through the
// normal placement/chain mechanic. Pawns are only ever PLACED on rank 2/7, so a
// placement never auto-promotes.
import { describe, expect, test } from "bun:test";
import { STARTING_SQUARES } from "../shared/board";
import type { GameState, Move, PromotionPiece } from "../shared/engine";
import {
  IllegalMoveError,
  allLegalMoves,
  applyMove,
  applyPlacement,
  initialState,
} from "../shared/engine";
import { emptyBoards, pc, put, sq, stateFrom } from "./helpers";

function asPlacement(s: GameState) {
  if (s.phase.kind !== "awaitingPlacement") {
    throw new Error(`expected awaitingPlacement, got ${s.phase.kind}`);
  }
  return s.phase;
}

function asWin(s: GameState) {
  if (s.phase.kind !== "gameOver" || s.phase.outcome.result !== "win") {
    throw new Error(`expected win, got ${JSON.stringify(s.phase)}`);
  }
  return s.phase.outcome;
}

function expectMoveError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(IllegalMoveError);
    expect((e as IllegalMoveError).code).toBe(code as IllegalMoveError["code"]);
    return;
  }
  throw new Error(`expected IllegalMoveError(${code}) but nothing was thrown`);
}

describe("promotion — non-capturing", () => {
  test("a white pawn reaching rank 8 becomes the chosen piece and flips the turn", () => {
    for (const promotion of ["queen", "rook", "bishop", "knight"] as PromotionPiece[]) {
      const boards = emptyBoards();
      put(boards[0], "e7", pc("white", "pawn"));
      const after = applyMove(stateFrom(boards, "white"), {
        board: 0,
        from: sq("e7"),
        to: sq("e8"),
        promotion,
      });
      expect(after.phase.kind).toBe("awaitingMove");
      expect(after.turn).toBe("black");
      expect(after.boards[0][sq("e8")]).toEqual({ type: promotion, color: "white" });
      expect(after.boards[0][sq("e7")]).toBeNull();
    }
  });

  test("a black pawn promotes on rank 1", () => {
    const boards = emptyBoards();
    put(boards[0], "d2", pc("black", "pawn"));
    const after = applyMove(stateFrom(boards, "black"), {
      board: 0,
      from: sq("d2"),
      to: sq("d1"),
      promotion: "knight",
    });
    expect(after.boards[0][sq("d1")]).toEqual({ type: "knight", color: "black" });
  });
});

describe("promotion — capture routing (promoted piece stays, captured travels)", () => {
  test("promoting capture: pawn promotes on the origin board; the captured piece routes to the other board", () => {
    const boards = emptyBoards();
    put(boards[0], "e7", pc("white", "pawn"));
    put(boards[0], "f8", pc("black", "rook")); // captured via e7xf8 + promote
    const after = applyMove(stateFrom(boards, "white"), {
      board: 0,
      from: sq("e7"),
      to: sq("f8"),
      promotion: "queen",
    });
    const phase = asPlacement(after);
    expect(after.boards[0][sq("f8")]).toEqual({ type: "queen", color: "white" }); // promoted, stays
    expect(after.boards[0][sq("e7")]).toBeNull();
    expect(phase.pending.piece).toEqual({ type: "rook", color: "black" }); // captured travels
    expect(phase.pending.board).toBe(1);
    expect(after.turn).toBe("white"); // resolver keeps the turn mid-chain
    expect(after.enPassant).toBeNull();

    const done = applyPlacement(after, sq("a8")); // empty black-rook start on board 1
    expect(done.phase.kind).toBe("awaitingMove");
    expect(done.turn).toBe("black");
    expect(done.boards[1][sq("a8")]).toEqual({ type: "rook", color: "black" });
  });

  test("promoting capture of a king increments the counter and the king travels", () => {
    const boards = emptyBoards();
    put(boards[0], "e7", pc("white", "pawn"));
    put(boards[0], "f8", pc("black", "king"));
    const after = applyMove(stateFrom(boards, "white"), {
      board: 0,
      from: sq("e7"),
      to: sq("f8"),
      promotion: "queen",
    });
    expect(after.kingCaptures.black).toBe(1);
    expect(after.boards[0][sq("f8")]).toEqual({ type: "queen", color: "white" });
    expect(asPlacement(after).pending.piece).toEqual({ type: "king", color: "black" });
  });

  test("a promoting capture that is the king's 2nd capture wins immediately (no placement)", () => {
    const boards = emptyBoards();
    put(boards[0], "e7", pc("white", "pawn"));
    put(boards[0], "f8", pc("black", "king"));
    const after = applyMove(stateFrom(boards, "white", { white: 0, black: 1 }), {
      board: 0,
      from: sq("e7"),
      to: sq("f8"),
      promotion: "queen",
    });
    const win = asWin(after);
    expect(win.winner).toBe("white");
    expect(after.kingCaptures.black).toBe(2);
    expect(after.boards[0][sq("f8")]).toEqual({ type: "queen", color: "white" });
  });
});

describe("promotion — validation", () => {
  function pawnAtE7(): GameState {
    const boards = emptyBoards();
    put(boards[0], "e7", pc("white", "pawn"));
    return stateFrom(boards, "white");
  }

  test("missing promotion on a last-rank pawn move is rejected", () => {
    expectMoveError(
      () => applyMove(pawnAtE7(), { board: 0, from: sq("e7"), to: sq("e8") }),
      "INVALID_PROMOTION",
    );
  });

  test("an invalid promotion target (king/pawn) is rejected", () => {
    expectMoveError(
      () =>
        applyMove(pawnAtE7(), {
          board: 0,
          from: sq("e7"),
          to: sq("e8"),
          promotion: "king" as unknown as PromotionPiece,
        }),
      "INVALID_PROMOTION",
    );
    expectMoveError(
      () =>
        applyMove(pawnAtE7(), {
          board: 0,
          from: sq("e7"),
          to: sq("e8"),
          promotion: "pawn" as unknown as PromotionPiece,
        }),
      "INVALID_PROMOTION",
    );
  });

  test("promotion specified on a non-promoting pawn move is rejected", () => {
    const boards = emptyBoards();
    put(boards[0], "e2", pc("white", "pawn"));
    expectMoveError(
      () =>
        applyMove(stateFrom(boards, "white"), {
          board: 0,
          from: sq("e2"),
          to: sq("e3"),
          promotion: "queen",
        }),
      "INVALID_PROMOTION",
    );
  });

  test("promotion specified on a non-pawn move is rejected", () => {
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    expectMoveError(
      () =>
        applyMove(stateFrom(boards, "white"), {
          board: 0,
          from: sq("a1"),
          to: sq("a2"),
          promotion: "queen",
        } as Move),
      "INVALID_PROMOTION",
    );
  });
});

describe("promotion — bot enumeration", () => {
  test("allLegalMoves expands a promoting pawn move into Q/R/B/N variants", () => {
    const boards = emptyBoards();
    put(boards[0], "e7", pc("white", "pawn")); // e8 empty -> single forward promotion
    const moves = allLegalMoves(stateFrom(boards, "white")).filter((m) => m.to === sq("e8"));
    expect(moves.length).toBe(4);
    expect(new Set(moves.map((m) => m.promotion))).toEqual(
      new Set<PromotionPiece>(["queen", "rook", "bishop", "knight"]),
    );
  });

  test("the standard opening still has exactly 20 moves (no spurious promotions)", () => {
    expect(allLegalMoves(initialState()).length).toBe(20);
  });
});

// Sanity tie-in: placement targets for a captured pawn are the rank-2/7 starts,
// so placement never lands a pawn on a promotion rank.
test("captured-pawn placement squares are the home pawn ranks (never a promotion rank)", () => {
  expect(STARTING_SQUARES.pawn.white).toEqual([
    sq("a2"),
    sq("b2"),
    sq("c2"),
    sq("d2"),
    sq("e2"),
    sq("f2"),
    sq("g2"),
    sq("h2"),
  ]);
  expect(STARTING_SQUARES.pawn.black).toEqual([
    sq("a7"),
    sq("b7"),
    sq("c7"),
    sq("d7"),
    sq("e7"),
    sq("f7"),
    sq("g7"),
    sq("h7"),
  ]);
});
