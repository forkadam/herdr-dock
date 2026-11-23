// How large the Render panel shows a picture (pure; no host imports). A picture is shown at its natural size when it
// fits; a wider one shrinks to the room, but never below 70% of its size: past that it scrolls sideways, since text
// drawn smaller can't be read.
export const MIN_SCALE = 0.7;
const MIN_WIDTH = 40;

// size: the picture's own { w, h } (either may be missing); room: the width the panel has for it.
export function shownSize(size, room) {
  const n = Number(size?.w), nh = Number(size?.h);
  if (!(n > 0 && nh > 0)) return { w: room, h: Math.round(room * 0.6), scroll: false };
  const w = Math.max(MIN_WIDTH, Math.round(n <= room ? n : Math.max(room, MIN_SCALE * n)));
  return { w, h: Math.round((w * nh) / n), scroll: w > room };
}
