// Loads the focusable left features' real classes against stubbed host modules: while one is focused (it fills the
// panel, the others are title rows), clicking its own title ends the focus, so the panel goes back to normal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetHost, handlers } from "./fixtures/host-stubs.mjs";

const herdr = await import("herdr");
const cx = { spawn() {}, notify() {}, stop_propagation() {}, timer: { every() {} } };
const MODS = [
  { mod: "dock-spaces", title: "dock-spaces-title" },
  { mod: "dock-agents", title: "dock-agents-title" },
  { mod: "dock-git", title: "dock-git-title" },
  { mod: "dock-quotas", title: "dock-quotas-title" },
];

function render(Cls, myId, focus) {
  resetHost();
  herdr.data.props = { dockRegion: "left", dockFeature: myId };
  herdr.data.layout = { id: "root", children: [{ id: "dock-left", size: { px: 300 } }] };
  herdr.data.shared.set("dock.left.mode", "expanded");
  herdr.data.shared.set("dock.left.focus", focus);
  const v = new Cls();
  v.init({}, cx);
  v.render(cx);
}

for (const { mod, title } of MODS) {
  const { default: Cls } = await import(`../src/mods/${mod}/main.js`);
  const myId = `dock-left-3-${mod}`;

  test(`${mod}: focused, its title click ends the focus`, () => {
    render(Cls, myId, myId);
    const click = handlers()[`${title}:on_click`];
    assert.equal(typeof click, "function", "the focused title is clickable");
    click({}, cx);
    assert.equal(herdr.data.shared.get("dock.left.focus"), null);
    assert.equal(herdr.data.shared.get("dock.left.mode"), "expanded");
  });

  test(`${mod}: with nothing focused its title isn't a button`, () => {
    render(Cls, myId, null);
    assert.equal(handlers()[`${title}:on_click`], undefined);
  });
}

test("dock-pages: its title row, clicked while another feature is focused, ends the focus (Pages has no tall face)", async () => {
  const { default: Pages } = await import("../src/mods/dock-pages/main.js");
  render(Pages, "dock-left-1-dock-pages", "dock-left-2-dock-spaces");
  handlers()["dock-pages-title:on_click"]({}, cx);
  assert.equal(herdr.data.shared.get("dock.left.focus"), null);
  assert.equal(herdr.data.shared.get("dock.left.mode"), "expanded");
});
