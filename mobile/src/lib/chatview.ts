/**
 * How a conversation is laid out: times, date pills, grouping and ticks.
 *
 * Kept away from the screen that draws it so the rules can be checked on their own — these are the parts
 * that are wrong silently. A tick that says "read" when nobody has read it, or a date pill that calls last
 * Tuesday "Today", looks perfectly fine on screen and is simply untrue.
 *
 * No React and nothing from React Native here, on purpose.
 */

/* ───────────────────────── Time and dates ───────────────────────── */

/** "4:08 pm" — what sits in the corner of a bubble. */
export const clock = (d?: string | Date) =>
  !d ? "" : new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Today", "Yesterday", "Monday", "12 November 2026" — the pill between two days of messages. */
export function dayLabel(d: string | Date) {
  const t = new Date(d);
  const now = new Date();
  if (sameDay(t, now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(t, y)) return "Yesterday";
  // inside the last week, the weekday is more use than the date
  if (now.getTime() - t.getTime() < 6 * 86_400_000) return t.toLocaleDateString([], { weekday: "long" });
  return t.toLocaleDateString([], { day: "numeric", month: "long", year: t.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** What a conversation list shows beside a thread: a time today, "Yesterday", else a short date. */
export function listTime(d?: string | Date) {
  if (!d) return "";
  const t = new Date(d);
  const now = new Date();
  if (sameDay(t, now)) return clock(t);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(t, y)) return "Yesterday";
  return t.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/* ───────────────────────── Ticks ───────────────────────── */

/**
 * How far one of my own messages has got.
 *
 * The server sends `reads` — how many people have opened the conversation since it arrived, counting me.
 * So one is "nobody yet", and everybody having read it means `reads` has reached the number of members.
 * There is no separate "delivered" signal on this platform, so the middle state is honest about being
 * "sent, not yet read" rather than claiming a delivery it cannot know about.
 */
export type TickState = "sending" | "sent" | "read";
export function tickFor(msg: any, memberCount: number): TickState {
  if (msg.pending) return "sending";
  const reads = Number(msg.reads || 1);
  return memberCount > 1 && reads >= memberCount ? "read" : "sent";
}

/* ───────────────────────── Grouping ───────────────────────── */

export interface Row {
  type: "day" | "msg";
  key: string;
  date?: string;
  msg?: any;
  /** The last of a run from one person: the one that gets the tail and the time. */
  tail?: boolean;
  /** The first of a run: the one that gets the sender's name, in a group. */
  head?: boolean;
}

/**
 * Turns a flat list of messages into what is actually drawn: date pills, and runs of messages grouped
 * by sender.
 *
 * A run breaks on a different sender, a different day, or a gap of more than five minutes — so "yes" sent
 * three times in a row is one block with one timestamp, while "yes" and a reply an hour later are not.
 */
export function toRows(messages: any[]): Row[] {
  const out: Row[] = [];
  let lastDay = "";
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const day = new Date(m.createdAt || Date.now()).toDateString();
    if (day !== lastDay) {
      out.push({ type: "day", key: `d-${day}-${i}`, date: m.createdAt });
      lastDay = day;
    }
    if (m.kind === "system") {
      out.push({ type: "msg", key: String(m._id), msg: m, head: true, tail: true });
      continue;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const runs = (a: any, b: any) =>
      !!a &&
      !!b &&
      a.kind !== "system" &&
      b.kind !== "system" &&
      String(a.byId || (a.mine ? "me" : "")) === String(b.byId || (b.mine ? "me" : "")) &&
      !!a.mine === !!b.mine &&
      new Date(b.createdAt).toDateString() === new Date(a.createdAt).toDateString() &&
      Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < 5 * 60_000;

    out.push({ type: "msg", key: String(m._id), msg: m, head: !runs(prev, m), tail: !runs(m, next) });
  }
  return out;
}

/* ───────────────────────── Who said it ───────────────────────── */

/**
 * A stable colour per person, for their name above a message in a group.
 *
 * The same person is always the same colour in every conversation, because it comes from their id rather
 * than their position in the list — which is the whole point of colouring them at all.
 */
const NAME_COLOURS = ["#1f6f8b", "#9a4f1b", "#6b3fa0", "#0f7b5f", "#a3366a", "#2a5fa8", "#7a6a12"];
export const nameColour = (id: string) => {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLOURS[h % NAME_COLOURS.length];
};
