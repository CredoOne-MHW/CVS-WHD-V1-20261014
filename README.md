# Wellness Hive · Lead Management System

Multi-tenant lead capture, qualification and conversion platform.
**Next.js 14 (App Router) + TypeScript UI · Express API · MongoDB · AWS S3 · one Vercel deployment.**

---

## 1. Quick start

```bash
npm install
cp .env.example .env.local      # fill in the values below
npm run dev                      # http://localhost:3000 → /login
```

| Variable | Purpose |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | Atlas connection. In Atlas → Network Access allow `0.0.0.0/0` (Vercel IPs are dynamic). |
| `JWT_SECRET` | Long random string (`openssl rand -hex 48`). |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | First Super Admin, created automatically on the first request if none exists. Remove the password from Vercel afterwards if you like — it is only read when no Super Admin exists. |
| `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_BASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Knowledge-base files for AI agents (stored under `companies/<id>/kb/…`). Keep the bucket private; `S3_PUBLIC_BASE_URL` is optional (CloudFront). |
| `APP_BASE_URL` *(optional)* | Public URL printed on connector cards. Defaults to the request host. |
| `CRON_SECRET` *(optional)* | Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. |
| `DATA_ENCRYPTION_KEY` *(optional)* | Key for AES-256-GCM encryption of webhook headers, connector secrets and LLM API keys. Falls back to `JWT_SECRET`. **Don't rotate without re-saving secrets.** |
| `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO` *(optional)* | Login/sidebar branding. Defaults to Wellness Hive and `/wellness-hive-logo.jpeg`. |

### Deploy to Vercel
1. Push to GitHub → Import in Vercel (framework auto-detects Next.js).
2. Add the env vars above (Production + Preview).
3. Deploy. `vercel.json` sets the `bom1` (Mumbai) region, a 60 s function limit for the API and two crons:
   - `/api/cron/retry` every 15 min — retries failed lead deliveries with exponential backoff (max 5 attempts).
   - `/api/cron/followups` daily 08:00 IST — sends the follow-up digest through any `followup_digest` webhook.
   *(Vercel Hobby only allows daily crons — on Hobby change the retry cron to daily or upgrade to Pro.)*

---

## 2. Architecture

```
src/app/            Next.js UI (client components)
  login/            single login for everyone — role decides the console
  sa/…              Super Admin console
  app/…             Company Admin console
  f/[key]           hosted QR / campaign form (public)
src/pages/api/[[...path]].ts   → mounts the Express app for every /api/* request
server/
  app.ts            Express app (JSON + raw body for HMAC, cookies, DB connect, routers)
  models/           Mongoose models (one file)
  middleware/       auth (JWT cookie, plan ∧ role permissions), activity logger
  routes/auth.ts    login, me, force-login (impersonation), change password
  routes/sa/        dashboard, companies, AI agents, plans (+ shared settings routers)
  routes/co/        dashboard, leads, integrations, users, Post, AI agents
  routes/shared.ts  WhatsApp webhooks, WhatsApp logs, activity logs, roles (used by both consoles)
  routes/public.ts  lead intake, Meta verify, hosted form info, crons
  lib/              intake engine, WhatsApp dispatcher, S3, file parsing, LLM client, crypto
shared/
  constants.ts      MODULE REGISTRY, statuses, lost reasons, connector types, events
  templating.ts     payload rendering / single-line / splitting (used by server AND the live card preview)
```

### Module registry → automatic grids
`shared/constants.ts › COMPANY_MODULES` is the single source of truth. Add an entry and it automatically appears in:
the Company sidebar, the **Plan** grid, both **Role Management** grids and server-side permission checks (`can("<key>", "read")`).
New modules start unchecked on every plan until a Super Admin grants them.

### Permissions
`effective = Plan grid ∧ Role grid`. Company owners get the full plan grid; other company users get their role clipped to the plan.
Every API route declares its module + action, so hiding a button is cosmetic — the server enforces it.

### Multi-tenancy
Every company query is filtered by `companyId` taken from the signed session, never from the request body. S3 keys are tenant-prefixed.

### Force Login
Super Admin → Company → **Force Login** issues a 2-hour company-owner session flagged `impersonatedBy`. The SA session is parked in a second cookie; the yellow banner's **Return to Super Admin** restores it. Both sides log the event, and every action taken while impersonating shows "via <SA email>" in Activity Logs.

---

## 3. Leads

* **De-duplication:** a new lead with the same phone / WhatsApp / email in the same company is merged instead of duplicated. The new touch is appended to `attribution[]` (first touch is preserved), empty fields are filled, comments are appended with date + source.
* **Attribution kept per touch:** source, connector, campaign, medium, referral, UTM params (+gclid/fbclid), timestamp, raw payload. Consent (WhatsApp/email, text, time, IP) is stored when supplied.
* **Statuses:** New → Contact Attempted → Interested / Not Interested → Requirement Identified → Price / Package Shared → Appointment Booked → Converted / Service Initiated · Follow-ups needed · Lost / Not Converted.
* **Lost** requires a reason (modal). *Other* requires a description. Enforced on the server too.
* **Timeline:** every status change and remark is kept with who/when.
* **Score (0-100):** contactability, detail, consent, paid/referral source and stage — used for sorting.
* **Delete** is two-step: OTP sent on WhatsApp (event `delete_otp`) to the signed-in admin's number (user WhatsApp, else company WhatsApp) → 6-digit code, 5-minute expiry, 5 attempts → soft delete.
* **Import:** `.xlsx/.xls/.csv`, up to 5,000 rows / 4 MB. Templates at `/api/co/leads/template.xlsx|csv`. Column names are matched flexibly (Name, Full Name, Mobile, WhatsApp No, E-mail…).

---

## 4. Connector intake (all channels)

`POST /api/intake/<connector-key>`

| Auth (any one) | |
|---|---|
| `x-api-key: <secret>` | server-to-server |
| `x-signature: sha256=<HMAC-SHA256(raw body, secret)>` | signed webhooks |
| `?key=<secret>` | tools that can't set headers (email parse, telephony) |
| `google_key` in body | Google Ads lead forms |
| Browser `Origin` + honeypot `_hp` empty | website / QR forms only |

**Idempotency:** `Idempotency-Key` header → else provider id (Meta `leadgen_id`, WhatsApp `wamid`, Google `lead_id`, `CallSid`, `id`) → else SHA-256 of the body. Unique index `(connector, key)` guarantees a delivery is processed once. Replays return `{ duplicate: true }`.

**Retries:** a delivery that fails (e.g. Meta Graph timeout) is stored as `failed` with backoff `2^attempt` minutes and re-processed by `/api/cron/retry`; after 5 attempts it becomes `dead`. Integration → connector → **Deliveries** shows every payload with a manual **Retry**. Meta and WhatsApp always get HTTP 200 so they don't hammer you while we retry internally.

**Formats understood out of the box:** flat JSON / form-urlencoded, Meta Lead Ads webhook (`entry[].changes[].value`, fetches `field_data` from Graph using the Page token stored as secret), WhatsApp Cloud API inbound messages, Google Ads `user_column_data`, SendGrid/Mailgun/Postmark inbound email, Exotel/Knowlarity-style call webhooks. Per-connector **Field mapping** overrides any key (dot paths allowed).

Meta / WhatsApp verification: `GET /api/intake/<key>?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`.

---

## 5. WhatsApp webhooks

Each webhook = endpoint + method + headers (encrypted) + payload template, bound to an **event**.

* **System events (company):** `lead_reminder`, `lead_created`, `lead_status_changed`, `followup_digest`, `delete_otp`, `broadcast`. Companies can add **custom event types**.
* **System events (Super Admin):** `company_reminder`, `company_created`, `company_deactivated`, `credits_low`.
* **Placeholders:** `{{event}} {{template}} {{to}} {{phone}} {{name}} {{company}} {{message}} {{message_raw}} {{params}} {{params.<key>}}`. String placeholders are JSON-escaped; `{{params}}` (unquoted) inserts an object.
* **Single-line mode** collapses newlines/tabs with your separator (WhatsApp template variables reject `\n`). `{{message_raw}}` keeps the original.
* **Max characters** splits long messages at paragraph → sentence boundaries, sends parts in order and tags `(Part 1/3)`.
* **Retries:** 5xx / network errors retry twice (0.5 s, 1.5 s). 4xx is final.
* Every part is written to **WhatsApp Logs** with request, response, HTTP status and attempts; **Resend** replays the exact body.
* The card's **Preview of the payload** uses the same `shared/templating.ts` code the server uses, so what you see is what is sent.

**Post** tab: choose existing leads (filter by status/search) or upload a sheet (optionally saving contacts as leads), choose a webhook, write a message with `{{name}}`, send. Max 300 recipients per run (serverless time limit); 5 parallel sends.

---

## 6. AI agents

* **Super Admin → AI Agents:** model name, provider (Anthropic, OpenAI, Gemini, any OpenAI-compatible URL), LLM version, API key (encrypted), token weights (in/out), actual rate and company rate (₹ per 1k weighted tokens), default credits. List shows margin and allocated/used credits.
* **Super Admin → Company → ⋯ → AI Agents & credits:** allocate credits per model per company.
* **Company → Settings → AI Agent:** pick an allocated model, name, purpose, system prompt, reusable prompts, knowledge-base files (csv, xlsx, zip, txt, json, docx, pdf). Files go to S3; extracted text is stored alongside and injected (up to ~60k chars) as context. **Test** opens a chat; every call meters `weighted = in×w_in + out×w_out`, `credits = weighted/1000`, deducts from the wallet, and blocks at zero.

---

## 7. Security notes

* Passwords: bcrypt (12 rounds). Sessions: httpOnly, SameSite=Lax JWT cookie, 12 h; `tokenVersion` revokes sessions on password change / deactivation.
* Login throttling: 5 failures → 10-minute lock (per instance — add a Vercel Firewall rate-limit rule for /api/auth/login and /api/intake/* in production).
* Secrets at rest: AES-256-GCM. Connector secret is shown once on creation / rotation.
* Activity log payloads redact anything named password / secret / token / otp / apiKey / authorization.
* All inputs validated with zod; regex search input is escaped.
* Upload limit 4 MB per file (Vercel request body cap is 4.5 MB). For larger KB files switch to presigned S3 uploads.

---

## 8. Assumptions I made (change freely)

1. **Express inside Next.js.** The Express app is mounted at `/api/*` through a Next.js API route so the product ships as one Vercel project, one domain, no CORS.
2. **Role Management (Super Admin)** stores *role templates per plan*; **Role Management (Company)** lets a company create roles inside its plan and assign them to users (Users tab).
3. **Plans** are documents; the four defaults (Trial, Standard, Pro, Enterprise) are seeded on first boot and more can be created.
4. **Deleting a company** is a soft delete: logins are removed, data is retained for audit.
5. **Delete OTP** needs an active webhook on the *Delete OTP* event and a WhatsApp number on the admin's user (falls back to the company WhatsApp).
6. The Super Admin "AI Agents" item under *Company* is implemented as per-company credit allocation (⋯ menu on each company row).
