# Round-Trip Chess

A two-board chess variant. Play starts like normal chess, but **captured pieces
aren't removed** — they travel to a **second board**. You win by capturing the
opponent's king on **both** boards: a "round trip" from the first board to the
second and back.

> **Capture pieces to send them to the other board • Win by capturing the
> opponent's king twice.**

## Status

**Design stage — not yet implemented.** This repo currently holds the spec and the
implementation kickoff. Start here:

- [`PROMPT.md`](./PROMPT.md) — the full game design spec (rules, win condition, the
  capture→placement→chain mechanic, website copy, open questions).
- [`HANDOFF.md`](./HANDOFF.md) — the kickoff prompt for the implementing agent.

## Origin

The original prototype was built with **v0 (Vercel)** and is **local hotseat only
(single browser, no multiplayer)**: <https://v0-round-trip-chess-variant.vercel.app/>.
Its source isn't available (different v0 account), so it serves as a visual/UX
reference only.

## Planned build

Real-time, two-player, no-login online multiplayer, mirroring the
[`rps-roulette`](https://github.com/nmamano/rps-roulette) architecture: Bun + Hono +
WebSockets · React 19 + Vite · a pure shared rules engine · in-memory
server-authoritative state (no DB, no login) · deployed on fly.io (single machine).
