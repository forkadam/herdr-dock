// What the bar's attention item says (pure): need-you in red, unread dim, each left out at zero.
export function attentionText({ needYou, unread }) {
  const out = [];
  if (needYou > 0) out.push({ text: `⚠ ${needYou} need you`, tone: "bad" });
  if (unread > 0) out.push({ text: `${unread} unread`, tone: "dim" });
  return out.length ? out : [{ text: "No notifications", tone: "dim" }];
}

// The bar's bell (pure): its colour (red when something needs you, accent for unread only, dim when
// nothing), whether it carries a dot (whenever there's something to see), and its tooltip, the same words
// attentionText would have shown.
export function attentionBell(c) {
  const tone = c.needYou > 0 ? "bad" : c.unread > 0 ? "unread" : "none";
  return { tone, dot: tone !== "none", tip: attentionText(c).map((p) => p.text).join(" · ") };
}
