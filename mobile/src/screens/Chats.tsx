/**
 * Chats on the phone — the list of conversations, one conversation, and starting a new one.
 *
 * Members are shown by name and role only; a phone number or e-mail address is never part of what the
 * platform sends here. A message is kept the moment it is sent, so a tap that happens while the signal is
 * poor comes back with the text still in the box instead of losing it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { api } from "../lib/api";
import { subscribe, poller, setLiveConfig, isLive } from "../lib/live";
import { T } from "../theme";

const LIMIT_MESSAGE = 4000;
const Stack = createNativeStackNavigator();

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const shortTime = (d?: string) => {
  if (!d) return "";
  const t = new Date(d);
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins} min`;
  if (new Date().toDateString() === t.toDateString()) return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return t.toLocaleDateString([], { day: "2-digit", month: "short" });
};
const titleOf = (thread: any, meId: string) =>
  thread?.kind === "group" ? thread.name || "Group" : (thread?.members || []).find((m: any) => String(m.userId) !== meId)?.name || "Direct message";

const Avatar = ({ name, group }: { name: string; group?: boolean }) => (
  <View style={[s.avatar, group && { backgroundColor: "rgba(217,181,42,0.22)" }]}>
    <Text style={[s.avatarText, group && { color: "#7a5c00" }]}>{initials(name)}</Text>
  </View>
);

export default function Chats({ me }: { me: any }) {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: T.brand }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "800" } }}>
      <Stack.Screen name="ChatList" options={{ headerShown: false }}>
        {(props: any) => <ThreadList {...props} me={me} />}
      </Stack.Screen>
      <Stack.Screen name="Thread" options={({ route }: any) => ({ title: route.params?.title || "Chat" })}>
        {(props: any) => <Thread {...props} me={me} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

/* ───────────────────────── The list ───────────────────────── */

function ThreadList({ navigation, me }: any) {
  const [threads, setThreads] = useState<any[] | null>(null);
  const [channels, setChannels] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const meId = String(me?.userId || "");

  const load = useCallback(async () => {
    const r = await api("/co/chat/threads").catch(() => null);
    if (!r) return;
    setLiveConfig(r.realtime);
    setThreads(r.threads || []);
    setChannels(r.channels || null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!channels) return;
    let stop = () => {};
    subscribe(channels.user, { "thread.new": load, "thread.updated": load }).then((f) => (stop = f));
    const off = poller(load, 8000);
    return () => {
      stop();
      off();
    };
  }, [channels, load]);

  const refresh = async () => {
    setBusy(true);
    await load();
    setBusy(false);
  };

  if (threads === null)
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} />
      </View>
    );

  return (
    <View style={s.wrap}>
      <FlatList
        data={threads}
        keyExtractor={(t) => String(t._id)}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={T.brand} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No conversations yet</Text>
            <Text style={s.emptyBody}>Tap “New chat” to message anyone in your company. Your administrator decides which groups you are in.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const title = titleOf(item, meId);
          return (
            <Pressable style={s.row} android_ripple={{ color: "rgba(0,0,0,0.06)" }} onPress={() => navigation.navigate("Thread", { threadId: String(item._id), title })}>
              <Avatar name={title} group={item.kind === "group"} />
              <View style={s.rowBody}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {title}
                  {item.kind === "group" ? `  ·  ${(item.members || []).length}` : ""}
                </Text>
                <Text style={s.rowSub} numberOfLines={1}>
                  {item.lastMessage?.text || "No messages yet"}
                </Text>
              </View>
              <View style={s.rowRight}>
                <Text style={s.time}>{shortTime(item.lastMessage?.at)}</Text>
                {!!item.unread && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{item.unread}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable style={s.fab} onPress={() => setPicker(true)}>
        <Text style={s.fabText}>New chat</Text>
      </Pressable>
      <PeoplePicker
        open={picker}
        onClose={() => setPicker(false)}
        onPicked={async (userId) => {
          const t = await api("/co/chat/direct", { body: { userId } }).catch(() => null);
          setPicker(false);
          if (t) {
            await load();
            navigation.navigate("Thread", { threadId: String(t._id), title: titleOf(t, meId) });
          }
        }}
      />
      {!isLive() && <Text style={s.hint}>Messages refresh every few seconds.</Text>}
    </View>
  );
}

function PeoplePicker({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: (userId: string) => void }) {
  const [people, setPeople] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open && !people) api("/co/chat/people").then((r) => setPeople(r.people || [])).catch(() => setPeople([]));
  }, [open, people]);
  const rows = (people || []).filter((p: any) => p.name.toLowerCase().includes(q.toLowerCase()) || String(p.role || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={s.sheet}>
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle}>Start a conversation</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.close}>Close</Text>
          </Pressable>
        </View>
        <TextInput style={s.input} placeholder="Search by name or role" placeholderTextColor={T.muted} value={q} onChangeText={setQ} autoCorrect={false} />
        {people === null ? (
          <ActivityIndicator color={T.brand} style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(p) => String(p.userId)}
            ListEmptyComponent={<Text style={s.emptyBody}>Nobody matches.</Text>}
            renderItem={({ item }) => (
              <Pressable style={s.row} android_ripple={{ color: "rgba(0,0,0,0.06)" }} onPress={() => onPicked(String(item.userId))}>
                <Avatar name={item.name} />
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{item.name}</Text>
                  <Text style={s.rowSub}>{item.role || "Member"}</Text>
                </View>
              </Pressable>
            )}
          />
        )}
        <Text style={s.privacy}>Only names and roles are shown — nobody's phone number or e-mail address is visible in chat.</Text>
      </View>
    </Modal>
  );
}

/* ───────────────────────── One conversation ───────────────────────── */

function Thread({ route, me }: any) {
  const { threadId } = route.params;
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const meId = String(me?.userId || "");
  const lastAt = useRef<string | null>(null);
  const list = useRef<FlatList<any> | null>(null);

  const toEnd = () => setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);

  const load = useCallback(async () => {
    const r = await api(`/co/chat/threads/${threadId}/messages`).catch(() => null);
    if (!r) return;
    setData(r);
    lastAt.current = r.messages?.length ? r.messages[r.messages.length - 1].createdAt : null;
    toEnd();
    api(`/co/chat/threads/${threadId}/read`, { method: "POST" }).catch(() => undefined);
  }, [threadId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Only what arrived since the last message we hold. */
  const catchUp = useCallback(async () => {
    if (!lastAt.current) return load();
    const r = await api(`/co/chat/threads/${threadId}/messages?after=${encodeURIComponent(lastAt.current)}`).catch(() => null);
    if (!r?.messages?.length) return;
    setData((d: any) => ({ ...d, messages: [...(d?.messages || []), ...r.messages] }));
    lastAt.current = r.messages[r.messages.length - 1].createdAt;
    toEnd();
    api(`/co/chat/threads/${threadId}/read`, { method: "POST" }).catch(() => undefined);
  }, [threadId, load]);

  useEffect(() => {
    const cid = data?.thread?.companyId;
    if (!cid) return;
    let stop = () => {};
    subscribe(`private-co-${cid}-thread-${threadId}`, {
      message: (m: any) => {
        setData((d: any) => (d && !(d.messages || []).some((x: any) => String(x._id) === String(m._id)) ? { ...d, messages: [...d.messages, { ...m, mine: String(m.byId) === meId }] } : d));
        lastAt.current = m.createdAt || lastAt.current;
        toEnd();
      },
    }).then((f) => (stop = f));
    const off = poller(catchUp, 6000);
    return () => {
      stop();
      off();
    };
  }, [data?.thread?.companyId, threadId, meId, catchUp]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    try {
      const msg = await api(`/co/chat/threads/${threadId}/messages`, { body: { text: body } });
      setData((d: any) => (d && !(d.messages || []).some((x: any) => String(x._id) === String(msg._id)) ? { ...d, messages: [...d.messages, msg] } : d));
      lastAt.current = msg.createdAt;
      toEnd();
    } catch {
      setText(body); // nothing typed is lost
    } finally {
      setSending(false);
    }
  };

  if (!data)
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} />
      </View>
    );

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FlatList
        ref={list}
        data={data.messages || []}
        keyExtractor={(m) => String(m._id)}
        contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={[s.emptyBody, { marginTop: 40 }]}>Say hello.</Text>}
        renderItem={({ item: m }) =>
          m.kind === "system" ? (
            <Text style={s.system}>{m.text}</Text>
          ) : (
            <View style={[s.bubbleRow, m.mine ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
              <View style={[s.bubble, m.mine ? s.mine : s.theirs]}>
                {!m.mine && data.thread.kind === "group" && <Text style={s.who}>{m.byName}</Text>}
                <Text style={m.mine ? s.mineText : s.theirsText}>{m.text}</Text>
                <Text style={[s.bubbleTime, m.mine && { color: "rgba(255,255,255,0.75)" }]}>{shortTime(m.createdAt)}</Text>
              </View>
            </View>
          )
        }
      />
      <View style={s.composer}>
        <TextInput
          style={s.composerInput}
          placeholder="Write a message"
          placeholderTextColor={T.muted}
          value={text}
          onChangeText={setText}
          maxLength={LIMIT_MESSAGE}
          multiline
        />
        <Pressable style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]} onPress={send} disabled={!text.trim() || sending}>
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendText}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.line },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontWeight: "800", color: T.text, fontSize: 15 },
  rowSub: { color: T.muted, fontSize: 12.5, marginTop: 2 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  time: { color: T.muted, fontSize: 11 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: T.brand, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(47,92,36,0.12)", alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800", color: T.brand, fontSize: 13 },
  empty: { padding: 36, alignItems: "center" },
  emptyTitle: { fontWeight: "800", color: T.text, fontSize: 16 },
  emptyBody: { color: T.muted, textAlign: "center", marginTop: 8, lineHeight: 20, paddingHorizontal: 20 },
  hint: { textAlign: "center", color: T.muted, fontSize: 11, paddingVertical: 6 },
  fab: { position: "absolute", right: 18, bottom: 22, backgroundColor: T.brand, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, elevation: 4 },
  fabText: { color: "#fff", fontWeight: "800" },
  sheet: { flex: 1, backgroundColor: T.bg, paddingTop: 48 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: T.text },
  close: { color: T.brand, fontWeight: "700" },
  input: { marginHorizontal: 16, marginBottom: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, color: T.text },
  privacy: { color: T.muted, fontSize: 11.5, padding: 16, lineHeight: 17 },
  bubbleRow: { flexDirection: "row", marginBottom: 8 },
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
  mine: { backgroundColor: T.brand, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: T.card, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: T.line },
  mineText: { color: "#fff", fontSize: 14.5, lineHeight: 20 },
  theirsText: { color: T.text, fontSize: 14.5, lineHeight: 20 },
  who: { fontSize: 11, fontWeight: "800", color: T.brand, marginBottom: 2 },
  bubbleTime: { fontSize: 10, color: T.muted, textAlign: "right", marginTop: 3 },
  system: { textAlign: "center", color: T.muted, fontSize: 11.5, paddingVertical: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, backgroundColor: T.card, borderTopWidth: 1, borderTopColor: T.line },
  composerInput: { flex: 1, maxHeight: 110, minHeight: 42, backgroundColor: T.bg, borderWidth: 1, borderColor: T.line, borderRadius: 18, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, color: T.text },
  sendBtn: { backgroundColor: T.brand, height: 42, paddingHorizontal: 18, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "800" },
});
