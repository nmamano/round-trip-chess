// Pseudo-legal movement generation for a single board.
// Pure and browser-safe: no I/O, no Bun/server imports.
//
// Scope: standard chess geometry only — sliding blockers, pawn forward / double
// from home rank / diagonal capture, and knight/king single steps. A NORMAL move
// may capture an OPPONENT piece only and may never land on a same-color piece.
//
// Permanently excluded (Round-Trip Chess is king-capture based, with NO
// checkmate): check, king safety, and pins. Kings may move into and along
// attacked lines — you win by actually capturing the king.
//
// NOT YET implemented but IN SCOPE per Nil (planned next — see HANDOFF-NEXT.md):
// castling, en passant, and promotion. Each needs deliberate design for the
// two-board variant (e.g. castling has no "through check" rule here; promotion
// interacts with the capture->placement mechanic). Until then this module is
// plain pseudo-legal geometry.
//
// "Legal" here means geometrically legal for the piece on `from`; the engine
// layer enforces side-to-move and resolves captures.

import type { Board, Piece } from "./board";
import { fileOf, idx, inBounds, rankOf } from "./board";

type Offset = readonly [number, number];

const ROOK_DIRS: readonly Offset[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const BISHOP_DIRS: readonly Offset[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const QUEEN_DIRS: readonly Offset[] = [...ROOK_DIRS, ...BISHOP_DIRS];

const KNIGHT_OFFSETS: readonly Offset[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const KING_OFFSETS: readonly Offset[] = [...ROOK_DIRS, ...BISHOP_DIRS];

// Returns the geometrically legal destination squares for the piece on `from`,
// sorted ascending for deterministic output. Empty if `from` is empty.
export function legalDestinations(board: Board, from: number): number[] {
  const piece = board[from];
  if (!piece) return [];

  let dests: number[];
  switch (piece.type) {
    case "pawn":
      dests = pawnDestinations(board, from, piece);
      break;
    case "knight":
      dests = stepDestinations(board, from, piece, KNIGHT_OFFSETS);
      break;
    case "king":
      dests = stepDestinations(board, from, piece, KING_OFFSETS);
      break;
    case "bishop":
      dests = slideDestinations(board, from, piece, BISHOP_DIRS);
      break;
    case "rook":
      dests = slideDestinations(board, from, piece, ROOK_DIRS);
      break;
    case "queen":
      dests = slideDestinations(board, from, piece, QUEEN_DIRS);
      break;
    default: {
      const exhaustive: never = piece.type;
      return exhaustive;
    }
  }
  return dests.sort((a, b) => a - b);
}

function stepDestinations(
  board: Board,
  from: number,
  piece: Piece,
  offsets: readonly Offset[],
): number[] {
  const f = fileOf(from);
  const r = rankOf(from);
  const out: number[] = [];
  for (const [df, dr] of offsets) {
    const nf = f + df;
    const nr = r + dr;
    if (!inBounds(nf, nr)) continue;
    const to = idx(nf, nr);
    const occ = board[to];
    if (!occ || occ.color !== piece.color) out.push(to);
  }
  return out;
}

function slideDestinations(
  board: Board,
  from: number,
  piece: Piece,
  dirs: readonly Offset[],
): number[] {
  const f = fileOf(from);
  const r = rankOf(from);
  const out: number[] = [];
  for (const [df, dr] of dirs) {
    let nf = f + df;
    let nr = r + dr;
    while (inBounds(nf, nr)) {
      const to = idx(nf, nr);
      const occ = board[to];
      if (!occ) {
        out.push(to);
      } else {
        if (occ.color !== piece.color) out.push(to); // capture opponent, then stop
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  return out;
}

function pawnDestinations(board: Board, from: number, piece: Piece): number[] {
  const f = fileOf(from);
  const r = rankOf(from);
  const dir = piece.color === "white" ? 1 : -1;
  const homeRank = piece.color === "white" ? 1 : 6;
  const out: number[] = [];

  // Forward one (must be empty), then forward two from the home rank.
  const oneRank = r + dir;
  if (inBounds(f, oneRank) && !board[idx(f, oneRank)]) {
    out.push(idx(f, oneRank));
    const twoRank = r + 2 * dir;
    if (r === homeRank && inBounds(f, twoRank) && !board[idx(f, twoRank)]) {
      out.push(idx(f, twoRank));
    }
  }

  // Diagonal captures (opponent only). No en passant.
  for (const df of [-1, 1]) {
    const nf = f + df;
    const nr = r + dir;
    if (!inBounds(nf, nr)) continue;
    const occ = board[idx(nf, nr)];
    if (occ && occ.color !== piece.color) out.push(idx(nf, nr));
  }

  return out;
}
