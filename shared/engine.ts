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
import {
  STARTING_SQUARES,
  cloneBoard,
  emptyBoard,
  fileOf,
  idx,
  initialBoard,
  rankOf,
  squareToAlgebraic,
} from "./board";
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
  | "ILLEGAL_DESTINATION"
  | "INVALID_PROMOTION";
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

// A pawn reaching the last rank promotes atomically as part of the move (no
// separate phase): the UI picks the piece and sends it on the move. King/pawn are
// excluded targets.
export type PromotionPiece = Exclude<PieceType, "pawn" | "king">;

// Ordered queen-first (the conventional default) so any consumer that takes the
// first option — or renders them in order — leads with the strongest piece.
const PROMOTABLE: PromotionPiece[] = ["queen", "rook", "bishop", "knight"];

function isPromotionPiece(p: unknown): p is PromotionPiece {
  return p === "knight" || p === "bishop" || p === "rook" || p === "queen";
}

export interface Move {
  board: BoardId;
  from: number;
  to: number;
  // Required iff this move lands a pawn on its last rank; rejected otherwise.
  promotion?: PromotionPiece;
}

// En-passant right, carried on GameState. Set ONLY by a pawn double-step and
// consumed/cleared by the very next move. `square` is the capture target (the
// square the double-stepped pawn passed over); `pawnSquare` is where that pawn
// now sits and is the cell actually emptied by an en-passant capture.
export interface EnPassant {
  board: BoardId;
  square: number;
  pawnSquare: number;
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
  // The en-passant right available to the side to move, or null. Always null while
  // a placement chain is in flight (a double-step never captures), so it is NOT
  // part of `chainSignature`; `applyPlacement` asserts this invariant.
  enPassant: EnPassant | null;
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
    enPassant: null,
    phase: { kind: "awaitingMove" },
  };
}

// The en-passant target square for `board`, or null — board-filtered so movement
// generation only ever sees a same-board square.
function epTargetFor(state: GameState, board: BoardId): number | null {
  return state.enPassant && state.enPassant.board === board ? state.enPassant.square : null;
}

// The last rank a pawn of `color` promotes on (white rank 8 / black rank 1).
function promotionRank(color: Color): number {
  return color === "white" ? 7 : 0;
}

// Legal destinations for the piece on `from`, but only for the side to move and
// only while awaiting a move. Returns [] otherwise (including for empty squares
// or opponent pieces).
export function legalMovesFrom(state: GameState, board: BoardId, from: number): number[] {
  if (state.phase.kind !== "awaitingMove") return [];
  const piece = state.boards[board][from];
  if (!piece || piece.color !== state.turn) return [];
  return legalDestinations(state.boards[board], from, epTargetFor(state, board));
}

// Every legal move for the side to move across both boards. Useful for a
// random-legal-move bot and for tests; not used in the hot path.
export function allLegalMoves(state: GameState): Move[] {
  if (state.phase.kind !== "awaitingMove") return [];
  const moves: Move[] = [];
  for (const board of [0, 1] as BoardId[]) {
    const cells = state.boards[board];
    const epTarget = epTargetFor(state, board);
    for (let from = 0; from < cells.length; from++) {
      const piece = cells[from];
      if (!piece || piece.color !== state.turn) continue;
      for (const to of legalDestinations(cells, from, epTarget)) {
        // A pawn reaching its last rank must promote: expand into one Move per
        // promotion target so a random-legal bot never emits an illegal
        // promotionless move.
        if (piece.type === "pawn" && rankOf(to) === promotionRank(piece.color)) {
          for (const promotion of PROMOTABLE) moves.push({ board, from, to, promotion });
        } else {
          moves.push({ board, from, to });
        }
      }
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

// Shared tail for every capture path (normal, en-passant, promoting capture): the
// king-win check, then enter the placement chain seeded with the first config.
// `enPassant` is always cleared here — a capture never leaves a dangling EP right.
function enterCaptureResolution(
  turn: Color,
  boards: [Board, Board],
  priorKingCaptures: { white: number; black: number },
  captureBoard: BoardId,
  captured: Piece,
): GameState {
  const kingCaptures = { ...priorKingCaptures };
  if (captured.type === "king") {
    kingCaptures[captured.color] += 1;
    if (kingCaptures[captured.color] >= 2) {
      return {
        boards,
        turn,
        kingCaptures,
        enPassant: null,
        phase: {
          kind: "gameOver",
          outcome: { result: "win", winner: opponent(captured.color), reason: "kingCaptured" },
        },
      };
    }
  }

  const pending: PendingPlacement = {
    piece: { type: captured.type, color: captured.color },
    board: otherBoard(captureBoard),
    visited: [],
  };
  pending.visited.push(chainSignature(boards, kingCaptures, turn, pending));

  return {
    boards,
    turn,
    kingCaptures,
    enPassant: null,
    phase: { kind: "awaitingPlacement", pending },
  };
}

// Castling (no-check variant): king already validated as a two-square home move.
// Relocates the rook to the square the king crossed; never captures.
function applyCastle(
  state: GameState,
  board: BoardId,
  from: number,
  to: number,
  color: Color,
): GameState {
  const backRank = color === "white" ? 0 : 7;
  const kingside = fileOf(to) > fileOf(from); // king -> g (file 6) vs c (file 2)
  const rookFrom = idx(kingside ? 7 : 0, backRank);
  const rookTo = idx(kingside ? 5 : 3, backRank);

  const boards = cloneBoards(state);
  boards[board][to] = boards[board][from];
  boards[board][from] = null;
  boards[board][rookTo] = boards[board][rookFrom];
  boards[board][rookFrom] = null;

  return {
    boards,
    turn: opponent(state.turn),
    kingCaptures: { ...state.kingCaptures },
    enPassant: null,
    phase: { kind: "awaitingMove" },
  };
}

// En-passant capture: advance the pawn to the empty target and remove the pawn on
// `pawnSquare`, which then enters the normal placement/chain mechanic. The victim
// is verified to be an opposing pawn rather than trusted from stored state.
function applyEnPassant(
  state: GameState,
  board: BoardId,
  from: number,
  to: number,
  pawnSquare: number,
): GameState {
  // The captured pawn must sit on the file of the target square, exactly one rank
  // "behind" it relative to the capturer's direction of travel — i.e. the square an
  // opponent double-stepping pawn would occupy. Verifying the geometry (not just
  // "some opposing pawn exists") makes a malformed state fail at the invariant.
  const dir = state.turn === "white" ? 1 : -1;
  const expectedPawnSquare = idx(fileOf(to), rankOf(to) - dir);
  const victim = state.boards[board][pawnSquare];
  if (
    pawnSquare !== expectedPawnSquare ||
    !victim ||
    victim.type !== "pawn" ||
    victim.color === state.turn
  ) {
    throw new Error(
      `en-passant invariant violated: expected an opposing pawn on board ${board} at ${squareToAlgebraic(expectedPawnSquare)}`,
    );
  }

  const boards = cloneBoards(state);
  boards[board][to] = boards[board][from];
  boards[board][from] = null;
  boards[board][pawnSquare] = null;

  return enterCaptureResolution(state.turn, boards, state.kingCaptures, board, {
    type: victim.type,
    color: victim.color,
  });
}

// Arms the en-passant right iff this move was a pawn double-step; null otherwise.
function doubleStepEnPassant(
  board: BoardId,
  from: number,
  to: number,
  mover: Piece,
): EnPassant | null {
  if (mover.type !== "pawn") return null;
  const dir = mover.color === "white" ? 1 : -1;
  const homeRank = mover.color === "white" ? 1 : 6;
  if (
    rankOf(from) === homeRank &&
    fileOf(from) === fileOf(to) &&
    rankOf(to) === rankOf(from) + 2 * dir
  ) {
    return { board, square: idx(fileOf(from), rankOf(from) + dir), pawnSquare: to };
  }
  return null;
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
  const epTarget = epTargetFor(state, board);
  if (!legalDestinations(state.boards[board], from, epTarget).includes(to)) {
    throw new IllegalMoveError(
      "ILLEGAL_DESTINATION",
      `${squareToAlgebraic(from)}->${squareToAlgebraic(to)} on board ${board} is not a legal move`,
    );
  }

  // Promotion validity is resolved BEFORE any mutation. Only a pawn landing on its
  // last rank may carry a `promotion` — and it MUST. This same guard rejects a
  // stray `promotion` on castling / en-passant / non-pawn moves.
  const isPromotion = mover.type === "pawn" && rankOf(to) === promotionRank(mover.color);
  if (move.promotion !== undefined && !isPromotion) {
    throw new IllegalMoveError(
      "INVALID_PROMOTION",
      `promotion is only legal when a pawn reaches its last rank (got ${squareToAlgebraic(from)}->${squareToAlgebraic(to)})`,
    );
  }
  if (isPromotion && !isPromotionPiece(move.promotion)) {
    throw new IllegalMoveError(
      "INVALID_PROMOTION",
      `a pawn reaching its last rank must promote to knight|bishop|rook|queen (got ${String(move.promotion)})`,
    );
  }

  // Castling: the only two-file king move, generated by movement.ts only when it is
  // legal. It relocates the rook and never captures, so the turn simply flips.
  if (
    mover.type === "king" &&
    from === idx(4, mover.color === "white" ? 0 : 7) &&
    Math.abs(fileOf(to) - fileOf(from)) === 2
  ) {
    return applyCastle(state, board, from, to, mover.color);
  }

  // En passant: a pawn moving diagonally onto the empty target square an opponent
  // pawn just double-stepped over. The captured pawn sits on `pawnSquare`, which is
  // NOT the destination.
  if (
    mover.type === "pawn" &&
    state.enPassant !== null &&
    state.enPassant.board === board &&
    to === state.enPassant.square &&
    state.boards[board][to] === null
  ) {
    return applyEnPassant(state, board, from, to, state.enPassant.pawnSquare);
  }

  const boards = cloneBoards(state);
  const captured = boards[board][to];
  // On a promoting move the pawn becomes the chosen piece on arrival; any captured
  // occupant is still the piece that travels to the other board.
  boards[board][to] = isPromotion
    ? { type: move.promotion as PromotionPiece, color: mover.color }
    : boards[board][from];
  boards[board][from] = null;

  if (!captured) {
    // A non-capturing pawn double-step — and only that — arms the en-passant right.
    return {
      boards,
      turn: opponent(state.turn),
      kingCaptures: { ...state.kingCaptures },
      enPassant: doubleStepEnPassant(board, from, to, mover),
      phase: { kind: "awaitingMove" },
    };
  }

  return enterCaptureResolution(state.turn, boards, state.kingCaptures, board, captured);
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

  // Invariant: a placement chain is only ever entered from a capture, which clears
  // the en-passant right. So `enPassant` is always null here, and need not appear in
  // `chainSignature`. If this ever fires, EP must be folded into the signature.
  if (state.enPassant !== null) {
    throw new Error("invariant violated: enPassant must be null during a placement chain");
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
      enPassant: null,
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
        enPassant: null,
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
      enPassant: null,
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
    enPassant: null,
    phase: { kind: "awaitingPlacement", pending: nextPending },
  };
}
