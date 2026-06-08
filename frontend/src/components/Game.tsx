import { useEffect, useMemo, useState } from "react";
import { Board } from "@/components/Board";
import { PromotionPicker } from "@/components/PromotionPicker";
import { RulesPanel } from "@/components/RulesPanel";
import { Button } from "@/components/Button";
import { legalTargetsFor, needsPromotion } from "@/lib/highlights";
import { cn } from "@/lib/cn";
import type { BoardId, Color } from "@shared/board";
import type { PromotionPiece } from "@shared/engine";
import type { PlayerId, RoomSnapshot } from "@shared/protocol";

interface Props {
  snapshot: RoomSnapshot;
  you: PlayerId;
  error: string | null;
  actionNonce: number; // bumps when the server rejects an action → clear local UI
  opponentLeft: boolean;
  onMove: (board: BoardId, from: number, to: number, promotion?: PromotionPiece) => void;
  onPlace: (square: number) => void;
  onNewGame: () => void;
  onExit: () => void;
}

function kingStatus(n: number): string {
  return n === 0 ? "Safe" : n === 1 ? "1× captured" : "2× captured";
}

export function Game({
  snapshot,
  you,
  error,
  actionNonce,
  opponentLeft,
  onMove,
  onPlace,
  onNewGame,
  onExit,
}: Props) {
  const { phase, turn, kingCaptures, players, boards, code } = snapshot;
  const me = players.find((p) => p.id === you);
  // Read my color from the server-authoritative snapshot rather than assuming
  // p1=White, so the frontend stays correct if sides ever become randomized
  // (HANDOFF-NEXT §8). Fallback preserves the current locked creator=White rule.
  const myColor: Color = me?.color ?? (you === "p1" ? "white" : "black");
  const opp = players.find((p) => p.id !== you);
  const myName = me?.name ?? "You";
  const oppName = opp?.name ?? "Opponent";
  const oppConnected = opp?.connected ?? false;

  const over = phase.kind === "gameOver" ? phase.outcome : null;
  const isMyTurn = phase.kind !== "gameOver" && turn === myColor;
  const moveMode = isMyTurn && phase.kind === "awaitingMove";
  const placeMode = isMyTurn && phase.kind === "awaitingPlacement";

  const [selected, setSelected] = useState<{ board: BoardId; square: number } | null>(null);
  const [promo, setPromo] = useState<{ board: BoardId; from: number; to: number } | null>(null);

  // Clear ephemeral UI whenever the server pushes a new turn/phase, or rejects an
  // action. The board itself always renders snapshot.boards (no optimism).
  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [turn, phase.kind, snapshot.lobby, actionNonce]);

  // Transient error toast.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!error) {
      setToast(null); // a later success cleared the error → drop any stale toast
      return;
    }
    setToast(error);
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [error, actionNonce]);

  const legalTargets = useMemo(() => {
    if (!moveMode || !selected) return [];
    return legalTargetsFor(snapshot, selected.board, selected.square);
  }, [moveMode, selected, snapshot]);

  function handleSquareClick(board: BoardId, square: number) {
    // Placement: only the resolver acts, only on the pending board's options.
    if (placeMode && phase.kind === "awaitingPlacement") {
      if (board === phase.board && phase.options.includes(square)) {
        setSelected(null);
        onPlace(square);
      }
      return;
    }
    if (!moveMode) return;

    const piece = boards[board][square];

    // A move only resolves within the selected piece's own board.
    if (selected && selected.board === board) {
      if (square === selected.square) {
        setSelected(null); // click the same square to deselect
        return;
      }
      if (legalTargets.includes(square)) {
        if (needsPromotion(boards[board], selected.square, square)) {
          setPromo({ board, from: selected.square, to: square });
        } else {
          onMove(board, selected.square, square);
          setSelected(null);
        }
        return;
      }
    }

    // Otherwise (re)select one of your own pieces, or clear.
    if (piece && piece.color === myColor) setSelected({ board, square });
    else setSelected(null);
  }

  function choosePromotion(piece: PromotionPiece) {
    if (!promo) return;
    onMove(promo.board, promo.from, promo.to, piece);
    setPromo(null);
    setSelected(null);
  }

  function decorFor(board: BoardId) {
    const sel = selected && selected.board === board ? selected.square : null;
    const legal = selected && selected.board === board ? legalTargets : [];
    // Show the candidate landing squares to BOTH players (not just the resolver)
    // so the player whose piece was captured can see the pending placement. Only
    // the resolver's board is interactive; Board renders a subtler shape for the
    // passive (non-interactive) preview.
    const placements =
      phase.kind === "awaitingPlacement" && phase.board === board ? phase.options : [];
    const interactive =
      moveMode || (placeMode && phase.kind === "awaitingPlacement" && phase.board === board);
    return { sel, legal, placements, interactive };
  }

  // Status / prompt line.
  let status: string;
  if (over) {
    status =
      over.result === "win"
        ? `${over.winner === myColor ? "You win" : `${oppName} wins`}. King sent round-trip to the primary board.`
        : "Draw. An infinite loop ended the game.";
  } else if (placeMode && phase.kind === "awaitingPlacement") {
    const p = phase.piece;
    status = `Chain! Place the captured ${p.color} ${p.type} on a highlighted square (Board ${phase.board + 1}).`;
  } else if (moveMode) {
    status = selected
      ? "Pick a highlighted square to move."
      : "Your move. Pick a piece on either board.";
  } else if (!oppConnected) {
    status = `${oppName} disconnected. Waiting for them to return…`;
  } else if (phase.kind === "awaitingPlacement") {
    const p = phase.piece;
    status = `${oppName} captured a ${p.color} ${p.type}, choosing where to drop it on Board ${phase.board + 1}…`;
  } else {
    status = `${oppName}'s turn…`;
  }

  const banner = over
    ? over.result === "win"
      ? `🎉 ${over.winner.toUpperCase()} WINS! 🎉`
      : "🤝 DRAW: INFINITE LOOP"
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
      {/* Top bar */}
      <header className="flex items-center justify-between">
        <button
          onClick={onExit}
          className="font-heading text-lg font-extrabold tracking-tight text-muted-foreground transition-colors hover:text-foreground"
        >
          Round-Trip<span className="text-primary">Chess</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="rounded-full border-2 border-border bg-card px-3 py-1 font-heading text-xs font-bold text-muted-foreground">
            Room {code}
          </span>
          <span className="rounded-full border-2 border-primary/30 bg-card px-3 py-1 font-heading text-xs font-bold text-primary">
            You: {myColor.toUpperCase()}
          </span>
        </div>
      </header>

      {/* Scoreboard: turn + king status */}
      <div className="grid grid-cols-1 gap-3 rounded-3xl border-2 border-border bg-card p-4 shadow-[0_6px_0_0_var(--border)] sm:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-3">
          <span className="font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase">
            Current Turn
          </span>
          <span
            className={cn(
              "rounded-full px-3 py-1 font-heading text-sm font-extrabold",
              over ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            {turn.toUpperCase()}
          </span>
          {isMyTurn && !over && (
            <span className="font-heading text-xs font-bold text-primary">(you)</span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          <KingPill label="White King" value={kingCaptures.white} />
          <KingPill label="Black King" value={kingCaptures.black} />
        </div>
      </div>

      {/* Players */}
      <div className="flex items-center justify-between px-1 text-sm">
        <span className="flex items-center gap-2 font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          {myName} <span className="font-normal text-muted-foreground">(you)</span>
        </span>
        <span className="flex items-center gap-2 font-bold">
          {oppName}
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              oppConnected ? "bg-win" : "bg-muted-foreground/40",
            )}
            title={oppConnected ? "Connected" : "Reconnecting…"}
          />
        </span>
      </div>

      {/* Boards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {([0, 1] as BoardId[]).map((b) => {
          const d = decorFor(b);
          return (
            <Board
              key={b}
              cells={boards[b]}
              boardId={b}
              label={b === 0 ? "Primary board" : "Secondary board"}
              orientation={myColor}
              selected={d.sel}
              legalTargets={d.legal}
              placementTargets={d.placements}
              interactive={d.interactive}
              onSquareClick={handleSquareClick}
            />
          );
        })}
      </div>

      {/* Status / banner */}
      <div
        className={cn(
          "rounded-3xl border-2 p-4 text-center transition-colors",
          over && over.result === "win" && over.winner === myColor && "border-win/60 bg-win/10",
          over && over.result === "win" && over.winner !== myColor && "border-lose/60 bg-lose/10",
          over && over.result === "draw" && "border-border bg-muted",
          !over && "border-border bg-card",
        )}
      >
        {banner ? (
          <div className="flex flex-col items-center gap-4">
            <div
              className={cn(
                "font-heading text-2xl font-extrabold sm:text-3xl",
                over?.result === "win" && over.winner === myColor && "text-win",
                over?.result === "win" && over.winner !== myColor && "text-lose",
                over?.result === "draw" && "text-foreground",
              )}
            >
              {banner}
            </div>
            <p className="text-sm font-semibold text-muted-foreground">{status}</p>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button className="flex-1 rounded-2xl sm:flex-none sm:px-8" onClick={onNewGame}>
                New Game
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-2xl sm:flex-none sm:px-8"
                onClick={onExit}
              >
                Back to lobby
              </Button>
            </div>
          </div>
        ) : (
          <p className="font-heading text-base font-bold sm:text-lg">{status}</p>
        )}
      </div>

      <RulesPanel />

      {/* Promotion picker */}
      {promo && (
        <PromotionPicker
          color={myColor}
          onChoose={choosePromotion}
          onCancel={() => {
            setPromo(null);
            setSelected(null);
          }}
        />
      )}

      {/* Error toast */}
      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <button
            onClick={() => setToast(null)}
            className="rounded-2xl border-2 border-lose/40 bg-card px-4 py-2 text-sm font-semibold text-lose shadow-[0_4px_0_0_var(--border)]"
          >
            {toast}
          </button>
        </div>
      )}

      {/* Opponent-left overlay */}
      {opponentLeft && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-foreground/30 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border-2 border-border bg-card p-6 text-center shadow-[0_8px_0_0_var(--border)]">
            <div className="font-heading text-2xl font-extrabold">Opponent left</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Your opponent disconnected and didn&apos;t return.
            </p>
            <Button className="mt-5 w-full rounded-2xl" onClick={onExit}>
              Back to lobby
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

function KingPill({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 2
      ? "border-lose/50 bg-lose/10 text-lose"
      : value === 1
        ? "border-accent/60 bg-accent/15 text-accent-foreground"
        : "border-border bg-background text-muted-foreground";
  return (
    <span
      className={cn("rounded-full border-2 px-3 py-1 text-xs font-bold whitespace-nowrap", tone)}
    >
      {label}: {kingStatus(value)}
    </span>
  );
}
