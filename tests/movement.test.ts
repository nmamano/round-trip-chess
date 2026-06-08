import { describe, expect, test } from "bun:test";
import { emptyBoard } from "../shared/board";
import { legalDestinations } from "../shared/movement";
import { pc, put, sq } from "./helpers";

// Convenience: assert a piece's legal destinations equal an exact set (as
// algebraic squares), order-independent but the engine already sorts ascending.
function expectDests(boardFrom: string, dests: number[], expected: string[]) {
  expect(dests).toEqual(expected.map(sq).sort((a, b) => a - b));
  void boardFrom;
}

describe("knight", () => {
  test("jumps over pieces and ignores own-piece landings", () => {
    const b = emptyBoard();
    put(b, "d4", pc("white", "knight"));
    // Surround d4 with own pawns; knight still jumps out.
    for (const s of ["c3", "d3", "e3", "c4", "e4", "c5", "d5", "e5"])
      put(b, s, pc("white", "pawn"));
    const d = legalDestinations(b, sq("d4"));
    expectDests("d4", d, ["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5"]);
  });

  test("captures opponents but not own pieces", () => {
    const b = emptyBoard();
    put(b, "d4", pc("white", "knight"));
    put(b, "e6", pc("black", "pawn")); // capturable
    put(b, "f5", pc("white", "pawn")); // own, blocked
    const d = legalDestinations(b, sq("d4"));
    expect(d).toContain(sq("e6"));
    expect(d).not.toContain(sq("f5"));
  });
});

describe("rook / bishop / queen sliding", () => {
  test("rook stops at first piece, capturing an opponent", () => {
    const b = emptyBoard();
    put(b, "a1", pc("white", "rook"));
    put(b, "a4", pc("black", "pawn")); // capturable, blocks beyond
    put(b, "c1", pc("white", "pawn")); // own, blocks (not captured)
    const d = legalDestinations(b, sq("a1"));
    expect(d).toContain(sq("a2"));
    expect(d).toContain(sq("a3"));
    expect(d).toContain(sq("a4")); // capture
    expect(d).not.toContain(sq("a5")); // blocked beyond capture
    expect(d).toContain(sq("b1"));
    expect(d).not.toContain(sq("c1")); // own piece
    expect(d).not.toContain(sq("d1")); // blocked beyond own piece
  });

  test("bishop moves diagonally and is blocked", () => {
    const b = emptyBoard();
    put(b, "c1", pc("white", "bishop"));
    put(b, "e3", pc("black", "pawn"));
    const d = legalDestinations(b, sq("c1"));
    expect(d).toContain(sq("d2"));
    expect(d).toContain(sq("e3")); // capture
    expect(d).not.toContain(sq("f4")); // blocked beyond capture
    expect(d).toContain(sq("b2"));
    expect(d).toContain(sq("a3"));
  });

  test("queen combines rook and bishop", () => {
    const b = emptyBoard();
    put(b, "d4", pc("white", "queen"));
    const d = legalDestinations(b, sq("d4"));
    // Open board: 27 squares (rook 14 + bishop 13).
    expect(d.length).toBe(27);
    expect(d).toContain(sq("d8"));
    expect(d).toContain(sq("h8"));
    expect(d).toContain(sq("a1"));
    expect(d).toContain(sq("a4"));
  });
});

describe("king", () => {
  test("one step in any direction; blocked by own, captures opponent", () => {
    const b = emptyBoard();
    put(b, "e4", pc("white", "king"));
    put(b, "e5", pc("white", "pawn")); // own, blocked
    put(b, "d5", pc("black", "pawn")); // capturable
    const d = legalDestinations(b, sq("e4"));
    expect(d).not.toContain(sq("e5"));
    expect(d).toContain(sq("d5"));
    expect(d).toContain(sq("f5"));
    expect(d).toContain(sq("e3"));
    expect(d.length).toBe(7); // 8 neighbors minus own pawn on e5
  });
});

describe("pawn", () => {
  test("white pawn: single + double from home rank", () => {
    const b = emptyBoard();
    put(b, "a2", pc("white", "pawn"));
    expectDests("a2", legalDestinations(b, sq("a2")), ["a3", "a4"]);
  });

  test("white pawn: single only when off home rank", () => {
    const b = emptyBoard();
    put(b, "a3", pc("white", "pawn"));
    expectDests("a3", legalDestinations(b, sq("a3")), ["a4"]);
  });

  test("black pawn moves toward rank 1, double from home rank", () => {
    const b = emptyBoard();
    put(b, "d7", pc("black", "pawn"));
    expectDests("d7", legalDestinations(b, sq("d7")), ["d5", "d6"]);
  });

  test("pawn cannot capture straight ahead and is blocked", () => {
    const b = emptyBoard();
    put(b, "e4", pc("white", "pawn"));
    put(b, "e5", pc("black", "pawn")); // directly ahead, not capturable
    expect(legalDestinations(b, sq("e4"))).toEqual([]);
  });

  test("double step blocked when the intermediate square is occupied", () => {
    const b = emptyBoard();
    put(b, "e2", pc("white", "pawn"));
    put(b, "e3", pc("white", "pawn")); // blocks both single and double
    expect(legalDestinations(b, sq("e2"))).toEqual([]);
  });

  test("diagonal captures of opponents only", () => {
    const b = emptyBoard();
    put(b, "e4", pc("white", "pawn"));
    put(b, "d5", pc("black", "pawn")); // capturable
    put(b, "f5", pc("white", "pawn")); // own, not capturable
    const d = legalDestinations(b, sq("e4"));
    expect(d).toContain(sq("e5")); // forward
    expect(d).toContain(sq("d5")); // capture
    expect(d).not.toContain(sq("f5")); // own piece
  });
});

describe("empty square", () => {
  test("returns no destinations", () => {
    expect(legalDestinations(emptyBoard(), sq("d4"))).toEqual([]);
  });
});
