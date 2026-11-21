// Runs at most `n` async jobs at once; the rest wait in FIFO order. (No Node built-ins: bundled into Herdr mods.)
export function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < n && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => { active--; next(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
