/**
 * The small pieces the home screens are built from.
 *
 * Charts drawn with plain views rather than a charting library: a phone dashboard needs a handful of bars
 * and rings, and a library for that is a megabyte of bundle and a native dependency for something that is
 * a few rectangles. Everything here takes its colour from the company's own brand.
 */
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { T, TYPE, LIFT } from "../theme";

/** A number and what it is. `tone` tints the figure when it is something to act on. */
export const Stat = memo(function Stat({
  value,
  label,
  hint,
  tone = "normal",
  wide,
}: {
  value: number | string;
  label: string;
  hint?: string;
  tone?: "normal" | "warn" | "good" | "quiet";
  wide?: boolean;
}) {
  const colour = tone === "warn" ? T.danger : tone === "good" ? "#1b7a4b" : tone === "quiet" ? T.muted : T.brand;
  return (
    <View style={[s.tile, wide && { flexBasis: "100%" }]}>
      <Text style={[s.value, { color: colour }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.label} numberOfLines={1}>
        {label}
      </Text>
      {!!hint && (
        <Text style={s.hint} numberOfLines={1}>
          {hint}
        </Text>
      )}
    </View>
  );
});

/** A titled block. Sections are what stop a dashboard reading as one long list of numbers. */
export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/**
 * A row of labelled bars — how open leads are spread across their statuses, say.
 *
 * Each bar is drawn against the largest value rather than the total, so a small category is still visible
 * instead of being a one-pixel sliver next to a big one.
 */
export const Bars = memo(function Bars({ rows, empty = "Nothing yet" }: { rows: { label: string; n: number; tone?: string }[]; empty?: string }) {
  const top = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <Text style={s.empty}>{empty}</Text>;
  return (
    <View style={{ gap: 9 }}>
      {rows.map((r) => (
        <View key={r.label}>
          <View style={s.barTop}>
            <Text style={s.barLabel} numberOfLines={1}>
              {r.label}
            </Text>
            <Text style={s.barN}>{r.n}</Text>
          </View>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${Math.max(3, Math.round((r.n / top) * 100))}%`, backgroundColor: r.tone || T.brand }]} />
          </View>
        </View>
      ))}
    </View>
  );
});

/**
 * One bar split into coloured parts — a ticket's life, say, across Open / In progress / Resolved.
 *
 * Better than four separate bars when the parts add up to a whole: the eye reads the proportion directly
 * instead of comparing four lengths.
 */
export const Split = memo(function Split({ parts, empty = "Nothing yet" }: { parts: { label: string; n: number; colour: string }[]; empty?: string }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return <Text style={s.empty}>{empty}</Text>;
  return (
    <View>
      <View style={s.splitTrack}>
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <View key={p.label} style={{ flex: p.n, backgroundColor: p.colour }} />
          ))}
      </View>
      <View style={s.keyRow}>
        {parts.map((p) => (
          <View key={p.label} style={s.key}>
            <View style={[s.dot, { backgroundColor: p.colour }]} />
            <Text style={s.keyText}>
              {p.label} <Text style={s.keyN}>{p.n}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});

/** A line of the form "label … value", for figures that do not deserve a tile of their own. */
export const Line = memo(function Line({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "good" }) {
  return (
    <View style={s.line}>
      <Text style={s.lineLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[s.lineValue, tone === "warn" && { color: T.danger }, tone === "good" && { color: "#1b7a4b" }]}>{value}</Text>
    </View>
  );
});

/** The colours a ticket status is drawn in, shared by the home screens and the ticket list. */
export const TICKET_TONE: Record<string, string> = {
  Open: "#c2410c",
  "In Progress": "#b58100",
  Resolved: "#1b7a4b",
  Closed: "#6b7a70",
};

const s = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: "47%", backgroundColor: T.card, borderRadius: T.radius, paddingHorizontal: T.md, paddingVertical: 12, borderWidth: 1, borderColor: T.line, ...LIFT },
  value: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  label: { ...TYPE.label, marginTop: 2 },
  hint: { ...TYPE.meta, marginTop: 1 },

  section: { backgroundColor: T.card, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: T.md, ...LIFT },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: T.sm },
  sectionTitle: { ...TYPE.label, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: T.muted },

  empty: { ...TYPE.meta, paddingVertical: 4 },
  barTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 },
  barLabel: { fontSize: 12.5, fontWeight: "700", color: T.text, flex: 1 },
  barN: { fontSize: 12.5, fontWeight: "800", color: T.muted, marginLeft: 8 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: T.tint, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },

  splitTrack: { height: 9, borderRadius: 5, overflow: "hidden", flexDirection: "row", backgroundColor: T.tint },
  keyRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 9 },
  key: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { height: 8, width: 8, borderRadius: 4 },
  keyText: { fontSize: 11.5, color: T.muted, fontWeight: "600" },
  keyN: { color: T.text, fontWeight: "800" },

  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 6 },
  lineLabel: { fontSize: 13, color: T.muted, flex: 1, fontWeight: "600" },
  lineValue: { fontSize: 13.5, fontWeight: "800", color: T.text },
});
