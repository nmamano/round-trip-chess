import { test, expect, describe } from "bun:test";
import { Match, waitingSnapshot, colorOf, type MatchPlayer } from "../server/match";
import { sq, pc, put, emptyBoards, stateFrom } from "./helpers";

function players(): { p1: MatchPlayer; p2: MatchPlayer } {
  return {
    p1: { id: "p1", name: "Alice", connected: true },
    p2: { id: "p2", name: "Bob", connected: true },
  };
}

// Drive the standard opening to a capture: white e2-e4, black d7-d5, white e4xd5.
// Leaves the match awaiting White's placement of the captured black pawn on board 1.
function toAwaitingPlacement(): Match {
  const m = new Match(players());
  expect(m.move("p1", { board: 0, from: sq("e2"), to: sq("e4") }).ok).toBe(true);
  expect(m.move("p2", { board: 0, from: sq("d7"), to: sq("d5") }).ok).toBe(true);
  expect(m.move("p1", { board: 0, from: sq("e4"), to: sq("d5") }).ok).toBe(true);
  return m;
}

describe("colorOf", () => {
  test("p1 is White (moves first), p2 is Black", () => {
    expect(colorOf("p1")).toBe("white");
    expect(colorOf("p2")).toBe("black");
  });
});

describe("Match — fresh game", () => {
  test("starts active, White to move, standard opening", () => {
    const m = new Match(players());
    const s = m.snapshot("ABCD");
    expect(s.lobby).toBe("active");
    expect(s.turn).toBe("white");
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.kingCaptures).toEqual({ white: 0, black: 0 });
    expect(s.players.map((p) => [p.id, p.color])).toEqual([
      ["p1", "white"],
      ["p2", "black"],
    ]);
    // Board 0 = standard (white king on e1), board 1 = empty.
    expect(s.boards[0][sq("e1")]).toEqual(pc("white", "king"));
    expect(s.boards[1].every((c) => c === null)).toBe(true);
  });
});

describe("Match — turn ownership", () => {
  test("moving out of turn is rejected as not_your_turn (before the engine runs)", () => {
    const m = new Match(players());
    const res = m.move("p2", { board: 0, from: sq("d7"), to: sq("d5") });
    expect(res).toEqual({
      ok: false,
      error: { code: "not_your_turn", message: "It is not your turn." },
    });
    expect(m.snapshot("ABCD").turn).toBe("white"); // unchanged
  });

  test("a legal move applies and flips the turn", () => {
    const m = new Match(players());
    expect(m.move("p1", { board: 0, from: sq("e2"), to: sq("e4") }).ok).toBe(true);
    const s = m.snapshot("ABCD");
    expect(s.turn).toBe("black");
    expect(s.boards[0][sq("e2")]).toBeNull();
    expect(s.boards[0][sq("e4")]).toEqual(pc("white", "pawn"));
  });

  test("placing out of turn is rejected as not_your_turn", () => {
    const m = toAwaitingPlacement(); // White is resolving; turn stays White
    const res = m.place("p2", sq("a7"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_your_turn");
  });
});

describe("Match — capture → placement → chain", () => {
  test("a capturing move enters awaitingPlacement with the captured piece + options", () => {
    const m = toAwaitingPlacement();
    const s = m.snapshot("ABCD");
    expect(s.turn).toBe("white"); // resolver still to act — turn does not flip mid-chain
    expect(s.phase.kind).toBe("awaitingPlacement");
    if (s.phase.kind === "awaitingPlacement") {
      expect(s.phase.piece).toEqual(pc("black", "pawn"));
      expect(s.phase.board).toBe(1);
      // Black-pawn starting squares: a7..h7 on the destination board.
      expect(s.phase.options).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
      expect(s.phase.options).toContain(sq("a7"));
    }
  });

  test("placing on an empty start square resolves the chain and flips the turn", () => {
    const m = toAwaitingPlacement();
    expect(m.place("p1", sq("a7")).ok).toBe(true);
    const s = m.snapshot("ABCD");
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.turn).toBe("black");
    expect(s.boards[1][sq("a7")]).toEqual(pc("black", "pawn"));
  });

  test("placing on a non-start square is rejected as illegal_placement", () => {
    const m = toAwaitingPlacement();
    const res = m.place("p1", sq("a1")); // not a black-pawn start
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("illegal_placement");
  });
});

describe("Match — phase guards", () => {
  test("an illegal destination maps to illegal_move", () => {
    const m = new Match(players());
    const res = m.move("p1", { board: 0, from: sq("e2"), to: sq("e5") }); // pawn can't jump 3
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("illegal_move");
  });

  test("moving while awaiting a placement maps to bad_phase", () => {
    const m = toAwaitingPlacement(); // White owns the turn, but phase is awaitingPlacement
    const res = m.move("p1", { board: 0, from: sq("d2"), to: sq("d4") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("bad_phase");
  });

  test("placing while awaiting a move maps to bad_phase", () => {
    const m = new Match(players()); // awaitingMove, White to act
    const res = m.place("p1", sq("a7"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("bad_phase");
  });
});

describe("Match — game over + new game", () => {
  test("capturing a king the second time ends the game; newGame only works after", () => {
    // White rook on a1, Black king on b1, Black king already captured once.
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    put(boards[0], "b1", pc("black", "king"));
    const m = new Match(players(), stateFrom(boards, "white", { white: 0, black: 1 }));

    expect(m.newGame()).toBe(false); // not over yet

    expect(m.move("p1", { board: 0, from: sq("a1"), to: sq("b1") }).ok).toBe(true);
    expect(m.isOver()).toBe(true);
    const s = m.snapshot("ABCD");
    expect(s.phase.kind).toBe("gameOver");
    if (s.phase.kind === "gameOver") {
      expect(s.phase.outcome).toEqual({ result: "win", winner: "white", reason: "kingCaptured" });
    }

    expect(m.newGame()).toBe(true); // allowed now
    expect(m.snapshot("ABCD").phase.kind).toBe("awaitingMove");
    expect(m.snapshot("ABCD").turn).toBe("white");
    expect(m.newGame()).toBe(false); // no longer over
  });

  test("an infinite-loop chain ends as a draw, surfaced in the snapshot", () => {
    // A chain that reproduces a configuration => draw (the resolver keeps the
    // turn across the whole chain, so White makes every placement).
    const boards = emptyBoards();
    put(boards[0], "d8", pc("white", "rook"));
    put(boards[0], "d4", pc("black", "rook")); // captured to start the chain
    put(boards[0], "a8", pc("black", "rook")); // cycle square (board 0)
    put(boards[1], "a8", pc("black", "rook")); // cycle square (board 1)
    const m = new Match(players(), stateFrom(boards)); // White to move

    expect(m.move("p1", { board: 0, from: sq("d8"), to: sq("d4") }).ok).toBe(true);
    expect(m.place("p1", sq("a8")).ok).toBe(true); // step 1
    expect(m.place("p1", sq("a8")).ok).toBe(true); // step 2 reproduces the config

    expect(m.isOver()).toBe(true);
    const s = m.snapshot("ABCD");
    expect(s.phase.kind).toBe("gameOver");
    if (s.phase.kind === "gameOver") {
      expect(s.phase.outcome).toEqual({ result: "draw", reason: "infiniteLoop" });
    }
  });
});

describe("Match — snapshot hygiene (server-authoritative boundary)", () => {
  test("mutating a snapshot cannot mutate Match state", () => {
    const m = new Match(players());
    const s1 = m.snapshot("ABCD");
    s1.boards[0][sq("e1")] = null;
    s1.boards[1][sq("a1")] = pc("white", "queen");
    s1.kingCaptures.white = 99;
    const s2 = m.snapshot("ABCD");
    expect(s2.boards[0][sq("e1")]).toEqual(pc("white", "king"));
    expect(s2.boards[1][sq("a1")]).toBeNull();
    expect(s2.kingCaptures.white).toBe(0);
  });

  test("pending.visited never appears in a serialized snapshot", () => {
    const m = toAwaitingPlacement(); // awaitingPlacement carries internal `visited`
    expect(JSON.stringify(m.snapshot("ABCD"))).not.toContain("visited");
  });

  test("the constructor clones its seed: mutating the seed afterward is inert", () => {
    const boards = emptyBoards();
    put(boards[0], "a1", pc("white", "rook"));
    const seed = stateFrom(boards, "white");
    const m = new Match(players(), seed);
    // Mutate the seed after construction — Match must not be affected.
    seed.boards[0][sq("a1")] = null;
    seed.kingCaptures.white = 99;
    const s = m.snapshot("ABCD");
    expect(s.boards[0][sq("a1")]).toEqual(pc("white", "rook"));
    expect(s.kingCaptures.white).toBe(0);
  });
});

describe("waitingSnapshot", () => {
  test("renders the standard opening with just the creator, lobby = waiting", () => {
    const s = waitingSnapshot("ABCD", { id: "p1", name: "Alice", connected: true });
    expect(s.lobby).toBe("waiting");
    expect(s.players).toEqual([{ id: "p1", color: "white", name: "Alice", connected: true }]);
    expect(s.turn).toBe("white");
    expect(s.phase.kind).toBe("awaitingMove");
    expect(s.boards[0][sq("e1")]).toEqual(pc("white", "king"));
    expect(s.boards[1].every((c) => c === null)).toBe(true);
  });
});
