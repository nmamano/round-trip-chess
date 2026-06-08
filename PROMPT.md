# Round-Trip Chess — Game Design Spec

> This is the **design source of truth** for the Round-Trip Chess variant. The
> implementation kickoff lives in [`HANDOFF.md`](./HANDOFF.md).
>
> There is **no original source code to reuse**: the prototype was generated with
> v0 (Vercel) under a different account. The live v0 app is a **visual/behavioral
> reference only** — observe it, don't expect to copy its code.

---

## 0. One-paragraph pitch

**Round-Trip Chess** is a two-board chess variant. Play starts like normal chess,
but captured pieces are never removed from the game — they travel to a **second
board**. You win by capturing the opponent's king on **both** boards: a "round
trip" from the first board to the second and back.

---

## 1. Rules (as authored — preserve verbatim)

> Starts like normal chess until pieces are captured. Captured pieces are not
> removed — they are moved to a second board that starts empty. The captured
> piece doesn't change sides, but the capturer decides where to place it among the
> valid starting positions for that piece and color.
>
> At each turn, each player moves a piece on either board of their choosing (not
> both).
>
> Capturing a piece on the second board sends it back to the first board — again,
> the capturer decides where to place it among the valid starting positions for
> that piece and color.
>
> The weird part: if you capture a piece and there is another piece in one of its
> starting positions in the other board, you can place the captured piece there
> and capture that other piece — even your own piece — which you then need to move
> to the other board. This can cause long chain reactions and has many strategic
> applications.
>
> You win by capturing the opponent's king on both boards. That is, sending it
> round-trip from the first board to the second board and back.
>
> Notes:
>
> - There is no checkmate; you have to actually capture the king.
> - If you cause an infinite loop (a rare edge case), you win.

---

## 2. Win condition

- Capture the opponent's king on **both** boards → **win**.
- The UI tracks each king's state: **Safe → 1× captured → 2× captured** (the
  second capture is the win).
- **No checkmate** — you must literally capture the king. (Kings can move into
  and sit in "check"; there is no check/checkmate concept.)
- **Infinite loop**: if a chain reaction (see §4) causes an infinite loop, the
  player who triggered it **wins**.

---

## 3. Turn structure

- Two players, **White** and **Black**, alternate turns.
- On your turn you move **exactly one piece**, on **either** board (your choice —
  **not both**). The two boards are independent surfaces; a single turn touches
  one of them.
- Movement on each board follows **standard chess piece movement**. (Castling /
  en passant / promotion: see Design Questions §6 — confirm against the v0
  reference; likely simplified or omitted in v0.)
- A move that lands on an opponent (or, via placement, any) piece is a
  **capture**, which triggers the placement/chain mechanic below.

---

## 4. Capture → placement → chain reaction (the core mechanic)

- A captured piece **keeps its color** (it does not switch sides).
- The piece is moved to the **other board** and placed by the **capturer** on one
  of the **valid starting positions** for that piece's type and color.
- **Board 1** starts as a standard chess setup; **Board 2** starts **empty**. A
  capture on Board 1 sends the piece to Board 2; a capture on Board 2 sends it
  back to Board 1.
- **Chain reaction:** if the chosen starting square is **already occupied**, the
  placed piece **captures** whatever is there — even one of **your own** pieces.
  That newly-captured piece must then be placed on the other board (again on a
  valid starting square), which may itself be occupied, continuing the chain.
- Chains can be long and are a deliberate strategic feature.

### Proposed "valid starting positions" (confirm against v0)

| Piece | White squares | Black squares |
| ----- | ------------- | ------------- |
| Pawn | a2–h2 | a7–h7 |
| Rook | a1, h1 | a8, h8 |
| Knight | b1, g1 | b8, g8 |
| Bishop | c1, f1 | c8, f8 |
| Queen | d1 | d8 |
| King | e1 | e8 |

The capturer chooses among these for the relevant board. Open question: behavior
when **all** valid squares for that piece/color are occupied (forced chain? choose
any? — see §6).

---

## 5. Reference deployment (UX reference only — not our code)

Live v0 prototype (local hotseat, **single browser, no multiplayer**):
**https://v0-round-trip-chess-variant.vercel.app/**

Use it to match the look, layout, and interaction feel. Our build replaces the
client-only hotseat with **real-time online multiplayer** (see `HANDOFF.md`).

---

## 6. Website copy (use verbatim)

- **Title:** Round-Trip Chess
- **Subtitle:** Capture pieces to send them to the other board • Win by capturing
  the opponent's king twice

**UI state display:**

- `Current Turn: WHITE`
- `White King: Safe` → `1x captured` → `2x captured` (that's the win condition)
- `Black King: Safe`
- **New Game** button
- When the game ends: `🎉 WHITE WINS! 🎉`

**Main UI:**

- Primary board
- Secondary board

**Bottom info panel — Rules:**

- Each turn, move a piece on either board (your choice, not both)
- Captured pieces move to the other board – you place them on valid starting
  positions
- Chain reaction: placing on an occupied square captures that piece too (even
  your own!)
- Win by capturing the opponent's king on BOTH boards (round-trip)
- No checkmate – you must actually capture the king

---

## 7. Design questions to resolve during implementation

Resolve from first principles or by observing the v0 reference; flag anything that
can't be settled to Nil.

1. **Valid-square selection when occupied/full:** if a placement square is taken →
   chain (per §4). If *all* valid squares for that piece/color are occupied, must
   the capturer pick one (forcing a chain), or is there another rule?
2. **Castling / en passant / promotion:** in scope, or simplified/omitted (as v0
   likely did)? Promotion is especially fraught with two boards.
3. **Chain-reaction resolution:** strictly sequential, capturer chooses at each
   step; define the loop-detection that yields the "infinite loop = win" outcome.
4. **King capture & the win counter:** confirm a king capture increments its
   counter and re-enters play on the other board until the 2nd capture (win).
   Can a king be captured by a chain placement (not just a normal move)?
5. **Turn legality:** can you pass? Must a legal move exist? What if a player has
   no legal moves on either board?
6. **Move timer:** the v0 hotseat has none. For online play, decide whether to add
   an optional per-move/clock timer (probably out of scope for MVP).
