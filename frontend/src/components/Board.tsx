// A DUMB board renderer: a pure function of its props with NO chess rules. It
// receives a cell array plus decoration sets and reports raw square clicks; the
// caller (Game) owns all intent. This keeps the renderer trivially swappable
// (e.g. chessground later) without leaking variant rules into it.

import type { Board as BoardCells, BoardId, Color } from "@shared/board";
import { fileOf, rankOf, squareToAlgebraic } from "@shared/board";
import { PieceGlyph } from "@/components/PieceGlyph";
import { cn } from "@/lib/cn";

interface Props {
  cells: BoardCells;
  boardId: BoardId;
  label: string;
  orientation: Color; // "white" = white home rank at bottom; "black" = flipped 180°
  selected: number | null;
  legalTargets: number[];
  placementTargets: number[];
  interactive: boolean;
  onSquareClick: (board: BoardId, square: number) => void;
}

export function Board({
  cells,
  boardId,
  label,
  orientation,
  selected,
  legalTargets,
  placementTargets,
  interactive,
  onSquareClick,
}: Props) {
  const legal = new Set(legalTargets);
  const placements = new Set(placementTargets);

  // Display order. White: rank 8 top / file a left. Black: rotated 180°. The
  // canonical square index always flows through onSquareClick unchanged.
  const squares: number[] = [];
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const rank = orientation === "white" ? 7 - dr : dr;
      const file = orientation === "white" ? dc : 7 - dc;
      squares.push(rank * 8 + file);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <span className="font-heading text-sm font-bold tracking-wide text-foreground">
          {label}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {boardId === 0 ? "standard start" : "starts empty"}
        </span>
      </div>
      <div
        className="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-xl border-2 border-border shadow-[0_4px_0_0_var(--border)]"
        role="grid"
        aria-label={label}
      >
        {squares.map((sq, i) => {
          const piece = cells[sq];
          const dark = (fileOf(sq) + rankOf(sq)) % 2 === 0;
          const isSelected = selected === sq;
          const isLegal = legal.has(sq);
          const isPlacement = placements.has(sq);
          const showRank = i % 8 === 0; // leftmost display column
          const showFile = i >= 56; // bottom display row
          return (
            <button
              key={sq}
              type="button"
              disabled={!interactive}
              onClick={() => onSquareClick(boardId, sq)}
              className={cn(
                // container-type lets the glyph size scale with the cell (cqi)
                // instead of a fixed font-size, so pieces fill the square at any
                // board width.
                "relative flex aspect-square items-center justify-center select-none [container-type:inline-size]",
                dark ? "bg-[var(--sq-dark)]" : "bg-[var(--sq-light)]",
                interactive ? "cursor-pointer" : "cursor-default",
                isSelected && "outline outline-2 -outline-offset-2 outline-[var(--sq-sel)]",
              )}
              aria-label={
                squareToAlgebraic(sq) + (piece ? ` ${piece.color} ${piece.type}` : " empty")
              }
            >
              {showRank && (
                <span className="absolute top-0.5 left-0.5 text-[9px] font-bold text-foreground/40">
                  {rankOf(sq) + 1}
                </span>
              )}
              {showFile && (
                <span className="absolute right-0.5 bottom-0.5 text-[9px] font-bold text-foreground/40">
                  {"abcdefgh"[fileOf(sq)]}
                </span>
              )}
              {piece && (
                <PieceGlyph
                  type={piece.type}
                  color={piece.color}
                  className="text-[100cqi] leading-none"
                />
              )}
              {isLegal &&
                (piece ? (
                  <span className="pointer-events-none absolute inset-1 rounded-full border-[3px] border-[var(--sq-move)]" />
                ) : (
                  <span className="pointer-events-none absolute h-1/4 w-1/4 rounded-full bg-[var(--sq-move)]" />
                ))}
              {isPlacement &&
                (interactive ? (
                  // Active (your turn to place): filled tint + dashed circle, clickable.
                  <>
                    <span className="pointer-events-none absolute inset-0 bg-[var(--sq-place)]" />
                    <span className="pointer-events-none absolute h-1/3 w-1/3 rounded-full border-2 border-dashed border-[var(--sq-place-ring)]" />
                  </>
                ) : (
                  // Passive preview (opponent is placing): show WHERE the captured
                  // piece may land, but as a subtler dashed square outline (no fill,
                  // no circle) so it reads as "watch", not "click".
                  <span className="pointer-events-none absolute inset-[3px] rounded-md border-2 border-dashed border-[var(--sq-place-ring)] opacity-60" />
                ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
