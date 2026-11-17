/**
 * The pieces that make a conversation read like a phone messenger rather than a web page in a frame.
 *
 * These are the conventions every messaging app has settled on — bubbles with a tail, the time tucked into
 * the bottom corner, ticks for sent and read, a date pill between days, consecutive messages from one person
 * grouped together. They are drawn here in **the company's own brand colours**, taken from the build: this
 * app is white-label, so a borrowed palette would be wrong for every company that is not that brand, and
 * nobody else's logo or artwork is used.
 */
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { T } from "../theme";

export * from "../lib/chatview";
import { dayLabel, type TickState } from "../lib/chatview";

/** ✓ or ✓✓, the second pair coloured once everyone has read it. A clock face while it is still going out. */
export const Ticks = memo(function Ticks({ state, onBrand }: { state: TickState; onBrand?: boolean }) {
  if (state === "sending") return <Text style={[k.tick, onBrand && k.tickOnBrand]}>🕓</Text>;
  const read = state === "read";
  return <Text style={[k.tick, onBrand && k.tickOnBrand, read && k.tickRead]}>{read ? "✓✓" : "✓"}</Text>;
});


/* ───────────────────────── Bits of furniture ───────────────────────── */

export const DayPill = memo(function DayPill({ date }: { date: string }) {
  return (
    <View style={k.dayWrap}>
      <Text style={k.day}>{dayLabel(date)}</Text>
    </View>
  );
});

export const SystemLine = memo(function SystemLine({ text }: { text: string }) {
  return (
    <View style={k.dayWrap}>
      <Text style={k.system}>{text}</Text>
    </View>
  );
});

/**
 * The little tail on the last bubble of a run.
 *
 * Drawn as a triangle from borders rather than an image, so it takes the bubble's own colour and stays
 * sharp at any screen density.
 */
export function Tail({ mine, colour }: { mine: boolean; colour: string }) {
  return <View style={[k.tail, mine ? k.tailMine : k.tailTheirs, mine ? { borderLeftColor: colour } : { borderRightColor: colour }]} />;
}

/** "Rituparna is typing…" — three dots that do not animate, because an animation here costs more than it gives. */
export const Typing = memo(function Typing({ who }: { who: string }) {
  return (
    <View style={k.typingWrap}>
      <View style={k.typingBubble}>
        <Text style={k.typingText}>{who} is typing…</Text>
      </View>
    </View>
  );
});

const k = StyleSheet.create({
  tick: { fontSize: 10.5, color: T.muted, marginLeft: 3, fontWeight: "700" },
  tickOnBrand: { color: "rgba(255,255,255,0.72)" },
  tickRead: { color: "#4fc3f7" },

  dayWrap: { alignItems: "center", marginVertical: 10 },
  day: {
    fontSize: 11,
    fontWeight: "800",
    color: T.muted,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
  system: {
    fontSize: 11.5,
    color: T.muted,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: "hidden",
    textAlign: "center",
  },

  tail: { position: "absolute", bottom: 0, width: 0, height: 0, borderTopWidth: 0, borderBottomWidth: 10, borderBottomColor: "transparent" },
  tailMine: { right: -6, borderLeftWidth: 9 },
  tailTheirs: { left: -6, borderRightWidth: 9 },

  typingWrap: { paddingHorizontal: 12, paddingBottom: 6 },
  typingBubble: { alignSelf: "flex-start", backgroundColor: "#fff", borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 7 },
  typingText: { fontSize: 12, color: T.muted, fontStyle: "italic" },
});
