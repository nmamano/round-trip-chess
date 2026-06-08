# Round-Trip Chess — Hand-Off for the Next Session

You are continuing the build of **Round-Trip Chess**. The pure rules engine is
done and committed; your job is to (A) finish the remaining engine rules that are
now in scope, then (B) build the server, (C) the frontend, and (D) deploy.

**`PROMPT.md` is the authoritative game spec** and wins any rules conflict (flag
conflicts to Nil rather than guessing). `HANDOFF.md` is the original end-to-end
brief. This file (`HANDOFF-NEXT.md`) is the delta: what's already built and what
to do next.

---

## 0. Current status (what exists)

- Commit `339bfbb` on `master`: the pure `shared/` rules engine + tests.
- `bun run ci` is **green**: prettier + eslint + tsc + 46 tests / 335 assertions.
- Run it: `cd ~/nil/round-trip-chess && bun install && bun run ci`.

Files:

- `shared/board.ts` — board model (`idx = rank*8 + file`, a1 = 0), square↔algebraic
  helpers, `STARTING_SQUARES[type][color]` (the PROMPT §4 placement table),
  `initialBoard`/`emptyBoard`/`cloneBoard`.
- `shared/movement.ts` — pure per-piece pseudo-legal geometry. **Geometry only:
  no check / king-safety / pins** (permanent — king-capture variant). Castling /
  en passant / promotion are NOT here yet (see §2).
- `shared/engine.ts` — the turn state machine and public API (see §1).
- `shared/config.ts` — tunables + `MAX_CHAIN_ITERATIONS` (assertion ceiling).
- `tests/` — per-piece movement truth tables + scripted engine scenarios
  (chains, king round-trip, infinite loop, phase guards, boundary errors).

---

## 1. Engine API (already built — consume / extend, don't rewrite)

```ts
initialState(): GameState
legalMovesFrom(state, board, from): number[]      // side-to-move + awaitingMove only
allLegalMoves(state): Move[]                       // for a random-legal bot / tests
placementOptions(state): number[]                  // derived from pending piece
applyMove(state, move): GameState                  // move = { board, from, to }
applyPlacement(state, square): GameState
```

State shape:

```ts
GameState = {
  boards: [Board, Board];                 // Board 0 = standard, Board 1 = empty
  turn: Color;                            // "white" | "black"
  kingCaptures: { white: number; black: number };
  phase:
    | { kind: "awaitingMove" }
    | { kind: "awaitingPlacement"; pending: { piece, board, visited } }
    | { kind: "gameOver"; winner: Color; reason: "kingCaptured" | "infiniteLoop" };
}
```

Errors: `IllegalMoveError` (`WRONG_PHASE | INVALID_BOARD | INVALID_SQUARE |
NO_PIECE | WRONG_OWNER | ILLEGAL_DESTINATION`) and `IllegalPlacementError`
(`WRONG_PHASE | INVALID_SQUARE | ILLEGAL_SQUARE`). The engine throws on illegal
input; the server pre-validates and maps these to protocol errors.

`pending.visited` is **internal** chain loop-detection metadata — must NOT be
projected into the client-facing snapshot.

---

## 2. Locked-in design decisions (resolved by Nil)

1. **Capture → placement → chain.** A capture sends the captured piece to the
   OTHER board; the capturer places it on a valid starting square for its
   type/color. Landing on an occupied square captures that piece too (even your
   OWN) and continues the chain. The active player resolves the whole chain; the
   turn flips only when a placement lands on an empty square.
2. **King win.** `kingCaptures[C]` increments on ANY capture of king C (normal
   move or chain placement). Reaching 2 ⇒ game over, winner = opponent(C).
   **Self-capturing your own king to its 2nd capture loses** — confirmed correct
   (counter-intuitive but intentional; tested).
3. **Infinite loop ⇒ the triggering (active) player WINS** (PROMPT §2). Detected
   by configuration-repeat within a single chain (signature = both boards + king
   counters + side-to-move + pending piece/board), seeded with the first chain
   config. Hard iteration cap **asserts** (throws) rather than declaring a winner.
   ⚠️ OPEN: Nil described the loop case as "equivalent to stalemate." The engine
   currently scores it as a WIN for the trigger (per PROMPT §2). Confirm with Nil
   whether to keep win or change to draw before relying on it.
4. **No-legal-move / passing:** effectively unreachable in this variant (a king
   can almost always capture or step); not specially handled — `legalMovesFrom`
   just returns `[]`. The real terminal edge is the infinite loop above.
5. **Stateless pawn double-step**, keyed on the home rank (2 white / 7 black). A
   pawn placed back onto its home rank regains the double-step — confirmed
   correct.
6. Indexing `a1 = 0`, `idx = rank*8 + file`. No chess library — the variant
   rules are ours in `shared/`.

---

## 3. Remaining ENGINE work — now IN scope (do this first)

Nil confirmed **castling, en passant, and promotion are in scope.** These were
intentionally omitted from the first slice. Treat this as a fresh design round:
**send the plan + design proposals below to the reviewer (Game Reviewer) BEFORE
coding** (see §6), confirm the open questions with Nil, then implement engine-first
with exhaustive tests, same as the first slice.

Proposed designs below have already been **reviewed by Game Reviewer** (early
design pass); they are the recommended starting point. Still send the concrete
plan back to the reviewer before coding and confirm the Nil-facing items in §8.

- **Castling (no-check variant) — stateless.** Consistent with Nil's stateless
  pawn-double-step ruling, define it strictly as: king of the side-to-move on its
  home square (e1/e8), a **same-color** rook on its a/h home square **on the same
  board**, all intervening squares empty → king moves two squares, rook relocates.
  **No check / through-check / into-check rules. No capture by castling.** Because
  placement can recreate home positions, castling rights intentionally revive — no
  move-history/rights tracking. Encode as a king move of two squares from home
  (`Move` shape unchanged); `applyMove` also relocates the rook.
  Test matrix: both boards × both colors × king-/queen-side; blocked path;
  missing/wrong-color rook; and **revived castling after pieces are placed back**.
- **En passant.** Add `enPassant: { board, square, pawnSquare } | null` to
  `GameState` (store both the EP target square AND the captured pawn's square for
  validation clarity). Set **only** by a normal pawn double-step, **never** by
  placement; clear it when the opponent's next normal move successfully applies.
  Same-board only. An EP capture removes the pawn at `pawnSquare` (≠ destination),
  and that captured pawn enters the normal placement/chain mechanic on the other
  board. Invariant: `enPassant` should already be `null` during any
  `awaitingPlacement` chain — assert/test that; if it ever can co-exist with a
  chain, it MUST be added to `chainSignature` (the signature must represent full
  config).
- **Promotion — atomic on the move (recommended).** Add
  `move.promotion?: Exclude<PieceType, "pawn" | "king">` and resolve it **inside
  `applyMove`**, not via a separate phase. The UI prompts before sending the move.
  - Non-capturing promotion: move + promote, flip turn.
  - Promoting capture: move pawn, apply the chosen promotion immediately,
    increment the king counter if a king was captured, then if the move captured
    anything enter `awaitingPlacement` for the captured piece.
    This avoids a transient state where a pawn has moved/captured but the captured
    piece can't yet be placed, and keeps the server command model simpler. Pawns are
    only ever PLACED on rank 2/7, so placement never auto-promotes; promotion is via
    forward/diagonal movement only, on EITHER board.
  - _Alternative (only if product UX requires post-move selection):_ an explicit
    `awaitingPromotion` phase. It must carry enough frozen data to avoid
    recomputing the move: boards-after-move-with-unresolved-pawn, the captured
    piece (if any), `kingCaptures` after the capture event, and the next placement
    target board. More state to serialize/test — prefer the atomic form unless Nil
    asks otherwise.

Each feature: extend `shared/movement.ts` / `shared/engine.ts`, add truth-table
and scenario tests, keep `bun run ci` green.

---

## 4. Then: server slice (HANDOFF §3 step 2)

Mirror `~/nil/rps-roulette` (READ-ONLY reference — do not modify it):

- `shared/protocol.ts` — client/server message discriminated unions + the
  two-board `RoomSnapshot` (full state — chess is perfect information, NO
  hidden-pick anti-cheat), including the pending-placement / chain / promotion
  sub-states. Do NOT serialize `pending.visited`.
- `server/rooms.ts` — in-memory room store; sole owner of broadcasts; reconnect
  by room code + per-player token; reap empty/finished rooms.
- `server/match.ts` — wraps the engine; the authoritative turn + chain state
  machine; maps engine errors to protocol errors.
- `server/socket.ts` — dispatch; `createBunWebSocket` from `hono/bun`; default
  export `{ fetch, websocket }`; `error` ServerMsg shape; never fail silently.
- `tests/match.test.ts` — headless: legal move applies; capture → placement;
  chain resolves; king ×2 ⇒ game over with winner; reconnect resumes; New Game
  resets.
- Optional: trivial **random-legal-move bot** only (no real chess AI) using
  `allLegalMoves` + random `placementOptions` — behind a labeled "vs Bot" path.

---

## 5. Then: frontend, deploy

- Minimal Vite + React 19 frontend: create/join by code, render BOTH boards,
  click-to-move, placement picker, promotion picker. Wired to the real WS,
  driven purely by `RoomSnapshot`. Ugly is fine first.
- Port the v0 visuals (https://v0-round-trip-chess-variant.vercel.app/): two-board
  layout, `Current Turn`, king status (Safe / 1× / 2×), New Game, win banner
  `🎉 WHITE WINS! 🎉`, rules panel (copy verbatim from PROMPT §6), reconnect,
  don't-break-on-mobile (stack the boards).
  - **Board rendering choice (Nil to confirm at this step):** keep the board a
    pure projection of `RoomSnapshot` behind a thin `<Board snapshot onIntent>`
    wrapper so library-vs-hand-roll stays a swappable detail. Options: hand-roll
    (CSS grid + Unicode glyphs) for the tracer bullet; optionally **chessground**
    (lichess's renderer — prettiest, great highlight API for the placement picker)
    for the polished pass. Whatever you pick, use it as a DUMB renderer — never
    let a library enforce chess rules (would fight the variant).
- `Dockerfile` + `fly.toml` (single machine, `min_machines_running = 1`, no
  autoscale — in-memory state). `bun run ci` green. `fly deploy`, app slug
  `round-trip-chess`. Then play a real match across two devices.

---

## 6. Pairing protocol (if continuing the paired workflow)

Driver implements, **Game Reviewer** (agent id `agent-1780864878869-eq7t`,
model gpt-5.5, room "Parked Projects") reviews. Phases: scope solo → send the
design (files, approach, edge cases, the §3 open questions) to the reviewer
BEFORE coding → iterate → implement → share the diff for review → iterate.

**Every message to the reviewer MUST instruct them to reply by POSTing back to
the driver's agent endpoint** (a reply written only in their own chat never
reaches you):

```
curl -s -X POST localhost:4000/agents/<DRIVER_AGENT_ID>/message \
  -H 'Content-Type: application/json' \
  -d '{"text":"...","senderAgentId":"agent-1780864878869-eq7t"}'
```

Escalate to Nil only after design (if needed) and after implementation, or if you
hit 5 rounds without convergence / a cross-cutting architectural tradeoff.

---

## 7. Guardrails (unchanged)

Server-authoritative; in-memory only (no DB/login); single fly machine; minimal
deps; `shared/` stays browser-safe (no Bun/server imports); commit in logical
increments staging only your own changes; do NOT modify `~/nil/rps-roulette`.

---

## 8. Open questions to confirm with Nil before/while building §3

1. Infinite loop = **win for trigger** (current/PROMPT §2) vs **draw**
   ("equivalent to stalemate")? — reconcile before relying on it. ⚠️ If Nil
   chooses draw, `GameOverReason` + `Phase` need a dedicated **draw shape** (don't
   overload `winner`); settle this BEFORE the protocol/snapshot locks in.
2. **Stateless castling** (position-keyed, no move history) — acceptable, matching
   the pawn double-step precedent? (Reviewer: yes.)
3. **Promotion** — atomic `move.promotion` (reviewer-recommended) vs an explicit
   `awaitingPromotion` phase; confirm the piece-choice UX with two boards.
