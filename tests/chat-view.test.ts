/**
 * How a conversation is laid out: date pills, grouping into runs, and ticks.
 *
 * These are the parts that are wrong *silently*. A tick that says "read" when nobody has read it, or a
 * date pill calling last Tuesday "Today", looks perfectly fine on a screenshot and is simply untrue — so
 * they are checked here rather than by looking at the app.
 *
 *   npx tsx tests/chat-view.test.ts
 */
import { toRows, tickFor, dayLabel, listTime, nameColour, clock } from "../mobile/src/lib/chatview";

let fails = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const ok = (name: string, cond: boolean) => check(name, !!cond, true);

const at = (iso: string) => new Date(iso).toISOString();
const msg = (id: string, who: string, when: string, extra: any = {}) => ({
  _id: id,
  byId: who === "me" ? "u1" : who,
  mine: who === "me",
  kind: "text",
  text: id,
  createdAt: at(when),
  reads: 1,
  ...extra,
});

/* ── 1 · runs ─────────────────────────────────────────────────────────────────────────────────── */

const day = "2026-11-17T";
const run = toRows([
  msg("a", "u2", `${day}09:00:00Z`),
  msg("b", "u2", `${day}09:01:00Z`), // same person, a minute later → same run
  msg("c", "u2", `${day}09:30:00Z`), // half an hour later → new run
  msg("d", "me", `${day}09:31:00Z`), // different person → new run
]);
const only = run.filter((r) => r.type === "msg");

check("a date pill is put in front of the first message", run[0].type, "day");
check("…and only one for a single day", run.filter((r) => r.type === "day").length, 1);
check("the first of a run is a head", only[0].head, true);
check("the second is not", only[1].head, false);
check("…and the first is not a tail", only[0].tail, false);
check("the last of a run is a tail", only[1].tail, true);
check("a gap of half an hour starts a new run", only[2].head, true);
check("a different sender starts a new run", only[3].head, true);
check("the last message of all is a tail", only[3].tail, true);

/*
 * A run must not span two days even when the messages are minutes apart.
 *
 * Built from local clock components rather than a UTC string: the separator follows the *reader's* day,
 * so "23:59Z and 00:01Z" is one local day in India and two in London, and hard-coding either would make
 * this test pass or fail depending on where it is run.
 */
const localMidnight = (dayOffset: number, h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const midnight = toRows([msg("a", "u2", localMidnight(-2, 23, 59)), msg("b", "u2", localMidnight(-1, 0, 1))]);
check("two date pills across midnight", midnight.filter((r) => r.type === "day").length, 2);
check("…and the run is broken by the day", midnight.filter((r) => r.type === "msg")[1].head, true);

/* a system line is always on its own */
const sys = toRows([msg("a", "u2", `${day}09:00:00Z`), { _id: "s", kind: "system", text: "x", createdAt: at(`${day}09:00:30Z`) }, msg("b", "u2", `${day}09:01:00Z`)]);
const sysMsgs = sys.filter((r) => r.type === "msg");
check("a system line is its own head and tail", [sysMsgs[1].head, sysMsgs[1].tail], [true, true]);
check("…and it breaks the run around it", sysMsgs[2].head, true);

/* two people sending in the same minute must not be merged */
const two = toRows([msg("a", "u2", `${day}09:00:00Z`), msg("b", "u3", `${day}09:00:10Z`)]);
check("different senders in the same minute are separate runs", two.filter((r) => r.type === "msg")[1].head, true);

/* ── 2 · ticks ────────────────────────────────────────────────────────────────────────────────── */

check("a message still going out shows the clock", tickFor({ pending: true }, 2), "sending");
check("sent, nobody has read it", tickFor({ reads: 1 }, 2), "sent");
check("the other person has read it", tickFor({ reads: 2 }, 2), "read");
check("in a group of five, two readers is not read", tickFor({ reads: 2 }, 5), "sent");
check("…everybody having read it is", tickFor({ reads: 5 }, 5), "read");
// a thread whose member count has not loaded must not claim "read" for everything
check("an unknown member count never claims read", tickFor({ reads: 1 }, 1), "sent");
check("a missing reads count is treated as just sent", tickFor({}, 2), "sent");

/* ── 3 · dates ────────────────────────────────────────────────────────────────────────────────── */

const now = new Date();
const minus = (d: number) => new Date(now.getTime() - d * 86_400_000);
check("today", dayLabel(now), "Today");
check("yesterday", dayLabel(minus(1)), "Yesterday");
ok("three days ago is named as a weekday", /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(dayLabel(minus(3))));
ok("a month ago is a date, not a weekday", /\d/.test(dayLabel(minus(30))));

check("the list shows a time for today", listTime(now), clock(now));
check("…“Yesterday” for yesterday", listTime(minus(1)), "Yesterday");
ok("…and a short date for older", /\d{2}\/\d{2}\/\d{2}/.test(listTime(minus(10))));
check("nothing in, nothing out", listTime(undefined), "");

/* ── 4 · the colour of a name in a group ──────────────────────────────────────────────────────── */

check("the same person is always the same colour", nameColour("abc123"), nameColour("abc123"));
ok("different people usually differ", nameColour("abc123") !== nameColour("zzz999"));
ok("always a real colour", /^#[0-9a-f]{6}$/i.test(nameColour("anything")));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
