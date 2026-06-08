// Advisory, client-side move highlighting. The browser-safe shared/ engine is
// reused ONLY to compute legal destinations for the side to move; the SERVER
// remains the sole authority on legality and chain resolution. Nothing here is
// ever trusted; it just decorates the board.

import type { RoomSnapshot } from "@shared/protocol";
import type { Board, BoardId } from "@shared/board";
import type { GameState } from "@shared/engine";
import { rankOf } from "@shared/board";
import { legalMovesFrom } from "@shared/engine";

// Rebuild a minimal GameState from the snapshot, valid ONLY for the
// awaitingMove case (HANDOFF-NEXT §1). During a chain the snapshot already
// carries the valid placement squares in phase.options, so the engine is never
// consulted there.
function reconstruct(s: RoomSnapshot): GameState {
  return {
    boards: s.boards,
    turn: s.turn,
    kingCaptures: s.kingCaptures,
    enPassant: s.enPassant, // included so en-passant targets highlight correctly
    phase: { kind: "awaitingMove" },
  };
}

/** Legal destination squares for the piece on `from`, or [] when not movable. */
export function legalTargetsFor(s: RoomSnapshot, board: BoardId, from: number): number[] {
  if (s.phase.kind !== "awaitingMove") return [];
  return legalMovesFrom(reconstruct(s), board, from);
}

/** True iff moving `from`→`to` lands a pawn on its last rank (promotion required). */
export function needsPromotion(cells: Board, from: number, to: number): boolean {
  const p = cells[from];
  if (!p || p.type !== "pawn") return false;
  return rankOf(to) === (p.color === "white" ? 7 : 0);
}
