// Pick and Notes: the person points at elements of the page and sends them to the agent as Design Feedback. Mixed
// into the panel's class (main.js): `this` is the panel. Ported in spirit from cockpit's browser/main/design.js
// (cockpit, MIT; its picker from Orca, MIT, Copyright (c) 2026 Lovecast Inc.).
//
// Pick or Notes takes the page (a take-over with that reason, so the agent waits) and puts PICK_SCRIPT in it. Pointer
// moves reach the page over the stream (the script outlines the element under them); a click is the script's (the
// page never sees it). After each click the panel reads the picks, takes a picture of the page with the element
// outlined, and lists it with a note field. Send types the prompt into the agent's terminal (`hc send`), then the page
// is handed back; Copy puts it on the clipboard. The state is this copy's: another copy only shows that it runs.
import { appHome, hc } from "herdr";
import { InputState } from "gpui-base";
import * as fs from "fs/promises";
import { slashPath } from "../../shared/path.js";
import { picksRel } from "../../shared/browser/session.js";
import { pageHeading } from "../../shared/browser/frame.js";
import { changes } from "../../shared/browser/panel.js";
import { NOTES_MAX, addPicks, designFeedback, pictureName, stalePicks } from "../../shared/browser/feedback.js";
import { PICK_SCRIPT, READ_PICKS, RELEASE_SCRIPT, holdScript, markScript, parsePicks } from "../../shared/browser/pick-script.js";

const home = () => slashPath(appHome());
const READ_TRIES = 6; // reads after a click, 150 ms apart, until the script has recorded it
const BACKSTOP_MS = 2000;
// Each read first puts the script back if the page lost it (a reload or another page): the next click is a pick again.
const READ_AGAIN = `${PICK_SCRIPT};\n${READ_PICKS}`;

export const pickControls = {
  // The note fields, made once (InputState needs a live host call, not render): one per element Notes can hold.
  makeNoteInputs() {
    this.noteInputs = Array.from({ length: NOTES_MAX }, () => InputState.new({ placeholder: "What should change here?" }));
    for (const input of this.noteInputs) input.on("submit", (_e, cx) => { if (this.picking?.kind === "pick") this.sendFeedback(cx); });
    this.freeSlots = this.noteInputs.map((_x, i) => i);
    this.pickWanted = false; // a click came while the picks were being read: read again
    this.pickReading = false;
    this.picking = null; // { kind: "pick" | "notes", t, items: [{ ...pick, picture, slot, intent, priority }] }
  },

  startPick(kind, cx) {
    this.act(kind === "pick" ? "Starting Pick…" : "Starting Notes…", cx, async (t, rec, cx) => {
      this.dropPicks();
      await this.setControl(t, changes.pick(kind, Date.now()));
      this.picking = { kind, t, items: [] };
      this.flash = null;
      await this.ab(rec, ["eval", PICK_SCRIPT]);
      this.pickBackstop(this.picking, cx);
    });
  },

  // Besides the read after each click here: one every few seconds while it runs (a click that reached the page
  // another way, one whose read gave up early, or a page that lost the script).
  pickBackstop(p, cx) {
    if (!p) return;
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(BACKSTOP_MS);
        if (this.picking !== p) return;
        if (this.terminal === p.t && !this.pickReading) this.pickClicked(cx, 1);
      }
    });
  },

  // A click went to the page while picking: read what the script recorded (one read loop at a time; a click during
  // it runs the loop once more).
  pickClicked(cx, tries = READ_TRIES) {
    if (!this.myPick()) return;
    this.pickWanted = true;
    if (this.pickReading) return;
    this.pickReading = true;
    cx.spawn(async (cx) => {
      try {
        while (this.pickWanted) { this.pickWanted = false; await this.readPicks(cx, tries); }
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.pickReading = false;
      cx.notify();
    });
  },

  async readPicks(cx, tries) {
    const p = this.picking, rec = this.record;
    for (let i = 0; i < tries && this.picking === p && rec; i++) {
      await cx.sleep(i ? 150 : 80);
      const r = await this.ab(rec, ["eval", READ_AGAIN]).catch(() => null);
      const picks = parsePicks(r?.stdout);
      if (!picks.length) continue;
      await this.addPicked(p, rec, picks);
      cx.notify();
      return;
    }
  },

  async addPicked(p, rec, picks) {
    const { added, dropped } = addPicks(p.items, picks, p.kind);
    this.error = dropped ? `Notes holds ${NOTES_MAX} elements: send or remove some first` : null;
    if (p.kind === "pick" && added.length) this.dropItems(p.items.splice(0));
    for (const pick of added) {
      const picture = await this.takePicture(rec, p.t, pick);
      if (this.picking !== p) { if (picture) await fs.unlink(picture).catch(() => {}); return; }
      const slot = this.freeSlots.shift();
      if (slot === undefined) break;
      this.noteInputs[slot].set_value("");
      const notes = p.kind === "notes";
      p.items.push({ ...pick, picture, slot, intent: notes ? "fix" : null, priority: notes ? "normal" : null });
      this.noteInputs[slot].focus();
    }
    this.flash = null;
    if (p.kind === "notes") await this.markNotes(rec);
  },

  // The whole page with the element outlined (agent-browser takes no element shot), under picks/; null on failure.
  async takePicture(rec, t, pick) {
    const dir = `${home()}/${picksRel()}`;
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    const path = `${dir}/${pictureName(t, Date.now(), pick.n)}`;
    try {
      await this.ab(rec, ["eval", holdScript(pick.n)]);
      await this.ab(rec, ["screenshot", path]);
      return path;
    } catch (e) {
      console.log(`dock-browser: no picture: ${e?.message ?? e}`);
      return null;
    } finally {
      await this.ab(rec, ["eval", RELEASE_SCRIPT]).catch(() => null);
    }
  },

  // Notes' numbered badges in the page, numbered as the list is.
  async markNotes(rec) {
    const p = this.picking;
    if (!p || p.kind !== "notes") return;
    await this.ab(rec, ["eval", markScript(p.items.map((it, i) => ({ n: it.n, label: i + 1 })))]).catch(() => null);
  },

  removeNote(i, cx) {
    const p = this.picking;
    if (!p?.items[i]) return;
    this.dropItems(p.items.splice(i, 1));
    const rec = this.record;
    if (rec) cx.spawn(async () => this.markNotes(rec));
    cx.notify();
  },

  setNoteField(i, field, value, cx) {
    const it = this.picking?.items[i];
    if (!it) return;
    it[field] = value;
    cx.notify();
  },

  // The prompt for what is listed, with the notes as typed.
  feedbackText() {
    const p = this.picking;
    const { url } = pageHeading(this.record, this.stream?.state ?? {});
    return designFeedback({ url, items: p.items.map((it) => ({ ...it, note: this.noteInputs[it.slot].value() })) });
  },

  copyNotes(cx) {
    if (!this.picking?.items.length) return;
    cx.write_to_clipboard(this.feedbackText());
    this.flash = "Copied";
    cx.notify();
  },

  // Typed into the agent's terminal as its next prompt; then the script leaves the page and the page is handed back
  // (finish: size tabs closed, the agent's tab and size back). The pictures stay for the agent to open.
  sendFeedback(cx) {
    const p = this.picking;
    if (!p?.items.length || this.busy) return;
    const text = this.feedbackText();
    this.act("Sending…", cx, async (t, rec) => {
      const r = await hc(["send", t, text]);
      if (r.code !== 0) throw new Error(String(r.stderr || r.stdout || "").trim().split("\n")[0] || "The agent's terminal didn't take it");
      this.releaseSlots(p.items);
      if (this.picking === p) this.picking = null;
      await this.finish(t, rec, true);
      await this.setControl(t, changes.handBack());
    });
  },

  // Leaving Pick or Notes without sending: the same as Hand back (its finish takes the script out of the page).
  leavePick(cx) { this.handBack(cx); },

  // This copy's Pick or Notes ended (sent, or the record no longer says so): what wasn't sent goes, pictures included.
  dropPicks() {
    const p = this.picking;
    this.picking = null;
    if (p) this.dropItems(p.items);
  },

  dropItems(items) {
    this.releaseSlots(items);
    for (const it of items) if (it.picture) fs.unlink(it.picture).catch(() => {});
  },

  releaseSlots(items) {
    for (const it of items) {
      if (!Number.isInteger(it.slot) || this.freeSlots.includes(it.slot)) continue;
      this.noteInputs[it.slot].set_value("");
      this.freeSlots.push(it.slot);
    }
    this.freeSlots.sort((a, b) => a - b);
  },

  // Pictures older than a day (sent long ago): deleted with the sweep.
  async sweepPictures() {
    const dir = `${home()}/${picksRel()}`;
    let names = [];
    try { names = await fs.readdir(dir); } catch { return; }
    for (const n of stalePicks(names, Date.now())) await fs.unlink(`${dir}/${n}`).catch(() => {});
  },
};
