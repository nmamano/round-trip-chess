// Hono app: WS upgrade + Bun default export. In-memory state only — see fly.toml
// (added in a later slice): this MUST run on exactly one machine.
//
// No static SPA serving yet — the frontend is a later slice. Once it exists, add
// serveStatic("./frontend/dist") with an index.html fallback, as in rps-roulette.

import { Hono } from "hono";
import { logger } from "hono/logger";
import { RoomStore } from "./rooms";
import { registerSocket } from "./socket";

const PORT = Number(process.env.PORT ?? 3000);

const app = new Hono();
// Quiet under `bun test` (NODE_ENV=test); log requests in dev/prod.
if (process.env.NODE_ENV !== "test") app.use("*", logger());

const store = new RoomStore();
const websocket = registerSocket(app, store);

app.get("/health", (c) => c.json({ ok: true, rooms: store.size }));
app.get("/", (c) => c.text("Round-Trip Chess server. Connect a WebSocket to /ws."));

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
