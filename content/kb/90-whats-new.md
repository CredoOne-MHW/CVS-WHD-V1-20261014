---
title: What’s new
slug: whats-new
order: 90
summary: Changes in recent deploys.
---
## November 2026 — v1.7.0 — one place for every app

- **Mobile App Release** is a new Super Admin screen: every company's app in one place, with what is building now, what finished, what failed, and how many phones are on the newest version.
- **Build for one company, or for all of them at once.** A company that has no app yet is left out of the bulk build on purpose — its first one is always started by hand.
- **A push rebuilds everybody.** Switch on *Automatic rebuilds*, and new app code rebuilds the app of every company that wants it, each with its own name, icon and colours. Phones get it as an ordinary update.
- **Updates now install over the old app.** The platform keeps one permanent signing key per company, so Android stops refusing updates. A phone holding an older app needs one uninstall-and-reinstall; the screen tells you when that applies, and only while it does.
- The **Mobile App tab** on a company used to spin for ever if anything went wrong. It now says what went wrong, and has a Try again button.
- The **Build screen** shows what is actually live — one card per platform with the version, size, file and a download — before the list of every build.

## November 2026 — v1.6.0 — chat, notices and notifications

- **Chats** is new, on the web and in your app: message anyone in your company one-to-one, or talk in a group your administrator sets up. A message appears for everyone the moment it is sent.
- Members are shown by **name and role only** — nobody's phone number or e-mail address is visible in chat, ever.
- A **group** has a name and the people added to it. You can see who is in it, and leave one you no longer need.
- **Notices**: if your role allows it, post a line that scrolls across the top of everyone's screen — on the web and on their phones — until you stop it. Tap it on the phone to stop it moving while you read.
- **Notifications on your phone** for a new message, a group you are added to, and a notice sent as a push. Your phone registers itself when you sign in, and is forgotten when you sign out, so a shared phone never keeps your messages.
- Unread counts, read receipts and "typing…" everywhere.
- If your administrator has not yet connected the messaging service, everything still works — messages refresh every few seconds instead of instantly, and the Chats screen tells you which it is doing.
- Already have the app installed? Ask your administrator to build it again, so the new Chats screen is in it.

## November 2026 — v1.5.0 — your own mobile app

- Your company now has its **own Android app** (iOS once your administrator sets up Apple signing) — same name, icon and colours as your platform, and it signs in to your company only.
- Download it from **Settings → Mobile App**. On an Android phone, allow "Install unknown apps" for your browser the first time; later versions install over it.
- Sign in with the same e-mail and password you use here. You see exactly what your role allows.
- At the first sign-in the app shows your **data-protection notice**. It has to be read to the end before it can be accepted, and the acceptance appears under DPDP → Acceptance status marked as coming from the app.
- The menu has **Dashboard**, **Chats** and **Profile**, where you sign out and can see the version and build number.

## November 2026 — v1.4.0 — DPDP consent and your own website

**DPDP consent** (Settings → DPDP, and under Logs → DPDP)

- Your **consent notice**: write it here, or upload your own PDF or Word file. You start from the platform's notice with your company's name, address and grievance officer already filled in — edit it and it becomes yours.
- Share the **consent link** (`your-address/consent`) from your website, your apps and your CRM. The person must scroll the notice to the end before **Accept** turns on, and there is no way past it other than accepting or closing the window.
- Every acceptance is kept as evidence: who, when, which version, how long they had it open, how far they scrolled, which purposes they ticked, and from where. **Acceptance status** lists them and downloads as Excel.
- **Cookie consent** records what each visitor chose in the banner on your website.
- Someone can ask you to withdraw their consent: use the ✕ on their row. The record stays and is marked withdrawn, as the Act requires.

**Your own website** (set up by your administrator)

- A small site with a hero, your story, what you do, featured items, offers, testimonials, gallery, FAQ, contact details and an enquiry form — switch on only the sections you want.
- **Every enquiry on it becomes a lead**, tagged with the campaign set on the Enquiry section, and the person's consent is recorded with it.

## November 2026 — v1.3.0 — the company workspace (Super Admin)

- A company now **opens as its own page** — click its name in Super Admin → Company. The header carries Force login, Login page, Suspend and Save changes; everything about the company sits behind its tabs.
- **Overview** shows the company at a glance: leads, conversions, clients, outstanding, users, live channels, deliveries needing attention, its addresses and its latest leads.
- **Company details**, **Subscription** (plan, frequency, amount, due date, discount in ₹ or %, gross) and **Login credentials** (with Show and Generate for the password).
- **Branding & domain** adds login page colours and per-app themes; **White label** holds the platform-branding switch, support link, e-mail sender, app names, look & feel and custom CSS.
- **Role access** lets Super Admin set the company's own roles, within the plan and the Modules tab.
- **Mobile Modules** picks what the company's mobile apps may show.
- **Notifications** sets each alert per device with its sound, including your own uploaded sounds.
- **Cron Jobs** shows every background job with its schedule, last and next run, an on/off switch and Run now.
- **Retention Policy** sets how long each log is kept, with a nightly housekeeping job and an Apply button.
- Fixed: after a new deployment, clicking one menu then another could leave the screen where it was until a manual refresh. A click that does not land now takes you there directly.

## November 2026 — v1.2.0 — deleting a client

- **Client → Clients** has a **Delete** action next to View journey, verified by a one-time code on WhatsApp — the same gate used for leads.
  - Before any code is sent, you are shown exactly what goes with the client: sales order lines, unpaid invoices and their amount, pay-ins received and their amount, and tickets (with the open count). You can record a reason.
  - The code goes to your own WhatsApp number (your company's number if your profile has none) through the existing **Delete OTP** webhook event. It is valid for 5 minutes.
  - The client then leaves Clients, the Service Board, Subscription Management and its support page, together with its sales orders, invoices, pay-ins and tickets — so no stray rows are left behind.
- **Nothing is erased.** A complete copy — profile, journey, sales orders, invoices, pay-ins and tickets — is archived in your company's own database, with who deleted it, when and why, and the same is written to the activity log. Payment files in S3 are left untouched. Ask your administrator if a deleted client has to be brought back.
- **Delete is a permission, and nobody gets it automatically.** In Role Management, the **Clients** sub-module now has a Delete box. Unlike the other boxes it does not follow the Client module — a role can delete a client only once that box is ticked, so no existing role gained the ability on its own. The company owner is unaffected, and Super Admin can still restrict or pause it per company under Company → Modules.

## November 2026 — v1.1.0

- Sales Order shows one row per client, expanding to its services, with **Convert to Invoice** (Discount as a fixed amount or a percentage, and Gross).
- **Outstanding** counts only what is due up to today; later months show as **Upcoming**.
- **Company Name** on leads and clients, in the list, in search, in import and export, and in the sample file.
- **Integration → Needs attention** lists any delivery that could not be saved as a lead, with Retry and Retry all.
- WhatsApp Logs rebuilt, a more compact interface throughout, and release notes at `/release`.

## October 2026 — sign-in connectors, Platform Apps, company modules

- **Facebook Lead Ads, Instagram Lead Ads, LinkedIn Lead Gen Forms and Google Sheets / Forms** are now sign-in connectors:
  - Companies click Connect, give consent (DPDP Act), sign in on the platform and pick their Pages, accounts or sheet.
  - No App IDs, secrets or webhook setup for companies.
  - The old Facebook & Instagram App-ID setup is retired; existing connectors keep working.
- **Super Admin → Settings → Platform Apps**:
  - Credovation’s Meta, LinkedIn and Google apps, with a **Test** button that also sets the Meta lead webhook.
  - An editable **Privacy contact** that appears on consent notices and on the new `/privacy`, `/terms` and `/data-deletion` pages.
- **Website / Landing Page Form** and **WhatsApp Business Platform** are now REST API / webhook connectors, authenticated with the API key (older connectors keep working until switched).
- **Company → Modules** tab: pause or restrict any module or sub-module per company, on top of the plan.
- **Knowledge Base** tabs are written as Markdown files in the code (`content/kb`), so they update with every deploy.
  - Each article has **Download .md** and **Copy Markdown**, and **Full guide (.md)** gives every article in one file.
  - The Markdown is rebuilt on every deploy, with that deployment’s addresses filled in.

## October 2026 — earlier

- Role Management sub-modules.
- Client billing renamed to Sales Order, Invoice and Pay-In.
- A pop-up with S3 attachments when an invoice is marked Paid.
- An “S3 storage required” switch per company.
