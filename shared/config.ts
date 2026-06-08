// Centralized engine tunables. Browser-safe: constants only, no I/O, no imports
// that touch Bun/server. (Engine logic lives in board.ts / movement.ts /
// engine.ts.)

export const BOARD_SIZE = 8;
export const NUM_SQUARES = BOARD_SIZE * BOARD_SIZE;

// Defensive ceiling on chain-resolution steps within a single turn. Loop
// detection (repeated chain configuration) is the real termination guarantee and
// should always fire first; reaching this cap therefore indicates a signature
// bug, so the engine ASSERTS (throws) rather than declaring a winner — declaring
// a winner here could mask such a bug.
export const MAX_CHAIN_ITERATIONS = 1024;

// ---------------------------------------------------------------------------
// Server tunables. Consumed by server/ only, but kept here so shared/ remains
// the single source of truth for constants. Still browser-safe: plain values,
// no Bun/server imports.
// ---------------------------------------------------------------------------

// How long a room is kept alive after a player drops, so they can rejoin by code.
export const RECONNECT_GRACE_MS = 30000;

// Room code: short, unambiguous, uppercase, no look-alike characters.
export const CODE_LENGTH = 4;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Per-player reconnect token.
export const TOKEN_LENGTH = 24;
export const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Display name guardrails.
export const MAX_NAME_LENGTH = 20;
