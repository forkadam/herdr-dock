// One live stream of an agent-browser session: its WebSocket, the frames it sends written to files the panel draws
// with image() (a few kept, the rest deleted), and the rest of its messages folded into `state` (streamStep).
// The panel owns the decisions: it is told through onChange (anything changed) and onLost (the socket went away).
import { WebSocket } from "websocket";
import { Buffer } from "buffer";
import * as fs from "fs/promises";
import { appHome } from "herdr";
import { slashPath } from "../../shared/path.js";
import { FrameRing, decodeBase64, jpegSize, streamStep } from "../../shared/browser/frame.js";

const MAX_FPS = 15;
let nativeBase64 = true; // the runtime's Buffer decodes base64 (checked on the first frame)

function bytesOf(data) {
  if (nativeBase64) {
    try {
      const b = Buffer.from(data, "base64");
      if (b && b.length > 2 && b[0] === 0xff && b[1] === 0xd8) return b;
    } catch {}
    nativeBase64 = false;
  }
  return decodeBase64(data);
}

const textOf = (raw) => (typeof raw === "string" ? raw : new TextDecoder().decode(raw));

// Clears in flight, by folder: a new stream for the same terminal waits for the old one's clear, so the old rmdir
// never lands after the new mkdir.
const clearing = new Map();

// Every file in an app-home-relative folder, then the folder: what a stopped stream leaves behind.
export function clearFolder(rel) {
  const p = (clearing.get(rel) ?? Promise.resolve()).then(() => removeFolder(rel));
  clearing.set(rel, p);
  p.finally(() => { if (clearing.get(rel) === p) clearing.delete(rel); });
  return p;
}

async function removeFolder(rel) {
  const dir = `${slashPath(appHome())}/${rel}`;
  let names = [];
  try { names = await fs.readdir(dir); } catch { return; }
  await Promise.all(names.map((n) => fs.unlink(`${dir}/${n}`).catch(() => {})));
  await fs.rmdir(dir).catch(() => {});
}

export class Stream {
  constructor({ port, framesRel, onChange, onLost }) {
    this.port = port;
    this.framesRel = framesRel;
    this.onChange = onChange ?? (() => {});
    this.onLost = onLost ?? (() => {});
    this.ring = new FrameRing(framesRel);
    this.state = { phase: "connecting", url: "", tabs: [], status: null, errors: 0, errorTexts: [] };
    this.size = null; // the frame's { w, h } from its JPEG header: the page's CSS pixels
    this.loss = {}; // afterLoss's memory (lastReconnect)
    this.ws = null;
    this.stopped = false;
    this.gen = 0;
    this.epoch = Date.now().toString(36); // frame names never repeat, so a cached picture is never shown for a new one
    this.count = 0;
  }

  get frame() { return this.ring.current; }
  get prev() { return this.ring.prev; }

  start(cx) {
    if (this.stopped) return;
    const gen = ++this.gen;
    const home = slashPath(appHome());
    cx.spawn(async () => {
      let ws = null;
      try {
        await (clearing.get(this.framesRel) ?? Promise.resolve()).catch(() => {});
        await fs.mkdir(`${home}/${this.framesRel}`, { recursive: true });
        ws = await WebSocket.connect(`ws://127.0.0.1:${this.port}/?maxFps=${MAX_FPS}`);
        if (this.stopped || gen !== this.gen) { ws.close().catch(() => {}); return; }
        this.ws = ws;
        this.set({ ...this.state, phase: "live" });
        for (;;) {
          const raw = await ws.read();
          if (this.stopped || gen !== this.gen) return;
          let m;
          try { m = JSON.parse(textOf(raw)); } catch { continue; }
          if (m?.type === "frame") { await this.write(m, home); continue; }
          const next = streamStep(this.state, m);
          if (next !== this.state) this.set(next);
          if (next.phase === "lost") break;
        }
      } catch {}
      if (this.stopped || gen !== this.gen) return;
      if (this.ws === ws) this.ws = null;
      ws?.close().catch(() => {});
      this.set({ ...this.state, phase: "lost" });
      this.onLost(this);
    });
  }

  // The same stream on a new port (agent-browser restarted its daemon): the frames drawn stay until new ones come.
  reconnect(port, cx) {
    this.port = port;
    this.set({ ...this.state, phase: "connecting" });
    this.start(cx);
  }

  async write(m, home) {
    if (typeof m.data !== "string") return;
    const bytes = bytesOf(m.data);
    const size = jpegSize(bytes);
    if (!size) return;
    const { rel, drop } = this.ring.next(`${this.epoch}-${++this.count}`);
    const file = `${home}/${rel}`;
    try {
      await fs.writeFile(file, bytes);
    } catch {
      // The folder went away under us (a clear that landed late): make it again and try once more.
      try {
        await fs.mkdir(`${home}/${this.framesRel}`, { recursive: true });
        await fs.writeFile(file, bytes);
      } catch {
        this.ring.list = this.ring.list.filter((r) => r !== rel);
        return;
      }
    }
    for (const d of drop) fs.unlink(`${home}/${d}`).catch(() => {});
    if (this.stopped) { fs.unlink(`${home}/${rel}`).catch(() => {}); return; }
    this.size = size;
    this.onChange(this);
  }

  set(state) { this.state = state; this.onChange(this); }

  // Closes the socket and deletes the frames folder (the returned promise settles when it's gone).
  stop() {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    this.gen++;
    const ws = this.ws;
    this.ws = null;
    ws?.close().catch(() => {});
    this.ring.clear();
    return clearFolder(this.framesRel);
  }

  // A message to the page (input). Typed input goes here only: never logged.
  send(msg) {
    this.ws?.write(JSON.stringify(msg)).catch(() => {});
  }
}
