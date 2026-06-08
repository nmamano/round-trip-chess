// Shared test utilities for building positions by hand.
import type { Board, Color, Piece, PieceType } from "../shared/board";
import { algebraicToSquare, emptyBoard } from "../shared/board";
import type { EnPassant, GameState } from "../shared/engine";

export const sq = algebraicToSquare;

export function pc(color: Color, type: PieceType): Piece {
  return { color, type };
}

export function put(board: Board, square: string, piece: Piece): void {
  board[algebraicToSquare(square)] = piece;
}

// Two empty boards, ready to be populated by hand.
export function emptyBoards(): [Board, Board] {
  return [emptyBoard(), emptyBoard()];
}

export function stateFrom(
  boards: [Board, Board],
  turn: Color = "white",
  kingCaptures: { white: number; black: number } = { white: 0, black: 0 },
  enPassant: EnPassant | null = null,
): GameState {
  return { boards, turn, kingCaptures, enPassant, phase: { kind: "awaitingMove" } };
}
