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
