/**
 * Support tickets on the phone.
 *
 * One screen, two sources. A customer reads `/co/my-tickets`, which is scoped to their own client record
 * on the server and can return nobody else's; staff read the company list they already have permission
 * for. The screen never decides what somebody may see — it asks the endpoint that is allowed to.
 *
 * Raising one is a customer action. Staff raise tickets against a named client, which needs the client
 * picker on the web, so the button is not offered here rather than offered and then refused.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { T, TYPE, LIFT } from "../theme";
import { TICKET_TONE } from "../components/stats";

const CATEGORIES = ["Support", "Request", "Grievance"] as const;
const FILTERS = ["All", "Open", "In Progress", "Resolved", "Closed"] as const;

/** "2 Nov, 4:08 pm" — enough to place a ticket in time without a full timestamp. */
const when = (d?: string) =>
  !d
    ? ""
    : new Date(d).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).replace(",", " ·").toLowerCase().replace(/\b(am|pm)\b/, (m) => m);

export default function Tickets({ me, route, navigation }: any) {
  const isCustomer = me?.kind === "customer";
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [open, setOpen] = useState<any>(null); // the ticket being read
  const [raise, setRaise] = useState(false);

  // the dashboard's floating button arrives here asking for the form straight away
  useEffect(() => {
    if (route?.params?.raise && isCustomer) {
      setRaise(true);
      navigation?.setParams?.({ raise: false });
    }
  }, [route?.params?.raise, isCustomer, navigation]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api(isCustomer ? "/co/my-tickets?limit=50" : "/co/clients-tickets?limit=50");
      setItems(r.items || []);
    } catch (e: any) {
      setErr(e?.message || "Those could not be loaded.");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, [isCustomer]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = (items || []).filter((t) => filter === "All" || t.status === filter);

  if (!items)
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} />
      </View>
    );

  return (
    <View style={s.wrap}>
      {!!err && (
        <Pressable style={s.err} onPress={load}>
          <Text style={s.errText}>{err} — tap to try again</Text>
        </Pressable>
      )}

      {/* filters stay on one line; a wrapped row of chips eats a third of a small screen */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters} contentContainerStyle={{ paddingHorizontal: T.pad, gap: 7 }}>
        {FILTERS.map((f) => {
          const n = f === "All" ? (items || []).length : (items || []).filter((t) => t.status === f).length;
          return (
            <Pressable key={f} style={[s.chip, filter === f && s.chipOn]} onPress={() => setFilter(f)}>
              <Text style={[s.chipText, filter === f && s.chipTextOn]}>
                {f}
                {n > 0 ? ` ${n}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={shown}
        keyExtractor={(t) => String(t._id)}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={T.brand} />}
        contentContainerStyle={{ padding: T.pad, paddingTop: T.xs, paddingBottom: 110 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{filter === "All" ? "No tickets yet" : `Nothing ${filter.toLowerCase()}`}</Text>
            <Text style={s.emptyBody}>{isCustomer ? "Anything you raise will appear here, with its progress." : "Tickets raised by clients and staff appear here."}</Text>
          </View>
        }
        renderItem={({ item: t }) => (
          <Pressable style={s.row} onPress={() => setOpen(t)}>
            <View style={s.rowTop}>
              <Text style={s.no}>{t.ticketNo}</Text>
              <View style={[s.pill, { backgroundColor: `${TICKET_TONE[t.status] || T.muted}1A` }]}>
                <Text style={[s.pillText, { color: TICKET_TONE[t.status] || T.muted }]}>{t.status}</Text>
              </View>
            </View>
            <Text style={s.desc} numberOfLines={2}>
              {t.description}
            </Text>
            <Text style={s.meta} numberOfLines={1}>
              {t.category}
              {!isCustomer && t.clientName ? ` · ${t.clientName}` : ""} · {when(t.updatedAt)}
            </Text>
          </Pressable>
        )}
      />

      {isCustomer && (
        <Pressable style={s.fab} onPress={() => setRaise(true)} accessibilityLabel="Raise a support ticket">
          <Text style={s.fabPlus}>＋</Text>
          <Text style={s.fabText}>Raise a ticket</Text>
        </Pressable>
      )}

      <Detail ticket={open} onClose={() => setOpen(null)} isCustomer={isCustomer} />
      <Raise open={raise} onClose={() => setRaise(false)} onDone={() => { setRaise(false); load(); }} />
    </View>
  );
}

/** One ticket, with everything that has happened to it. Read-only on the phone. */
function Detail({ ticket, onClose, isCustomer }: { ticket: any; onClose: () => void; isCustomer: boolean }) {
  if (!ticket) return null;
  const history = [...(ticket.history || [])].reverse();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={s.head}>
          <Text style={s.headTitle}>{ticket.ticketNo}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.headClose}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: T.pad, gap: T.sm }}>
          <View style={s.card}>
            <View style={[s.pill, { alignSelf: "flex-start", backgroundColor: `${TICKET_TONE[ticket.status] || T.muted}1A` }]}>
              <Text style={[s.pillText, { color: TICKET_TONE[ticket.status] || T.muted }]}>{ticket.status}</Text>
            </View>
            <Text style={s.detailDesc}>{ticket.description}</Text>
            <Text style={s.meta}>
              {ticket.category}
              {!isCustomer && ticket.clientName ? ` · ${ticket.clientName}` : ""} · raised {when(ticket.createdAt)}
            </Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Progress</Text>
            {history.length ? (
              history.map((hst: any, i: number) => (
                <View key={i} style={s.event}>
                  <View style={[s.eventDot, { backgroundColor: TICKET_TONE[hst.to] || T.muted }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.eventTitle}>{hst.from ? `${hst.from} → ${hst.to}` : hst.to}</Text>
                    {!!hst.note && <Text style={s.eventNote}>{hst.note}</Text>}
                    <Text style={s.meta}>
                      {when(hst.at)}
                      {hst.by ? ` · ${hst.by}` : ""}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={s.meta}>Nothing recorded yet.</Text>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Raising one. The client is taken from the sign-in on the server — this form never names one. */
function Raise({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Support");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setCategory("Support");
      setDescription("");
      setErr("");
    }
  }, [open]);

  const send = async () => {
    if (description.trim().length < 5) return setErr("Please describe it in a little more detail.");
    setBusy(true);
    setErr("");
    try {
      await api("/co/my-tickets", { body: { category, description: description.trim() } });
      onDone();
    } catch (e: any) {
      setErr(e?.message || "That could not be raised. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.head}>
          <Text style={s.headTitle}>Raise a ticket</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.headClose}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: T.pad, gap: T.md }} keyboardShouldPersistTaps="handled">
          {!!err && <Text style={s.formErr}>{err}</Text>}

          <View>
            <Text style={s.label}>What is it about?</Text>
            <View style={s.catRow}>
              {CATEGORIES.map((c) => (
                <Pressable key={c} style={[s.cat, category === c && s.catOn]} onPress={() => setCategory(c)}>
                  <Text style={[s.catText, category === c && s.catTextOn]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Text style={s.label}>Tell us what happened</Text>
            <TextInput
              style={s.textarea}
              value={description}
              onChangeText={setDescription}
              placeholder="The more detail you give, the faster this can be sorted out."
              placeholderTextColor={T.muted}
              multiline
              maxLength={4000}
              textAlignVertical="top"
            />
            <Text style={s.counter}>{description.length}/4000</Text>
          </View>

          <Pressable style={[s.submit, (busy || description.trim().length < 5) && { opacity: 0.5 }]} onPress={send} disabled={busy || description.trim().length < 5}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.fabText}>Send it</Text>}
          </Pressable>
          <Text style={s.meta}>You will get a WhatsApp message as it moves along.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg },

  err: { backgroundColor: "#fdecec", padding: T.sm, marginHorizontal: T.pad, marginTop: T.sm, borderRadius: T.radiusSm },
  errText: { color: "#a11", fontWeight: "700", fontSize: 12.5 },

  filters: { flexGrow: 0, paddingVertical: T.sm },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 18, backgroundColor: T.card, borderWidth: 1, borderColor: T.line },
  chipOn: { backgroundColor: T.brand, borderColor: T.brand },
  chipText: { fontSize: 12, fontWeight: "800", color: T.muted },
  chipTextOn: { color: "#fff" },

  row: { backgroundColor: T.card, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: T.md, marginBottom: T.xs + 2, ...LIFT },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  no: { fontWeight: "800", fontSize: 13, color: T.text, letterSpacing: 0.3 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9 },
  pillText: { fontSize: 11, fontWeight: "800" },
  desc: { fontSize: 13.5, color: T.text, marginTop: 6, lineHeight: 19 },
  meta: { ...TYPE.meta, marginTop: 5 },

  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 30, gap: 6 },
  emptyTitle: { ...TYPE.title },
  emptyBody: { ...TYPE.meta, textAlign: "center" },

  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: T.brand, paddingHorizontal: 16, paddingVertical: 14, paddingTop: Platform.OS === "ios" ? 52 : 16 },
  headTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  headClose: { color: "#fff", fontWeight: "700" },

  card: { backgroundColor: T.card, borderRadius: T.radius, borderWidth: 1, borderColor: T.line, padding: T.md, gap: 8, ...LIFT },
  cardTitle: { ...TYPE.label, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: T.muted },
  detailDesc: { fontSize: 14.5, lineHeight: 21, color: T.text },

  event: { flexDirection: "row", gap: 10, paddingVertical: 7 },
  eventDot: { height: 9, width: 9, borderRadius: 5, marginTop: 5 },
  eventTitle: { fontWeight: "800", fontSize: 13 },
  eventNote: { fontSize: 13, color: T.text, marginTop: 2, lineHeight: 18 },

  label: { ...TYPE.label, marginBottom: 7 },
  catRow: { flexDirection: "row", gap: 8 },
  cat: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: T.line, backgroundColor: T.card },
  catOn: { backgroundColor: T.brand, borderColor: T.brand },
  catText: { fontWeight: "800", fontSize: 12.5, color: T.muted },
  catTextOn: { color: "#fff" },
  textarea: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: T.radius, padding: T.md, minHeight: 140, fontSize: 14.5, color: T.text, lineHeight: 20 },
  counter: { ...TYPE.meta, textAlign: "right", marginTop: 4 },
  formErr: { backgroundColor: "#fdecec", color: "#a11", fontWeight: "700", fontSize: 12.5, padding: T.sm, borderRadius: T.radiusSm },
  submit: { backgroundColor: T.brand, borderRadius: T.radius, paddingVertical: 14, alignItems: "center", ...LIFT },

  fab: { position: "absolute", right: T.pad, bottom: 20, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: T.brand, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 26, ...LIFT, elevation: 5 },
  fabPlus: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: -2 },
  fabText: { color: "#fff", fontWeight: "800", fontSize: 13.5 },
});
