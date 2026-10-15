# CredoOne · Lead Management System (white-label)

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

---

## 9. White label (per-company branding & domains)

| Address | Shows |
|---|---|
| `https://mhw.credovation.tech` (APP_BASE_DOMAIN), any `*.vercel.app`, localhost | CredoOne platform login → Super Admin |
| `https://<short-name>.mhw.credovation.tech` | That company's branded login → Company Admin |
| `https://leads.theircompany.com` (company's own domain) | Same company login, on their domain |

* **Super Admin → Company → Create → Branding & domain:** short name (sub-domain), own domain, logo, side banner, favicon, theme colour, accent colour, login layout (split / banner / centered), display name, tagline, headline, sub-headline, support email/phone, footer. Live preview in the form.
* **Theme engine** (`shared/theme.ts`): one hex → 50–950 scale as CSS variables; Tailwind's `hive-*`/`honey-*` read them, so the company console (sidebar, buttons, charts, badges) and login all follow the company colour. Colours that fail 4.5:1 with white text are darkened automatically.
* **Assets** are uploaded to S3 under `companies/<id>/branding/` and served via `/api/public/brand-asset/:id/:kind` (bucket stays private, cached 24 h, cache-busted on change).
* **DNS records** appear automatically after saving (and via the 🌐 icon): CNAME for a sub-domain, A for a root domain, `_vercel` TXT when ownership must be proven, optional CAA. **Check DNS now** does live lookups through 1.1.1.1 / 8.8.8.8.
* **Vercel API (optional):** with `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` (+ `VERCEL_TEAM_ID`) the app adds the company's domain to the project, shows Vercel's project-specific CNAME / IP and TXT challenge, and triggers verification. Without it, add the domain in Vercel › Settings › Domains and the records fall back to `cname.vercel-dns.com` / `76.76.21.21`.
* **Login isolation:** on a company address only that company's users can sign in; Super Admins sign in only on the platform address. Sessions are host-only cookies.
* **Knowledgebase › White Label** has the full step-by-step guide (platform wildcard setup via NS delegation of `mhw` at `credovation.tech`, per-company records, provider tips, troubleshooting). **Company domains** tab lists every company's URLs and live status.

### One-time setup for mhw.credovation.tech
1. Vercel env: `APP_BASE_DOMAIN=mhw.credovation.tech` (+ optional Vercel API vars) → redeploy.
2. Vercel › Settings › Domains: add `mhw.credovation.tech` and `*.mhw.credovation.tech` (or use the button in Knowledgebase).
3. At credovation.tech's DNS provider: remove existing records for `mhw`, add `NS mhw → ns1.vercel-dns.com` and `NS mhw → ns2.vercel-dns.com` (wildcard certificates need Vercel DNS for that sub-zone).
4. Open `https://mhw.credovation.tech/login` → CredoOne login.

### Troubleshooting the login address
Open `https://<address>/api/health` — it shows how the address is resolved (`platformHost`, `baseDomain`) and whether MongoDB/JWT are configured. If `baseDomain` is `null`, set `APP_BASE_DOMAIN` in Vercel and redeploy (quotes, `https://` and trailing slashes are tolerated). Without it, any address that matches no company shows the platform login.


---

## 10. October 2026 update

### Dev and prod side by side
`APP_BASE_DOMAIN` is resolved **per request**. Set it per Vercel environment (Production → `mhw.credovation.tech`, Preview → `dev-mhw.credovation.tech`) or put both in one comma-separated value. If an address isn't listed, the app auto-detects the base from the address, so a deployment never shows a dead end. `/api/health` reports the resolved base, its source and the Vercel environment.

### Unique DNS per company
Every company gets values nobody else has:
| Type | Host | Value |
|---|---|---|
| CNAME | `lead` | `<shortname>.mhw.credovation.tech` (its own target, served by the wildcard) |
| TXT | `_credoone-verify.lead` | `credoone-verify=<32 random hex>` (its own token) |
| TXT | `_vercel` | only when Vercel asks for an ownership challenge |
The Knowledgebase guide renders its example with the same generator (`server/lib/domains.ts › recordsFor`), so guide and dialog always match. "Check DNS now" verifies ownership via the TXT token.

### S3 layout
`<Company-Name>/logo/…`, `<Company-Name>/banner/…`, `<Company-Name>/brain/…` (knowledge base; extracted text under `brain/_extracted/`). The folder is fixed when the company is created (renaming the company doesn't move files). Objects are SSE-encrypted; the bucket stays private.

### AI
* **Providers** are a collection managed from the provider dropdown (`+ Add provider…`, `Manage providers…`). Seeded: OpenRouter, Anthropic, OpenAI, Google Gemini, Groq, Mistral, DeepSeek. Any OpenAI-compatible gateway can be added. The ↻ button loads the provider's model list (OpenRouter's is public and shows USD price per 1M tokens).
* **Floating assistant:** tick "Use as the company assistant" on one company agent → a button with the company logo appears on every company screen. It is **read-only by construction**: its only data tool is the report engine (whitelisted fields, company filter, the user's own module permissions).
* **Credits:** every call is metered. When a model's credits run out, the company admin gets a WhatsApp alert (`ai_credits_exhausted` event) once; topping up re-arms it.

### Reports
* **Super Admin › Report** and **Company › Report › DIY**: summaries (group by any field or per day/week/month/year, count/sum/avg/max) or detailed lists, filters, date range, Excel/CSV export (UTF-8 BOM so ₹ and Bengali open correctly in Excel).
* **Company › Report › Agentic**: pick an agent, describe the report; the AI writes a spec, the engine runs it read-only, the AI adds 2–4 insights. Export the same way.

### Performance & scale
* **Sessions are stateless** (signed, httpOnly cookie) — concurrent *sessions* cost nothing on the server; capacity is about concurrent *requests*.
* Auth context (user, company, plan, role) is cached 30–120 s instead of 3–4 DB reads per call; tenant, connector, provider and knowledge-base lookups are cached too. Add **Upstash Redis** to share the cache and rate limits across instances.
* Mongo pool is small per instance (`MONGODB_POOL_SIZE`, default 5) with zlib compression; size the Atlas tier for (peak instances × pool).
* Wildcard icon import removed: console first-load JS went from ~264 kB to ~100–120 kB. Client GET requests are de-duplicated with a 10 s micro-cache.
* Branding responses are CDN-cacheable (`s-maxage`); static assets immutable.
* For a 10-lakh-user launch: enable Upstash, Vercel Pro/Enterprise with Fluid compute, a dedicated Atlas cluster, and run `tests/load/k6-smoke.js` with rising stages first. No code can promise a number without that load test on your real plans.

### Security
CSP, HSTS (preload), frame-deny, Permissions-Policy, COOP · same-origin check on every cookie-authenticated write (CSRF) · Mongo operator stripping + simple query parser (NoSQL injection) · shared brute-force limits on login and intake · `no-store` on all API responses · consoles `noindex` + private cache.

### SEO / AEO
Per-address title, description, canonical, Open Graph and JSON-LD (Organization for company logins, SoftwareApplication for the platform) on `/login` · per-host `robots.txt` and `sitemap.xml` · `/llms.txt` for answer engines.

### 10.1 Fix — company modules visible on every plan (Oct 2026)
- Report, Role Management, Activity Logs and AI Agent are now ticked on **every** plan (Trial and Standard included). Existing databases get a one-time migration (`meta.plans_v2`) on the first request after deploy; Super Admin can still narrow any plan in **Plan**.
- New modules added later are ticked on all plans by default.
- AI Agent: **Create** always works; the AI model is optional until Super Admin allocates one (Company › ⋯ › AI Agents & credits). The floating assistant button always shows on the company side, with a set-up card until it's ready.
- S3 base folder is the company name exactly as typed (`WELLNESSHIVE DIAGNOSTICA LLP/logo`, `/banner`, `/brain`). Existing files (including the earlier hyphenated folders) are moved in the background once (`meta.s3_layout_v2`), and again for a company on its next upload. Manual: `POST /api/sa/companies/<id|all>/s3-relayout`.

### 10.2 AI models for every company + usage history (Oct 2026)
- Every **active** model in Super Admin › AI Agents is offered to every company automatically. The company's credit wallet for a model opens with that model's **Credits (default)** the first time it's listed or used; Super Admin can still top up per company (Company › ⋯ › AI Agents & credits). Deactivate a model to withdraw it.
- Create / Edit AI agent: picking a model shows its charges — ₹ per credit, token weights, an estimated cost of a typical reply, and credits left.
- AI Agent list › Action › **Usage**: credits left, cost incurred, credits used, calls, tokens, a 30-day trend, a breakdown by use (agent chat / floating assistant / agentic report) and the full call history (`GET /api/co/ai-agents/:id/usage`).

### 10.3 Fixes (Oct 2026)
- Floating assistant: readiness now checks the agent's model correctly (it was reporting "no AI model yet" even when one was set).
- Test chat / assistant: replies from reasoning models (e.g. Kimi K2.5 via OpenRouter) that come back as an array of parts or with empty content no longer crash the page; text is normalised server- and client-side (`shared/text.ts`), and min output tokens raised to 1,500.
- Error boundaries for `/app` and `/sa` so a screen error shows "Try again" instead of a blank page.
- Browser-tab icon: company favicon → logo → a monogram in the theme colour (never the generic globe), on login and inside the console. The assistant button uses the same monogram when no logo is uploaded.

### 10.4 AI chat hardening + client error capture (Oct 2026)
Verified end-to-end (production build, real CSP, FerretDB as Mongo, a mock OpenRouter returning Kimi-style replies): Test chat and the floating assistant render every reply shape — plain, null/reasoning-only, part arrays, `<think>` blocks, JSON with object `text`, missing text, provider error bodies — without crashing.
- **Provider replies**: `<think>` stripped; OpenRouter "200 with error body" and non-JSON responses become clear errors (`AI provider error 429: …`) instead of `[object Object]`/empty replies; the assistant always returns a plain string.
- **Time budget**: provider calls ≤ 50 s and the assistant's multi-step loop stays inside Vercel's 60 s cap; timeouts show "The AI model took too long…".
- **Never a blank page**: error boundaries around the floating assistant, its message list and the Test chat; `/app`, `/sa` and `global-error` pages show the actual error message with Try again / Reload.
- **Error reporting**: any screen error is posted to `POST /api/client-error` → Activity Logs (action "Screen error", module `client`, Error status, payload with stack + browser) and Vercel function logs.
- **Stale deployments**: a tab left open across a deploy that fails to load code ("ChunkLoadError") reloads itself once.
- **CSRF check** compares Origin by hostname (port-safe).
- **Browser extensions**: chat inputs opt out of Grammarly/Editor/password-manager overlays; chat areas are `translate="no"`; a small DOM guard in the root layout tolerates nodes moved by extensions.

### 10.5 Root cause of the AI chat crash ("n is not a function")
Newer Chrome (154+) returns a **Promise** from `Element.scrollIntoView()`. The Test chat and the floating assistant auto-scrolled with
`useEffect(() => end.current?.scrollIntoView(...))` — an expression body, so the effect *returned* that Promise and React later called it as the
cleanup function → `TypeError: n is not a function` inside react-dom on the next message. Reproduced exactly (same chunk/offset) by giving the
test browser Chrome-154 scroll behaviour; fixed by using block-bodied effects everywhere (5 places). `npm run build` now runs
`scripts/check-effects.mjs` first and fails if any `useEffect`/`useLayoutEffect` uses an expression body.

## 11. AI model allocation & Subscription Management (Oct 2026)

### Super Admin › AI Agents › Allocation
- Sub-tabs **Models | Allocation**. **Allocate** (top right): Company (multi-select, searchable), Models (multi-select, searchable),
  Allocation start date, Renewal frequency (Weekly / Monthly / Quarterly / Half Yearly), **Renewal date** (auto-calculated),
  optional credits per cycle (defaults to each model's credits). Every company × model pair is upserted in one bulk write.
- The company's AI Agent screen shows **only allocated models**. On the renewal date used credits reset and the next date is set —
  by the daily job, and lazily on first use so a company never waits for the job. Edit / remove per row (usage history is kept).
- Existing wallets were migrated once (`meta.alloc_v3`) as monthly allocations, so nothing a company already uses disappears.

### Super Admin › Settings › Subscription Management
- **Plan**: Plan (from the Plan module), amount, frequency, reminder notification (1 / 3 / 7 days prior, multi-select),
  notify via company web app and/or WhatsApp, WhatsApp webhook (pick one, or default to webhooks on the new events
  `subscription_reminder`, `subscription_overdue`, `subscription_expired` — selectable when creating a WhatsApp webhook).
- **Allocation**: Company (single, searchable), subscription plan, start date, discount (₹ flat or %). One active subscription per company;
  billing cycles are created automatically (back-dated starts create the past cycles too).
- **Status**: sub-tabs Active / Over Dues / Expired with counts; filters by expiry date range and company name. Columns: company, start,
  expiry, total, system due, AI agent due (live "so far" while the cycle is open, snapshotted when it closes), discount, payment status
  (Paid / Unpaid / Over Due / Expired — editable), actions **Usage** (AI spend by model + daily, allocations) and **Reminder** (pick webhook, edit message, send).
- Rules: new cycles are Unpaid; past the expiry (due) date → **Over Due**; 30 days after → **Expired**. Total = system − discount + AI usage.

### Daily job — 02:00 IST (`/api/cron/billing`, Vercel cron `30 20 * * *` UTC)
Renews AI allocations, creates the next cycles, applies Over Due / Expired, sends 1/3/7-day reminders and Over Due / Expired WhatsApps —
each exactly once per cycle (atomic claims; safe to re-run). Statuses also self-correct on read (at most every 5 min), so screens are right
even before the job runs. Without `CRON_SECRET`, cron URLs only accept Vercel's scheduler on Vercel.

### Company › Settings › Subscription
**Current Plan** (plan, cycle progress, amount due with system / AI / discount breakdown, reminder settings, AI model credits & renewal
dates) and **History** (every cycle with payment status, filterable). Always visible to the company (read-only), whatever the plan grid says.
A top-middle **flash alert** shows when a payment is Over Due / Expired (red, pulsing) or due soon (amber, when the plan enables
web-app reminders); one small cached request per page load + every 10 minutes.

### Performance & security notes
Indexes: cycles `{subscriptionId, periodStart}` (unique → idempotent), `{companyId, periodStart}`, `{status, periodEnd}`; AI usage
`{companyId, createdAt}`, `{companyAgentId, createdAt}`; allocations `{renewalDate}`. Lists are paginated (25), lean and projected;
dropdown data and counters are cached (30–60 s) and invalidated on every change. All inputs are zod-validated (ids, enums, bounded amounts,
discount ≤ amount / ≤ 100 %), company routes are tenant-scoped, Super Admin routes need the `subscriptions` permission.
