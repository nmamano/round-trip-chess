// Round-Trip Chess rules engine — the authoritative game logic.
// Pure, deterministic, browser-safe: no I/O, no Bun/server imports.
//
// A turn is a small sub-state-machine:
//   awaitingMove --(move)--> [no capture] --> awaitingMove (turn flips)
//                            [capture]    --> awaitingPlacement
//   awaitingPlacement --(placement on empty)--> awaitingMove (turn flips)
//                     --(placement on occupied)--> awaitingPlacement (chain)
//   any king reaching 2 captures, or a chain repeating a configuration, ends in
//   gameOver.
//
// The active player ("resolver") makes every placement choice in a chain; the
// turn does NOT flip until the chain ends on an empty square.

import type { Board, BoardId, Color, Piece, PieceType } from "./board";
import { STARTING_SQUARES, cloneBoard, emptyBoard, initialBoard, squareToAlgebraic } from "./board";
import { MAX_CHAIN_ITERATIONS, NUM_SQUARES } from "./config";
import { legalDestinations } from "./movement";

// ---------------------------------------------------------------------------
// Errors — stable codes so the later server layer can map them to protocol
// errors and tests can assert exactly.
// ---------------------------------------------------------------------------

export type IllegalMoveCode =
  | "WRONG_PHASE"
  | "INVALID_BOARD"
  | "INVALID_SQUARE"
  | "NO_PIECE"
  | "WRONG_OWNER"
  | "ILLEGAL_DESTINATION";
export type IllegalPlacementCode = "WRONG_PHASE" | "INVALID_SQUARE" | "ILLEGAL_SQUARE";

export class IllegalMoveError extends Error {
  readonly code: IllegalMoveCode;
  constructor(code: IllegalMoveCode, message: string) {
    super(message);
    this.name = "IllegalMoveError";
    this.code = code;
  }
}

export class IllegalPlacementError extends Error {
  readonly code: IllegalPlacementCode;
  constructor(code: IllegalPlacementCode, message: string) {
    super(message);
    this.name = "IllegalPlacementError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// State model
// ---------------------------------------------------------------------------

export interface Move {
  board: BoardId;
  from: number;
  to: number;
}

export interface PendingPlacement {
  piece: Piece; // the captured piece that must be placed
  board: BoardId; // the board it must be placed on (the OTHER board)
  // INTERNAL chain loop-detection metadata: signatures of awaiting-placement
  // configs seen so far this chain. Authoritative engine state, but must NOT be
  // projected into the client-facing snapshot in the server round.
  visited: string[];
}

// The legal placement squares for a pending capture are DERIVED from the piece
// itself (the canonical PROMPT §4 table), never stored on the pending state, so
// no accidental mutation can widen what `applyPlacement` accepts. Returns a
// reference to the shared sorted array — callers must not mutate it.
function placementSquares(piece: Piece): number[] {
  return STARTING_SQUARES[piece.type][piece.color];
}

function isSquare(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < NUM_SQUARES;
}

// A finished game is either a win (a king was captured twice) or a draw (a chain
// reproduced a configuration — an infinite loop). The two shapes are kept
// distinct so a draw never has to overload `winner`.
export type Outcome =
  | { result: "win"; winner: Color; reason: "kingCaptured" }
  | { result: "draw"; reason: "infiniteLoop" };

export type Phase =
  | { kind: "awaitingMove" }
  | { kind: "awaitingPlacement"; pending: PendingPlacement }
  | { kind: "gameOver"; outcome: Outcome };

export interface GameState {
  boards: [Board, Board];
  turn: Color;
  kingCaptures: { white: number; black: number };
  phase: Phase;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function opponent(color: Color): Color {
  return color === "white" ? "black" : "white";
}

function otherBoard(board: BoardId): BoardId {
  return board === 0 ? 1 : 0;
}

function cloneBoards(state: GameState): [Board, Board] {
  return [cloneBoard(state.boards[0]), cloneBoard(state.boards[1])];
}

const PIECE_LETTER: Record<PieceType, string> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

function cellChar(cell: Piece | null): string {
  if (!cell) return ".";
  const letter = PIECE_LETTER[cell.type];
  return cell.color === "white" ? letter.toUpperCase() : letter;
}

// A signature uniquely identifying an awaiting-placement configuration within a
// single chain: both boards, the king counters, the side to move, and the piece
// about to be placed (with its destination board). If a placement reproduces a
// signature already seen in this chain, the chain can never terminate => the
// game is a draw (infinite loop).
function chainSignature(
  boards: [Board, Board],
  kingCaptures: { white: number; black: number },
  turn: Color,
  pending: { piece: Piece; board: BoardId },
): string {
  const b0 = boards[0].map(cellChar).join("");
  const b1 = boards[1].map(cellChar).join("");
  const pend = `${cellChar(pending.piece)}@${pending.board}`;
  return `${turn}|${kingCaptures.white},${kingCaptures.black}|${b0}|${b1}|${pend}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initialState(): GameState {
  return {
    boards: [initialBoard(), emptyBoard()],
    turn: "white",
    kingCaptures: { white: 0, black: 0 },
    phase: { kind: "awaitingMove" },
  };
}

// Legal destinations for the piece on `from`, but only for the side to move and
// only while awaiting a move. Returns [] otherwise (including for empty squares
// or opponent pieces).
export function legalMovesFrom(state: GameState, board: BoardId, from: number): number[] {
  if (state.phase.kind !== "awaitingMove") return [];
  const piece = state.boards[board][from];
  if (!piece || piece.color !== state.turn) return [];
  return legalDestinations(state.boards[board], from);
}

// Every legal move for the side to move across both boards. Useful for a
// random-legal-move bot and for tests; not used in the hot path.
export function allLegalMoves(state: GameState): Move[] {
  if (state.phase.kind !== "awaitingMove") return [];
  const moves: Move[] = [];
  for (const board of [0, 1] as BoardId[]) {
    const cells = state.boards[board];
    for (let from = 0; from < cells.length; from++) {
      const piece = cells[from];
      if (!piece || piece.color !== state.turn) continue;
      for (const to of legalDestinations(cells, from)) moves.push({ board, from, to });
    }
  }
  return moves;
}

// The valid placement squares for the pending capture, or [] if not awaiting a
// placement. Derived from the pending piece (not stored state), deterministic,
// sorted ascending. Returns a fresh copy so callers can't mutate engine state.
export function placementOptions(state: GameState): number[] {
  if (state.phase.kind !== "awaitingPlacement") return [];
  return placementSquares(state.phase.pending.piece).slice();
}

export function applyMove(state: GameState, move: Move): GameState {
  if (state.phase.kind !== "awaitingMove") {
    throw new IllegalMoveError("WRONG_PHASE", `cannot move while phase is ${state.phase.kind}`);
  }

  const { board, from, to } = move;
  // Boundary validation: server input arrives as JSON and is only typed by
  // convention, so validate ranges before indexing or formatting squares.
  if (board !== 0 && board !== 1) {
    throw new IllegalMoveError("INVALID_BOARD", `invalid board: ${board}`);
  }
  if (!isSquare(from) || !isSquare(to)) {
    throw new IllegalMoveError("INVALID_SQUARE", `square out of range: from=${from} to=${to}`);
  }

  const mover = state.boards[board][from];
  if (!mover) {
    throw new IllegalMoveError(
      "NO_PIECE",
      `no piece on board ${board} at ${squareToAlgebraic(from)}`,
    );
  }
  if (mover.color !== state.turn) {
    throw new IllegalMoveError(
      "WRONG_OWNER",
      `piece on board ${board} at ${squareToAlgebraic(from)} is not ${state.turn}'s`,
    );
  }
  if (!legalDestinations(state.boards[board], from).includes(to)) {
    throw new IllegalMoveError(
      "ILLEGAL_DESTINATION",
      `${squareToAlgebraic(from)}->${squareToAlgebraic(to)} on board ${board} is not a legal move`,
    );
  }

  const boards = cloneBoards(state);
  const captured = boards[board][to];
  boards[board][to] = boards[board][from];
  boards[board][from] = null;

  if (!captured) {
    return {
      boards,
      turn: opponent(state.turn),
      kingCaptures: { ...state.kingCaptures },
      phase: { kind: "awaitingMove" },
    };
  }

  // A capture occurred. King-win is checked at the capture event, before any
  // placement / chain bookkeeping.
  const kingCaptures = { ...state.kingCaptures };
  if (captured.type === "king") {
    kingCaptures[captured.color] += 1;
    if (kingCaptures[captured.color] >= 2) {
      return {
        boards,
        turn: state.turn,
        kingCaptures,
        phase: {
          kind: "gameOver",
          outcome: { result: "win", winner: opponent(captured.color), reason: "kingCaptured" },
        },
      };
    }
  }

  // The captured piece travels to the other board and must be placed there.
  const pending: PendingPlacement = {
    piece: { type: captured.type, color: captured.color },
    board: otherBoard(board),
    visited: [],
  };
  pending.visited.push(chainSignature(boards, kingCaptures, state.turn, pending));

  return { boards, turn: state.turn, kingCaptures, phase: { kind: "awaitingPlacement", pending } };
}

export function applyPlacement(state: GameState, square: number): GameState {
  if (state.phase.kind !== "awaitingPlacement") {
    throw new IllegalPlacementError(
      "WRONG_PHASE",
      `cannot place while phase is ${state.phase.kind}`,
    );
  }

  if (!isSquare(square)) {
    throw new IllegalPlacementError("INVALID_SQUARE", `square out of range: ${square}`);
  }

  const pending = state.phase.pending;
  // Legality derives from the canonical starting-square table for the pending
  // piece — not from any stored/mutable field.
  if (!placementSquares(pending.piece).includes(square)) {
    throw new IllegalPlacementError(
      "ILLEGAL_SQUARE",
      `${squareToAlgebraic(square)} is not a valid starting square for ${pending.piece.color} ${pending.piece.type}`,
    );
  }

  const boards = cloneBoards(state);
  const target = pending.board;
  const occupant = boards[target][square];
  boards[target][square] = { type: pending.piece.type, color: pending.piece.color };

  // Landing on an empty square ends the chain; the turn passes.
  if (!occupant) {
    return {
      boards,
      turn: opponent(state.turn),
      kingCaptures: { ...state.kingCaptures },
      phase: { kind: "awaitingMove" },
    };
  }

  // The placement captured the occupant (which may be the resolver's OWN piece).
  // King-win takes precedence over loop detection.
  const kingCaptures = { ...state.kingCaptures };
  if (occupant.type === "king") {
    kingCaptures[occupant.color] += 1;
    if (kingCaptures[occupant.color] >= 2) {
      return {
        boards,
        turn: state.turn,
        kingCaptures,
        phase: {
          kind: "gameOver",
          outcome: { result: "win", winner: opponent(occupant.color), reason: "kingCaptured" },
        },
      };
    }
  }

  const nextPending: PendingPlacement = {
    piece: { type: occupant.type, color: occupant.color },
    board: otherBoard(target),
    visited: pending.visited.slice(),
  };

  const signature = chainSignature(boards, kingCaptures, state.turn, nextPending);
  if (nextPending.visited.includes(signature)) {
    // This placement reproduces a configuration already seen this chain: the
    // chain can never terminate. Per Nil, an infinite loop is a DRAW (PROMPT §2
    // says the trigger wins; Nil overrode this to "equivalent to stalemate").
    return {
      boards,
      turn: state.turn,
      kingCaptures,
      phase: { kind: "gameOver", outcome: { result: "draw", reason: "infiniteLoop" } },
    };
  }
  nextPending.visited.push(signature);

  if (nextPending.visited.length > MAX_CHAIN_ITERATIONS) {
    // Unreachable in correct play — loop detection should have fired. Assert
    // rather than declare an outcome so a signature bug cannot be masked.
    throw new Error(
      `chain exceeded MAX_CHAIN_ITERATIONS=${MAX_CHAIN_ITERATIONS} without loop detection — likely a chainSignature bug`,
    );
  }

  return {
    boards,
    turn: state.turn,
    kingCaptures,
    phase: { kind: "awaitingPlacement", pending: nextPending },
  };
}
