// End-to-end integration over a real WebSocket against the actual server, booted
// in-process on an ephemeral port. Covers the highest-risk wire behaviors:
// create/join, a server-validated move broadcast, out-of-turn rejection, the
// capture→placement chain, reconnect-by-token, opponent-left, and join errors.

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import app from "../server/index.ts";
import type { ClientMsg, ServerMsg } from "../shared/protocol";
import { sq } from "./helpers";

type OfType<K extends ServerMsg["t"]> = Extract<ServerMsg, { t: K }>;

let server: ReturnType<typeof Bun.serve>;
let WS_URL = "";

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  WS_URL = `ws://localhost:${server.port}/ws`;
});
afterAll(() => server.stop(true));

interface Client {
  send(m: ClientMsg): void;
  opened(): Promise<void>;
  waitFor<K extends ServerMsg["t"]>(
    t: K,
    extra?: (m: OfType<K>) => boolean,
    ms?: number,
  ): Promise<OfType<K>>;
  last<K extends ServerMsg["t"]>(t: K): OfType<K> | null;
  states(): OfType<"state">[];
  close(): void;
}

function client(): Client {
  const ws = new WebSocket(WS_URL);
  const inbox: ServerMsg[] = [];
  const waiters: Array<(m: ServerMsg) => boolean> = [];

  ws.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    const m = JSON.parse(e.data) as ServerMsg;
    inbox.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i](m)) waiters.splice(i, 1);
  };

  return {
    send: (m) => ws.send(JSON.stringify(m)),
    opened: () =>
      new Promise<void>((r) =>
        ws.readyState === WebSocket.OPEN ? r() : ws.addEventListener("open", () => r()),
      ),
    waitFor: (t, extra, ms = 2500) => {
      const match = (m: ServerMsg): m is OfType<typeof t> =>
        m.t === t && (!extra || extra(m as OfType<typeof t>));
      const existing = inbox.find(match);
      if (existing) return Promise.resolve(existing as OfType<typeof t>);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), ms);
        waiters.push((m) => {
          if (match(m)) {
            clearTimeout(timer);
            resolve(m as OfType<typeof t>);
            return true;
          }
          return false;
        });
      });
    },
    last: (t) => {
      for (let i = inbox.length - 1; i >= 0; i--)
        if (inbox[i].t === t) return inbox[i] as OfType<typeof t>;
      return null;
    },
    states: () => inbox.filter((m): m is OfType<"state"> => m.t === "state"),
    close: () => ws.close(),
  };
}

async function startGame() {
  const p1 = client();
  await p1.opened();
  p1.send({ t: "create", name: "Alice" });
  const j1 = await p1.waitFor("joined");
  const p2 = client();
  await p2.opened();
  p2.send({ t: "join", code: j1.code, name: "Bob" });
  const j2 = await p2.waitFor("joined");
  await p1.waitFor("state", (m) => m.state.lobby === "active");
  return { p1, p2, j1, j2 };
}

describe("integration (real WS)", () => {
  test("create yields a waiting room; join makes it active for both, White to move", async () => {
    const { p1, p2, j1, j2 } = await startGame();
    expect(j1.you).toBe("p1");
    expect(j1.color).toBe("white");
    expect(j1.state.lobby).toBe("waiting");
    expect(j2.you).toBe("p2");
    expect(j2.color).toBe("black");
    expect(j2.state.lobby).toBe("active");
    expect(j1.token.length).toBeGreaterThanOrEqual(12);

    const s = p1.last("state")!;
    expect(s.state.lobby).toBe("active");
    expect(s.state.turn).toBe("white");
    expect(s.state.players.find((p) => p.id === "p2")?.name).toBe("Bob");
    p1.close();
    p2.close();
  });

  test("a move is validated server-side and broadcast to both players", async () => {
    const { p1, p2 } = await startGame();
    p1.send({ t: "move", board: 0, from: sq("e2"), to: sq("e4") });
    const after1 = await p1.waitFor("state", (m) => m.state.turn === "black");
    const after2 = await p2.waitFor("state", (m) => m.state.turn === "black");
    expect(after1.state.boards[0][sq("e4")]).toEqual({ type: "pawn", color: "white" });
    expect(after2.state.boards[0][sq("e2")]).toBeNull();
    p1.close();
    p2.close();
  });

  test("acting out of turn is rejected as not_your_turn", async () => {
    const { p1, p2 } = await startGame();
    p2.send({ t: "move", board: 0, from: sq("d7"), to: sq("d5") }); // Black tries to move first
    const err = await p2.waitFor("error");
    expect(err.code).toBe("not_your_turn");
    p1.close();
    p2.close();
  });

  test("capture → placement chain resolves over the wire (and never leaks pending.visited)", async () => {
    const { p1, p2 } = await startGame();
    p1.send({ t: "move", board: 0, from: sq("e2"), to: sq("e4") });
    await p2.waitFor("state", (m) => m.state.turn === "black");
    p2.send({ t: "move", board: 0, from: sq("d7"), to: sq("d5") });
    await p1.waitFor("state", (m) => m.state.turn === "white");

    p1.send({ t: "move", board: 0, from: sq("e4"), to: sq("d5") }); // capture
    const pending = await p1.waitFor("state", (m) => m.state.phase.kind === "awaitingPlacement");
    const phase = pending.state.phase;
    expect(phase.kind).toBe("awaitingPlacement");
    if (phase.kind === "awaitingPlacement") {
      expect(phase.piece).toEqual({ type: "pawn", color: "black" });
      expect(phase.board).toBe(1);
      expect(phase.options).toContain(sq("a7"));
    }

    p1.send({ t: "place", square: sq("a7") });
    // Wait specifically for the post-placement state (the captured pawn lands on
    // board 1) — `awaitingMove && turn black` alone also matches White's earlier
    // first move, before any capture.
    const resolved = await p1.waitFor("state", (m) => m.state.boards[1][sq("a7")] !== null);
    expect(resolved.state.phase.kind).toBe("awaitingMove");
    expect(resolved.state.turn).toBe("black");
    expect(resolved.state.boards[1][sq("a7")]).toEqual({ type: "pawn", color: "black" });

    // Perfect-information boundary: no state ever serialized internal chain metadata.
    expect(p1.states().every((m) => !JSON.stringify(m.state).includes("visited"))).toBe(true);
    expect(p2.states().every((m) => !JSON.stringify(m.state).includes("visited"))).toBe(true);
    p1.close();
    p2.close();
  });

  test("reconnect by token reclaims the slot; bad token is rejected", async () => {
    const { p1, p2, j1 } = await startGame();

    p1.close();
    await p2.waitFor(
      "state",
      (m) => m.state.players.find((p) => p.id === "p1")?.connected === false,
    );

    const p1b = client();
    await p1b.opened();
    p1b.send({ t: "reconnect", code: j1.code, token: j1.token });
    const rejoined = await p1b.waitFor("joined");
    expect(rejoined.you).toBe("p1");
    expect(rejoined.color).toBe("white");
    await p2.waitFor(
      "state",
      (m) => m.state.players.find((p) => p.id === "p1")?.connected === true,
    );

    const intruder = client();
    await intruder.opened();
    intruder.send({ t: "reconnect", code: j1.code, token: "not-a-real-token" });
    const err = await intruder.waitFor("error");
    expect(err.code).toBe("bad_token");

    p1b.close();
    p2.close();
    intruder.close();
  });

  test("explicit leave notifies the opponent", async () => {
    const { p1, p2 } = await startGame();
    p1.send({ t: "leave" });
    await p2.waitFor("opponentLeft");
    p2.close();
  });

  test("malformed (non-string) code/token are rejected as bad_message, not a crash", async () => {
    const a = client();
    await a.opened();
    a.send({ t: "join", code: 123, name: "x" } as unknown as ClientMsg);
    expect((await a.waitFor("error")).code).toBe("bad_message");
    a.close();

    const b = client();
    await b.opened();
    b.send({ t: "reconnect", code: "ABCD", token: 456 } as unknown as ClientMsg);
    expect((await b.waitFor("error")).code).toBe("bad_message");
    b.close();
  });

  test("newGame before the game is over is rejected with bad_phase", async () => {
    const { p1, p2 } = await startGame();
    p1.send({ t: "newGame" });
    const err = await p1.waitFor("error");
    expect(err.code).toBe("bad_phase");
    p1.close();
    p2.close();
  });

  test("join errors: unknown code and full room", async () => {
    const x = client();
    await x.opened();
    x.send({ t: "join", code: "ZZZZ", name: "Nobody" });
    const e1 = await x.waitFor("error");
    expect(e1.code).toBe("room_not_found");
    x.close();

    const { p1, p2, j1 } = await startGame();
    const c = client();
    await c.opened();
    c.send({ t: "join", code: j1.code, name: "Cat" });
    const e2 = await c.waitFor("error");
    expect(e2.code).toBe("room_full");
    p1.close();
    p2.close();
    c.close();
  });
});
