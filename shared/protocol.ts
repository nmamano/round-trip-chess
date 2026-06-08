// The client⇄server wire protocol. Imported by both the server and the frontend,
// so it must stay browser-safe: types only, plus the pure engine types.

import type { Board, BoardId, Color, Piece } from "./board";
import type { EnPassant, Outcome, PromotionPiece } from "./engine";

export type PlayerId = "p1" | "p2";

// Room lifecycle, distinct from the engine's per-turn phase. "waiting" = no
// opponent yet (the Match does not exist); "active" = a game is running. A
// finished game is still "active" — gameOver lives inside the engine phase (see
// SnapshotPhase), so the board and final outcome keep rendering.
export type LobbyPhase = "waiting" | "active";

export interface PlayerView {
  id: PlayerId;
  color: Color; // The side this player holds THIS game; alternates each New Game (p1 is White for game 1).
  name: string;
  connected: boolean;
}

// Client-facing projection of the engine's Phase. Deliberately NOT the engine's
// PendingPlacement: `pending.visited` is internal chain loop-detection metadata
// and must never reach a client. Instead, awaiting-placement surfaces the derived
// valid placement squares.
export type SnapshotPhase =
  | { kind: "awaitingMove" }
  | { kind: "awaitingPlacement"; piece: Piece; board: BoardId; options: number[] }
  | { kind: "gameOver"; outcome: Outcome };

/**
 * The full, player-AGNOSTIC view of a room the server broadcasts to every client.
 *
 * Round-Trip Chess is perfect information: there is NO hidden-pick anti-cheat, so
 * one identical snapshot is sent to both players. Per-client identity (your
 * PlayerId/Color and your reconnect token) is delivered once, in `joined` —
 * never in a broadcast.
 */
export interface RoomSnapshot {
  code: string;
  lobby: LobbyPhase;
  players: PlayerView[];
  boards: [Board, Board];
  turn: Color;
  kingCaptures: { white: number; black: number };
  enPassant: EnPassant | null; // public chess state; needed for UI legality hints
  phase: SnapshotPhase;
}

// ---- client → server -------------------------------------------------------

export type ClientMsg =
  | { t: "create"; name: string }
  | { t: "join"; code: string; name: string }
  | { t: "reconnect"; code: string; token: string }
  | { t: "move"; board: BoardId; from: number; to: number; promotion?: PromotionPiece }
  | { t: "place"; square: number }
  | { t: "newGame" }
  | { t: "leave" };

// ---- server → client -------------------------------------------------------

export type ErrorCode =
  | "room_not_found"
  | "room_full"
  | "bad_token"
  | "not_your_turn" // protocol-level: acting out of turn (distinct from engine ownership)
  | "illegal_move"
  | "illegal_placement"
  | "bad_phase"
  | "bad_message";

export type ServerMsg =
  // `you`, `color`, and `token` are returned ONLY here — never in a broadcast.
  | { t: "joined"; code: string; you: PlayerId; color: Color; token: string; state: RoomSnapshot }
  | { t: "state"; state: RoomSnapshot } // pushed on every transition
  | { t: "opponentLeft" }
  | { t: "error"; code: ErrorCode; message: string };
