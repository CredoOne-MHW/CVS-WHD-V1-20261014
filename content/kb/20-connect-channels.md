---
title: Connecting channels
slug: connect-channels
order: 20
summary: What a company does to connect Facebook, Instagram, LinkedIn or Google Sheets — and what to tell them.
---
## For company users (2 minutes)

1. **Integration** → the channel card → **Connect with Facebook / LinkedIn / Google**.
2. Read the **consent notice (DPDP Act)**. Click **I agree to all & connect**, or tick each purpose and click **Continue**. Nothing is pre-ticked: consent must be a clear action. Who agreed, when, from which IP and which notice version are all recorded.
3. A secure window opens on **facebook.com / linkedin.com / accounts.google.com**. Sign in with your **own** ID and password. CredoOne never sees them.
4. On the platform’s screen, **keep every permission box ticked**, and select your Pages (Facebook) or Business.
5. Back in CredoOne, pick what to connect:
   - **Facebook:** Pages
   - **Instagram:** Instagram professional accounts
   - **LinkedIn:** ad accounts and Pages
   - **Google:** paste the sheet link and pick the tab
6. Click **Connect**. Recent leads are fetched straight away, then:
   - **Facebook / Instagram:** new leads arrive in seconds (Page lead webhook), with a check every 15 minutes as a safety net.
   - **LinkedIn:** instant when LinkedIn notifications are on, otherwise every 15 minutes.
   - **Google Sheets:** new rows every 15 minutes. Each row is read once.

## Facebook and Instagram are separate connectors

They sign in the same way (Instagram lead ads are delivered through Facebook), but each has its own card, its own Pages and accounts, and its own stats.

When both are connected for the same Page:
- Facebook-placement leads go to **Facebook Lead Ads**.
- Instagram-placement leads go to **Instagram Lead Ads**.

When only one of them is connected, it receives both placements, so no lead is lost.

## Disconnect = withdraw consent

**Disconnect** on the connector:
- unsubscribes the Pages
- deletes the stored login immediately
- stops new leads

Leads already received stay. **Reconnect** at any time.

## Status you may see

| Status | Meaning | What to do |
|---|---|---|
| Not enabled yet | The Super Admin hasn’t saved that platform in Platform Apps | Super Admin → Platform Apps |
| Connected | Leads are flowing | — |
| Reconnect needed / Login expired | The platform login expired or was revoked (LinkedIn: about 60 days) | Open the connector → **Reconnect** |
| Disconnected | Consent was withdrawn | **Reconnect**, or delete the connector |
| “Real-time off … fetched every 15 minutes” on a Page | The Page couldn’t be subscribed to the lead webhook | Check you have the Advertise task on the Page; allow CredoOne in Meta Business Suite → Settings → Integrations → **Leads access** |
