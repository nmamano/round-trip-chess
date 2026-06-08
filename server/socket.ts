// WebSocket connection handling: parse/validate/dispatch ClientMsg, manage each
// socket's binding to a room slot. All game state + broadcasting lives in Room.
//
// Boundary validation here is the first line of defense: it rejects structurally
// malformed payloads (bad board id, non-integer squares, bogus promotion) before
// they reach Match. The engine remains the FINAL legality authority — anything
// well-typed but illegal (wrong destination, occupied square, etc.) is rejected
// downstream and mapped to illegal_move / illegal_placement.

import { createBunWebSocket } from "hono/bun";
import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { type Connection, type Room, RoomStore } from "./rooms";
import { colorOf } from "./match";
import type { ClientMsg, PlayerId } from "../shared/protocol";
import type { BoardId } from "../shared/board";
import type { Move, PromotionPiece } from "../shared/engine";

const { upgradeWebSocket, websocket } = createBunWebSocket();

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const isBoardId = (n: unknown): n is BoardId => n === 0 || n === 1;
const isPromotion = (p: unknown): p is PromotionPiece =>
  p === "knight" || p === "bishop" || p === "rook" || p === "queen";

// Validate a `move` payload's shape (not its chess legality — that's the engine's
// job). Full square-range checks are also the engine's; here we only ensure the
// values are well-formed enough to hand to Match.
function parseMove(m: unknown): Move | null {
  if (typeof m !== "object" || m === null) return null;
  const r = m as Record<string, unknown>;
  if (!isBoardId(r.board) || !isInt(r.from) || !isInt(r.to)) return null;
  if (r.promotion !== undefined && !isPromotion(r.promotion)) return null;
  const move: Move = { board: r.board, from: r.from, to: r.to };
  if (r.promotion !== undefined) move.promotion = r.promotion;
  return move;
}

// Validate a `place` payload's shape. The square's RANGE is the engine's job
// (it range-checks before indexing); here we only ensure it's an integer.
function parsePlace(m: unknown): number | null {
  if (typeof m !== "object" || m === null) return null;
  const square = (m as Record<string, unknown>).square;
  return isInt(square) ? square : null;
}

function makeConn(ws: WSContext): Connection {
  return {
    send(msg) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // socket already gone; nothing to do
      }
    },
    close() {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}

export function registerSocket(app: Hono, store: RoomStore) {
  app.get(
    "/ws",
    upgradeWebSocket(() => {
      let conn: Connection | null = null;
      let bound: { room: Room; pid: PlayerId } | null = null;

      // If our room was reaped, drop the stale binding so create/join works again.
      const active = (): { room: Room; pid: PlayerId } | null => {
        if (bound && !store.has(bound.room.code)) bound = null;
        return bound;
      };

      const dispatch = (msg: ClientMsg) => {
        if (!conn) return;
        switch (msg.t) {
          case "create": {
            if (active()) return;
            const room = store.createRoom();
            const { pid, token } = room.addCreator(msg.name, conn);
            bound = { room, pid };
            conn.send({
              t: "joined",
              code: room.code,
              you: pid,
              color: colorOf(pid),
              token,
              state: room.snapshot(),
            });
            return;
          }
          case "join": {
            if (active()) return;
            // Envelope validation: `code` feeds RoomStore.get (.toUpperCase), so a
            // non-string would throw. Reject malformed payloads, never crash.
            if (typeof msg.code !== "string") {
              conn.send({ t: "error", code: "bad_message", message: "Malformed room code." });
              return;
            }
            const room = store.get(msg.code);
            if (!room) {
              conn.send({ t: "error", code: "room_not_found", message: "No room with that code." });
              return;
            }
            const res = room.reserveJoiner(msg.name, conn);
            if ("error" in res) {
              conn.send({ t: "error", code: res.error, message: res.message });
              return;
            }
            bound = { room, pid: res.pid };
            conn.send({
              t: "joined",
              code: room.code,
              you: res.pid,
              color: colorOf(res.pid),
              token: res.token,
              state: room.snapshot(),
            });
            room.broadcast(); // push the active game state to both players
            return;
          }
          case "reconnect": {
            if (active()) return;
            // Both feed lookups (code -> RoomStore.get, token -> slot match), so a
            // non-string code would throw and a non-string token is meaningless.
            if (typeof msg.code !== "string" || typeof msg.token !== "string") {
              conn.send({
                t: "error",
                code: "bad_message",
                message: "Malformed reconnect payload.",
              });
              return;
            }
            const room = store.get(msg.code);
            if (!room) {
              conn.send({
                t: "error",
                code: "room_not_found",
                message: "Room no longer exists.",
              });
              return;
            }
            const res = room.reconnect(msg.token, conn);
            if ("error" in res) {
              conn.send({ t: "error", code: res.error, message: res.message });
              return;
            }
            bound = { room, pid: res.pid };
            conn.send({
              t: "joined",
              code: room.code,
              you: res.pid,
              color: colorOf(res.pid),
              token: msg.token,
              state: room.snapshot(),
            });
            room.broadcast(); // opponent sees presence restored
            return;
          }
          case "move": {
            const b = active();
            if (!b) return;
            const move = parseMove(msg);
            if (!move) {
              conn.send({ t: "error", code: "bad_message", message: "Malformed move." });
              return;
            }
            b.room.move(b.pid, move, conn);
            return;
          }
          case "place": {
            const b = active();
            if (!b) return;
            const square = parsePlace(msg);
            if (square === null) {
              conn.send({ t: "error", code: "bad_message", message: "Malformed placement." });
              return;
            }
            b.room.place(b.pid, square, conn);
            return;
          }
          case "newGame": {
            const b = active();
            if (b) b.room.newGame(b.pid, conn);
            return;
          }
          case "leave": {
            const b = active();
            if (b) b.room.leave(b.pid, conn);
            bound = null;
            return;
          }
          default: {
            conn.send({ t: "error", code: "bad_message", message: "Unknown message." });
          }
        }
      };

      return {
        onOpen(_event: Event, ws: WSContext) {
          conn = makeConn(ws);
        },
        onMessage(event: MessageEvent, ws: WSContext) {
          if (!conn) conn = makeConn(ws);
          const raw = typeof event.data === "string" ? event.data : null;
          if (!raw) {
            conn.send({ t: "error", code: "bad_message", message: "Expected a text frame." });
            return;
          }
          let msg: ClientMsg;
          try {
            msg = JSON.parse(raw) as ClientMsg;
          } catch {
            conn.send({ t: "error", code: "bad_message", message: "Malformed JSON." });
            return;
          }
          if (!msg || typeof msg.t !== "string") {
            conn.send({ t: "error", code: "bad_message", message: "Missing message type." });
            return;
          }
          dispatch(msg);
        },
        onClose() {
          if (bound) bound.room.handleDisconnect(bound.pid, conn!);
          bound = null;
        },
      };
    }),
  );

  return websocket;
}
