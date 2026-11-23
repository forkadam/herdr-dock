// A minimal ustar reader (pure): finds one member's bytes in an uncompressed tar.

const dec = new TextDecoder();
const field = (b, from, to) => { const s = b.subarray(from, to); const z = s.indexOf(0); return dec.decode(z < 0 ? s : s.subarray(0, z)); };

// tarFile(tarBytes, "package/bin/agent-browser") -> Uint8Array | null. Names are prefix (345..500) + "/" + name (0..100).
export function tarFile(tar, member) {
  for (let at = 0; at + 512 <= tar.length;) {
    const head = tar.subarray(at, at + 512);
    if (head.every((x) => x === 0)) return null; // end of archive
    const name = field(head, 0, 100);
    const prefix = field(head, 345, 500);
    const size = parseInt(field(head, 124, 136).trim() || "0", 8);
    if (!Number.isFinite(size)) return null;
    const start = at + 512;
    if ((prefix ? `${prefix}/${name}` : name) === member) return start + size <= tar.length ? tar.subarray(start, start + size) : null;
    at = start + Math.ceil(size / 512) * 512;
  }
  return null;
}
