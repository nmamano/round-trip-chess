// Rules copy: verbatim from PROMPT.md §6 (the bottom "Rules" info panel).

const RULES = [
  "Each turn, move a piece on either board (your choice, not both)",
  "Captured pieces move to the other board – you place them on valid starting positions",
  "Chain reaction: placing on an occupied square captures that piece too (even your own!)",
  "Win by capturing the opponent's king on BOTH boards (round-trip)",
  "No checkmate – you must actually capture the king",
];

export function RulesPanel() {
  return (
    <div className="rounded-3xl border-2 border-border bg-card p-5">
      <h2 className="font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Rules
      </h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-foreground">
        {RULES.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-primary">▸</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
