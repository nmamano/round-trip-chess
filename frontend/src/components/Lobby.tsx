import { useState } from "react";
import { Button } from "@/components/Button";

const ADJ = [
  "Swift",
  "Sneaky",
  "Lucky",
  "Bold",
  "Cosmic",
  "Feral",
  "Quiet",
  "Royal",
  "Atomic",
  "Vivid",
];
const NOUN = [
  "Fox",
  "Comet",
  "Raven",
  "Tiger",
  "Specter",
  "Bishop",
  "Hydra",
  "Falcon",
  "Wolf",
  "Sphinx",
];

function randomName() {
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
}

interface Props {
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  initialCode?: string;
  error?: string | null;
  busy?: boolean;
}

export function Lobby({ onCreate, onJoin, initialCode, error, busy }: Props) {
  const [name, setName] = useState(randomName);
  const [code, setCode] = useState((initialCode ?? "").toUpperCase().slice(0, 4));

  const trimmedName = () => name.trim() || "Player";

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-9 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-5xl font-extrabold tracking-tight text-balance sm:text-6xl">
          Round-Trip <span className="text-primary">Chess</span>
        </h1>
        <p className="max-w-md font-sans text-base font-semibold leading-relaxed text-pretty text-muted-foreground">
          Capture pieces to send them to the other board • Win by capturing the opponent&apos;s king
          twice.
        </p>
      </div>

      <div className="w-full rounded-3xl border-2 border-border bg-card p-6 shadow-[0_8px_0_0_var(--border)]">
        <label
          className="mb-2 block font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase"
          htmlFor="name"
        >
          Your name
        </label>
        <div className="mb-6 flex gap-2">
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-2xl border-2 border-input bg-background px-4 py-3 font-semibold outline-none transition-colors focus:border-primary"
            placeholder="Enter a name"
            maxLength={20}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setName(randomName())}
            className="shrink-0 rounded-2xl"
            aria-label="Randomize name"
          >
            Shuffle
          </Button>
        </div>

        <Button
          className="w-full rounded-2xl py-6 text-base"
          disabled={busy}
          onClick={() => onCreate(trimmedName())}
        >
          Create game
        </Button>

        <div className="my-5 flex items-center gap-3 font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase">
          <span className="h-0.5 flex-1 rounded-full bg-border" />
          or join a room
          <span className="h-0.5 flex-1 rounded-full bg-border" />
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.length === 4 && !busy) onJoin(code, trimmedName());
            }}
            className="w-full rounded-2xl border-2 border-input bg-background px-4 py-3 text-center font-heading text-lg font-bold tracking-[0.4em] uppercase outline-none transition-colors focus:border-primary"
            placeholder="CODE"
            maxLength={4}
          />
          <Button
            type="button"
            variant="outline"
            disabled={code.length < 4 || busy}
            onClick={() => onJoin(code, trimmedName())}
            className="shrink-0 rounded-2xl"
          >
            Join
          </Button>
        </div>

        {error && (
          <p className="mt-3 rounded-2xl bg-lose/10 px-3 py-2 text-center text-sm font-semibold text-lose">
            {error}
          </p>
        )}
        {!error && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Create a game and share the 4-letter code with a friend to play.
          </p>
        )}
      </div>
    </main>
  );
}
