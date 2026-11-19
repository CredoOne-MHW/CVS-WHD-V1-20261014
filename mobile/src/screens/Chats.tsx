/**
 * Chats on the phone — the list of conversations, one conversation, and starting a new one.
 *
 * Members are shown by name and role only; a phone number or e-mail address is never part of what the
 * platform sends here. A message is kept the moment it is sent, so a tap that happens while the signal is
 * poor comes back with the text still in the box instead of losing it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as DocumentPicker from "expo-document-picker";
import { api } from "../lib/api";
import { subscribe, poller, setLiveConfig, isLive, setOpenThread, setBadge } from "../lib/live";
import { T, TYPE, LIFT } from "../theme";
import { clock, listTime, toRows, tickFor, Ticks, DayPill, SystemLine, Tail, Typing, nameColour } from "../components/chat-ui";

const LIMIT_MESSAGE = 4000;
const LIMIT_FILE_MB = 20;
/** The same list the server takes, so a file is never uploaded only to be refused on arrival. */
const FILE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
];
const isImageMime = (m?: string) => /^image\//.test(String(m || ""));
const fileSize = (bytes?: number) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
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
  const [group, setGroup] = useState(false);
  const [search, setSearch] = useState("");
  const meId = String(me?.userId || "");
  /** The same permission the web checks before offering to make a group. */
  const canGroup = !!(me?.perms?.["chats:groups"]?.create || me?.perms?.chats?.create);

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

  /**
   * The number on the app icon is the unread total, recomputed whenever the list is.
   *
   * This must stay **above** the early return below. It was written underneath it, which meant the first
   * render — while the list was still loading — ran nine hooks and the next one, the moment the
   * conversations arrived, ran ten. React counts hooks and refuses to continue when the number changes, so
   * the list threw on the very render that was about to show it. That is why the screen could be opened
   * and then would not respond to anything.
   */
  useEffect(() => {
    if (!threads) return;
    setBadge(threads.reduce((n: number, t: any) => n + Number(t.unread || 0), 0));
  }, [threads]);

  if (threads === null)
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} />
      </View>
    );

  const shown = threads.filter((t: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${titleOf(t, meId)} ${t.lastMessage?.text || ""}`.toLowerCase().includes(q);
  });

  return (
    <View style={s.wrap}>
      {/*
        The polling note, at the top rather than the bottom.
        It used to be the last child of this view, which put it underneath the floating buttons — half of
        it was hidden behind "New chat" and there was no way to read it.
      */}
      {!isLive() && <Text style={s.pollNote}>Messages refresh every few seconds</Text>}

      {/* search sits above the list and filters what is already here — no request per keystroke */}
      <View style={s.searchWrap}>
        <TextInput
          style={s.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations"
          placeholderTextColor={T.muted}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={shown}
        keyExtractor={(t) => String(t._id)}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={T.brand} />}
        contentContainerStyle={{ paddingBottom: 90 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{search ? "Nothing matches" : "No conversations yet"}</Text>
            <Text style={s.emptyBody}>
              {search ? "Try a different name or word." : "Tap “New chat” to message anyone in your company. Your administrator decides which groups you are in."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const title = titleOf(item, meId);
          const last = item.lastMessage;
          const mineLast = last?.byId && String(last.byId) === meId;
          const unread = Number(item.unread || 0);
          return (
            <Pressable style={s.row} android_ripple={{ color: "rgba(0,0,0,0.06)" }} onPress={() => navigation.navigate("Thread", { threadId: String(item._id), title })}>
              <Avatar name={title} group={item.kind === "group"} />
              <View style={s.rowBody}>
                <View style={s.rowTop}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={[s.time, unread > 0 && s.timeUnread]}>{listTime(last?.at)}</Text>
                </View>
                <View style={s.rowBottom}>
                  {/*
                    A tick on my own last message, and in a group the sender's name in front of it — the two
                    things that let somebody scan this list without opening anything.
                  */}
                  {mineLast && <Ticks state={unread === 0 ? "read" : "sent"} />}
                  <Text style={[s.rowSub, unread > 0 && s.rowSubUnread]} numberOfLines={1}>
                    {item.kind === "group" && last?.by && last.by !== "system" ? `${mineLast ? "You" : String(last.by).split(/\s+/)[0]}: ` : ""}
                    {last?.text || "No messages yet"}
                  </Text>
                  {unread > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      {/*
        Two actions, side by side. "New group" appears only for somebody whose role allows it — the same
        permission the web checks — so a tele-caller does not get a button that answers "not allowed".
      */}
      <View style={s.fabRow}>
        <Pressable style={[s.fabBtn, s.fabGhost]} onPress={() => setPicker(true)}>
          <Text style={[s.fabText, { color: T.brand }]}>New chat</Text>
        </Pressable>
        {canGroup && (
          <Pressable style={s.fabBtn} onPress={() => setGroup(true)}>
            <Text style={s.fabText}>New group</Text>
          </Pressable>
        )}
      </View>
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
      <GroupMaker
        open={group}
        onClose={() => setGroup(false)}
        onMade={async (t: any) => {
          setGroup(false);
          await load();
          if (t) navigation.navigate("Thread", { threadId: String(t._id), title: t.name || "Group" });
        }}
      />
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

/**
 * Making a group on the phone.
 *
 * A name and whoever is tapped. The person creating it is added by the server, so they are not in this
 * list — being shown your own name with a tick beside it only invites somebody to untick it and wonder why
 * nothing happened. Names and roles are all this ever shows; no phone numbers or e-mail addresses.
 */
function GroupMaker({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: (t: any) => void }) {
  const [people, setPeople] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setPicked([]);
    setQ("");
    setErr("");
    api("/co/chat/people")
      .then((r: any) => setPeople(r.people || []))
      .catch(() => setPeople([]));
  }, [open]);

  const list = (people || []).filter((p: any) => !q.trim() || `${p.name} ${p.role || ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  const make = async () => {
    if (!name.trim()) return setErr("Give the group a name");
    if (!picked.length) return setErr("Add at least one person");
    setBusy(true);
    setErr("");
    try {
      onMade(await api("/co/chat/groups", { body: { name: name.trim(), memberIds: picked } }));
    } catch (e: any) {
      setErr(e?.message || "That group could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        <View style={s.gHead}>
          <Text style={s.gHeadText}>New group</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.gClose}>Close</Text>
          </Pressable>
        </View>

        <View style={{ padding: 14, gap: 10 }}>
          {!!err && <Text style={s.formErr}>{err}</Text>}
          <TextInput style={s.gInput} value={name} onChangeText={setName} placeholder="Group name" placeholderTextColor={T.muted} maxLength={60} />
          <TextInput style={s.gInput} value={q} onChangeText={setQ} placeholder="Search people" placeholderTextColor={T.muted} autoCapitalize="none" />
          <Text style={s.pickCount}>{picked.length ? `${picked.length} selected` : "Tap the people to add"}</Text>
        </View>

        {people === null ? (
          <View style={s.center}>
            <ActivityIndicator color={T.brand} />
          </View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(p) => String(p.userId)}
            contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 100 }}
            ListEmptyComponent={<Text style={s.hint}>Nobody matches.</Text>}
            renderItem={({ item }) => {
              const on = picked.includes(String(item.userId));
              return (
                <Pressable style={[s.pickRow, on && s.pickRowOn]} onPress={() => setPicked((p) => (on ? p.filter((x) => x !== String(item.userId)) : [...p, String(item.userId)]))}>
                  <Avatar name={item.name} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {!!item.role && (
                      <Text style={s.rowSub} numberOfLines={1}>
                        {item.role}
                      </Text>
                    )}
                  </View>
                  <Text style={[s.tick, on && { color: T.brand }]}>{on ? "✓" : ""}</Text>
                </Pressable>
              );
            }}
          />
        )}

        <View style={s.sheetFoot}>
          <Pressable style={[s.makeBtn, (busy || !name.trim() || !picked.length) && { opacity: 0.5 }]} onPress={make} disabled={busy || !name.trim() || !picked.length}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.fabText}>Create group</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Thread({ route, me }: any) {
  const { threadId } = route.params;
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState(""); // why an attachment did not go out, shown above the composer
  const meId = String(me?.userId || "");
  const lastAt = useRef<string | null>(null);
  const list = useRef<FlatList<any> | null>(null);
  /** Who is typing right now, and when to stop saying so. */
  const [typingWho, setTypingWho] = useState("");
  const typingTimer = useRef<any>(null);
  const sentTypingAt = useRef(0);
  /**
   * Whether the view is at the newest message.
   *
   * Kept in a ref as well as state: the ref is read inside onContentSizeChange, which must not re-subscribe
   * when it changes, while the state is what decides whether the jump button is on screen.
   */
  const atEnd = useRef(true);
  const [atEndState, setAtEndState] = useState(true);

  const toEnd = () => setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);

  /**
   * While this conversation is on screen, its own notifications are not shown as banners — you are already
   * looking at them. Cleared on the way out, so the next message does notify.
   */
  useEffect(() => {
    setOpenThread(String(threadId));
    return () => setOpenThread(null);
  }, [threadId]);

  const onScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
    atEnd.current = near;
    setAtEndState((was) => (was === near ? was : near));
  }, []);

  /**
   * Typing, told to the others at most once every three seconds.
   *
   * Sending one of these per keystroke would be a request per character. The others stop seeing it four
   * seconds after the last one arrives, so a person who stops mid-sentence does not appear to type for ever.
   */
  const onType = useCallback(
    (v: string) => {
      setText(v);
      if (!v.trim() || Date.now() - sentTypingAt.current < 3000) return;
      sentTypingAt.current = Date.now();
      api(`/co/chat/threads/${threadId}/typing`, { method: "POST", body: {} }).catch(() => undefined);
    },
    [threadId]
  );

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

  /**
   * Only what arrived since the last message we hold — plus, now and then, the read counts.
   *
   * Where there is no real-time service the `message.read` event never arrives, so the ticks on messages
   * already on screen would stay where they were for the life of the conversation. Every sixth poll
   * (about half a minute) the visible page is re-read and only its `reads` counts are merged in: the scroll
   * position is untouched and no message moves, which is the whole reason this is not just `load()`.
   */
  const pollCount = useRef(0);
  const catchUp = useCallback(async () => {
    if (!lastAt.current) return load();
    const r = await api(`/co/chat/threads/${threadId}/messages?after=${encodeURIComponent(lastAt.current)}`).catch(() => null);
    if (!r?.messages?.length) {
      if (isLive() || ++pollCount.current % 6) return;
      const fresh = await api(`/co/chat/threads/${threadId}/messages`).catch(() => null);
      if (!fresh?.messages?.length) return;
      const reads = new Map(fresh.messages.map((m: any) => [String(m._id), Number(m.reads || 1)]));
      setData((d: any) => (d ? { ...d, messages: d.messages.map((m: any) => (reads.has(String(m._id)) ? { ...m, reads: reads.get(String(m._id)) } : m)) } : d));
      return;
    }
    setData((d: any) => ({ ...d, messages: [...(d?.messages || []), ...r.messages] }));
    lastAt.current = r.messages[r.messages.length - 1].createdAt;
    if (atEnd.current) toEnd();
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
        setTypingWho(""); // the message is here, so they have stopped
        if (atEnd.current) toEnd();
      },
      /** Someone else is typing. Never mine, and it clears itself if nothing follows. */
      typing: (p: any) => {
        if (String(p?.userId) === meId) return;
        setTypingWho(String(p?.name || "Someone"));
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTypingWho(""), 4000);
      },
      /**
       * Somebody opened the conversation, which marks everything up to that moment as read.
       *
       * This is what moves the ticks on messages already on screen. Without it they could never change:
       * the catch-up only ever asks for messages newer than the last one it holds, so a read receipt on
       * something older would never arrive and a sent message would show one tick for ever.
       */
      "message.read": (p: any) => {
        if (String(p?.userId) === meId) return;
        setData((d: any) => (d ? { ...d, messages: d.messages.map((m: any) => (m.mine && !m.pending ? { ...m, reads: Math.max(Number(m.reads || 1), 2) } : m)) } : d));
      },
    }).then((f) => (stop = f));
    const off = poller(catchUp, 6000);
    return () => {
      stop();
      off();
      clearTimeout(typingTimer.current);
    };
  }, [data?.thread?.companyId, threadId, meId, catchUp]);

  /**
   * Sending.
   *
   * The message appears in the conversation immediately, with a clock face where its ticks will be, and is
   * replaced by the real one when the server answers. On a weak signal that is the difference between an
   * app that feels instant and one that appears to have swallowed what you typed; if the send fails the
   * placeholder is taken out again and the text is put back in the box, so nothing is lost either way.
   */
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const tempId = `tmp-${Date.now()}`;
    setSending(true);
    setText("");
    setData((d: any) => (d ? { ...d, messages: [...d.messages, { _id: tempId, kind: "text", text: body, mine: true, pending: true, byId: meId, createdAt: new Date().toISOString(), reads: 1 }] } : d));
    toEnd();
    try {
      const msg = await api(`/co/chat/threads/${threadId}/messages`, { body: { text: body } });
      setData((d: any) => {
        if (!d) return d;
        const without = d.messages.filter((x: any) => String(x._id) !== tempId && String(x._id) !== String(msg._id));
        return { ...d, messages: [...without, { ...msg, mine: true }] };
      });
      lastAt.current = msg.createdAt;
      toEnd();
    } catch {
      setData((d: any) => (d ? { ...d, messages: d.messages.filter((x: any) => String(x._id) !== tempId) } : d));
      setText(body); // nothing typed is lost
    } finally {
      setSending(false);
    }
  };

  /**
   * Attaching a file from the phone.
   *
   * The system picker is used rather than a photo-library permission, so nothing has to be granted before a
   * person can send a document, and a picture is reachable through it too. React Native's FormData takes the
   * `{ uri, name, type }` shape and streams the file itself, so a 15 MB photo never has to be read into
   * memory as a string first.
   */
  const attach = async () => {
    if (sending) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: FILE_MIMES, copyToCacheDirectory: true, multiple: false }).catch(() => null);
    const f = picked && !picked.canceled ? picked.assets?.[0] : null;
    if (!f) return;
    if (f.size && f.size > LIMIT_FILE_MB * 1024 * 1024) {
      setNote(`Exceeded File Size — that file is ${fileSize(f.size)}, and the limit is ${LIMIT_FILE_MB} MB.`);
      return;
    }
    setSending(true);
    setNote("");
    try {
      const form = new FormData();
      form.append("file", { uri: f.uri, name: f.name || "file", type: f.mimeType || "application/octet-stream" } as any);
      const msg = await api(`/co/chat/threads/${threadId}/files`, { form });
      setData((d: any) => (d && !(d.messages || []).some((x: any) => String(x._id) === String(msg._id)) ? { ...d, messages: [...d.messages, msg] } : d));
      lastAt.current = msg.createdAt;
      toEnd();
    } catch (e: any) {
      setNote(e?.message || "The file did not go out — try again.");
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

  const rows = toRows(data.messages || []);
  const members = (data.thread?.members || []).length || 2;
  const isGroup = data.thread?.kind === "group";

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      {/* the conversation sits on a tinted ground, so the bubbles read as cards on a surface */}
      <View style={s.paper}>
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 10 }}
          onContentSizeChange={() => atEnd.current && list.current?.scrollToEnd({ animated: false })}
          onScroll={onScroll}
          scrollEventThrottle={120}
          ListEmptyComponent={<Text style={[s.emptyBody, { marginTop: 48 }]}>No messages yet. Say hello.</Text>}
          renderItem={({ item: r }) => {
            if (r.type === "day") return <DayPill date={r.date!} />;
            const m = r.msg;
            if (m.kind === "system") return <SystemLine text={m.text} />;
            const mine = !!m.mine;
            const colour = mine ? T.brand : "#ffffff";
            return (
              <View style={[s.bubbleRow, mine ? s.rowMine : s.rowTheirs, { marginTop: r.head ? 6 : 1.5 }]}>
                <View style={[s.bubble, mine ? s.mine : s.theirs, r.tail && (mine ? s.mineTail : s.theirsTail)]}>
                  {r.tail && <Tail mine={mine} colour={colour} />}
                  {!mine && isGroup && r.head && <Text style={[s.who, { color: nameColour(String(m.byId || m.byName)) }]}>{m.byName}</Text>}
                  {m.kind === "file" && m.file ? <FileBubble msg={m} /> : <Text style={mine ? s.mineText : s.theirsText}>{m.text}</Text>}
                  {/* the time sits in the bottom corner of the bubble, with the ticks beside it */}
                  <View style={s.stamp}>
                    <Text style={[s.bubbleTime, mine && s.bubbleTimeMine]}>{clock(m.createdAt)}</Text>
                    {mine && <Ticks state={tickFor(m, members)} onBrand />}
                  </View>
                </View>
              </View>
            );
          }}
        />

        {!!typingWho && <Typing who={typingWho} />}

        {/* only when scrolled away from the newest message, as a phone does */}
        {!atEndState && (
          <Pressable style={s.jump} onPress={() => list.current?.scrollToEnd({ animated: true })} accessibilityLabel="Go to the newest message">
            <Text style={s.jumpText}>⌄</Text>
          </Pressable>
        )}
      </View>

      {!!note && (
        <Pressable onPress={() => setNote("")} style={s.note}>
          <Text style={s.noteText}>{note}</Text>
        </Pressable>
      )}

      <View style={s.composer}>
        <View style={s.inputPill}>
          <Pressable style={s.clipBtn} onPress={attach} disabled={sending} hitSlop={6} accessibilityLabel="Attach a file">
            <Text style={[s.clipText, sending && { opacity: 0.4 }]}>＋</Text>
          </Pressable>
          <TextInput
            style={s.composerInput}
            placeholder="Message"
            placeholderTextColor={T.muted}
            value={text}
            onChangeText={onType}
            maxLength={LIMIT_MESSAGE}
            multiline
          />
        </View>
        {/* one round button that is Send when there is something to send, as a phone does */}
        <Pressable style={[s.sendBtn, !text.trim() && !sending && { opacity: 0.55 }]} onPress={send} disabled={!text.trim() || sending} accessibilityLabel="Send">
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendGlyph}>➤</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * An attachment on the phone.
 *
 * Nothing in a message carries a usable address — the bucket is private — so the link is asked for on the
 * tap that wants the file, and it stops working a few minutes later. A picture appears in place; anything
 * else is handed to whatever app on the phone opens that kind of file.
 */
function FileBubble({ msg }: { msg: any }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const f = msg.file || {};
  const image = isImageMime(f.mime);

  const open = async () => {
    if (busy) return;
    if (url) {
      if (!image) Linking.openURL(url).catch(() => setErr("Nothing on this phone opens that kind of file."));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await api(`/co/chat/files/${msg._id}`);
      setUrl(r.url);
      if (!image) await Linking.openURL(r.url).catch(() => setErr("Nothing on this phone opens that kind of file."));
    } catch (e: any) {
      setErr(e?.message || "That file could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Saving the file to the phone.
   *
   * A separate link is fetched carrying the attachment disposition and the real name, and handed to the
   * phone's browser, which saves it to Downloads under that name. The viewing link deliberately does not
   * carry it, so a picture can still be shown in place.
   */
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api(`/co/chat/files/${msg._id}?download=1`);
      await Linking.openURL(r.url);
    } catch (e: any) {
      setErr(e?.message || "That file could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (image && url)
    return (
      <View>
        <Image source={{ uri: url }} style={s.shot} resizeMode="cover" />
        <View style={s.imgFoot}>
          <Text style={[s.fileMeta, msg.mine && { color: "rgba(255,255,255,0.8)" }]} numberOfLines={1}>
            {f.name} · {fileSize(f.size)}
          </Text>
          <Pressable onPress={save} hitSlop={8} accessibilityLabel={`Save ${f.name}`}>
            {busy ? <ActivityIndicator size="small" color={msg.mine ? "#fff" : T.brand} /> : <Text style={[s.saveLink, msg.mine && { color: "#fff" }]}>Save</Text>}
          </Pressable>
        </View>
        {!!err && <Text style={s.fileErr}>{err}</Text>}
      </View>
    );

  return (
    <View>
      <View style={s.fileRow}>
        <Pressable style={s.fileMain} onPress={open}>
          <View style={[s.fileIcon, msg.mine && { backgroundColor: "rgba(255,255,255,0.22)" }]}>
            {busy ? <ActivityIndicator size="small" color={msg.mine ? "#fff" : T.brand} /> : <Text style={[s.fileIconText, msg.mine && { color: "#fff" }]}>{image ? "◻" : "▣"}</Text>}
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={[s.fileName, msg.mine && { color: "#fff" }]} numberOfLines={1}>
              {f.name}
            </Text>
            <Text style={[s.fileMeta, msg.mine && { color: "rgba(255,255,255,0.75)" }]}>
              {fileSize(f.size)} · {image ? "tap to view" : "tap to open"}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={save} hitSlop={8} accessibilityLabel={`Save ${f.name}`}>
          <Text style={[s.saveLink, msg.mine && { color: "#fff" }]}>Save</Text>
        </Pressable>
      </View>
      {!!err && <Text style={s.fileErr}>{err}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg },
  row: { flexDirection: "row", alignItems: "center", gap: T.sm, paddingHorizontal: T.pad, paddingVertical: 9, backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.line },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  rowTitle: { ...TYPE.title, fontSize: 15, flex: 1 },
  rowSub: { ...TYPE.meta, flex: 1, fontSize: 12.5 },
  rowSubUnread: { color: T.text, fontWeight: "600" },
  searchWrap: { paddingHorizontal: T.pad, paddingTop: T.xs + 2, paddingBottom: T.xs, backgroundColor: T.card },
  pollNote: { backgroundColor: T.tint, color: T.brand, fontSize: 11, fontWeight: "700", textAlign: "center", paddingVertical: 5 },
  search: { backgroundColor: T.bg, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, fontSize: 13, color: T.text },
  rowRight: { alignItems: "flex-end", gap: 4 },
  time: { fontSize: 11, color: T.muted, fontWeight: "600" },
  timeUnread: { color: T.brand, fontWeight: "800" },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: T.brand, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  avatar: { height: 44, width: 44, borderRadius: 22, backgroundColor: T.tint, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800", color: T.brand, fontSize: 13 },
  empty: { padding: 36, alignItems: "center" },
  emptyTitle: { fontWeight: "800", color: T.text, fontSize: 16 },
  emptyBody: { color: T.muted, textAlign: "center", marginTop: 8, lineHeight: 20, paddingHorizontal: 20 },
  hint: { textAlign: "center", color: T.muted, fontSize: 11, paddingVertical: 6 },
  fab: { position: "absolute", right: 18, bottom: 22, backgroundColor: T.brand, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, elevation: 4 },
  fabText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  fabBtn: { backgroundColor: T.brand, paddingHorizontal: 17, paddingVertical: 11, borderRadius: 22, ...LIFT, elevation: 4 },
  fabRow: { position: "absolute", right: 14, left: 14, bottom: 18, flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  fabGhost: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line },
  gHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: T.brand, paddingHorizontal: 16, paddingVertical: 14, paddingTop: Platform.OS === "ios" ? 52 : 16 },
  gHeadText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  gClose: { color: "#fff", fontWeight: "700" },
  gInput: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: T.text },
  formErr: { backgroundColor: "#fdecec", color: "#a11", fontWeight: "600", fontSize: 12, padding: 10, borderRadius: 10 },
  pickCount: { color: T.muted, fontSize: 11, fontWeight: "700" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 13, padding: 10, marginBottom: 8 },
  pickRowOn: { borderColor: T.brand, backgroundColor: "rgba(47,92,36,0.06)" },
  tick: { fontSize: 16, fontWeight: "800", color: "transparent", width: 18, textAlign: "center" },
  sheetFoot: { position: "absolute", left: 14, right: 14, bottom: 18 },
  makeBtn: { backgroundColor: T.brand, borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  sheet: { flex: 1, backgroundColor: T.bg, paddingTop: 48 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: T.text },
  close: { color: T.brand, fontWeight: "700" },
  input: { marginHorizontal: 16, marginBottom: 10, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, color: T.text },
  privacy: { color: T.muted, fontSize: 11.5, padding: 16, lineHeight: 17 },
  /**
   * The conversation's ground.
   *
   * A tint taken from the company's own brand rather than a borrowed wallpaper: this app is white-label,
   * so the surface has to belong to whichever company the build is for.
   */
  paper: { flex: 1, backgroundColor: "#eef1ec" },
  bubbleRow: { flexDirection: "row", paddingHorizontal: 4 },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", borderRadius: 14, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 5, ...LIFT },
  mine: { backgroundColor: T.brand },
  /** Only the last bubble of a run squares off, because that is the one wearing the tail. */
  mineTail: { borderBottomRightRadius: 3 },
  theirs: { backgroundColor: "#ffffff" },
  theirsTail: { borderBottomLeftRadius: 3 },
  mineText: { color: "#fff", fontSize: 14.5, lineHeight: 20 },
  /** The time and ticks tuck into the bottom-right corner of the bubble. */
  stamp: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", marginTop: 1 },
  theirsText: { color: T.text, fontSize: 14.5, lineHeight: 20 },
  who: { fontSize: 11.5, fontWeight: "800", marginBottom: 2 },
  bubbleTime: { fontSize: 10, color: T.muted },
  bubbleTimeMine: { color: "rgba(255,255,255,0.72)" },
  jump: { position: "absolute", right: 14, bottom: 14, height: 38, width: 38, borderRadius: 19, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", ...LIFT },
  jumpText: { fontSize: 20, lineHeight: 22, color: T.brand, fontWeight: "800", marginTop: -3 },
  system: { textAlign: "center", color: T.muted, fontSize: 11.5, paddingVertical: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: "#eef1ec" },
  /** One rounded field holding the attach button and the text, with Send as a separate round button. */
  inputPill: { flex: 1, flexDirection: "row", alignItems: "flex-end", backgroundColor: "#fff", borderRadius: 24, paddingLeft: 4, paddingRight: 12, minHeight: 46 },
  composerInput: { flex: 1, maxHeight: 120, minHeight: 46, paddingTop: 12, paddingBottom: 12, color: T.text, fontSize: 15 },
  sendBtn: { backgroundColor: T.brand, height: 46, width: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", ...LIFT },
  sendGlyph: { color: "#fff", fontSize: 17, marginLeft: 2 },
  clipBtn: { height: 46, width: 42, alignItems: "center", justifyContent: "center" },
  clipText: { fontSize: 23, lineHeight: 25, color: T.muted, fontWeight: "700" },
  note: { backgroundColor: "#fdecec", paddingHorizontal: 14, paddingVertical: 8 },
  noteText: { color: "#a11", fontSize: 12, fontWeight: "600" },
  shot: { width: 220, height: 160, borderRadius: 12 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 190 },
  fileMain: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  imgFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 5 },
  saveLink: { fontWeight: "800", fontSize: 12, color: T.brand },
  fileIcon: { height: 36, width: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(47,92,36,0.12)" },
  fileIconText: { fontSize: 16, color: T.brand },
  fileName: { fontWeight: "800", color: T.text },
  fileMeta: { fontSize: 11, color: T.muted, marginTop: 1 },
  fileErr: { color: "#a11", fontSize: 11, marginTop: 4 },
});
