import type { Color, PieceType } from "@shared/board";
import { cn } from "@/lib/cn";

// Solid Unicode glyphs for BOTH colors; the fill color + outline stroke are
// applied via CSS so white pieces stay crisp on dark squares (outline glyphs
// can wash out). Shared by the board and the promotion picker.
const GLYPH: Record<PieceType, string> = {
  king: "♚",
  queen: "♛",
  rook: "♜",
  bishop: "♝",
  knight: "♞",
  pawn: "♟",
};

// Text variation selector (U+FE0E). iOS Safari otherwise gives the black pawn
// (U+265F) emoji presentation, so it renders glossy and oversized while the
// other glyphs stay flat text. Appending this forces text presentation; it is a
// no-op on glyphs that already render as text.
const TEXT_PRESENTATION = "\uFE0E";

export function PieceGlyph({
  type,
  color,
  className,
}: {
  type: PieceType;
  color: Color;
  className?: string;
}) {
  return (
    <span
      className={cn(
        color === "white" ? "text-white" : "text-neutral-900",
        // iOS/touch text-style chess glyphs render descent-heavy and sit low in
        // the cell. Nudge up on coarse-pointer devices so they optically center;
        // desktop (fine pointer) is left untouched.
        "pointer-coarse:-translate-y-[8%]",
        className,
      )}
      style={{
        WebkitTextStroke:
          color === "white" ? "1.25px rgba(0,0,0,0.7)" : "1px rgba(255,255,255,0.35)",
      }}
    >
      {GLYPH[type] + TEXT_PRESENTATION}
    </span>
  );
}
