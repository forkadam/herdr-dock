// What the bar's attention item says (pure): need-you in red, unread dim, each left out at zero.
export function attentionText({ needYou, unread }) {
  const out = [];
  if (needYou > 0) out.push({ text: `⚠ ${needYou} need you`, tone: "bad" });
  if (unread > 0) out.push({ text: `${unread} unread`, tone: "dim" });
  return out.length ? out : [{ text: "No notifications", tone: "dim" }];
}
