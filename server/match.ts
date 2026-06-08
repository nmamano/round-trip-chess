// Authoritative match state machine: a thin wrapper over the pure rules engine.
//
// The engine (shared/engine.ts) owns ALL chess rules and is immutable — every
// applyMove/applyPlacement returns a fresh GameState. Match holds the current
// state, enforces TURN OWNERSHIP (which the pure engine intentionally has no
// concept of — it knows pieces and colors, not "players"), maps engine errors to
// protocol error codes, and projects a client-facing snapshot.
//
// Deliberately timer-free and socket-free: the Room owns sockets, presence, and
// the single reconnect-grace timer. Chess (this slice) has no gameplay clock, so
// unlike rps-roulette there is no `version` / stale-timer machinery here.

import {
  initialState,
  applyMove,
  applyPlacement,
  placementOptions,
  IllegalMoveError,
  IllegalPlacementError,
} from "../shared/engine";
import type { GameState, Move, Phase } from "../shared/engine";
import { cloneBoard } from "../shared/board";
import type { Color } from "../shared/board";
import type {
  PlayerId,
  PlayerView,
  RoomSnapshot,
  SnapshotPhase,
  ErrorCode,
} from "../shared/protocol";

export interface MatchPlayer {
  id: PlayerId;
  name: string;
  connected: boolean;
}

// The first-game color mapping: the creator (p1) is White and moves first.
// Colors then ALTERNATE every New Game (see Match.newGame), so the live mapping
// comes from Match.colorOf / Room.colorOf. This static default only seeds game 1
// and the pre-match waiting snapshot.
export function colorOf(pid: PlayerId): Color {
  return pid === "p1" ? "white" : "black";
}

export interface ActionError {
  code: ErrorCode;
  message: string;
}
export type ActionResult = { ok: true } | { ok: false; error: ActionError };

const OK: ActionResult = { ok: true };
function fail(code: ErrorCode, message: string): ActionResult {
  return { ok: false, error: { code, message } };
}

// Deep-copy a Phase so a cloned GameState shares no mutable structure with the
// original (boards, the chain's `visited` array, etc.).
function clonePhase(p: Phase): Phase {
  switch (p.kind) {
    case "awaitingMove":
      return { kind: "awaitingMove" };
    case "awaitingPlacement":
      return {
        kind: "awaitingPlacement",
        pending: {
          piece: { ...p.pending.piece },
          board: p.pending.board,
          visited: p.pending.visited.slice(),
        },
      };
    case "gameOver":
      return { kind: "gameOver", outcome: { ...p.outcome } };
  }
}

// Defensive deep copy of a GameState. The engine itself is immutable (it clones
// before mutating), so the only corruption risk is a caller holding a reference to
// a seed/initial state and mutating it after construction — this severs that.
function cloneState(s: GameState): GameState {
  return {
    boards: [cloneBoard(s.boards[0]), cloneBoard(s.boards[1])],
    turn: s.turn,
    kingCaptures: { ...s.kingCaptures },
    enPassant: s.enPassant ? { ...s.enPassant } : null,
    phase: clonePhase(s.phase),
  };
}

export class Match {
  private state: GameState;
  // Which player holds White THIS game. Starts as p1 (the creator) and flips on
  // every New Game so the two players alternate colors across games. Player
  // identities (p1/p2) and reconnect tokens never change.
  private whitePid: PlayerId = "p1";

  // `initial` is primarily a test/seed seam (drive chain/gameOver positions
  // directly). The engine validates every subsequent transition regardless, so
  // server authority is unaffected. Defaults to the standard opening.
  constructor(
    readonly players: { p1: MatchPlayer; p2: MatchPlayer },
    initial: GameState = initialState(),
  ) {
    // Clone the seed so a caller mutating `initial` afterward can't corrupt us.
    this.state = cloneState(initial);
  }

  colorOf(pid: PlayerId): Color {
    return pid === this.whitePid ? "white" : "black";
  }

  get phaseKind(): GameState["phase"]["kind"] {
    return this.state.phase.kind;
  }

  isOver(): boolean {
    return this.state.phase.kind === "gameOver";
  }

  /** Apply a move for `pid`. Turn ownership is checked before the engine runs. */
  move(pid: PlayerId, move: Move): ActionResult {
    if (this.colorOf(pid) !== this.state.turn) {
      return fail("not_your_turn", "It is not your turn.");
    }
    try {
      this.state = applyMove(this.state, move);
      return OK;
    } catch (e) {
      if (e instanceof IllegalMoveError) {
        return fail(e.code === "WRONG_PHASE" ? "bad_phase" : "illegal_move", e.message);
      }
      throw e; // unexpected → a real bug; let it surface
    }
  }

  /**
   * Apply a placement for `pid` during a chain. The turn does NOT flip mid-chain,
   * so the resolver is still `state.turn` — the same ownership rule as `move`.
   */
  place(pid: PlayerId, square: number): ActionResult {
    if (this.colorOf(pid) !== this.state.turn) {
      return fail("not_your_turn", "It is not your turn.");
    }
    try {
      this.state = applyPlacement(this.state, square);
      return OK;
    } catch (e) {
      if (e instanceof IllegalPlacementError) {
        return fail(e.code === "WRONG_PHASE" ? "bad_phase" : "illegal_placement", e.message);
      }
      throw e;
    }
  }

  /**
   * Start a fresh game. Allowed only once the current game is over (MVP: no
   * mid-game abort/rematch). Returns false (a no-op) otherwise.
   */
  newGame(): boolean {
    if (this.state.phase.kind !== "gameOver") return false;
    // Alternate colors each game: whoever was Black now plays White (and moves
    // first). Player identities (p1/p2) and tokens are unchanged.
    this.whitePid = this.whitePid === "p1" ? "p2" : "p1";
    this.state = initialState();
    return true;
  }

  /**
   * Player-agnostic snapshot. Boards are CLONED so neither tests nor server
   * internals can mutate engine-owned state through the returned object, and the
   * internal `pending.visited` is never projected.
   */
  snapshot(code: string): RoomSnapshot {
    return {
      code,
      lobby: "active",
      players: this.playerViews(),
      boards: [cloneBoard(this.state.boards[0]), cloneBoard(this.state.boards[1])],
      turn: this.state.turn,
      kingCaptures: { ...this.state.kingCaptures },
      enPassant: this.state.enPassant ? { ...this.state.enPassant } : null,
      phase: this.projectPhase(),
    };
  }

  private playerViews(): PlayerView[] {
    return (["p1", "p2"] as const).map((id) => ({
      id,
      color: this.colorOf(id),
      name: this.players[id].name,
      connected: this.players[id].connected,
    }));
  }

  private projectPhase(): SnapshotPhase {
    const phase = this.state.phase;
    switch (phase.kind) {
      case "awaitingMove":
        return { kind: "awaitingMove" };
      case "awaitingPlacement":
        return {
          kind: "awaitingPlacement",
          piece: { ...phase.pending.piece },
          board: phase.pending.board,
          options: placementOptions(this.state), // derived; never the stored array
        };
      case "gameOver":
        return { kind: "gameOver", outcome: phase.outcome };
    }
  }
}

/**
 * The snapshot shown in the waiting room, before a second player joins and the
 * Match is created. Renders the standard opening so the board isn't blank while
 * the creator waits. Only ever sent to the creator (no opponent to broadcast to).
 */
export function waitingSnapshot(code: string, creator: MatchPlayer): RoomSnapshot {
  const s = initialState();
  return {
    code,
    lobby: "waiting",
    players: [
      {
        id: creator.id,
        color: colorOf(creator.id),
        name: creator.name,
        connected: creator.connected,
      },
    ],
    boards: [cloneBoard(s.boards[0]), cloneBoard(s.boards[1])],
    turn: s.turn,
    kingCaptures: { ...s.kingCaptures },
    enPassant: s.enPassant, // null in the initial state
    phase: { kind: "awaitingMove" },
  };
}
