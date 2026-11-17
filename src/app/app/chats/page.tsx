"use client";
/**
 * Chats — one-to-one and groups, live.
 *
 * A message appears for everyone the moment it is sent; nobody ever sees anyone else's phone number or
 * e-mail address, only a name and a role. Administrators get two extra tabs: Groups and Notices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Users, Megaphone, Search, Send, Plus, Check, X, Paperclip, FileText, Download } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader, Spinner, Empty, Btn, Badge, Modal, Field, useToast } from "@/components/ui";
import { subscribe, poller, realtimeConfig, isLive } from "@/lib/realtime";
import { useMe } from "@/components/Shell";
import { threadTitle, shortTime, LIMITS, EVENTS, NOTICE_TONES, FILE_TYPES, fileAccepted, fileSize, isImage, type PublicMember } from "@shared/chat";

type Thread = any;

const Avatar = ({ name, group }: { name: string; group?: boolean }) => (
  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${group ? "bg-honey-100 text-honey-800" : "bg-hive-100 text-hive-800"}`}>
    {name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?"}
  </span>
);

export default function Page() {
  const toast = useToast();
  const [tab, setTab] = useState<"chats" | "groups" | "notices">("chats");
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [channels, setChannels] = useState<{ user: string; company: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const perms = useMe()?.perms || ({} as any);

  const load = useCallback(
    async (fresh = false) => {
      const r = await api<any>("/co/chat/threads", { fresh }).catch(() => null);
      if (r) {
        setThreads(r.threads || []);
        setChannels(r.channels || null);
      }
    },
    []
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // the thread list updates itself: live where a service is configured, on a timer where it is not
  useEffect(() => {
    if (!channels) return;
    let stop = () => {};
    subscribe(realtimeConfig(), channels.user, {
      [EVENTS.threadNew]: () => load(true),
      [EVENTS.threadUpdated]: () => load(true),
    }).then((f) => (stop = f));
    const off = poller(() => load(true));
    return () => {
      stop();
      off();
    };
  }, [channels, load]);

  const canGroups = !!perms["chats:groups"]?.create;
  const canNotices = !!perms["chats:notices"]?.create;
  const tabs = [
    { k: "chats" as const, label: "Conversations", icon: MessageCircle, show: true },
    { k: "groups" as const, label: "Groups", icon: Users, show: canGroups },
    { k: "notices" as const, label: "Notices", icon: Megaphone, show: canNotices },
  ].filter((t) => t.show);

  return (
    <>
      <PageHeader
        title="Chats"
        subtitle={isLive() ? "Messages arrive the moment they are sent." : "Messages refresh every few seconds."}
        actions={<NewChat onOpened={(id) => { load(true); setOpen(id); }} />}
      />

      {tabs.length > 1 && (
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-100">
          {tabs.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-semibold ${tab === t.k ? "border-b-2 border-hive-600 text-hive-800" : "text-ink-500 hover:text-ink-700"}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "chats" && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[22rem_1fr]">
          <ThreadList threads={threads} open={open} onOpen={setOpen} />
          <div className="card min-h-[32rem] min-w-0 overflow-hidden p-0">
            {open ? <ThreadPane key={open} threadId={open} onSent={() => load(true)} /> : <Empty title="Pick a conversation" hint="Or start a new one — everyone in your company is one click away." />}
          </div>
        </div>
      )}
      {tab === "groups" && <Groups onChanged={() => load(true)} onOpen={(id) => { setTab("chats"); setOpen(id); }} />}
      {tab === "notices" && <Notices toast={toast} />}
    </>
  );
}

/* ───────────────────────── The list of conversations ───────────────────────── */

function ThreadList({ threads, open, onOpen }: { threads: Thread[] | null; open: string | null; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const meId = String(useMe()?.userId || "");
  const rows = (threads || []).filter((t) => threadTitle(t, meId).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="card flex max-h-[34rem] min-w-0 flex-col p-0">
      <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
        <Search className="h-4 w-4 text-ink-400" />
        <input className="w-full bg-transparent py-1 text-sm outline-none" placeholder="Search conversations" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {threads === null ? (
        <div className="flex justify-center py-12"><Spinner className="h-5 w-5" /></div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-ink-500">{q ? "Nothing matches." : "No conversations yet."}</p>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {rows.map((t) => {
            const title = threadTitle(t, meId);
            return (
              <li key={t._id}>
                <button onClick={() => onOpen(String(t._id))} className={`flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-hive-50/60 ${open === String(t._id) ? "bg-hive-50" : ""}`}>
                  <Avatar name={title} group={t.kind === "group"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{title}</span>
                      {t.kind === "group" && <Badge color="honey">{(t.members || []).length}</Badge>}
                    </span>
                    <span className="block truncate text-xs text-ink-500">{t.lastMessage?.text || "No messages yet"}</span>
                  </span>
                  <span className="shrink-0 text-right leading-tight">
                    <span className="block text-[11px] text-ink-400">{shortTime(t.lastMessage?.at)}</span>
                    {!!t.unread && <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hive-600 px-1.5 text-[11px] font-bold text-white">{t.unread}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────── One conversation ───────────────────────── */

function ThreadPane({ threadId, onSent }: { threadId: string; onSent: () => void }) {
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const meId = String(useMe()?.userId || "");
  const box = useRef<HTMLDivElement | null>(null);
  const lastAt = useRef<string | null>(null);

  const scroll = () => requestAnimationFrame(() => box.current?.scrollTo({ top: box.current.scrollHeight }));

  const load = useCallback(async () => {
    const r = await api<any>(`/co/chat/threads/${threadId}/messages`, { fresh: true }).catch(() => null);
    if (!r) return;
    setData(r);
    lastAt.current = r.messages?.length ? r.messages[r.messages.length - 1].createdAt : null;
    scroll();
    api(`/co/chat/threads/${threadId}/read`, { method: "POST" }).then(onSent).catch(() => {});
  }, [threadId, onSent]);

  useEffect(() => {
    load();
  }, [load]);

  /** Only the messages since the last one we hold — a thread never re-downloads itself. */
  const catchUp = useCallback(async () => {
    if (!lastAt.current) return load();
    const r = await api<any>(`/co/chat/threads/${threadId}/messages?after=${encodeURIComponent(lastAt.current)}`, { fresh: true }).catch(() => null);
    if (!r?.messages?.length) return;
    setData((d: any) => ({ ...d, messages: [...(d?.messages || []), ...r.messages] }));
    lastAt.current = r.messages[r.messages.length - 1].createdAt;
    scroll();
    api(`/co/chat/threads/${threadId}/read`, { method: "POST" }).catch(() => {});
  }, [threadId, load]);

  useEffect(() => {
    const cid = data?.thread?.companyId;
    if (!cid) return;
    let stop = () => {};
    subscribe(realtimeConfig(), `private-co-${cid}-thread-${threadId}`, {
      [EVENTS.message]: (m: any) => {
        setData((d: any) => (d && !(d.messages || []).some((x: any) => String(x._id) === String(m._id)) ? { ...d, messages: [...d.messages, { ...m, mine: String(m.byId) === meId }] } : d));
        lastAt.current = m.createdAt || lastAt.current;
        scroll();
      },
      [EVENTS.typing]: (t: any) => {
        if (String(t.userId) === meId) return;
        setTyping(t.name);
        setTimeout(() => setTyping(null), 2500);
      },
    }).then((f) => (stop = f));
    const off = poller(catchUp);
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
      const msg = await api<any>(`/co/chat/threads/${threadId}/messages`, { method: "POST", body: { text: body } });
      setData((d: any) => (d && !(d.messages || []).some((x: any) => String(x._id) === String(msg._id)) ? { ...d, messages: [...d.messages, msg] } : d));
      lastAt.current = msg.createdAt;
      scroll();
      onSent();
    } catch (e: any) {
      setText(body); // nothing typed is ever lost
      alert(e?.message || "The message did not go out — try again.");
    } finally {
      setSending(false);
    }
  };

  /**
   * Sending a file.
   *
   * Refused in the browser before anything is uploaded when the type is not one the server takes or the file
   * is over the limit — waiting out a 15 MB upload to be told it was never going to be accepted is a poor way
   * to find out. The message the server creates comes back and is appended exactly like a typed one.
   */
  const sendFile = async (f: File | null | undefined) => {
    if (!f || sending) return;
    if (!fileAccepted(f.type)) return alert(`${f.name} is not a kind of file this takes. Images, PDF, Word, Excel, CSV and text files are fine.`);
    if (f.size > LIMITS.fileMb * 1024 * 1024) return alert(`${f.name} is ${fileSize(f.size)}. The limit is ${LIMITS.fileMb} MB.`);
    setSending(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const msg = await api<any>(`/co/chat/threads/${threadId}/files`, { form });
      setData((d: any) => (d && !(d.messages || []).some((x: any) => String(x._id) === String(msg._id)) ? { ...d, messages: [...d.messages, msg] } : d));
      lastAt.current = msg.createdAt;
      scroll();
      onSent();
    } catch (e: any) {
      alert(e?.message || "The file did not go out — try again.");
    } finally {
      setSending(false);
    }
  };

  if (!data) return <div className="flex h-96 items-center justify-center"><Spinner className="h-5 w-5" /></div>;
  const title = threadTitle(data.thread, meId);

  return (
    <div className="flex h-[34rem] flex-col">
      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
        <Avatar name={title} group={data.thread.kind === "group"} />
        <div className="min-w-0">
          <p className="truncate font-bold">{title}</p>
          <p className="truncate text-xs text-ink-500">
            {data.thread.kind === "group" ? `${(data.thread.members || []).length} members` : typing ? "typing…" : (data.thread.members || []).find((m: any) => String(m.userId) !== meId)?.role || "Direct message"}
          </p>
        </div>
      </div>

      <div ref={box} className="flex-1 space-y-2 overflow-y-auto bg-hive-50/30 px-4 py-4">
        {(data.messages || []).length === 0 && <p className="py-10 text-center text-sm text-ink-500">Say hello.</p>}
        {(data.messages || []).map((m: any) =>
          m.kind === "system" ? (
            <p key={m._id} className="py-1 text-center text-xs text-ink-400">{m.text}</p>
          ) : (
            <div key={m._id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.mine ? "bg-hive-600 text-white" : "bg-white text-ink-800"}`}>
                {!m.mine && data.thread.kind === "group" && <p className="mb-0.5 text-[11px] font-bold text-hive-700">{m.byName}</p>}
                {m.kind === "file" && m.file ? <FileBubble msg={m} /> : <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                <p className={`mt-1 text-right text-[10px] ${m.mine ? "text-hive-100" : "text-ink-400"}`}>{shortTime(m.createdAt)}</p>
              </div>
            </div>
          )
        )}
        {typing && data.thread.kind === "group" && <p className="text-xs italic text-ink-400">{typing} is typing…</p>}
      </div>

      <div className="flex items-end gap-2 border-t border-ink-100 p-3">
        <label className={`btn-ghost h-10 shrink-0 cursor-pointer ${sending ? "pointer-events-none opacity-50" : ""}`} title={`Attach a file (up to ${LIMITS.fileMb} MB)`} aria-label="Attach a file">
          <Paperclip className="h-4 w-4" />
          <input
            type="file"
            className="hidden"
            accept={Object.keys(FILE_TYPES).join(",")}
            onChange={(e) => {
              sendFile(e.target.files?.[0]);
              e.target.value = ""; // so the same file can be sent twice
            }}
          />
        </label>
        <textarea
          className="input max-h-28 min-h-10 flex-1 resize-none py-2"
          rows={1}
          placeholder="Write a message"
          maxLength={LIMITS.message}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onInput={() => {
            api(`/co/chat/threads/${threadId}/typing`, { method: "POST" }).catch(() => {});
          }}
        />
        <Btn onClick={send} loading={sending} className="h-10">
          <Send className="h-4 w-4" />
        </Btn>
      </div>
    </div>
  );
}

/**
 * An attachment in a conversation.
 *
 * The bucket is private and nothing in a message carries a usable address: the link is asked for when
 * somebody actually wants the file, and the one that comes back stops working after five minutes. That is
 * also why an image is not shown until its link is fetched — a thumbnail would need the same link, so the
 * first click fetches it and the picture appears in place.
 */
function FileBubble({ msg }: { msg: any }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const f = msg.file || {};
  const image = isImage(f.mime);

  const fetchUrl = async () => {
    if (url || busy) return url;
    setBusy(true);
    setErr("");
    try {
      const r = await api<any>(`/co/chat/files/${msg._id}`);
      setUrl(r.url);
      return r.url as string;
    } catch (e: any) {
      setErr(e?.message || "That file could not be opened.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (image && url) return <img src={url} alt={f.name} className="max-h-64 rounded-xl" />;

  return (
    <div className="min-w-[12rem]">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={async () => {
          const u = await fetchUrl();
          if (u && !image) window.open(u, "_blank", "noopener");
        }}
      >
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${msg.mine ? "bg-white/20" : "bg-hive-100"}`}>
          {busy ? <Spinner className="h-4 w-4" /> : image ? <Download className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{f.name}</span>
          <span className={`block text-[11px] ${msg.mine ? "text-hive-100" : "text-ink-400"}`}>
            {fileSize(f.size)} · {image ? "click to view" : "click to open"}
          </span>
        </span>
      </button>
      {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
    </div>
  );
}

/* ───────────────────────── Starting a conversation ───────────────────────── */

function NewChat({ onOpened }: { onOpened: (threadId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<PublicMember[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (open && !people) api<any>("/co/chat/people").then((r) => setPeople(r.people || [])).catch(() => setPeople([]));
  }, [open, people]);

  const start = async (userId: string) => {
    setBusy(userId);
    try {
      const t = await api<any>("/co/chat/direct", { method: "POST", body: { userId } });
      setOpen(false);
      onOpened(String(t._id));
    } finally {
      setBusy("");
    }
  };

  const rows = (people || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.role || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <Btn onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> New chat
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Start a conversation" size="md">
        <input className="input mb-3" placeholder="Search by name or role" value={q} onChange={(e) => setQ(e.target.value)} />
        {people === null ? (
          <div className="flex justify-center py-8"><Spinner className="h-5 w-5" /></div>
        ) : (
          <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto">
            {rows.map((p) => (
              <li key={p.userId}>
                <button disabled={!!busy} onClick={() => start(p.userId)} className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-hive-50/60 disabled:opacity-50">
                  <Avatar name={p.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-ink-500">{p.role || "Member"}</span>
                  </span>
                  {busy === p.userId && <Spinner />}
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="py-8 text-center text-sm text-ink-500">Nobody matches.</li>}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-500">Only names and roles are shown — nobody's phone number or e-mail address is visible in chat.</p>
      </Modal>
    </>
  );
}

/* ───────────────────────── Groups (administrator) ───────────────────────── */

function Groups({ onChanged, onOpen }: { onChanged: () => void; onOpen: (id: string) => void }) {
  const [people, setPeople] = useState<PublicMember[] | null>(null);
  const [groups, setGroups] = useState<any[] | null>(null);
  const [form, setForm] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([api<any>("/co/chat/people", { fresh: true }).catch(() => ({ people: [] })), api<any>("/co/chat/threads", { fresh: true }).catch(() => ({ threads: [] }))]);
    setPeople(p.people || []);
    setGroups((t.threads || []).filter((x: any) => x.kind === "group"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { name: form.name, about: form.about, memberIds: form.memberIds };
      if (form._id) await api(`/co/chat/groups/${form._id}`, { method: "PUT", body });
      else await api("/co/chat/groups", { method: "POST", body });
      toast("ok", form._id ? "Group updated" : "Group created");
      setForm(null);
      await load();
      onChanged();
    } catch (e: any) {
      toast("err", e?.message || "Could not save the group");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => setForm((f: any) => ({ ...f, memberIds: f.memberIds.includes(id) ? f.memberIds.filter((x: string) => x !== id) : [...f.memberIds, id] }));

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink-600">Groups you create are visible to their members straight away, on the web and in the app.</p>
        <Btn onClick={() => setForm({ name: "", about: "", memberIds: [] })}>
          <Plus className="mr-1 h-4 w-4" /> New group
        </Btn>
      </div>

      {groups === null ? (
        <div className="flex justify-center py-16"><Spinner className="h-5 w-5" /></div>
      ) : groups.length === 0 ? (
        <Empty title="No groups yet" hint="A group has a name and the people you add to it. Nobody's contact details are shared." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g._id} className="card p-4">
              <div className="flex items-start gap-3">
                <Avatar name={g.name || "Group"} group />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{g.name}</p>
                  <p className="text-xs text-ink-500">{(g.members || []).length} members</p>
                </div>
              </div>
              {g.about && <p className="mt-2 line-clamp-2 text-xs text-ink-600">{g.about}</p>}
              <div className="mt-3 flex flex-wrap gap-1">
                {(g.members || []).slice(0, 6).map((m: any) => (
                  <span key={String(m.userId)} className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] text-ink-600">{m.name}</span>
                ))}
                {(g.members || []).length > 6 && <span className="text-[11px] text-ink-400">+{(g.members || []).length - 6} more</span>}
              </div>
              <div className="mt-4 flex gap-2">
                <Btn variant="secondary" className="flex-1" onClick={() => setForm({ _id: g._id, name: g.name, about: g.about || "", memberIds: (g.members || []).map((m: any) => String(m.userId)) })}>
                  Edit
                </Btn>
                <Btn variant="ghost" onClick={() => onOpen(String(g._id))}>Open</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit group" : "New group"}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn>
            <Btn onClick={save} loading={saving} disabled={!form?.name || form.name.trim().length < 2 || !form.memberIds.length}>
              {form?._id ? "Save group" : "Create group"}
            </Btn>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="Group name" required>
              <input className="input" maxLength={LIMITS.groupName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sales floor" />
            </Field>
            <Field label="What it is for" hint="Shown under the name.">
              <input className="input" maxLength={300} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} placeholder="Daily coordination for the sales team" />
            </Field>
            <Field label={`Members (${form.memberIds.length})`} required hint="Everyone added can read the whole conversation from the moment they join.">
              <div className="max-h-64 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100">
                {(people || []).map((p) => {
                  const on = form.memberIds.includes(p.userId);
                  return (
                    <button key={p.userId} type="button" onClick={() => toggle(p.userId)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hive-50/60">
                      <span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? "border-hive-600 bg-hive-600 text-white" : "border-ink-200"}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{p.name}</span>
                        <span className="block truncate text-xs text-ink-500">{p.role || "Member"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ───────────────────────── Notices (administrator) ───────────────────────── */

function Notices({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [form, setForm] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api<any>("/co/chat/notices/all?limit=50", { fresh: true }).catch(() => ({ items: [] }));
    setRows(r.items || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const post = async () => {
    setSaving(true);
    try {
      await api("/co/chat/notices", { method: "POST", body: { text: form.text, tone: form.tone, push: form.push, endsAt: form.endsAt || undefined } });
      toast("ok", "Notice is live");
      setForm(null);
      load();
    } catch (e: any) {
      toast("err", e?.message || "Could not post the notice");
    } finally {
      setSaving(false);
    }
  };

  const stop = async (id: string) => {
    await api(`/co/chat/notices/${id}/stop`, { method: "POST" }).catch(() => {});
    load();
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink-600">A notice scrolls across the top of every screen, on the web and in the app, until you stop it.</p>
        <Btn onClick={() => setForm({ text: "", tone: "info", push: false, endsAt: "" })}>
          <Plus className="mr-1 h-4 w-4" /> New notice
        </Btn>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16"><Spinner className="h-5 w-5" /></div>
      ) : rows.length === 0 ? (
        <Empty title="No notices yet" hint="Use one for anything everybody needs to see — a system window, a target, a holiday." />
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-hive-50/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Notice</th>
                <th className="px-4 py-2.5">Tone</th>
                <th className="px-4 py-2.5">Posted</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((n) => (
                <tr key={n._id}>
                  <td className="px-4 py-3">{n.text}</td>
                  <td className="px-4 py-3 capitalize">{n.tone}</td>
                  <td className="px-4 py-3 text-xs text-ink-500">{shortTime(n.createdAt)}{n.push ? " · pushed" : ""}</td>
                  <td className="px-4 py-3">{n.active ? <Badge color="green">Live</Badge> : <Badge color="gray">Stopped</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    {n.active && (
                      <Btn variant="ghost" onClick={() => stop(String(n._id))}>
                        <X className="mr-1 h-4 w-4" /> Stop
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="New notice"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn>
            <Btn onClick={post} loading={saving} disabled={!form?.text || form.text.trim().length < 2}>Post notice</Btn>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="What it says" required hint={`${form.text.length} / ${LIMITS.noticeLength} characters`}>
              <textarea className="input min-h-20" maxLength={LIMITS.noticeLength} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Month-end close is on Friday — please clear pending pay-ins by Thursday evening." />
            </Field>
            <Field label="Tone">
              <div className="flex gap-2">
                {NOTICE_TONES.map((t) => (
                  <button key={t} type="button" onClick={() => setForm({ ...form, tone: t })} className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${form.tone === t ? "bg-hive-600 text-white" : "bg-ink-50 text-ink-600"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Stop showing it after" hint="Leave empty to keep it until you stop it yourself.">
              <input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.push} onChange={(e) => setForm({ ...form, push: e.target.checked })} />
              Also send it as a push notification to everyone's phone
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}

