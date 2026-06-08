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
      className={cn(color === "white" ? "text-white" : "text-neutral-900", className)}
      style={{
        WebkitTextStroke:
          color === "white" ? "1.25px rgba(0,0,0,0.7)" : "1px rgba(255,255,255,0.35)",
      }}
    >
      {GLYPH[type]}
    </span>
  );
}
