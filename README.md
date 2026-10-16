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

## 12. One database per company, connector guides, marketplaces & Google Ads, MCP, AI endpoints (Oct 2026)

### One MongoDB database per company
- Creating a company creates a database named exactly as the **company code** (e.g. `WHD`) with all company collections and indexes.
  Codes must be valid database names (letters, numbers, `-`, `_`; ≤ 38 chars; not `admin`/`local`/`config`/the platform DB) and can
  never be reused — not even from a deleted company — so a new company can never inherit old data.
- **Company database**: leads, connectors, intake events, OTPs, AI agents, AI usage, AI endpoints, company webhooks,
  WhatsApp logs, activity logs, roles, event types. **Platform (MONGODB_DB)**: users/logins, companies, plans, AI models, allocations,
  subscriptions, Super Admin webhooks/logs, and two key registries (connector key → company DB, endpoint key hash → company DB).
- How it works: every request is bound to its company database right after authentication (`lib/context.ts`); company models resolve
  to that database on each call (`tm()` in `models/index.ts`). One connection pool serves all databases (`useDb` + `useCache`) — no extra
  connections, no extra latency. Super Admin views that span companies (dashboard, reports, activity logs) fan out over company databases
  with bounded concurrency and are cached.
- Existing companies are moved automatically (background on deploy + on first use; copy → verify → delete; resumable) and a 15-minute
  sweep moves any record written to the old location during the switch. Manual trigger: `POST /api/sa/companies/migrate-databases`.
- **MongoDB Atlas**: the database user needs the built-in role *readWriteAnyDatabase*. Free/shared tiers cap databases and collections
  (≈13 collections per company) — use a dedicated cluster (M10+) for many companies.

### AI reads only its own company database
- Each AI allocation stores `dbName` = the company's own database (shown read-only in Allocate). The server refuses any other value and,
  at run time, refuses to run if the allocation's database differs from the company's (`withAgentDb`).

### Company › Integration
- Every connector has a **Step-by-step setup guide** (Meta/Instagram Lead Ads, WhatsApp Cloud API/BSPs, REST, website forms incl.
  Elementor/CF7, Google Ads lead forms, inbound email, telephony, QR, partners, CSV, manual) with the connector's real URL, key and verify
  token filled in, plus an "via MCP" alternative where relevant.
- **Google Ads Lead Forms** (replaces the retired Google Search keyword connector, which could never reveal who searched — existing
  Google Search connectors are switched off automatically). People who search your keywords, click your ad and submit its lead form are
  delivered instantly by Google's lead form webhook to the connector URL, authenticated by the connector's key (`google_key`; wrong key →
  401). Name/phone/email/city/address columns map to the lead, custom questions go to comments, `gclid`/ad group/creative/form IDs are
  kept, Google's "Send test data" leads are marked TEST, and `lead_id` makes retries harmless. Google sends only the campaign ID — map
  IDs to readable names in the connector's **Settings**. Older leads: download the CSV in Google Ads → Assets → Lead forms and use
  Bulk import.
- **IndiaMART** — *Push API* (real time: paste your Lead URL in Lead Manager → ⋮ → Import/Export Leads → Push API) **plus** *Pull API*
  safety net every 15 minutes (`/api/cron/pull-frequent`; paste the Pull API key in Settings — optional). Rolling window with 5-minute
  overlap in IST, ≤ 7 days, one call per 5 minutes (IndiaMART's limit; Run now is limited the same way), which also keeps the key from
  expiring. Buyer enquiries, buy-leads, PNS calls and WhatsApp enquiries map to name/mobile/email/address/requirement; `UNIQUE_QUERY_ID`
  means a lead that arrives by both Push and Pull is stored once.
- **JustDial** — JustDial pushes each enquiry to your Lead URL (GET or POST; we reply `RECEIVED`). Ask your JustDial account manager to
  enable "lead push API" with that URL. Prefix + name, mobile, email, category (as campaign), area/city/pincode; deduped by `leadid`.
- **TradeIndia** — My Inquiry API, fetched every 15 minutes. Paste the API link from TradeIndia → Inquiries & Contacts → My Inquiry API
  (User ID, Profile ID and Key are filled in automatically; key stored encrypted). Deduped by `rfi_id`.
- **Sulekha** — Sulekha's team pushes enquiries to your Lead URL in their format (camelCase/snake_case both understood; anything else via
  Field mapping). Deduped by lead ID.
- **Shopify** — abandoned checkouts (with cart, value and the recovery link), new customers and orders arrive instantly via the
  store's webhooks (Shopify admin → Settings → Notifications → Webhooks: Checkout creation / update, Customer creation, Order creation →
  the connector's Lead URL). Paste the store's webhook signing key in Settings and every delivery's `X-Shopify-Hmac-Sha256` is verified
  (unsigned → 401). UTM campaign from the landing page, referrer, marketing consent kept. Checkouts without contact details yet, completed
  checkouts, cancelled orders and other topics are acknowledged and ignored (not stored, not retried). Choose what to capture; new leads
  from paid orders can start as Converted.
- **WooCommerce** — webhooks "Order created" / "Customer created" with the connector's endpoint as Delivery URL and its secret as Secret;
  `X-WC-Webhook-Signature` is verified, the save-time ping is answered. Optional read-only REST API key (Store URL + ck_/cs_) adds a
  15-minute fetch of recent orders (`/wp-json/wc/v3/orders`, GMT window, SSRF-guarded) — same ids as the webhooks, so nothing doubles.
  Campaign from WooCommerce order attribution (`_wc_order_attribution_utm_*`). Pending / failed orders stay New for follow-up.
- Shop events for the same person (checkout → order) merge into one lead with each event in its history.
- Push-platform Lead URLs have the form `/api/intake/<key>/<token>` (the token is the connector secret, shown once; rotate to issue a
  new URL). Every marketplace lead goes through the same duplicate merge, assignment, WhatsApp alerts and webhooks as other channels.
- **MCP Server** connector — Streamable-HTTP MCP client (Zapier MCP, Make, HubSpot, Pipedream, Composio, your own): List tools → pick a
  tool + JSON arguments + items path → records are pulled daily as leads, idempotent by record id. Server URLs are SSRF-guarded (https,
  no private/internal addresses).

### Company › Integration › Public Web Prospecting (keyword lead discovery)
- **What it does**: every day from 02:00 IST it finds people who *publicly asked* for what the company offers (keywords + optional
  location) and the company's allocated AI model structures each into a lead: Name, Phone, Email, WhatsApp, profile/post link,
  Location, Organisation, Role, Requirement, Intent (high/medium/low), evidence quote and source link. Anything missing is stored and
  shown as **NA** (phone/email/WhatsApp stay empty in the database so duplicate matching still works; screens and exports show NA).
- **Sources** (each switchable): *Web pages & blogs* via the company's Brave Search API or SerpAPI key; *Feeds & pages* — RSS/Atom feeds
  and public pages the company lists (local blogs, forums, community boards); *Bluesky* via its official API (handle + App Password).
  **Not supported by design**: LinkedIn, Facebook, Instagram, X, Threads, Quora, Reddit, WhatsApp/Telegram groups, and marketplace
  sites (JustDial, IndiaMART, Sulekha, TradeIndia — use their connectors): their terms forbid automated collection or need a login. They
  are never fetched even if a search returns them, and can't be added as feeds.
- **Test Now**: a dry run on a small sample showing exactly which leads would be created, plus a log of what was checked and why
  anything was skipped. Nothing is saved; AI credits are used for the pages read. **Run now** starts a real run.
- **Schedule**: `/api/cron/prospect` (Vercel cron every 15 minutes) seeds each connector once a day from 02:00 IST, then reads its queue
  in time-boxed slices (functions are limited to 60 s), fairly across companies. Pages already read are not read again.
- **Ethics & law** (India DPDP Act s.3(c)(ii) covers personal data a person made public themselves): robots.txt obeyed (user-agent
  `LeadHiveBot`, info page at `/bot`), pages marked `noai` skipped, no logins/CAPTCHAs/proxies, ≥1 s between requests to a site and
  ≤5 pages per site per run; only the text around the keywords goes to the AI; the AI keeps only details people published about
  themselves and every phone/email is re-checked against the source text (nothing invented); no health conditions or other sensitive
  details are recorded — only the service wanted; these leads never get the automatic WhatsApp welcome (no opt-in); untouched leads are
  deleted after the retention period; deleting a prospected lead adds salted one-way hashes of its phone/email/profile to a
  per-company **do-not-collect list** (`Suppression`), so that person is never collected again.

### Company › AI Agent › Models | Endpoint
- **Endpoint**: an HTTPS endpoint for external systems — `POST /api/ai/v1/chat` with `Authorization: Bearer ep_live_…` and
  `{ "question", "history"? }` → `{ "answer", "usage" }`. Answer with an existing AI agent, or a new endpoint on an allocated model with
  instructions. Data access: *Knowledge only*, *Knowledge + company totals* (default — aggregates only, never names/phones/emails), or
  *Full read-only data* (internal systems). Keys are stored as SHA-256 and shown once (rotate anytime); optional website allow-list
  (CORS, enforced server-side); per-endpoint rate limit; calls and credits counted; Test console and copy-paste integration guide.

## 13. Login templates, Client module, support portal, client billing (Oct 2026)

### Login page designs (Super Admin)
- **10 designs**: Classic Split, Photo Panel, Spotlight Card, Aurora, Minimal, Editorial, Gradient Mesh, Noir Luxe, Showcase,
  Frosted Glass. Each is rendered with the brand's own logo, banner, colours and texts.
- **Company › Branding & domain › Login page design**: pick per company; previews are real scaled renders (`TemplateThumb`), and
  the live preview follows the selection. Older companies keep their look (split → Classic, banner → Photo, centered → Spotlight).
- **Settings › Platform Branding** (new SA module `branding`): the platform address's login — template, theme/accent colours,
  tagline, headline, sub-headline, footer. Stored in the main DB (`PlatformSetting` "platform_branding"), refreshed per instance
  at most once a minute; never blocks the login page (1.5 s cap).

### Leads
- New fields: **Service** (multi-select from the company's service master — type to add, trash icon deletes from the master),
  **Company GST** (format-checked), **Trade licence**, **Company PAN**, **Registered address**, **Communication address**
  ("Same as registered" checkbox), **Owner mail id**, **Owner number**, **Owner PAN**, **Owner Aadhaar**. Aadhaar is
  checksum-validated (Verhoeff), stored **AES-256-GCM encrypted**, and only `XXXX XXXX 1234` ever leaves the server (API,
  screens, CSV export). Missing values show as NA.
- **Converted / Service Initiated → Client**: the lead leaves the Leads list and appears in the Client module with a Client ID
  (`<COMPANY CODE>-C0001`, per-company sequence). Works from the Status dropdown, the edit form, bulk status, new leads and
  integrations (e.g. a paid Shopify order); a catch-all promotion runs when the Client module loads.
- **Fix**: a status-only update (the Status dropdown in the list, the Lost reason pop-up) used to blank the lead's name. Partial
  updates now change only the fields sent; a one-time background repair (`lead_name_repair_v1`) restores names from the stored
  channel payload where one exists (manual leads can't be recovered).

### Client module (company sidebar › Client; permission key `clients`)
- **Clients**: list with Client ID, contact, services, service status, outstanding dues; the profile shows the whole
  **journey** — lead capture, status changes, notes, service-status moves, tickets, dues and payments — plus editable
  business details.
- **Service Board**: Kanban of service status. Drag-drop (HTML5; a "Move to" selector on touch screens), optimistic updates.
  **Edit columns**: add, rename, recolour, reorder, delete (clients in a deleted column move to the first one). Defaults:
  Onboarding · In Progress · On Hold · Delivered · Closed.
- **Support Tickets**: tickets from the support page (or raised by staff), status Open / In Progress / On Hold / Resolved /
  Closed with an optional note to the client. **Every status update sends WhatsApp** through the company's webhooks for the new
  events `support_ticket_created` and `support_ticket_updated` (Settings › WhatsApp Webhook shows them when creating a
  template).
- **Subscription Management**
  - *Payment Details*: client (searchable), service type (master), amount, Recurring / On-Demand, frequency (On-demand · Weekly ·
    Monthly · Quarterly · Half yearly · Yearly), first due date. Edit / Delete / Reminder.
  - *Payment › Recurring*: dues generated automatically per period (unique per plan + due date, so never duplicated), Unpaid by
    default, Over-Due automatically after the due date, Paid → Transaction History and the next period appears. Edit / Delete /
    Reminder.
  - *Payment › On-Demand*: Create with client, multiple service types, amount auto-filled from the client's Payment Details
    (editable), discount fixed ⇄ % (either one calculates the other), gross, status, mode (NEFT / CASH / UPI / Card / RTGS),
    transaction ID, remarks.
  - *Transaction History*: everything Paid; only the status can change (Unpaid / Over-Due moves it back).
  - Reminders use the event `client_payment_reminder` (a paid entry sends a receipt instead).
  - Daily 02:00 IST job (`/api/cron/billing`) also generates dues and marks Over-Due in every company database; reads refresh at
    most every 5 minutes per company.

### Client support portal (PWA)
- **https://support.&lt;company address&gt;** (e.g. `support.whd.mhw.credovation.tech` or `support.leads.company.in`) and,
  with no DNS at all, **&lt;company address&gt;/support**. The middleware serves the portal on any `support.` host.
- Clients sign in with **Client ID + the mobile number registered** with the company (client WhatsApp/phone or owner number) →
  signed 2-hour session (HMAC). Raise Support / Request / Grievance, see every ticket and its status trail. Rate-limited per IP
  and per Client ID; the portal never shows other clients' data.
- Installable: per-company manifest (`/support/manifest.webmanifest`, company name/colour/logo) + a small service worker
  (`/support-sw.js`, page navigations only, offline fallback), registered only on the `support.` host.
- **DNS**: one CNAME per support address → `cname.vercel-dns.com`. Super Admin › Company › DNS shows the records and checks
  them live; with `VERCEL_API_TOKEN` set the addresses are added to the Vercel project automatically.

### Performance
- New collections (company DBs): ServiceType, ClientBoard, Counter, SupportTicket, ClientPlan, ClientPayment — every list query
  is backed by a compound index (`tenant_indexes_v2` adds them to existing company databases in the background).
- Board: one indexed query per column in parallel + one grouped count. Client list: one grouped query for outstanding dues of the
  page. Service master cached 5 minutes; client dropdown options fetched once per page. Measured locally: lists 6–55 ms.

### 13.1 Cinematic 3D login (Oct 2026)
- **Cinematic 3D — Neural Brain** (template `cinema`, now the Super Admin login; also selectable per company): a real-time
  WebGL brain of ~1.9k glowing neurons and their synapses (two hemispheres, folds, cerebellum), turning slowly. The circular
  logo sits at its core with rings of light (the aura) circling it. Story, every 4.5 s:
  01 Leads from every source — coloured sparks fly in, land on the cortex and travel along synapses into the core;
  02 Clients, end to end — gold sparks flow out to a ring of client nodes around the brain;
  03 AI intelligence — firing waves sweep through the whole network.
- Colours come from the brand's theme. The logo disc is drawn after the glow pass, so the logo keeps its exact colours and
  is contain-fitted inside the circle (never cropped); a company without a logo shows its initials.
- **Circular logos everywhere**: one `LogoDisc` component shows every logo (platform and each company) inside a white circle,
  scaled to the circle's inscribed square so it is never cropped — login pages, sidebar, assistant, lead forms, the support
  portal and the Super Admin logo upload preview.
- Performance: Three.js is loaded only on the login page, only on desktop (the panel is hidden on phones), DPR capped,
  paused when the tab is hidden or off-screen, one still frame for "reduce motion", a CSS poster when WebGL is unavailable
  and in the template picker's previews. The login page itself stays ~104 KB.
- The earlier CSS-3D designs (Orbit / Depth / Funnel) were retired; anything set to them shows Cinematic 3D.
