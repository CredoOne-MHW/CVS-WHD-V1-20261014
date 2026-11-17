import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { T, TYPE, LIFT } from "../theme";

/** Today at a glance — the same figures the web dashboard shows, read from the same endpoint. */
export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await api("/co/dashboard/overview?days=30"));
      setErr("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!d && busy)
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} />
      </View>
    );

  /**
   * Read straight from what /co/dashboard/overview actually returns.
   *
   * These four used to read `totals.newLeads`, `dueToday`, `won` and `clients` — a shape the endpoint has
   * never had. Three of them silently fell back to 0, which looked like a quiet day rather than a bug, and
   * the fourth found `clients`, which is an object, and rendered it as "[object Object]". That mismatch is
   * what gave it away; the three zeros would have gone on lying indefinitely.
   */
  const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const cards = [
    { label: "New leads", value: num(d?.leads?.total), hint: `last ${d?.days ?? 30} days` },
    { label: "Follow-ups due", value: num(d?.followups?.dueToday), hint: "today" },
    { label: "Converted", value: num(d?.leads?.won), hint: `last ${d?.days ?? 30} days` },
    { label: "Clients", value: num(d?.clients?.total), hint: "in all" },
  ];

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: T.pad }} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={T.brand} />}>
      {!!err && <Text style={s.err}>{err}</Text>}
      <View style={s.grid}>
        {cards.map((c) => (
          <View key={c.label} style={s.card}>
            <Text style={s.cardValue}>{String(c.value)}</Text>
            <Text style={s.cardLabel}>{c.label}</Text>
            <Text style={s.cardHint}>{c.hint}</Text>
          </View>
        ))}
      </View>
      <Text style={s.note}>Pull down to refresh.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: T.sm },
  /**
   * The number first and large, the label under it.
   *
   * The label used to be a small upper-case line above the figure, which made four tiles read as four
   * headings with numbers attached. A dashboard is read by its numbers; everything else is a caption.
   */
  card: { flexGrow: 1, flexBasis: "47%", backgroundColor: T.card, borderRadius: T.radius, paddingHorizontal: T.md, paddingVertical: T.md, borderWidth: 1, borderColor: T.line, ...LIFT },
  cardValue: { ...TYPE.display, color: T.brand },
  cardLabel: { ...TYPE.label, marginTop: 2 },
  cardHint: { ...TYPE.meta, marginTop: 1 },
  note: { ...TYPE.meta, marginTop: T.lg, textAlign: "center" },
  err: { color: T.danger, fontWeight: "700", fontSize: 12, marginBottom: T.sm },
});
