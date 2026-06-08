# Round-Trip Chess — Hand-Off for the Next Session

You are continuing the build of **Round-Trip Chess**. The pure rules engine AND
the server are now done and committed; your job is to (A) build the **frontend**,
then (B) **deploy** to fly.io and play a real match across two devices.

**`PROMPT.md` is the authoritative game spec** and wins any rules conflict (flag
conflicts to Nil rather than guessing). `HANDOFF.md` is the original end-to-end
brief. This file (`HANDOFF-NEXT.md`) is the delta: what's already built and what
to do next.

---

## 0. Current status (what exists)

On `master` (see `git log`):

- The pure `shared/` **rules engine** + tests — board model, per-piece movement,
  capture→placement→**chain** resolution, king double-capture **win**,
  infinite-loop **draw**, and **castling / en passant / promotion**.
- The **server slice** (commit "Add server slice: online multiplayer over
  WebSocket") — server-authoritative, in-memory, create/join by code, reconnect
  by token, over Bun + Hono + WebSocket, mirroring `~/nil/rps-roulette`.
- `bun run ci` is **green**: prettier + eslint + tsc + **110 tests / 561
  assertions**.
- Run it: `cd ~/nil/round-trip-chess && bun install && bun run ci`.
- Run the server: `bun run dev` (hot) → `http://localhost:3000`, WS at `/ws`,
  health at `/health`. There is **no frontend yet** (`/` returns placeholder
  text).

Files:

- `shared/board.ts`, `shared/movement.ts`, `shared/engine.ts`, `shared/config.ts`
  — the pure, **browser-safe** engine (no Bun/server imports). See §1.
- `shared/protocol.ts` — the client⇄server wire types (browser-safe). See §2.
- `server/match.ts` — `Match` wraps the engine (turn ownership + error mapping +
  snapshot projection); also exports `colorOf()` and `waitingSnapshot()`.
- `server/rooms.ts` — `RoomStore` + `Room` (sole broadcaster + presence + the
  single reconnect-grace timer; stale-socket guards on every action).
- `server/socket.ts` — Bun/Hono WS dispatch + message-boundary validation.
- `server/index.ts` — Hono app, `/health`, default `{ port, fetch, websocket }`.
- `tests/` — engine truth-tables/scenarios + `castling`/`enpassant`/`promotion`
  suites + `match`/`rooms`/`integration` server suites.

---

## 1. Engine API the frontend can reuse (browser-safe — import directly)

`shared/` has no server imports, so the client may import it to drive **local
move highlighting** (the server still validates everything — highlights are
advisory only).

```ts
initialState(): GameState
legalMovesFrom(state, board, from): number[]   // side-to-move + awaitingMove only
allLegalMoves(state): Move[]                    // promoting pawn moves expand to Q/R/B/N
placementOptions(state): number[]              // valid placement squares (also in the snapshot)
```

Square indexing: `idx = rank*8 + file`, a1 = 0, e1 = 4, e8 = 60. `Board` is a
`(Piece|null)[]` of length 64. Helpers: `squareToAlgebraic`, `algebraicToSquare`,
`fileOf`, `rankOf`, `STARTING_SQUARES[type][color]`.

To highlight legal destinations, reconstruct a `GameState` from the snapshot
(boards/turn/enPassant + `phase:{kind:"awaitingMove"}`) and call
`legalMovesFrom`. During a chain, the valid squares are already in
`phase.options` — no reconstruction needed.

---

## 2. The wire protocol (already built — consume it, don't change it lightly)

`shared/protocol.ts`. The client is a pure projection of `RoomSnapshot`.

```ts
// client → server
type ClientMsg =
  | { t: "create"; name: string }
  | { t: "join"; code: string; name: string }
  | { t: "reconnect"; code: string; token: string }
  | { t: "move"; board: BoardId; from: number; to: number; promotion?: PromotionPiece }
  | { t: "place"; square: number }
  | { t: "newGame" }
  | { t: "leave" };

// server → client
type ServerMsg =
  | { t: "joined"; code: string; you: PlayerId; color: Color; token: string; state: RoomSnapshot }
  | { t: "state"; state: RoomSnapshot }
  | { t: "opponentLeft" }
  | { t: "error"; code: ErrorCode; message: string };

type ErrorCode =
  | "room_not_found"
  | "room_full"
  | "bad_token"
  | "not_your_turn"
  | "illegal_move"
  | "illegal_placement"
  | "bad_phase"
  | "bad_message";

interface RoomSnapshot {
  code: string;
  lobby: "waiting" | "active"; // "waiting" = no opponent yet
  players: { id: PlayerId; color: Color; name: string; connected: boolean }[];
  boards: [Board, Board]; // board 0 = primary (standard), board 1 = secondary
  turn: Color; // side to move / chain resolver
  kingCaptures: { white: number; black: number }; // 0 / 1 / 2(=win) — drives king status UI
  enPassant: EnPassant | null; // public; for UI legality hints
  phase:
    | { kind: "awaitingMove" }
    | { kind: "awaitingPlacement"; piece: Piece; board: BoardId; options: number[] }
    | { kind: "gameOver"; outcome: Outcome };
}

type Outcome =
  | { result: "win"; winner: Color; reason: "kingCaptured" }
  | { result: "draw"; reason: "infiniteLoop" };
```

**Key facts for the client:**

- **Perfect information**: the snapshot is identical for both players. Your own
  identity is `you`/`color` from the `joined` message (persist for reconnect).
- **It's your turn** when `lobby==="active"` and `snapshot.turn === yourColor`.
  In `awaitingMove` you move; in `awaitingPlacement` you (the resolver) place —
  the turn does **not** flip mid-chain, so the opponent is read-only until the
  chain ends.
- **Move flow**: click source → highlight `legalMovesFrom` → click dest → if a
  pawn reaches its last rank, show a **promotion picker** and send
  `move{...,promotion}`. A capture → server replies `awaitingPlacement` → render
  a **placement picker** over `phase.options` on `phase.board` → send
  `place{square}` → repeat until `awaitingMove`.
- **Endgame**: render from `outcome.result` — a **win** banner
  (`🎉 WHITE/BLACK WINS! 🎉`) OR a **draw** banner (infinite loop). `New Game`
  sends `{t:"newGame"}` (only valid once over; else you get `bad_phase`).
- **Reconnect**: persist `{code, token}` in `sessionStorage`; on load, send
  `reconnect`. `bad_token`/`room_not_found` → fall back to the lobby.
- Never trust the client: the server is authoritative and returns `error` on any
  illegal action — surface it, don't fail silently.

---

## 3. Build the frontend (HANDOFF §5 — do this first)

Minimal **Vite + React 19 + TS** app, mirroring `~/nil/rps-roulette/frontend`
(READ-ONLY reference — do not modify it). Typed, auto-reconnecting WS client
driven purely by `RoomSnapshot`. Ugly is fine for the tracer bullet; then port
the v0 visuals.

- **Lobby**: create / join by code, no accounts. Show the room code to share.
- **Game**: render **BOTH boards**, click-to-move, placement picker, promotion
  picker, `Current Turn`, king status (Safe / 1× / 2× from `kingCaptures`),
  `New Game`, win/draw banner, rules panel (**copy verbatim from PROMPT §6**),
  reconnect-by-code, don't-break-on-mobile (stack the boards).
- **Board rendering (Nil: "whatever works best" — driver's call).** Keep the
  board a pure projection of `RoomSnapshot` behind a thin
  `<Board snapshot onIntent>` wrapper so the choice stays a swappable detail.
  Reasonable path: hand-roll (CSS grid + Unicode glyphs ♔♕♖♗♘♙) for the tracer
  bullet; optionally **chessground** later for polish. **Hard constraint:**
  whatever you pick, use it as a DUMB renderer — never let a library enforce
  chess rules (it would fight the variant).
- **UX reference**: <https://v0-round-trip-chess-variant.vercel.app/> (two-board
  layout, turn indicator, king status, rules panel). Visual only — you can't read
  its code.

**Tooling deltas to wire up (mirror rps-roulette):**

- `package.json`: add a `build` script (`bun --cwd=frontend run build`); extend
  `typecheck` to also run the frontend `tsc`; add `&& bun run build` to `ci`.
- `eslint.config.js`: enable JSX (`parserOptions.ecmaFeatures.jsx`) and ignore
  `frontend/dist`.
- `server/index.ts`: serve the built SPA — `serveStatic({ root: "./frontend/dist" })`
  with an `index.html` fallback (currently omitted; see the rps-roulette
  `server/index.ts`).
- Keep `shared/` browser-safe; the frontend imports `shared/protocol.ts` (+ the
  engine for highlights) but **never** `server/`.

---

## 4. Then: deploy (HANDOFF §6)

- `Dockerfile` + `fly.toml` — single machine, `min_machines_running = 1`, **no
  autoscale** (in-memory state isn't shared). App slug `round-trip-chess`. Deeper
  reference for Bun/Hono Docker + fly conventions: `~/nil/wallgame`.
- `bun run ci` green (incl. the frontend build). `fly deploy`. Then play a real
  match across two devices: opening → captures that send pieces to the other
  board → at least one **chain reaction** → a king captured on **both** boards →
  **win**, plus **New Game**. No login, no DB.

---

## 5. Pairing protocol (if continuing the paired workflow)

Driver implements, **Game Reviewer** (agent id `agent-1780864878869-eq7t`,
model gpt-5.5, room "Parked Projects") reviews. Phases: scope solo → send the
design (files, approach, edge cases, open questions) to the reviewer BEFORE
coding → iterate → implement → share the diff for review → iterate.

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

## 6. Guardrails (unchanged)

Server-authoritative; in-memory only (no DB/login); single fly machine; minimal
deps (hand-roll board rendering — no heavy chess library enforcing rules); commit
in logical increments staging only your own changes; `shared/` stays browser-safe
(no Bun/server imports); do NOT modify `~/nil/rps-roulette` or `~/nil/wallgame`.

---

## 7. Locked-in decisions (resolved by Nil / peer-reviewed)

Game rules (engine):

1. **Capture → placement → chain.** Captured piece goes to the OTHER board; the
   capturer places it on a valid starting square; landing on an occupied square
   captures that piece too (even your OWN) and continues. Turn flips only when a
   placement lands on an empty square.
2. **King win.** `kingCaptures[C]` increments on ANY capture of king C; reaching
   2 ⇒ game over, winner = opponent(C). Self-capturing your own king to its 2nd
   loses (intentional, tested).
3. **Infinite loop ⇒ DRAW** (Nil's ruling, overrides PROMPT §2). Detected by a
   configuration-repeat within a single chain.
4. **No check/checkmate anywhere.** Kings move into/along attacked squares;
   castling carries NO check restrictions (structurally-illegal castling still
   rejected). Castling / EP / promotion are stateless / position-derived.

Server slice:

5. **Perfect information** — no hidden-pick anti-cheat; one player-agnostic
   snapshot broadcast to both. `you`/`color`/`token` only in `joined`.
6. **No gameplay clock** — the only timer is reconnect-grace; no
   round/version/stale-timer machinery.
7. **Fixed colors** — creator = White (moves first), joiner = Black. _(Confirm
   with Nil if you want randomized sides — see §8.)_
8. **`newGame`** allowed only once a game is over, **unilaterally** by either
   player (no abort/rematch mid-game). _(Confirm if you want a both-agree
   handshake — see §8.)_
9. **Bot deferred** — `createBot` is intentionally NOT in the protocol yet. Add a
   trivial random-legal-move bot as its own later slice if desired (it
   reintroduces a think-timer; test bot-turn draining + stale callbacks +
   leave/newGame cancellation).

---

## 8. Open questions to confirm with Nil (frontend/deploy)

1. **Color assignment** — fixed creator=White (current) vs randomized sides?
2. **`newGame`** — unilateral (current) vs both-players-agree?
3. **Move clock** — none (current). Add an optional per-move timer, or leave out
   of scope for MVP (PROMPT §6/§7)?
4. **Board renderer** — hand-rolled is fine for the tracer bullet; do you want
   the chessground polish pass in this slice or a later one?
