// Local preview server

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { ENTITIES, entityId } from "./src/entities.ts";

const PORT = Number(process.env.PORT) || 8081;
const build = new URL("./build/", import.meta.url).pathname;

// In-memory mock of everything in src/entities.ts
const state = new Map();
function set(entity, value, stateStr, numberRange) {
  const id = entityId(entity);
  state.set(id, { id, ...entity, value, state: stateStr ?? String(value), ...numberRange });
}

set(ENTITIES.cooling, true, "ON");
set(ENTITIES.schedule, true, "ON");
set(ENTITIES.presence, false, "OFF");
set(ENTITIES.acPower, true, "ON");
set(ENTITIES.missedMeal, false, "OFF");
set(ENTITIES.battery, 87, "87 %");
set(ENTITIES.chamberTemp, null, "NA");
setTimeout(() => {
  set(ENTITIES.chamberTemp, 41.2, "41.2 °F");
  broadcast(state.get(entityId(ENTITIES.chamberTemp)));
}, 5000);
set(ENTITIES.visitCount, 4, "4");
const lastVisit = new Date(Date.now() - 42 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
set(ENTITIES.lastVisitTime, lastVisit, lastVisit);
set(ENTITIES.lastVisitDuration, 92.3, "92.3 s");
set(ENTITIES.totalVisitTime, 401, "401 s");
set(ENTITIES.coolingTarget, "40", "40", { min_value: "30", max_value: "70", step: "1" });
set(ENTITIES.arrivalTimeout, "10", "10", { min_value: "1", max_value: "60", step: "1" });
set(ENTITIES.minimumFeedingTime, "3", "3", { min_value: "0", max_value: "120", step: "1" });
set(ENTITIES.chimeInterval, "0", "0", { min_value: "0", max_value: "600", step: "5" });
set(ENTITIES.statusLed, true, "ON");
set(ENTITIES.firmwareVersion, "2026.9.0 (config hash 0xdeadbeef, built Sep 12 2026, 05:47:00)");
const [mealOne, mealTwo, mealThree] = ENTITIES.feedTimes;
set(mealOne, "07:30:00", "07:30:00");
set(mealTwo, "12:30:00", "12:30:00");
set(mealThree, "18:00:00", "18:00:00");
for (const button of [ENTITIES.feedNow, ENTITIES.rotatePlate, ENTITIES.doorToggle, ENTITIES.chime]) {
  set(button, null, "");
}

const sseClients = new Set();
function broadcast(entity) {
  const line = `event: state\ndata: ${JSON.stringify(entity)}\n\n`;
  for (const res of sseClients) res.write(line);
}

const CONTENT_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
};

async function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? "index.html" : pathname.slice(1);
  try {
    const full = pathname === "/" ? null : join(build, filePath);
    const body = full ? await readFile(full) : INDEX_HTML;
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(filePath) || ".html"] || "text/plain" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const INDEX_HTML = `<!DOCTYPE html><html><head><meta charset=UTF-8><link rel=stylesheet href=/style.css></head><body><script type=module src=/app.js></script><esp-app></esp-app></body></html>`;

const serverStartedAt = Date.now();
function currentUptimeSeconds() {
  return Math.floor((Date.now() - serverStartedAt) / 1000);
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  res.write(`event: ping\ndata: ${JSON.stringify({ title: "Polar Wet Food Feeder", uptime: currentUptimeSeconds() })}\n\n`);
  for (const entity of state.values()) {
    res.write(`event: state\ndata: ${JSON.stringify(entity)}\n\n`);
  }
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

// Real ESPHome sends a heartbeat "ping" (with fresh uptime) every 10s
setInterval(() => {
  const line = `event: ping\ndata: ${JSON.stringify({ uptime: currentUptimeSeconds() })}\n\n`;
  for (const res of sseClients) res.write(line);
}, 10000);

// Generic POST /<domain>/<name>/<action> handler covering everything app.ts calls. Like
// web_server, an action the entity's domain doesn't support is a 404, and like NumberCall,
// an out-of-range number is still a 200 but leaves the state unchanged.
const ACTIONS = {
  switch: ["turn_on", "turn_off", "toggle"],
  button: ["press"],
  number: ["set"],
  time: ["set"],
};

function handleAction(req, res, parts, query) {
  const [domain, nameEnc, action] = parts;
  const name = decodeURIComponent(nameEnc);
  const entity = state.get(domain + "/" + name);
  if (!entity || !ACTIONS[domain]?.includes(action)) {
    console.warn(`[mock] 404: ${req.method} ${req.url}`);
    res.writeHead(404);
    res.end();
    return;
  }

  if (domain === "switch") {
    const next = action === "toggle" ? entity.value !== true : action === "turn_on";
    entity.value = next;
    entity.state = next ? "ON" : "OFF";
  } else if (domain === "button") {
    console.log(`[mock] button press: ${name}`);
  } else if (domain === "number") {
    const value = Number(query.get("value"));
    if (!(value >= Number(entity.min_value) && value <= Number(entity.max_value))) {
      console.warn(`[mock] ${name}: ${query.get("value")} is outside ${entity.min_value}-${entity.max_value}, ignored`);
      res.writeHead(200);
      res.end();
      return;
    }
    entity.value = query.get("value");
    entity.state = entity.value;
  } else if (domain === "time") {
    entity.value = query.get("value");
    entity.state = entity.value;
  }

  broadcast(entity);
  res.writeHead(200);
  res.end();
}

// Light background drift so live-update paths (battery icon thresholds, presence
// opacity, next-meal countdown) are visible without manually poking every control.
setInterval(() => {
  const presence = state.get(entityId(ENTITIES.presence));
  presence.value = !presence.value;
  presence.state = presence.value ? "ON" : "OFF";
  broadcast(presence);
}, 15000);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/events") return handleEvents(req, res);

  const parts = url.pathname.slice(1).split("/");
  if (req.method === "POST" && parts.length >= 2) return handleAction(req, res, parts, url.searchParams);

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`PLAF109 remote preview: http://localhost:${PORT}`);
});
