import { test, expect, describe } from "bun:test";
import { Room, type Connection } from "../server/rooms";
import type { ServerMsg } from "../shared/protocol";
import { sq } from "./helpers";

interface FakeConn extends Connection {
  sent: ServerMsg[];
  closed: boolean;
}

function fakeConn(): FakeConn {
  const conn: FakeConn = {
    sent: [],
    closed: false,
    send(m: ServerMsg) {
      conn.sent.push(m);
    },
    close() {
      conn.closed = true;
    },
  };
  return conn;
}

const noop = () => {};
const e2e4 = { board: 0 as const, from: sq("e2"), to: sq("e4") };

describe("Room — connection-identity guards", () => {
  test("a replaced (stale) socket cannot move for its old pid; the live socket can", () => {
    const room = new Room("TEST", noop);
    const c1 = fakeConn();
    const { token } = room.addCreator("Alice", c1);
    const c2 = fakeConn();
    room.reserveJoiner("Bob", c2); // match created → White (p1) to move

    // p1 reconnects on a fresh socket; this replaces (and closes) the old one.
    const c1b = fakeConn();
    expect(room.reconnect(token, c1b)).toEqual({ pid: "p1" });
    expect(c1.closed).toBe(true);

    // The stale socket tries to move for p1 → must be a no-op.
    room.move("p1", e2e4, c1);
    expect(room.snapshot().turn).toBe("white");

    // The live socket can move.
    room.move("p1", e2e4, c1b);
    expect(room.snapshot().turn).toBe("black");
  });

  test("a stale socket cannot place during a chain; the live socket can", () => {
    const room = new Room("T2", noop);
    const c1 = fakeConn();
    const { token } = room.addCreator("Alice", c1);
    const c2 = fakeConn();
    room.reserveJoiner("Bob", c2);

    // Drive to White's placement: e2-e4, d7-d5, e4xd5.
    room.move("p1", e2e4, c1);
    room.move("p2", { board: 0, from: sq("d7"), to: sq("d5") }, c2);
    room.move("p1", { board: 0, from: sq("e4"), to: sq("d5") }, c1);
    expect(room.snapshot().phase.kind).toBe("awaitingPlacement");

    // p1 reconnects → old socket goes stale.
    const c1b = fakeConn();
    room.reconnect(token, c1b);

    // Stale socket's placement is ignored; chain stays unresolved.
    room.place("p1", sq("a7"), c1);
    expect(room.snapshot().phase.kind).toBe("awaitingPlacement");

    // Live socket resolves the chain.
    room.place("p1", sq("a7"), c1b);
    const s = room.snapshot();
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.turn).toBe("black");
  });
});

describe("Room — error delivery", () => {
  test("acting out of turn sends a not_your_turn error to the offending socket", () => {
    const room = new Room("T3", noop);
    const c1 = fakeConn();
    room.addCreator("Alice", c1);
    const c2 = fakeConn();
    room.reserveJoiner("Bob", c2);

    // p2 (Black) tries to move first.
    room.move("p2", { board: 0, from: sq("d7"), to: sq("d5") }, c2);
    const err = c2.sent.find((m): m is Extract<ServerMsg, { t: "error" }> => m.t === "error");
    expect(err?.code).toBe("not_your_turn");
    expect(room.snapshot().turn).toBe("white"); // state untouched
  });
});

describe("Room — newGame feedback", () => {
  test("newGame before the game is over returns bad_phase (no silent drop)", () => {
    const room = new Room("T5", noop);
    const c1 = fakeConn();
    room.addCreator("Alice", c1);
    const c2 = fakeConn();
    room.reserveJoiner("Bob", c2);

    room.newGame("p1", c1);
    const err = c1.sent.find((m): m is Extract<ServerMsg, { t: "error" }> => m.t === "error");
    expect(err?.code).toBe("bad_phase");
  });
});

describe("Room — teardown", () => {
  test("explicit leave notifies the opponent and reaps the room", () => {
    let reaped = "";
    const room = new Room("T4", (c) => (reaped = c));
    const c1 = fakeConn();
    room.addCreator("Alice", c1);
    const c2 = fakeConn();
    room.reserveJoiner("Bob", c2);

    room.leave("p1", c1);
    expect(c2.sent.some((m) => m.t === "opponentLeft")).toBe(true);
    expect(reaped).toBe("T4");
  });
});
