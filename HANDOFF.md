# Round-Trip Chess — Implementation Hand-Off

You are the implementing agent. Build **Round-Trip Chess** end-to-end,
deploy-ready, as a **real-time, two-player, online** game. This document orients
you; **`PROMPT.md` is the authoritative game spec** and wins any rules conflict
(flag conflicts rather than guessing).

---

## 0. Mission (TL;DR)

Build the complete game: a **two-player, real-time, no-login** web game of
**Round-Trip Chess** — a two-board chess variant where captured pieces travel to a
second board and you win by capturing the opponent's king on **both** boards (see
`PROMPT.md`). **Server-authoritative** Bun + Hono + WebSocket backend, **React +
Vite** frontend, deployed to **fly.io on a single machine**.

**Mirror the architecture, stack, and deployment of the `rps-roulette` project**
(it's the reference implementation — see §1). The original v0 prototype is
client-only hotseat with **no multiplayer**; we are rebuilding it as real online
multiplayer on the rps-roulette stack.

---

## 1. Read these first (in order)

1. **`PROMPT.md`** — the full game spec: rules, win condition, the
   capture→placement→chain mechanic, website copy, and open design questions.
2. **`rps-roulette`** — **the architecture template.** Local at `~/nil/rps-roulette`,
   public at <https://github.com/nmamano/rps-roulette>. Copy its conventions:
   - `shared/` pure engine + `protocol.ts` wire types + `config.ts` (browser-safe)
   - `server/` Hono + Bun WS (`createBunWebSocket` from `hono/bun`, default export
     `{ fetch, websocket }`), in-memory `rooms.ts` (sole owner of timers +
     broadcasts), authoritative `match.ts` state machine, `socket.ts` dispatch
   - `frontend/` Vite + React 19 + TS, typed auto-reconnecting WS client driven by
     a server `RoomSnapshot`
   - `tests/` (bun test) + `bun run ci` (prettier + eslint + tsc + tests + build)
   - `Dockerfile` + `fly.toml` (single machine), `serveStatic` SPA fallback
3. **`~/nil/wallgame`** — deeper reference for the exact Bun/Hono WS wiring,
   Dockerfile, and `fly.toml` conventions if you need more detail than
   rps-roulette provides.
4. **<https://v0-round-trip-chess-variant.vercel.app/>** — the v0 prototype.
   **Visual/UX reference only** (you cannot read its code). Match its two-board
   layout, turn indicator, king-status display, and rules panel.

---

## 2. What carries over from rps-roulette vs. what's different

**Carries over (reuse the patterns):**

- Lobby with **create / join by code**, no accounts, in-memory server state.
- Server-authoritative: the server owns the game state and validates every action.
- Room store + reconnect by **room code + per-player token** (sessionStorage);
  `RECONNECT_GRACE_MS`; reap empty rooms.
- A per-client `RoomSnapshot` broadcast on every transition; typed discriminated
  unions for messages; an `error` ServerMsg shape; never fail silently.
- Tooling/CI/Docker/fly conventions identical.

**Different — design these deliberately:**

- **Perfect information, not hidden picks.** Chess is fully observable: both
  players see both boards. There is **no pick-hiding anti-cheat** like RPS. Server
  authority here means **validating move legality and resolving the chain
  reaction** — the snapshot carries the *full* state of both boards.
- **Turn-based, alternating** (not simultaneous). Protocol: client sends a move →
  server validates, applies, broadcasts the new snapshot. No simultaneous-pick
  timer. (An optional per-move clock is out of scope for MVP — see PROMPT §6/§7.)
- **Multi-step interactive moves.** A capture requires the capturer to **choose a
  placement square**, and a chain reaction may require **successive choices**. The
  protocol must support this: e.g. `move` → server replies with a "pending
  placement: choose among [squares]" state → client sends `placement` → repeat
  until the chain resolves → final snapshot. Model this as an explicit
  sub-state-machine inside the turn. **This is the trickiest part of the build.**
- **Two boards.** State is two 8×8 boards (Board 1 = standard setup, Board 2 =
  empty). A turn moves one piece on one board.

---

## 3. Build order (tracer-bullet, engine-first)

1. **`shared/` rules engine first + tests green.** This is the heart — nail it
   before any networking. Pure, no I/O, deterministic. Cover: board model, legal
   piece movement per board, capture → placement (valid starting squares per
   piece/color), **chain-reaction resolution**, king double-capture win, and
   **infinite-loop detection (→ triggering player wins)**. Unit-test exhaustively
   (truth tables for movement; scripted scenarios for chains, king round-trips,
   and loop detection).
2. **`shared/protocol.ts`** — message union + the two-board `RoomSnapshot`,
   including the **pending-placement / chain** sub-states.
3. **Server:** `rooms.ts` + `match.ts` (turn + chain state machine) + `socket.ts`;
   drive it with `tests/match.test.ts` (no UI): legal move applies; capture
   triggers placement; chain resolves; king captured ×2 → game over with winner;
   reconnect resumes; New Game resets.
4. **Minimal Vite frontend:** connect, create/join by code, render **both boards**,
   click to move, pick a placement square, see the result — wired to the **real**
   WS. Ugly is fine.
5. **Port the v0 visuals:** two-board layout, `Current Turn`, king status
   (Safe / 1× / 2×), New Game, win banner (`🎉 WHITE WINS! 🎉`), the rules panel
   (copy verbatim from PROMPT §6); clear placement/chain UX; reconnect-by-code;
   don't-break-on-mobile.
6. **`Dockerfile` + `fly.toml`**; `bun run ci` green; `fly deploy`; play a real
   match across two devices.

---

## 4. The bot (explicitly NOT a serious engine)

We are **not** building a chess AI. For MVP: **either no bot at all**, or a
**trivial "random legal move" bot** purely for solo smoke-testing (picks a uniformly
random legal move; on a forced placement/chain, picks a random valid square). Keep
it behind a clearly-labeled "Play vs Bot (random)" path if you add it. Do **not**
invest in evaluation, search, or strategy.

---

## 5. Guardrails & conventions

- Fresh standalone repo at `~/nil/round-trip-chess`. Commit in **logical
  increments** with clear messages; only stage files you actually changed.
- **Server is authoritative.** Validate every move and resolve all chains
  server-side; never trust the client for legality or chain outcomes.
- **No database, no login, no accounts.** In-memory server state.
- **fly.io: exactly ONE machine** (`min_machines_running = 1`, do not autoscale
  past 1) — in-memory state isn't shared across machines. In-flight games are lost
  on restart; acceptable, ephemeral by design.
- Keep dependencies minimal: hand-roll the board rendering (SVG or a CSS grid;
  Unicode chess glyphs ♔♕♖♗♘♙ are fine). Don't pull in a heavy chess library —
  the movement + variant rules are ours to own in `shared/`. (A tiny helper is OK
  only if it's genuinely trivial and doesn't hide the variant logic.)
- Centralize tunables (`shared/config.ts`). `shared/` stays **browser-safe** (no
  Bun/server imports).

---

## 6. Definition of done

- Two people on different devices play a full game: standard opening, captures
  that send pieces to the other board, at least one **chain reaction**, and the
  opponent's king captured on **both** boards → **win**, plus **New Game** —
  **no login, no DB.**
- Shared engine unit tests + server state-machine tests pass; **`bun run ci`**
  (prettier + eslint + tsc + tests + frontend build) is green.
- **Deployed and reachable on fly.io on a single machine** (app slug
  `round-trip-chess`).

---

## 7. Verify before declaring done

- `bun test` for the engine + the match/chain state machine.
- Local run: server on `:3000`, Vite on `:5173`; open **two** browser windows,
  create + join, and play through: a normal move on each board, a **capture +
  placement**, a **chain reaction**, a **king double-capture win**, and a
  **mid-game refresh (reconnect)**.

---

## 8. Watch-outs

- **The placement/chain protocol is the hard part** — it's an interactive,
  multi-step move. Design the turn as a small sub-state-machine (`awaiting move` →
  `awaiting placement(s)` → `resolved`) and keep it server-authoritative.
- **Loop detection:** "infinite loop ⇒ triggering player wins" needs a
  deterministic cycle check over chain states (e.g., detect a repeated
  board-configuration during a single chain). Define and test it.
- **King capture via a chain placement**, not just a normal move — make sure the
  win counter increments in both paths (PROMPT §7 Q4).
- **Promotion / castling / en passant:** decide in/out of scope early (PROMPT §7
  Q2); promotion is especially fraught with two boards — match the v0 prototype or
  confirm with Nil.
- **Two boards on mobile:** stack them and keep tap targets usable.

---

*Game spec: `PROMPT.md`. Architecture template: `rps-roulette`
(`~/nil/rps-roulette`, github.com/nmamano/rps-roulette). Deeper stack reference:
`~/nil/wallgame`. UX reference: the v0 URL in PROMPT §5.*
