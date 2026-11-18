/**
 * The home screen — one for the people who work here, one for customers.
 *
 * Which one somebody sees comes from their sign-in, not from a setting: a customer is a customer, and
 * showing them the company's lead pipeline would be both useless and a leak. Each fetches a single endpoint
 * that assembles everything the screen draws, so the screen arrives at once rather than filling in four
 * pieces at four different moments.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { T, TYPE, LIFT } from "../theme";
import { Stat, Section, Bars, Split, Line, TICKET_TONE } from "../components/stats";

/** Only ever a number. The platform sending nothing must read as 0, never as "[object Object]". */
const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** "2h 10m", "35m", "—" — how long something took, in words rather than a decimal of an hour. */
function hours(h?: number | null) {
  if (h === null || h === undefined || !Number.isFinite(Number(h))) return "—";
  const n = Number(h);
  if (n < 1) return `${Math.max(1, Math.round(n * 60))}m`;
  if (n < 24) return `${Math.floor(n)}h ${Math.round((n % 1) * 60)}m`;
  return `${Math.round(n / 24)}d`;
}

export default function Dashboard({ me, navigation }: any) {
  const isCustomer = me?.kind === "customer";
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setD(await api(isCustomer ? "/co/home/customer" : "/co/home/staff"));
    } catch (e: any) {
      setErr(e?.message || "That could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [isCustomer]);

  useEffect(() => {
    load();
  }, [load]);

  if (!d && !err)
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={T.brand} />}>
        {!!err && (
          <Pressable style={s.err} onPress={load}>
            <Text style={s.errText}>{err} — tap to try again</Text>
          </Pressable>
        )}
        {d && (isCustomer ? <CustomerHome d={d} navigation={navigation} /> : <StaffHome d={d} navigation={navigation} />)}
      </ScrollView>

      {/*
        Customers get one action, and it is the only one they need from this screen.
        Staff have the whole app in the menu, so a floating button there would be clutter.
      */}
      {isCustomer && (
        <Pressable style={s.fab} onPress={() => navigation?.navigate?.("Tickets", { raise: true })} accessibilityLabel="Raise a support ticket">
          <Text style={s.fabPlus}>＋</Text>
          <Text style={s.fabText}>Raise a ticket</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ───────────────────────────── For the people who work here ───────────────────────────── */

function StaffHome({ d, navigation }: any) {
  const pipeline = (d?.pipeline?.byStatus || []).slice(0, 6).map((x: any) => ({ label: x.status, n: num(x.n) }));
  const sup = d?.support || {};
  const chat = d?.chat || {};
  const overdue = num(d?.followups?.overdue);

  return (
    <>
      <View style={s.grid}>
        <Stat value={num(d?.leads?.total)} label="New leads" hint={`last ${d?.days ?? 30} days`} />
        <Stat value={num(d?.followups?.dueToday)} label="Follow-ups due" hint="today" tone={num(d?.followups?.dueToday) ? "warn" : "normal"} />
        <Stat value={num(d?.leads?.won)} label="Converted" hint={`last ${d?.days ?? 30} days`} tone="good" />
        <Stat value={num(d?.clients?.total)} label="Clients" hint={`${num(d?.clients?.new)} new`} />
      </View>

      {overdue > 0 && (
        <Pressable style={s.alert}>
          <Text style={s.alertText}>
            {overdue} follow-up{overdue === 1 ? "" : "s"} overdue
          </Text>
        </Pressable>
      )}

      <Section title="Lead status" right={<Text style={s.sectionNote}>{num(d?.pipeline?.open)} open</Text>}>
        <Bars rows={pipeline} empty="No open leads." />
      </Section>

      <Section
        title="Support tickets"
        right={
          <Pressable onPress={() => navigation?.navigate?.("Tickets")} hitSlop={8}>
            <Text style={s.link}>See all</Text>
          </Pressable>
        }
      >
        <Split
          parts={[
            { label: "Open", n: num(sup.open), colour: TICKET_TONE.Open },
            { label: "Resolved", n: num(sup.resolved), colour: TICKET_TONE.Resolved },
          ]}
          empty="No tickets yet."
        />
        <View style={{ marginTop: 6 }}>
          <Line label="Waiting over 48 hours" value={num(sup.stale48h)} tone={num(sup.stale48h) ? "warn" : undefined} />
          <Line label="Grievances" value={num(sup.grievances)} tone={num(sup.grievances) ? "warn" : undefined} />
          <Line label="Average time to resolve" value={hours(sup.avgResolutionHours)} />
        </View>
      </Section>

      <Section title="Response">
        <Line label="Leads not contacted in 24 hours" value={num(d?.speed?.uncontacted24h)} tone={num(d?.speed?.uncontacted24h) ? "warn" : "good"} />
        <Line label="Oldest new lead waiting" value={hours(d?.speed?.oldestNewHours)} />
      </Section>

      <Section
        title="Chats"
        right={
          <Pressable onPress={() => navigation?.navigate?.("Chats")} hitSlop={8}>
            <Text style={s.link}>Open</Text>
          </Pressable>
        }
      >
        <View style={s.grid}>
          <Stat value={num(chat.pending)} label="Unread messages" hint={`${num(chat.waiting)} conversation${num(chat.waiting) === 1 ? "" : "s"}`} tone={num(chat.pending) ? "warn" : "quiet"} />
          <Stat value={num(chat.groups)} label="Groups" hint={`${num(chat.conversations)} in all`} tone="quiet" />
        </View>
      </Section>

      <Text style={s.foot}>Pull down to refresh.</Text>
    </>
  );
}

/* ───────────────────────────── For customers ───────────────────────────── */

function CustomerHome({ d, navigation }: any) {
  const t = d?.tickets || {};
  return (
    <>
      <View style={s.hello}>
        <Text style={s.helloName} numberOfLines={1}>
          {d?.client?.name || "Welcome"}
        </Text>
        {!!d?.client?.code && <Text style={s.helloCode}>{d.client.code}</Text>}
      </View>

      <View style={s.grid}>
        <Stat value={num(t.awaiting)} label="With us now" hint="being looked at" tone={num(t.awaiting) ? "warn" : "good"} />
        <Stat value={num(t.resolved) + num(t.closed)} label="Resolved" hint="all time" tone="good" />
      </View>

      <Section
        title="Your tickets"
        right={
          <Pressable onPress={() => navigation?.navigate?.("Tickets")} hitSlop={8}>
            <Text style={s.link}>See all</Text>
          </Pressable>
        }
      >
        <Split
          parts={[
            { label: "Open", n: num(t.open), colour: TICKET_TONE.Open },
            { label: "In progress", n: num(t.inProgress), colour: TICKET_TONE["In Progress"] },
            { label: "Resolved", n: num(t.resolved), colour: TICKET_TONE.Resolved },
            { label: "Closed", n: num(t.closed), colour: TICKET_TONE.Closed },
          ]}
          empty="You have not raised anything yet."
        />
      </Section>

      <Text style={s.foot}>Pull down to refresh.</Text>
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg },
  page: { padding: T.pad, gap: T.sm, paddingBottom: 110 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: T.sm },

  hello: { paddingBottom: 2 },
  helloName: { ...TYPE.display, fontSize: 20 },
  helloCode: { ...TYPE.meta, marginTop: 1 },

  sectionNote: { ...TYPE.meta, fontWeight: "700" },
  link: { color: T.brand, fontWeight: "800", fontSize: 12 },

  alert: { backgroundColor: "#fdecec", borderRadius: T.radiusSm, paddingHorizontal: T.md, paddingVertical: 9 },
  alertText: { color: "#a11", fontWeight: "700", fontSize: 12.5 },

  err: { backgroundColor: "#fdecec", borderRadius: T.radiusSm, padding: T.md },
  errText: { color: "#a11", fontWeight: "700", fontSize: 12.5 },

  foot: { ...TYPE.meta, textAlign: "center", marginTop: T.xs },

  fab: {
    position: "absolute",
    right: T.pad,
    bottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: T.brand,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 26,
    ...LIFT,
    elevation: 5,
  },
  fabPlus: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: -2 },
  fabText: { color: "#fff", fontWeight: "800", fontSize: 13.5 },
});
