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
// Castling and en passant are generated HERE so a single source of truth feeds
// both `legalMovesFrom` and `applyMove`'s validation:
//   - Castling (no-check variant): a king on its home square with a same-color
//     rook on the matching a/h home square and an empty path gains the two-square
//     target (g/c file). NO check / through-check / into-check rules — kings may
//     castle through or into attacked squares. No capture by castling. Because it
//     is purely position-derived, castling "rights" revive whenever the home
//     positions are recreated (consistent with the stateless pawn double-step).
//   - En passant needs one bit of out-of-board state (the target square passed
//     over by an opponent double-step), threaded in via `enPassantTarget`. The
//     engine board-filters it so this module only ever sees a same-board square.
//
// Promotion is NOT a geometry concern: a promoting pawn's destination squares are
// the ordinary last-rank squares; the engine transforms the piece on arrival.
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
//
// `enPassantTarget` is the en-passant capture square for THIS board (the square a
// just-double-stepped opponent pawn passed over), or null. The engine board-filters
// it before calling, so a non-null value is always same-board.
export function legalDestinations(
  board: Board,
  from: number,
  enPassantTarget: number | null = null,
): number[] {
  const piece = board[from];
  if (!piece) return [];

  let dests: number[];
  switch (piece.type) {
    case "pawn":
      dests = pawnDestinations(board, from, piece, enPassantTarget);
      break;
    case "knight":
      dests = stepDestinations(board, from, piece, KNIGHT_OFFSETS);
      break;
    case "king":
      dests = stepDestinations(board, from, piece, KING_OFFSETS).concat(
        castlingDestinations(board, from, piece),
      );
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

function pawnDestinations(
  board: Board,
  from: number,
  piece: Piece,
  enPassantTarget: number | null,
): number[] {
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

  // Diagonal captures: an opponent piece, OR (en passant) the empty target square
  // an opponent pawn just double-stepped over. The engine has already confirmed
  // `enPassantTarget` belongs to this board.
  for (const df of [-1, 1]) {
    const nf = f + df;
    const nr = r + dir;
    if (!inBounds(nf, nr)) continue;
    const to = idx(nf, nr);
    const occ = board[to];
    if (occ) {
      if (occ.color !== piece.color) out.push(to);
    } else if (enPassantTarget !== null && to === enPassantTarget) {
      out.push(to);
    }
  }

  return out;
}

// Castling (no-check variant), purely position-derived. A king on its home square
// (e1/e8) with a SAME-COLOR rook on the matching a/h home square on this board and
// an empty path gains the two-square king target. There is no check / through-check
// / into-check restriction here, and castling never captures (the path is empty).
function castlingDestinations(board: Board, from: number, piece: Piece): number[] {
  if (piece.type !== "king") return [];
  const backRank = piece.color === "white" ? 0 : 7;
  if (from !== idx(4, backRank)) return []; // king must be on its home square
  const out: number[] = [];

  const sameColorRook = (square: number): boolean => {
    const cell = board[square];
    return cell !== null && cell.type === "rook" && cell.color === piece.color;
  };
  const empty = (file: number): boolean => board[idx(file, backRank)] === null;

  // Kingside: h-rook, f & g empty, king -> g (file 6).
  if (sameColorRook(idx(7, backRank)) && empty(5) && empty(6)) {
    out.push(idx(6, backRank));
  }
  // Queenside: a-rook, b, c & d empty, king -> c (file 2).
  if (sameColorRook(idx(0, backRank)) && empty(1) && empty(2) && empty(3)) {
    out.push(idx(2, backRank));
  }

  return out;
}
