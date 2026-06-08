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

- On `master` (see `git log`): the pure `shared/` rules engine + tests, with
  infinite-loop scored as a **draw** (see §2.3) **and castling / en passant /
  promotion now built** (the §3 engine slice — see §2.7).
- `bun run ci` is **green**: prettier + eslint + tsc + 79 tests / 438 assertions.
- Run it: `cd ~/nil/round-trip-chess && bun install && bun run ci`.

Files:

- `shared/board.ts` — board model (`idx = rank*8 + file`, a1 = 0), square↔algebraic
  helpers, `STARTING_SQUARES[type][color]` (the PROMPT §4 placement table),
  `initialBoard`/`emptyBoard`/`cloneBoard`.
- `shared/movement.ts` — pure per-piece pseudo-legal geometry **plus castling and
  en-passant generation** (both position-derived; EP via an `enPassantTarget`
  param). **Still no check / king-safety / pins** (permanent — king-capture
  variant); castling is the no-check variant (§2.7).
- `shared/engine.ts` — the turn state machine and public API (see §1); now also
  resolves castling, en passant, and atomic promotion.
- `shared/config.ts` — tunables + `MAX_CHAIN_ITERATIONS` (assertion ceiling).
- `tests/` — per-piece movement truth tables + scripted engine scenarios
  (chains, king round-trip, infinite loop, phase guards, boundary errors) +
  `castling` / `enpassant` / `promotion` feature suites.

---

## 1. Engine API (already built — consume / extend, don't rewrite)

```ts
initialState(): GameState
legalMovesFrom(state, board, from): number[]      // side-to-move + awaitingMove only
allLegalMoves(state): Move[]                       // bot/tests; promoting pawn moves expand to Q/R/B/N
placementOptions(state): number[]                  // derived from pending piece
applyMove(state, move): GameState                  // move = { board, from, to, promotion? }
applyPlacement(state, square): GameState
```

State shape:

```ts
GameState = {
  boards: [Board, Board];                 // Board 0 = standard, Board 1 = empty
  turn: Color;                            // "white" | "black"
  kingCaptures: { white: number; black: number };
  enPassant: EnPassant | null;            // armed only by a double-step; null in any chain
  phase:
    | { kind: "awaitingMove" }
    | { kind: "awaitingPlacement"; pending: { piece, board, visited } }
    | { kind: "gameOver"; outcome: Outcome };
}

// move.promotion?: "knight" | "bishop" | "rook" | "queen"  (required iff a pawn lands on its last rank)
EnPassant = { board: BoardId; square: number; pawnSquare: number };

Outcome =
  | { result: "win"; winner: Color; reason: "kingCaptured" }
  | { result: "draw"; reason: "infiniteLoop" };
```

Errors: `IllegalMoveError` (`WRONG_PHASE | INVALID_BOARD | INVALID_SQUARE |
NO_PIECE | WRONG_OWNER | ILLEGAL_DESTINATION | INVALID_PROMOTION`) and
`IllegalPlacementError` (`WRONG_PHASE | INVALID_SQUARE | ILLEGAL_SQUARE`). The
engine throws on illegal input; the server pre-validates and maps these to protocol
errors. (`enPassant` is authoritative state; like `pending.visited` decide
deliberately what the client snapshot needs — the EP target is public info.)

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
3. **Infinite loop ⇒ DRAW** (Nil's ruling — "equivalent to stalemate"; this
   overrides PROMPT §2's "trigger wins"). Detected by configuration-repeat within
   a single chain (signature = both boards + king counters + side-to-move +
   pending piece/board), seeded with the first chain config. Hard iteration cap
   **asserts** (throws) rather than declaring an outcome. Modeled with a dedicated
   draw shape: `gameOver` carries an `Outcome`, and a draw is `{ result: "draw";
reason: "infiniteLoop" }` — never overloading `winner`. (PROMPT §2 still reads
   "trigger wins"; it is owned by Nil and left as-authored — this chat ruling wins.)
4. **No-legal-move / passing:** effectively unreachable in this variant (a king
   can almost always capture or step); not specially handled — `legalMovesFrom`
   just returns `[]`. The real terminal edge is the infinite loop above.
5. **Stateless pawn double-step**, keyed on the home rank (2 white / 7 black). A
   pawn placed back onto its home rank regains the double-step — confirmed
   correct.
6. Indexing `a1 = 0`, `idx = rank*8 + file`. No chess library — the variant
   rules are ours in `shared/`.
7. **Castling / en passant / promotion (engine slice — built & peer-reviewed).**
   - **Castling carries NO check restrictions** (confirmed by Nil): a king may
     castle out of, through, or onto an attacked square — exactly as a normal king
     may step into one, because there is **no check/checkmate concept anywhere** in
     this variant (see §2 / PROMPT §2). _Structurally_-illegal castling is still
     fully rejected: king must be on its color's home square, a **same-color** rook
     on the matching a/h home square on the **same board**, all intervening squares
     empty; castling never captures. Stateless — the right revives whenever the home
     positions are recreated (no move history), matching the pawn double-step.
   - **En passant** is **same-board and immediate**: `enPassant {board, square,
pawnSquare}` is armed ONLY by a pawn double-step and cleared by the very next
     move, so it is always null during a placement chain (asserted) and therefore
     excluded from `chainSignature`. An EP capture removes the pawn on `pawnSquare`
     (≠ destination), which then enters the normal placement/chain mechanic.
   - **Promotion** is **atomic on the move** (`move.promotion?: Exclude<PieceType,
"pawn" | "king">`), resolved inside `applyMove`. A promoting capture promotes
     the pawn on its origin board and routes the captured piece to the other board.
     Placement never promotes (pawns are only ever placed on rank 2/7).

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
  - **Board rendering (Nil: "whatever works best" — driver's call).** Keep the
    board a pure projection of `RoomSnapshot` behind a thin
    `<Board snapshot onIntent>` wrapper so the choice stays a swappable detail.
    Reasonable path: hand-roll (CSS grid + Unicode glyphs) for the tracer bullet;
    optionally **chessground** (lichess's renderer — prettiest, great highlight
    API for the placement picker) for the polished pass. **Hard constraint:**
    whatever you pick, use it as a DUMB renderer — never let a library enforce
    chess rules (it would fight the variant).
  - **Endgame banner:** games can end in a **win** (`🎉 WHITE/BLACK WINS! 🎉`) OR
    a **draw** (infinite loop). Render both from `Outcome.result`.
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

_Resolved by Nil: infinite loop = **draw** (implemented, §2.3); board library =
**whatever works best** (driver's call, §5). The two castling/promotion questions
below are now also **resolved** (see §2.7) — no open questions remain for the engine
slice._

1. ~~**Stateless castling** (position-keyed, no move history) — acceptable?~~
   **Resolved (Nil):** yes — and confirmed to carry **NO check/through-check/
   into-check restrictions**, consistent with kings moving into attacked squares
   elsewhere in the variant. Structurally-illegal castling is still rejected. (§2.7)
2. ~~**Promotion** — atomic `move.promotion` vs an explicit `awaitingPromotion`
   phase~~ — **Resolved (Nil):** atomic `move.promotion`, resolved in `applyMove`;
   the UI prompts for the piece before sending the move. (§2.7)
