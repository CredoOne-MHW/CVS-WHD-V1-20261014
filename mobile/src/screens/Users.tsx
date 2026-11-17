/**
 * Users on the phone — staff and customers.
 *
 * The same thing the web does under Settings › Role Management › Users, in the shape a phone can hold: a
 * list, and one sheet to add or change somebody. Two things matter here beyond the obvious.
 *
 * A role is not optional. Every user gets one, because a sign-in with no role is a sign-in that can see
 * nothing, and that looks like a broken account rather than a deliberate one.
 *
 * A customer may be tied to the client or lead they already exist as elsewhere, through a dropdown that
 * searches as it is typed. That mapping is what puts a conversation beside somebody's history instead of
 * next to it. It stays optional: a customer who is not on the books yet still gets to talk.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { T, TYPE, LIFT } from "../theme";

type Person = { id: string; label: string; sub?: string; kind?: string };

export default function Users({ me }: { me: any }) {
  const [list, setList] = useState<any[] | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>(null);
  const perm = me?.perms?.["roles:users"] || {};

  const load = useCallback(async () => {
    setErr("");
    try {
      const [users, roleData] = await Promise.all([api("/co/users"), api("/co/assignable-roles").catch(() => ({ roles: [] }))]);
      setList(Array.isArray(users) ? users : []);
      setRoles(roleData?.roles || []);
    } catch (e: any) {
      setErr(e?.message || "That list could not be loaded.");
      setList([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const roleName = (id: string) => roles.find((r) => String(r._id) === String(id))?.name || "—";

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const picked: Person | null = form.kind === "customer" ? form.mapped : null;
      const map = { kind: form.kind || "staff", clientId: picked?.kind === "client" ? picked.id : "", leadId: picked?.kind === "lead" ? picked.id : "" };
      if (form._id) {
        await api(`/co/users/${form._id}`, {
          method: "PUT",
          body: { name: form.name, phone: form.phone || undefined, roleId: form.isOwner ? undefined : form.roleId, active: form.isOwner ? undefined : form.active, ...(form.password ? { password: form.password } : {}), ...(form.isOwner ? {} : map) },
        });
      } else {
        await api("/co/users", { body: { name: form.name, email: form.email, phone: form.phone || undefined, password: form.password, roleId: form.roleId, ...map } });
      }
      setForm(null);
      load();
    } catch (e: any) {
      setErr(e?.message || "That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (!list)
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} />
      </View>
    );

  return (
    <View style={s.wrap}>
      {!!err && !form && (
        <Pressable style={s.note} onPress={() => setErr("")}>
          <Text style={s.noteText}>{err}</Text>
        </Pressable>
      )}
      <FlatList
        data={list}
        keyExtractor={(u) => String(u._id)}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={T.brand} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
        ListEmptyComponent={<Text style={s.empty}>Nobody here yet.</Text>}
        renderItem={({ item: u }) => (
          <Pressable style={s.row} onPress={() => perm.update && setForm({ ...u, password: "", kind: u.kind || "staff", mapped: u.clientId || u.leadId ? { id: String(u.clientId || u.leadId), label: u.mappedTo || "Linked record", kind: u.clientId ? "client" : "lead" } : null })}>
            <View style={s.badgeWrap}>
              <Text style={s.badgeText}>{String(u.name || "?").split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join("")}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>
                {u.name}
              </Text>
              <Text style={s.sub} numberOfLines={1}>
                {u.email}
              </Text>
              <View style={s.tags}>
                <Text style={[s.tag, u.kind === "customer" ? s.tagCustomer : s.tagStaff]}>{u.kind === "customer" ? "Customer" : "Staff"}</Text>
                <Text style={[s.tag, s.tagRole]}>{u.isOwner ? "Owner" : roleName(u.roleId)}</Text>
                {u.active === false && <Text style={[s.tag, s.tagOff]}>Disabled</Text>}
              </View>
              {u.kind === "customer" && !!u.mappedTo && <Text style={s.mapped}>Linked to {u.mappedTo}</Text>}
            </View>
          </Pressable>
        )}
      />

      {perm.create && (
        <Pressable style={s.fab} onPress={() => setForm({ name: "", email: "", phone: "", password: "", roleId: roles[0]?._id || "", kind: "staff", mapped: null, active: true })}>
          <Text style={s.fabText}>Add user</Text>
        </Pressable>
      )}

      <Modal visible={!!form} animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{form?._id ? "Edit user" : "Add user"}</Text>
            <Pressable onPress={() => setForm(null)}>
              <Text style={s.sheetClose}>Close</Text>
            </Pressable>
          </View>
          {form && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {!!err && <Text style={s.formErr}>{err}</Text>}

              <Labeled label="Name">
                <TextInput style={s.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Full name" placeholderTextColor={T.muted} />
              </Labeled>

              <Labeled label="Email" hint={form._id ? "Cannot change once created" : "This is what they sign in with"}>
                <TextInput style={[s.input, !!form._id && s.inputOff]} editable={!form._id} autoCapitalize="none" keyboardType="email-address" value={form.email} onChangeText={(v) => setForm({ ...form, email: v.trim() })} placeholder="name@company.com" placeholderTextColor={T.muted} />
              </Labeled>

              <Labeled label="WhatsApp" hint="10 digits — receives the welcome message">
                <TextInput style={s.input} keyboardType="number-pad" maxLength={10} value={form.phone || ""} onChangeText={(v) => setForm({ ...form, phone: v.replace(/\D/g, "") })} placeholder="9876543210" placeholderTextColor={T.muted} />
              </Labeled>

              <Labeled label="Password" hint={form._id ? "Leave blank to keep the current one" : "At least 8 characters"}>
                <TextInput style={s.input} secureTextEntry value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} placeholder="••••••••" placeholderTextColor={T.muted} />
              </Labeled>

              {!form.isOwner && (
                <Labeled label="Role" hint="What this person may open and change">
                  <Choice options={roles.map((r) => ({ value: String(r._id), label: r.name }))} value={String(form.roleId || "")} onChange={(v) => setForm({ ...form, roleId: v })} empty="No roles yet — create one on the web first" />
                </Labeled>
              )}

              {/*
                Compact on purpose: a label and a two-way switch on one line rather than a stacked field.
                It is a yes/no about one person, not a section, and giving it a section's worth of height
                pushed Save off the bottom of a small screen.
              */}
              {!form.isOwner && (
                <View style={s.inlineRow}>
                  <Text style={s.label}>User type</Text>
                  <View style={s.segment}>
                    {[
                      { value: "staff", label: "Staff" },
                      { value: "customer", label: "Customer" },
                    ].map((o) => {
                      const on = (form.kind || "staff") === o.value;
                      return (
                        <Pressable
                          key={o.value}
                          style={[s.segBtn, on && s.segBtnOn]}
                          onPress={() => setForm({ ...form, kind: o.value, mapped: o.value === "customer" ? form.mapped : null })}
                        >
                          <Text style={[s.segText, on && s.segTextOn]}>{o.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {form.kind === "customer" && !form.isOwner && (
                <Labeled label="Client / Lead" hint="Optional — ties this sign-in to a record you already have">
                  <PersonLookup value={form.mapped} onPick={(p) => setForm({ ...form, mapped: p })} />
                </Labeled>
              )}

              {!!form._id && !form.isOwner && (
                <Labeled label="Status">
                  <Choice
                    options={[
                      { value: "1", label: "Active" },
                      { value: "0", label: "Disabled" },
                    ]}
                    value={form.active === false ? "0" : "1"}
                    onChange={(v) => setForm({ ...form, active: v === "1" })}
                  />
                </Labeled>
              )}

              <Pressable style={[s.save, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save</Text>}
              </Pressable>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const Labeled = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ gap: 6 }}>
    <Text style={s.label}>{label}</Text>
    {children}
    {!!hint && <Text style={s.hint}>{hint}</Text>}
  </View>
);

/** A row of taps instead of a dropdown — a native picker on a phone is more trouble than it is worth here. */
function Choice({ options, value, onChange, empty }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; empty?: string }) {
  if (!options.length) return <Text style={s.hint}>{empty || "Nothing to choose"}</Text>;
  return (
    <View style={s.choiceRow}>
      {options.map((o) => (
        <Pressable key={o.value} style={[s.choice, value === o.value && s.choiceOn]} onPress={() => onChange(o.value)}>
          <Text style={[s.choiceText, value === o.value && s.choiceTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The searchable dropdown.
 *
 * Typing waits 200 ms before asking the platform, every answer is kept for the session, and an answer that
 * arrives after a newer one has been typed is thrown away rather than painted — which is what otherwise
 * makes a box like this flicker on a slow connection.
 */
function PersonLookup({ value, onPick }: { value?: Person | null; onPick: (p: Person | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const cache = useRef(new Map<string, Person[]>());
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const key = q.trim().toLowerCase();
    const hit = cache.current.get(key);
    if (hit) {
      setRows(hit);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      api(`/co/people-lookup${key ? `?q=${encodeURIComponent(key)}` : ""}`)
        .then((r: any) => {
          cache.current.set(key, r.results || []);
          if (mine === seq.current) setRows(r.results || []);
        })
        .catch(() => {
          if (mine === seq.current) setRows([]);
        })
        .finally(() => {
          if (mine === seq.current) setBusy(false);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  if (value && !open)
    return (
      <View style={s.pickedRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.pickedName} numberOfLines={1}>
            {value.label}
          </Text>
          {!!value.sub && (
            <Text style={s.hint} numberOfLines={1}>
              {value.sub}
            </Text>
          )}
        </View>
        <Pressable onPress={() => onPick(null)}>
          <Text style={s.clear}>Clear</Text>
        </Pressable>
      </View>
    );

  return (
    <View>
      <TextInput
        style={s.input}
        value={q}
        onChangeText={(v) => {
          setQ(v);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search name, phone, email or client code…"
        placeholderTextColor={T.muted}
        autoCapitalize="none"
      />
      {open && (
        <View style={s.results}>
          {busy && !rows ? (
            <Text style={s.hint}>Searching…</Text>
          ) : !rows?.length ? (
            <Text style={s.hint}>No client or lead matches</Text>
          ) : (
            rows.map((r) => (
              <Pressable
                key={r.id}
                style={s.result}
                onPress={() => {
                  onPick(r);
                  setOpen(false);
                  setQ("");
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.resultName} numberOfLines={1}>
                    {r.label}
                  </Text>
                  {!!r.sub && (
                    <Text style={s.hint} numberOfLines={1}>
                      {r.sub}
                    </Text>
                  )}
                </View>
                <Text style={[s.tag, r.kind === "client" ? s.tagCustomer : s.tagRole]}>{r.kind}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg },
  empty: { textAlign: "center", color: T.muted, marginTop: 40 },
  note: { backgroundColor: "#fdecec", paddingHorizontal: 14, paddingVertical: 10 },
  noteText: { color: "#a11", fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", gap: T.sm, backgroundColor: T.card, borderRadius: T.radius, padding: T.sm + 2, marginBottom: T.xs + 2, borderWidth: 1, borderColor: T.line, ...LIFT },
  badgeWrap: { height: 38, width: 38, borderRadius: 19, backgroundColor: T.tint, alignItems: "center", justifyContent: "center" },
  badgeText: { color: T.brand, fontWeight: "800" },
  name: { ...TYPE.title, fontSize: 14.5 },
  sub: { ...TYPE.meta, marginTop: 1 },
  tags: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  tag: { fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: "hidden" },
  tagStaff: { backgroundColor: "rgba(0,0,0,0.06)", color: T.muted },
  tagCustomer: { backgroundColor: "rgba(47,92,36,0.14)", color: T.brand },
  tagRole: { backgroundColor: "rgba(217,181,42,0.2)", color: "#7a5c00" },
  tagOff: { backgroundColor: "#fdecec", color: "#a11" },
  mapped: { color: T.muted, fontSize: 11, marginTop: 4 },
  fab: { position: "absolute", bottom: 20, alignSelf: "center", backgroundColor: T.brand, paddingHorizontal: 26, paddingVertical: 13, borderRadius: 24 },
  fabText: { color: "#fff", fontWeight: "800" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: T.brand, paddingHorizontal: 16, paddingVertical: 14, paddingTop: Platform.OS === "ios" ? 52 : 16 },
  sheetTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  sheetClose: { color: "#fff", fontWeight: "700" },
  label: { fontWeight: "800", color: T.text, fontSize: 13 },
  hint: { color: T.muted, fontSize: 11 },
  formErr: { backgroundColor: "#fdecec", color: "#a11", fontWeight: "600", fontSize: 12, padding: 10, borderRadius: 10 },
  input: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: T.text },
  inputOff: { backgroundColor: "rgba(0,0,0,0.04)", color: T.muted },
  choiceRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  choice: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: T.line, backgroundColor: T.card },
  choiceOn: { backgroundColor: T.brand, borderColor: T.brand },
  choiceText: { fontWeight: "700", color: T.text, fontSize: 13 },
  choiceTextOn: { color: "#fff" },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  pickedName: { fontWeight: "800", color: T.text },
  clear: { color: "#a11", fontWeight: "700", fontSize: 12 },
  results: { marginTop: 6, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, padding: 8, gap: 2 },
  result: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, paddingVertical: 9 },
  resultName: { fontWeight: "700", color: T.text },
  save: { backgroundColor: T.brand, borderRadius: T.radius, paddingVertical: 14, alignItems: "center", marginTop: T.xs, ...LIFT },
  inlineRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: T.sm },
  segment: { flexDirection: "row", backgroundColor: T.tint, borderRadius: T.radiusPill, padding: 3 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: T.radiusPill },
  segBtnOn: { backgroundColor: T.brand },
  segText: { fontWeight: "800", fontSize: 12, color: T.muted },
  segTextOn: { color: "#fff" },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
