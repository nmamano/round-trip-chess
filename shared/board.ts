// Board model + square helpers for Round-Trip Chess.
// Pure and browser-safe: no I/O, no Bun/server imports.
//
// Square indexing: idx = rank * 8 + file, with file a=0..h=7 and rank 0 = chess
// rank 1 (White's back rank). So a1 = 0, h1 = 7, a8 = 56, e1 = 4, e8 = 60.

import { NUM_SQUARES } from "./config";

export type Color = "white" | "black";
export type PieceType = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export interface Piece {
  type: PieceType;
  color: Color;
}

export type Cell = Piece | null;
export type Board = Cell[]; // length NUM_SQUARES (64)

// There are two boards. Board 0 starts as a standard chess setup; board 1 starts
// empty. A capture on one board sends the captured piece to the other.
export type BoardId = 0 | 1;

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

export function idx(file: number, rank: number): number {
  return rank * 8 + file;
}

export function fileOf(square: number): number {
  return square % 8;
}

export function rankOf(square: number): number {
  return Math.floor(square / 8);
}

export function inBounds(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

export function squareToAlgebraic(square: number): string {
  if (square < 0 || square >= NUM_SQUARES) throw new Error(`square out of range: ${square}`);
  return "abcdefgh"[fileOf(square)] + String(rankOf(square) + 1);
}

export function algebraicToSquare(name: string): number {
  const s = name.toLowerCase();
  if (s.length !== 2) throw new Error(`invalid algebraic square: ${name}`);
  const file = s.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(s[1]) - 1;
  if (!Number.isInteger(rank) || !inBounds(file, rank)) {
    throw new Error(`invalid algebraic square: ${name}`);
  }
  return idx(file, rank);
}

// ---------------------------------------------------------------------------
// Valid starting squares (the placement targets for a captured piece)
// ---------------------------------------------------------------------------
//
// A captured piece is placed by the capturer on one of the valid starting
// squares for its type and color (see PROMPT §4). These are board-relative and
// identical on both boards. Arrays are sorted ascending and deterministic.

function startingSquaresFor(type: PieceType, color: Color): number[] {
  const backRank = color === "white" ? 0 : 7;
  const pawnRank = color === "white" ? 1 : 6;
  let squares: number[];
  switch (type) {
    case "pawn":
      squares = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => idx(f, pawnRank));
      break;
    case "rook":
      squares = [idx(0, backRank), idx(7, backRank)];
      break;
    case "knight":
      squares = [idx(1, backRank), idx(6, backRank)];
      break;
    case "bishop":
      squares = [idx(2, backRank), idx(5, backRank)];
      break;
    case "queen":
      squares = [idx(3, backRank)];
      break;
    case "king":
      squares = [idx(4, backRank)];
      break;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
  return squares.sort((a, b) => a - b);
}

const PIECE_TYPES: PieceType[] = ["pawn", "knight", "bishop", "rook", "queen", "king"];

export const STARTING_SQUARES: Record<PieceType, Record<Color, number[]>> = (() => {
  const table = {} as Record<PieceType, Record<Color, number[]>>;
  for (const type of PIECE_TYPES) {
    table[type] = {
      white: startingSquaresFor(type, "white"),
      black: startingSquaresFor(type, "black"),
    };
  }
  return table;
})();

// ---------------------------------------------------------------------------
// Board construction / cloning
// ---------------------------------------------------------------------------

export function emptyBoard(): Board {
  return new Array<Cell>(NUM_SQUARES).fill(null);
}

const BACK_RANK: PieceType[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

export function initialBoard(): Board {
  const board = emptyBoard();
  for (let file = 0; file < 8; file++) {
    board[idx(file, 0)] = { type: BACK_RANK[file], color: "white" };
    board[idx(file, 1)] = { type: "pawn", color: "white" };
    board[idx(file, 6)] = { type: "pawn", color: "black" };
    board[idx(file, 7)] = { type: BACK_RANK[file], color: "black" };
  }
  return board;
}

export function cloneBoard(board: Board): Board {
  return board.map((cell) => (cell ? { type: cell.type, color: cell.color } : null));
}
