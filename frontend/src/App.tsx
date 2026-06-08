import { useCallback, useEffect, useRef, useState } from "react";
import { Lobby } from "@/components/Lobby";
import { Waiting } from "@/components/Waiting";
import { Game } from "@/components/Game";
import { Net, type Status } from "@/net/socket";
import type { BoardId } from "@shared/board";
import type { PromotionPiece } from "@shared/engine";
import type { PlayerId, RoomSnapshot, ServerMsg } from "@shared/protocol";

const SESSION_KEY = "round-trip-chess";

interface Session {
  code: string;
  token: string;
}

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function roomFromUrl(): string | undefined {
  try {
    return new URLSearchParams(location.search).get("room")?.toUpperCase() ?? undefined;
  } catch {
    return undefined;
  }
}

// Strip ?room= from the URL (e.g. on Back to lobby), so the lobby doesn't keep
// prefilling a code for a room you've already left.
function clearRoomParam() {
  try {
    if (new URLSearchParams(location.search).has("room")) {
      history.replaceState(null, "", location.pathname);
    }
  } catch {
    // history may be unavailable in some embeds; ignore
  }
}

export function App() {
  const [status, setStatus] = useState<Status>("connecting");
  const [you, setYou] = useState<PlayerId | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [actionNonce, setActionNonce] = useState(0);

  const netRef = useRef<Net | null>(null);
  const urlRoom = roomFromUrl();

  const handleMessage = useCallback((m: ServerMsg) => {
    switch (m.t) {
      case "joined":
        setYou(m.you);
        setOpponentLeft(false);
        setError(null);
        setSnapshot(m.state);
        saveSession({ code: m.code, token: m.token });
        break;
      case "state":
        setError(null);
        setSnapshot(m.state);
        break;
      case "opponentLeft":
        setOpponentLeft(true);
        break;
      case "error":
        setError(m.message);
        if (m.code === "room_not_found" || m.code === "bad_token") {
          // A failed (auto-)reconnect or stale code: drop back to the lobby.
          clearSession();
          setYou(null);
          setSnapshot(null);
        } else {
          // An in-game rejection (illegal move/placement, out of turn, …): keep
          // the room, but tell Game to clear its optimistic selection/picker.
          setActionNonce((n) => n + 1);
        }
        break;
    }
  }, []);

  useEffect(() => {
    const net = new Net({
      onMessage: handleMessage,
      onStatus: setStatus,
      getReconnect: () => {
        const s = loadSession();
        if (!s) return null;
        // A ?room= link is the user's explicit intent: never auto-rejoin a
        // *different* stored room over it. Same room (or no URL room) is fine.
        // Read fresh so clearing the param on exit takes effect immediately.
        const fromUrl = roomFromUrl();
        if (fromUrl && s.code !== fromUrl) return null;
        return { t: "reconnect", code: s.code, token: s.token };
      },
    });
    netRef.current = net;
    net.connect();
    return () => net.close();
  }, [handleMessage]);

  // User-initiated create/join: clear any stored session FIRST so a stale
  // reconnect isn't replayed ahead of this on (re)connect and silently swallow
  // the create/join (the server ignores create/join while already bound).
  const create = useCallback((name: string) => {
    clearSession();
    setError(null);
    netRef.current?.send({ t: "create", name });
  }, []);

  const join = useCallback((code: string, name: string) => {
    clearSession();
    setError(null);
    netRef.current?.send({ t: "join", code, name });
  }, []);

  const move = useCallback(
    (board: BoardId, from: number, to: number, promotion?: PromotionPiece) => {
      netRef.current?.send(
        promotion ? { t: "move", board, from, to, promotion } : { t: "move", board, from, to },
      );
    },
    [],
  );

  const place = useCallback((square: number) => {
    netRef.current?.send({ t: "place", square });
  }, []);

  const newGame = useCallback(() => {
    setError(null);
    netRef.current?.send({ t: "newGame" });
  }, []);

  const exit = useCallback(() => {
    netRef.current?.send({ t: "leave" });
    clearSession();
    clearRoomParam(); // drop ?room= so the lobby doesn't prefill a now-stale code
    setYou(null);
    setSnapshot(null);
    setOpponentLeft(false);
    setError(null);
  }, []);

  const disconnected = status !== "open";

  let view;
  if (!you || !snapshot) {
    view = (
      <Lobby
        onCreate={create}
        onJoin={join}
        initialCode={urlRoom}
        error={error}
        busy={disconnected}
      />
    );
  } else if (snapshot.lobby === "waiting") {
    view = <Waiting code={snapshot.code} onCancel={exit} />;
  } else {
    view = (
      <Game
        snapshot={snapshot}
        you={you}
        error={error}
        actionNonce={actionNonce}
        opponentLeft={opponentLeft}
        onMove={move}
        onPlace={place}
        onNewGame={newGame}
        onExit={exit}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {disconnected && (
        <div className="fixed inset-x-0 top-0 z-40 bg-primary py-1.5 text-center text-xs font-bold text-primary-foreground">
          {status === "connecting" ? "Connecting…" : "Connection lost. Reconnecting…"}
        </div>
      )}
      {view}
    </div>
  );
}
