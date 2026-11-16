---
title: Chats, notices and push
slug: chats-notices
order: 70
summary: How one-to-one and group chat works, how a notice reaches every screen, and the one setting that makes it all instant.
---
## What this is

**Chats** is messaging inside one company — one-to-one and groups — on the web and in the company's own app. Alongside it, **Notices** puts a line of scrolling text across the top of every screen, and **push notifications** reach a phone that is not open.

A member is known to other members by **name and role only**. A phone number or an e-mail address is never part of anything chat sends, so a group cannot be used to collect contact details. That is in the code, not a setting.

## Switching it on

Chats is a module, so it starts switched off — like every new module.

1. **Super Admin → Plans**: tick **Chats** on each plan that should have it. A module absent from a plan grid has no permissions at all.
2. **Super Admin → Company → Modules**: confirm it is not paused for that company.
3. **Company → Settings → Role Management**: give the roles that should administer chat the two sub-modules:
   - **Groups** — create and change groups.
   - **Notices** — post and stop the scrolling notice.
   Everyone else needs only *Chats › read* and *create*, which is what lets them message and be messaged.
4. **Mobile Modules** (Super Admin → Company → Mobile Modules): tick **Chats** for it to appear in the app.
5. **Rebuild the company's app** from **Mobile App → Build** if the installed app was built before v1.6.0. The app reads permissions and modules at start-up, so those need no rebuild — only the new screen does.

## Making it instant

Chat works with nothing configured: every screen asks the platform every few seconds, and the header says "Messages refresh every few seconds."

To make it instant, give the platform one real-time service. This server cannot hold a WebSocket open — it runs on Vercel — so a managed service holds the connection and the platform publishes to it.

**Pusher** (the default, and the one with a Mumbai cluster):

1. Create a free **Sandbox** app at pusher.com → Channels. Choose cluster **ap2 (Mumbai)** — the nearest to India, which is what keeps a message to a few tens of milliseconds.
2. Copy its four values into the environment:

```
REALTIME_PROVIDER=pusher
PUSHER_APP_ID=…
PUSHER_KEY=…
PUSHER_SECRET=…
PUSHER_CLUSTER=ap2
```

3. Redeploy. The header now says "Messages arrive the moment they are sent."

**Ably** instead, if you prefer it: `REALTIME_PROVIDER=ably` and `ABLY_API_KEY=…`. Nothing else in the platform changes — the whole difference is in one file (`server/lib/realtime.ts`).

The secret never reaches a browser or a phone. A client asks the platform to sign each channel it wants to listen on, and the platform signs only that person's own channels and the conversations they are actually in.

## Push notifications

Push needs **no key on the platform**. Each company's app is built with Expo, and Expo's push service holds the Google (FCM) and Apple (APNs) credentials created with the app.

- A phone registers itself when someone signs in, and is forgotten at sign-out — so a shared phone stops receiving the previous person's messages.
- A token the device no longer holds is deleted the first time Expo says so. Other failures are counted, and a phone that fails five times is left alone.
- A push is a courtesy, never the delivery: the message is already saved before the push is attempted. A phone that is off simply shows it later.

## Notices

**Chats → Notices → New notice.** Up to 300 characters, in one of three tones (info, warning, success), optionally also sent as a push, with an optional stop time. It appears straight away on every screen, web and app.

- A person can hide a notice on their own device; the next notice still shows.
- On the phone, tapping the bar stops the scrolling so a long notice can be read.
- **Stop** takes it down everywhere at once. The row stays in the list, so there is a record of what was said and when.

## What is kept, and for how long

**Super Admin → Company → Retention Policy** has two rows for chat:

| Row | Default | Notes |
| --- | --- | --- |
| Chat messages | Keep for ever | A conversation is a record, not a log. Choose a period only if you have a reason to. |
| Dormant phones | 180 days | Measured from when the app was **last opened**, not when the phone was registered, so an active phone is never unregistered. |

Creating or changing a group, and posting or stopping a notice, are written to **Activity Logs** like every other action.

## If something looks wrong

- **No Chats menu.** The module is not ticked on that company's plan, or the role has no *Chats › read*.
- **Messages only arrive after a few seconds.** No real-time service is configured, or its keys are wrong. The chats header says which of the two is happening.
- **No notifications on the phone.** Notification permission was declined on that phone (iOS asks once), the app is older than v1.6.0, or the phone has not been opened since the app was reinstalled. Signing out and in registers it again.
- **Someone cannot be messaged.** They are inactive, or they belong to a different company. Chat never crosses companies: every channel name carries the company, and the platform refuses to sign a channel from another one.
