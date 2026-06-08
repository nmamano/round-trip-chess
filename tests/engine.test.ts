import { describe, expect, test } from "bun:test";
import { STARTING_SQUARES } from "../shared/board";
import type { GameState, Move } from "../shared/engine";
import {
  IllegalMoveError,
  IllegalPlacementError,
  allLegalMoves,
  applyMove,
  applyPlacement,
  initialState,
  legalMovesFrom,
  placementOptions,
} from "../shared/engine";
import { emptyBoards, pc, put, sq, stateFrom } from "./helpers";

// --- narrowing helpers -----------------------------------------------------

function asPlacement(state: GameState) {
  if (state.phase.kind !== "awaitingPlacement") {
    throw new Error(`expected awaitingPlacement, got ${state.phase.kind}`);
  }
  return state.phase;
}

function asGameOver(state: GameState) {
  if (state.phase.kind !== "gameOver") {
    throw new Error(`expected gameOver, got ${state.phase.kind}`);
  }
  return state.phase;
}

function asWin(state: GameState) {
  const outcome = asGameOver(state).outcome;
  if (outcome.result !== "win") throw new Error(`expected win, got ${outcome.result}`);
  return outcome;
}

function asDraw(state: GameState) {
  const outcome = asGameOver(state).outcome;
  if (outcome.result !== "draw") throw new Error(`expected draw, got ${outcome.result}`);
  return outcome;
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

function expectPlacementError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(IllegalPlacementError);
    expect((e as IllegalPlacementError).code).toBe(code as IllegalPlacementError["code"]);
    return;
  }
  throw new Error(`expected IllegalPlacementError(${code}) but nothing was thrown`);
}

// ---------------------------------------------------------------------------

describe("initialState", () => {
  test("Board 1 standard, Board 2 empty, White to move, zero king captures", () => {
    const s = initialState();
    expect(s.turn).toBe("white");
    expect(s.kingCaptures).toEqual({ white: 0, black: 0 });
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.boards[0][sq("e1")]).toEqual({ type: "king", color: "white" });
    expect(s.boards[0][sq("e8")]).toEqual({ type: "king", color: "black" });
    expect(s.boards[1].every((c) => c === null)).toBe(true);
  });

  test("White has the standard 20 opening moves (all on board 0)", () => {
    expect(allLegalMoves(initialState()).length).toBe(20);
  });
});

describe("legalMovesFrom", () => {
  test("respects side to move", () => {
    const s = initialState();
    expect(legalMovesFrom(s, 0, sq("e2"))).toEqual([sq("e3"), sq("e4")]);
    expect(legalMovesFrom(s, 0, sq("e7"))).toEqual([]); // black, not its turn
  });

  test("returns [] when not awaiting a move", () => {
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "a4", pc("black", "rook"));
    const s = applyMove(stateFrom(boards), { board: 0, from: sq("a1"), to: sq("a4") });
    expect(s.phase.kind).toBe("awaitingPlacement");
    expect(legalMovesFrom(s, 0, sq("a4"))).toEqual([]);
  });
});

describe("applyMove — non-capture", () => {
  test("moves the piece and flips the turn", () => {
    const s = applyMove(initialState(), { board: 0, from: sq("e2"), to: sq("e4") });
    expect(s.turn).toBe("black");
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.boards[0][sq("e4")]).toEqual({ type: "pawn", color: "white" });
    expect(s.boards[0][sq("e2")]).toBeNull();
  });
});

describe("applyMove — validation", () => {
  test("NO_PIECE / WRONG_OWNER / ILLEGAL_DESTINATION", () => {
    const s = initialState();
    expectMoveError(() => applyMove(s, { board: 0, from: sq("e4"), to: sq("e5") }), "NO_PIECE");
    expectMoveError(() => applyMove(s, { board: 0, from: sq("e7"), to: sq("e5") }), "WRONG_OWNER");
    expectMoveError(
      () => applyMove(s, { board: 0, from: sq("e2"), to: sq("e5") }),
      "ILLEGAL_DESTINATION",
    );
  });

  test("WRONG_PHASE when not awaiting a move", () => {
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "a4", pc("black", "rook"));
    const s = applyMove(stateFrom(boards), { board: 0, from: sq("a1"), to: sq("a4") });
    expectMoveError(() => applyMove(s, { board: 0, from: sq("a4"), to: sq("a5") }), "WRONG_PHASE");
  });

  test("out-of-range board / square become stable engine errors, not TypeErrors", () => {
    const s = initialState();
    // `as unknown as Move` simulates malformed JSON arriving at the engine.
    expectMoveError(
      () => applyMove(s, { board: 2, from: sq("e2"), to: sq("e4") } as unknown as Move),
      "INVALID_BOARD",
    );
    expectMoveError(() => applyMove(s, { board: 0, from: 99, to: sq("e4") }), "INVALID_SQUARE");
    expectMoveError(() => applyMove(s, { board: 0, from: sq("e2"), to: -1 }), "INVALID_SQUARE");
  });
});

describe("capture -> placement (non-king)", () => {
  test("enters awaitingPlacement with the captured piece, on the other board", () => {
    const boards = emptyBoards();
    put(boards[0], "d4", pc("white", "knight"));
    put(boards[0], "e6", pc("black", "pawn"));
    const s = applyMove(stateFrom(boards), { board: 0, from: sq("d4"), to: sq("e6") });

    const phase = asPlacement(s);
    expect(s.turn).toBe("white"); // turn does NOT flip mid-turn
    expect(phase.pending.piece).toEqual({ type: "pawn", color: "black" });
    expect(phase.pending.board).toBe(1);
    expect(placementOptions(s)).toEqual(STARTING_SQUARES.pawn.black);
    expect(s.boards[0][sq("e6")]).toEqual({ type: "knight", color: "white" });
    expect(s.boards[0][sq("d4")]).toBeNull();
    expect(s.kingCaptures).toEqual({ white: 0, black: 0 });
  });

  test("placementOptions reflects the pending piece, [] otherwise", () => {
    expect(placementOptions(initialState())).toEqual([]);
    const boards = emptyBoards();
    put(boards[0], "d4", pc("white", "knight"));
    put(boards[0], "e6", pc("black", "pawn"));
    const s = applyMove(stateFrom(boards), { board: 0, from: sq("d4"), to: sq("e6") });
    expect(placementOptions(s)).toEqual(STARTING_SQUARES.pawn.black);
  });

  test("placement on an empty square ends the chain and flips the turn", () => {
    const boards = emptyBoards();
    put(boards[0], "d4", pc("white", "knight"));
    put(boards[0], "e6", pc("black", "pawn"));
    let s = applyMove(stateFrom(boards), { board: 0, from: sq("d4"), to: sq("e6") });
    s = applyPlacement(s, sq("a7")); // empty square on board 1
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.turn).toBe("black");
    expect(s.boards[1][sq("a7")]).toEqual({ type: "pawn", color: "black" });
  });
});

describe("chain reaction", () => {
  test("placement on an opponent piece continues the chain; target board alternates", () => {
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "a4", pc("black", "rook"));
    put(boards[1], "a8", pc("black", "rook")); // sits on a black-rook start square
    let s = applyMove(stateFrom(boards), { board: 0, from: sq("a1"), to: sq("a4") });
    expect(asPlacement(s).pending.board).toBe(1);

    s = applyPlacement(s, sq("a8")); // captures the black rook on board 1
    const phase = asPlacement(s);
    expect(s.turn).toBe("white");
    expect(phase.pending.piece).toEqual({ type: "rook", color: "black" });
    expect(phase.pending.board).toBe(0); // alternated 1 -> 0
  });

  test("placement can capture OWN non-king piece and continue, then end on empty", () => {
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "a4", pc("black", "rook"));
    put(boards[1], "a8", pc("white", "rook")); // resolver's OWN piece
    let s = applyMove(stateFrom(boards), { board: 0, from: sq("a1"), to: sq("a4") });

    s = applyPlacement(s, sq("a8")); // white captures its own rook -> chain continues
    const phase = asPlacement(s);
    expect(phase.pending.piece).toEqual({ type: "rook", color: "white" });
    expect(phase.pending.board).toBe(0);
    expect(s.turn).toBe("white");

    s = applyPlacement(s, sq("h1")); // empty -> chain ends
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.turn).toBe("black");
    expect(s.boards[0][sq("h1")]).toEqual({ type: "rook", color: "white" });
  });
});

describe("applyPlacement — validation", () => {
  test("WRONG_PHASE when awaiting a move or game over", () => {
    expectPlacementError(() => applyPlacement(initialState(), sq("a2")), "WRONG_PHASE");
  });

  test("ILLEGAL_SQUARE when the square is not a valid starting square", () => {
    const boards = emptyBoards();
    put(boards[0], "d4", pc("white", "knight"));
    put(boards[0], "e6", pc("black", "pawn"));
    const s = applyMove(stateFrom(boards), { board: 0, from: sq("d4"), to: sq("e6") });
    expectPlacementError(() => applyPlacement(s, sq("a3")), "ILLEGAL_SQUARE"); // not a pawn start
  });

  test("INVALID_SQUARE when the square is out of range", () => {
    const boards = emptyBoards();
    put(boards[0], "d4", pc("white", "knight"));
    put(boards[0], "e6", pc("black", "pawn"));
    const s = applyMove(stateFrom(boards), { board: 0, from: sq("d4"), to: sq("e6") });
    expectPlacementError(() => applyPlacement(s, 99), "INVALID_SQUARE");
    expectPlacementError(() => applyPlacement(s, -5), "INVALID_SQUARE");
  });
});

describe("king capture via a normal move", () => {
  test("first capture increments the counter and the king travels to the other board", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "rook"));
    put(boards[0], "e8", pc("black", "king"));
    let s = applyMove(stateFrom(boards), { board: 0, from: sq("e1"), to: sq("e8") });

    const phase = asPlacement(s);
    expect(s.kingCaptures).toEqual({ white: 0, black: 1 });
    expect(phase.pending.piece).toEqual({ type: "king", color: "black" });
    expect(phase.pending.board).toBe(1);
    expect(placementOptions(s)).toEqual(STARTING_SQUARES.king.black); // [e8]

    s = applyPlacement(s, sq("e8")); // place the king on the empty other board
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.turn).toBe("black");
    expect(s.boards[1][sq("e8")]).toEqual({ type: "king", color: "black" });
    expect(s.kingCaptures.black).toBe(1);
  });

  test("second capture ends the game immediately (no placement)", () => {
    const boards = emptyBoards();
    put(boards[0], "e1", pc("white", "rook"));
    put(boards[0], "e8", pc("black", "king"));
    const s = applyMove(stateFrom(boards, "white", { white: 0, black: 1 }), {
      board: 0,
      from: sq("e1"),
      to: sq("e8"),
    });
    const win = asWin(s);
    expect(win.winner).toBe("white");
    expect(win.reason).toBe("kingCaptured");
    expect(s.kingCaptures.black).toBe(2);
  });
});

describe("king capture via a chain placement", () => {
  // A king can be captured by a placement when it has walked onto a square that
  // is a valid starting square for the piece being placed.
  function setup(kingCaptures: { white: number; black: number }) {
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "a4", pc("black", "rook"));
    put(boards[1], "a8", pc("black", "king")); // king sitting on a black-rook start square
    return applyMove(stateFrom(boards, "white", kingCaptures), {
      board: 0,
      from: sq("a1"),
      to: sq("a4"),
    });
  }

  test("first capture via placement increments and the king travels", () => {
    let s = setup({ white: 0, black: 0 });
    s = applyPlacement(s, sq("a8")); // black rook placed onto the black king
    const phase = asPlacement(s);
    expect(s.kingCaptures.black).toBe(1);
    expect(phase.pending.piece).toEqual({ type: "king", color: "black" });
    expect(phase.pending.board).toBe(0);
    expect(placementOptions(s)).toEqual(STARTING_SQUARES.king.black);
  });

  test("second capture via placement ends the game immediately", () => {
    let s = setup({ white: 0, black: 1 });
    s = applyPlacement(s, sq("a8"));
    const win = asWin(s);
    expect(win.winner).toBe("white");
    expect(win.reason).toBe("kingCaptured");
    expect(s.kingCaptures.black).toBe(2);
  });

  test("self-capturing your OWN king to its 2nd capture loses (intentional)", () => {
    // White, mid-chain, places a piece onto its own king for the 2nd time.
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "a4", pc("black", "rook"));
    put(boards[1], "a8", pc("white", "king")); // resolver's OWN king, already captured once
    let s = applyMove(stateFrom(boards, "white", { white: 1, black: 0 }), {
      board: 0,
      from: sq("a1"),
      to: sq("a4"),
    });
    s = applyPlacement(s, sq("a8")); // captures own king -> white reaches 2
    const win = asWin(s);
    expect(s.kingCaptures.white).toBe(2);
    expect(win.winner).toBe("black"); // opponent of the doomed king wins
    expect(win.reason).toBe("kingCaptured");
  });
});

describe("infinite-loop detection", () => {
  test("a chain that reproduces a configuration ends in a draw (Nil: loop == stalemate)", () => {
    const boards = emptyBoards();
    put(boards[0], "d8", pc("white", "rook"));
    put(boards[0], "d4", pc("black", "rook")); // captured to start the chain
    put(boards[0], "a8", pc("black", "rook")); // cycle square (board 0)
    put(boards[1], "a8", pc("black", "rook")); // cycle square (board 1)

    let s = applyMove(stateFrom(boards), { board: 0, from: sq("d8"), to: sq("d4") });
    expect(asPlacement(s).pending.board).toBe(1);

    s = applyPlacement(s, sq("a8")); // step 1: board 1 -> pending on board 0
    expect(s.phase.kind).toBe("awaitingPlacement");

    s = applyPlacement(s, sq("a8")); // step 2: reproduces the initial chain config
    const draw = asDraw(s);
    expect(draw.reason).toBe("infiniteLoop");
  });
});

describe("no check / no king safety", () => {
  test("a king may legally move into and along an attacked line", () => {
    const boards = emptyBoards();
    put(boards[0], "e4", pc("white", "king"));
    put(boards[0], "e8", pc("black", "rook")); // controls the whole e-file
    const s = stateFrom(boards);
    expect(legalMovesFrom(s, 0, sq("e4"))).toContain(sq("e5")); // still attacked — allowed
    // And the move actually applies without error.
    const after = applyMove(s, { board: 0, from: sq("e4"), to: sq("e5") });
    expect(after.boards[0][sq("e5")]).toEqual({ type: "king", color: "white" });
  });
});

describe("stateless pawn double-step", () => {
  test("a pawn placed back onto its home rank regains the double-step", () => {
    const boards = emptyBoards();
    put(boards[0], "e6", pc("black", "knight"));
    put(boards[0], "d4", pc("white", "pawn")); // will be captured and sent to board 1
    let s = applyMove(stateFrom(boards, "black"), { board: 0, from: sq("e6"), to: sq("d4") });

    s = applyPlacement(s, sq("a2")); // white pawn placed back onto its home rank (board 1)
    expect(s.turn).toBe("white");
    expect(s.boards[1][sq("a2")]).toEqual({ type: "pawn", color: "white" });

    const moves = legalMovesFrom(s, 1, sq("a2"));
    expect(moves).toContain(sq("a3"));
    expect(moves).toContain(sq("a4")); // double-step available again
  });
});
