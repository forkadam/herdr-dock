// Writing one of the hint hook's run records (render-hint.js): the folder made, the text written to a temp file and
// renamed into place, so a reader never sees half a record. The Render helper's tidy-up may remove an empty session
// folder between the mkdir and the write; then it's made again and the write tried once more. `fsx` is for tests.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FS = { mkdirSync, renameSync, writeFileSync };

export function writeRecord(dir, name, text, fsx = FS) {
  const file = join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  const attempt = () => {
    fsx.mkdirSync(dir, { recursive: true });
    fsx.writeFileSync(tmp, text);
    fsx.renameSync(tmp, file);
  };
  try { attempt(); } catch (e) { if (e?.code !== "ENOENT") throw e; attempt(); }
}
