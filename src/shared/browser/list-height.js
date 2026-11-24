// How tall the browser panel's two scroll lists draw, for the definite height each is given (src/shared/fit-height.js;
// the views are src/mods/dock-browser/pick-view.js and main.js). Pure.
//
// A note of the Notes bar is: the numbered badge and the element's name (19), its selector (17), the note field (26),
// then the intent and priority chips, which wrap onto a second line (18 each, 6 apart) in a narrow panel; 3 between each.
import { fitHeight, flowLines, lineHeight, stackHeight, textHeight, textWidth } from "../fit-height.js";
import { INTENTS, PRIORITIES } from "./feedback.js";

const CHIP_SIZE = 10.5;
const chip = (word) => Math.ceil(textWidth(word, CHIP_SIZE)) + 14; // px(6) each side, and the border
const group = (words) => words.reduce((n, word) => n + chip(word), 0) + 2 * (words.length - 1);

// `width`: the room a note has (the panel's width less the bar's padding); 0 when not laid out yet.
export function noteHeight(width) {
  const chipLines = flowLines([group(INTENTS), group(PRIORITIES)], width, 6);
  return Math.max(18, lineHeight(11.5)) + lineHeight(CHIP_SIZE) + 26 + (chipLines * 18 + (chipLines - 1) * 6) + 3 * 3;
}

// The page's error list under the header: a box with a border (1) and padding (6) all round, each error 11px and
// wrapping (the view cuts them to 400 characters), 2 between them, 140 high at most.
export const ERRORS_MAX_H = 140;

// `texts`: the errors as drawn; `width`: the box's width (the panel's less the header's padding), 0 before it is laid out.
export function errorsHeight(texts, width) {
  const lines = texts.map((text) => textHeight(text, { width: width - 14, size: 11 }));
  return fitHeight({ pad: 14, extra: stackHeight(lines, 2), max: ERRORS_MAX_H });
}
