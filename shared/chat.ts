/**
 * Chat inside a company — one-to-one and groups — and the notices an administrator puts on everyone's screen.
 *
 * A person's phone number and e-mail address are never part of anything the chat sends: members are known
 * to each other by name and role only. That is a rule of the feature, not a setting, so a group cannot be
 * used to harvest contact details.
 */

export const THREAD_KINDS = ["direct", "group"] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

export const MESSAGE_KINDS = ["text", "system"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const LIMITS = {
  message: 4000, // characters
  groupName: 60,
  groupMembers: 500,
  page: 50, // messages fetched at a time
  noticeLength: 300,
};

/** What another member may know about a person. Nothing else leaves the server. */
export interface PublicMember {
  userId: string;
  name: string;
  role?: string;
  initials: string;
  isAdmin?: boolean;
  active?: boolean;
}
export function publicMember(u: any, roleName?: string): PublicMember {
  const name = String(u?.name || "Member");
  return {
    userId: String(u?._id || u?.userId),
    name,
    role: roleName || (u?.isOwner ? "Owner" : undefined),
    initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join("") || "?",
    isAdmin: !!u?.isOwner,
    active: u?.active !== false,
  };
}

/** The channel a thread's messages travel on. Private, so the server decides who may listen. */
export const threadChannel = (companyId: string, threadId: string) => `private-co-${companyId}-thread-${threadId}`;
/** Everything addressed to one person: new threads, unread counts, notices. */
export const userChannel = (companyId: string, userId: string) => `private-co-${companyId}-user-${userId}`;
/** Everyone in the company: the scrolling notice. */
export const companyChannel = (companyId: string) => `private-co-${companyId}-all`;

export const EVENTS = {
  message: "message",
  messageRead: "message.read",
  threadNew: "thread.new",
  threadUpdated: "thread.updated",
  typing: "typing",
  notice: "notice",
} as const;

/** A notice an administrator shows across the top of every screen in the apps. */
export const NOTICE_TONES = ["info", "warning", "success"] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

/** The name a direct thread is shown under: the other person's. */
export function threadTitle(thread: any, meId: string) {
  if (thread.kind === "group") return thread.name || "Group";
  const other = (thread.members || []).find((m: any) => String(m.userId) !== String(meId));
  return other?.name || "Direct message";
}

/** "now", "3 min", "14:20", "12 Nov" — short enough for a list. */
export function shortTime(d?: string | Date | null) {
  if (!d) return "";
  const t = new Date(d);
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins} min`;
  const today = new Date();
  if (t.toDateString() === today.toDateString()) return t.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  return t.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
}
