/**
 * Step-by-step setup guides per connector. Tokens are filled with the live connector values:
 * {{endpoint}} intake URL · {{pushUrl}} self-authenticating push URL · {{secret}} API key / secret · {{verify}} Meta verify token · {{form}} hosted form URL.
 * Third-party menus are described as of Oct 2026 — names can shift slightly when vendors redesign.
 */
export type Step = { title: string; body: string; code?: string };
export type Guide = { summary: string; steps: Step[]; mcp?: string; links?: { label: string; url: string }[]; note?: string };

const MCP_ALT =
  "Already collecting these leads in Google Sheets, HubSpot, Zoho or another app? Add an “MCP Server” connector (Zapier MCP, Make, HubSpot MCP, Pipedream…) and pick that app’s find/search tool — new rows are pulled every night at 2 AM.";

export const GUIDES: Record<string, Guide> = {
  meta_leads: {
    note: "Retired: use the “Facebook Lead Ads” or “Instagram Lead Ads” connector — you just sign in with Facebook, no App ID, token or webhook setup. Existing connectors of this kind keep working.",
    summary: "Every Facebook or Instagram Lead Ad submission arrives in seconds through Meta’s leadgen webhook. Instagram lead ads use your Facebook Page’s forms, so one connector covers both.",
    steps: [
      { title: "Create this connector", body: "Click Connect. You get a Callback URL and a Verify token (shown on the connector’s Setup tab)." },
      { title: "Create a Meta app", body: "Go to developers.facebook.com → My Apps → Create app → type “Business”. Link it to your Business portfolio." },
      { title: "Subscribe the webhook", body: "In the app, add the “Webhooks” product → choose object “Page” → Subscribe to this object. Paste the Callback URL and Verify token below → Verify and save. Then subscribe to the field “leadgen”.", code: "Callback URL: {{endpoint}}\nVerify token: {{verify}}" },
      { title: "Generate a Page access token", body: "Business Settings → Users → System users → Add (Admin) → Assign assets: your Page (full control) and the app → Generate token with permissions leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads. Choose “Never expire”." },
      { title: "Save the token here", body: "Open this connector → Edit → paste the token as “Page access token”. It is stored encrypted and is used only to fetch each lead’s answers from Meta." },
      { title: "Connect your Page to the app", body: "Run this once (Graph API Explorer or curl) with the Page ID and the token. Also check Business Settings → Integrations → Leads access: allow your app.", code: "curl -X POST 'https://graph.facebook.com/v21.0/<PAGE_ID>/subscribed_apps?subscribed_fields=leadgen&access_token=<PAGE_TOKEN>'" },
      { title: "Send a test lead", body: "Open developers.facebook.com/tools/lead-ads-testing → pick the Page and form → Create lead. It appears in Leads within seconds; the Deliveries tab shows the raw event." },
      { title: "Go live", body: "Switch the app to Live mode. Leads from Instagram placements are tagged source “instagram”, Facebook ones “facebook”, with the campaign/ad name for attribution." },
    ],
    mcp: MCP_ALT,
    links: [
      { label: "Lead Ads Testing Tool", url: "https://developers.facebook.com/tools/lead-ads-testing" },
      { label: "Meta webhooks for Lead Ads", url: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving" },
    ],
  },
  whatsapp: {
    summary: "REST API / webhook: every inbound WhatsApp message to your business number is posted to your endpoint with your API key, and becomes (or updates) a lead — Meta Cloud API or any BSP.",
    steps: [
      { title: "Create this connector", body: "Click Connect and copy the API key shown once. It is both the key on every call and the webhook Verify token." },
      { title: "Meta Cloud API: open your app", body: "developers.facebook.com → your Business app → WhatsApp → Configuration → Webhook → Edit." },
      { title: "Set the Callback URL with your key", body: "Meta can’t send custom headers, so the key goes in the URL. Paste both values → Verify and save.", code: "Callback URL: {{endpoint}}?key={{secret}}\nVerify token: {{secret}}" },
      { title: "Subscribe to messages", body: "In Webhook fields, click Subscribe next to “messages”." },
      { title: "Using a BSP instead (Interakt, AiSensy, Gupshup, WATI…)", body: "Set the BSP’s incoming-message webhook to the endpoint and add the header x-api-key. Flat JSON like {\"phone\",\"name\",\"message\"} is understood automatically.", code: "curl -X POST '{{endpoint}}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-api-key: {{secret}}' \\\n  -d '{\"phone\":\"9876543210\",\"name\":\"Riya Sen\",\"message\":\"Hi, I need a home test\",\"message_id\":\"wamid.123\"}'" },
      { title: "Or sign the body", body: "Instead of the key you can send x-signature: sha256=<HMAC-SHA256 of the raw body using the key>." },
      { title: "Test", body: "Send “Hi” from your phone to the business number. A lead appears with the WhatsApp profile name, number and the message as comments. Calls without the key are refused (401)." },
    ],
    links: [{ label: "WhatsApp Cloud API webhooks", url: "https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks" }],
  },
  facebook_leads: {
    summary: "Sign in with Facebook and pick your Pages. Every Facebook Lead Ad submission becomes a lead in seconds — no App ID, token or webhook to set up.",
    steps: [
      { title: "Click “Connect with Facebook”", body: "Read the consent notice and click “I agree to all & connect” (or tick each purpose and Continue)." },
      { title: "Sign in on facebook.com", body: "A secure window opens on Facebook. Sign in with your own ID and password — we never see them." },
      { title: "Keep every box ticked", body: "On Facebook’s screen, choose the Pages (and Business) whose lead forms you use, and leave every permission ticked. Without them leads can’t be read." },
      { title: "Pick your Pages here", body: "Back in the Connect window, tick the Pages that should send leads → Connect. Recent leads (last 3 days) are fetched at once." },
      { title: "Test", body: "Open developers.facebook.com/tools/lead-ads-testing → pick the Page and form → Create lead. It appears in Leads within seconds." },
      { title: "Allow CRM access if Facebook asks", body: "If leads don’t arrive: Meta Business Suite → Settings → Integrations → Leads access → allow CredoOne for the Page." },
    ],
    links: [{ label: "Lead Ads Testing Tool", url: "https://developers.facebook.com/tools/lead-ads-testing" }],
    note: "You need the Advertise or Manage task on the Page. Disconnect at any time — the stored login is deleted immediately.",
  },
  instagram_leads: {
    summary: "Sign in with Facebook and pick your Instagram professional accounts. Lead forms on Instagram ads become leads in seconds.",
    steps: [
      { title: "Link Instagram to a Facebook Page", body: "Your Instagram account must be Professional (Business or Creator) and linked to a Facebook Page (Instagram → Settings → Account type and tools; Page → Settings → Linked accounts)." },
      { title: "Click “Connect with Facebook”", body: "Instagram lead ads are delivered through Facebook, so you sign in with Facebook. Read the consent notice and agree." },
      { title: "Keep every box ticked", body: "Select the Page and Instagram account on Facebook’s screen and leave every permission ticked." },
      { title: "Pick your Instagram accounts", body: "Tick the accounts that should send leads → Connect. Leads are tagged source “instagram”." },
    ],
    note: "If you also connect Facebook Lead Ads for the same Page, Facebook-placement leads go there and Instagram-placement leads come here.",
  },
  linkedin_leads: {
    summary: "Sign in with LinkedIn and pick your ad accounts or LinkedIn Pages. Lead Gen Form responses become leads automatically.",
    steps: [
      { title: "Check your LinkedIn role", body: "You need Account Manager, Campaign Manager or Leads Manager on the ad account (or admin on the LinkedIn Page for Page lead forms)." },
      { title: "Click “Connect with LinkedIn”", body: "Read the consent notice and agree. Sign in on linkedin.com with your own login and click Allow." },
      { title: "Pick ad accounts / Pages", body: "Tick the ones that run lead gen forms → Connect. Responses from the last 7 days are fetched at once." },
      { title: "Done", body: "New responses arrive within minutes (instant where LinkedIn notifications are on, otherwise every 15 minutes). LinkedIn logins last about 60 days — you’ll see “Reconnect” when it’s time." },
    ],
  },
  google_sheets: {
    summary: "Sign in with Google and pick a sheet — e.g. your Google Form’s response sheet. New rows become leads every 15 minutes.",
    steps: [
      { title: "Have a sheet with headings", body: "Row 1 must be headings like Name, Phone, Email, City, Message. Google Forms: Responses → Link to Sheets." },
      { title: "Click “Connect with Google”", body: "Agree to the consent notice and sign in on accounts.google.com. Read-only access to sheets is requested." },
      { title: "Paste the sheet link", body: "Paste the docs.google.com/spreadsheets/… link → Check → pick the tab. Choose whether to import rows already there." },
      { title: "Done", body: "New rows are read every 15 minutes (or click Fetch now). Each row is read once." },
    ],
    note: "If Google says “Google hasn’t verified this app”, click Advanced → Go to CredoOne. The platform administrator can remove this by verifying the app with Google.",
  },
  rest_api: {
    summary: "A JSON endpoint for any system — your app, CRM, Zapier/Make, a call-centre tool. Create one connector per sending system so attribution stays clean.",
    steps: [
      { title: "Create this connector", body: "Copy the endpoint URL and the API key (the key is shown once)." },
      { title: "Send a lead", body: "POST JSON with the x-api-key header. Common field names (name, phone, mobile, email, message, city, utm_*) are mapped automatically; use Field mapping for anything else.", code: "curl -X POST '{{endpoint}}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-api-key: {{secret}}' \\\n  -H 'Idempotency-Key: order-1042' \\\n  -d '{\"name\":\"Riya Sen\",\"phone\":\"9876543210\",\"email\":\"riya@example.com\",\"message\":\"Full body checkup\",\"utm_campaign\":\"puja-camp\"}'" },
      { title: "Make retries safe", body: "Send the same Idempotency-Key when you retry — the lead is never duplicated. Without one, a hash of the body is used." },
      { title: "Or sign the body", body: "Instead of x-api-key you can send x-signature: sha256=<HMAC-SHA256 of the raw body using the secret>." },
      { title: "Read the response", body: "200 = created/merged (with leadId) · 202 = accepted but failed, will retry automatically · 401 = wrong key · 429 = slow down." },
    ],
    mcp: MCP_ALT,
  },
  website_form: {
    summary: "REST API / webhook: your website, landing page or form plugin POSTs each submission as JSON (or form fields) with your API key.",
    steps: [
      { title: "Create this connector", body: "Copy the endpoint URL and the API key (the key is shown once)." },
      { title: "Send a submission (recommended: from your server or form plugin)", body: "POST JSON with the x-api-key header. name, phone, email, message, city and utm_* are mapped automatically.", code: "curl -X POST '{{endpoint}}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-api-key: {{secret}}' \\\n  -H 'Idempotency-Key: form-1042' \\\n  -d '{\"name\":\"Riya Sen\",\"phone\":\"9876543210\",\"email\":\"riya@example.com\",\"message\":\"Full body checkup\",\"consent\":\"yes\",\"utm_campaign\":\"puja-camp\"}'" },
      { title: "WordPress / Elementor / Webflow / Wix", body: "Elementor Pro: Form → Actions After Submit → Webhook. Contact Form 7: “CF7 to Webhook”. Webflow / Wix: Logic or Automations → Send HTTP request. Use the endpoint and add the x-api-key header — or, where headers can’t be set, put the key in the URL.", code: "{{endpoint}}?key={{secret}}" },
      { title: "From the browser (no page reload)", body: "Works too, but the key is visible in your page source — rotate it if it is misused. Keep the hidden _hp field: filled-in submissions are treated as bots.", code: "await fetch('{{endpoint}}', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json', 'x-api-key': '{{secret}}' },\n  body: JSON.stringify({ name, phone, email, message, consent, utm_source, utm_campaign, _hp })\n});" },
      { title: "Plain HTML form", body: "Put the key in the action URL; after submit, people see your hosted thank-you page.", code: "<form action=\"{{endpoint}}?key={{secret}}\" method=\"POST\">\n  <input name=\"name\" required>\n  <input name=\"phone\" required>\n  <input name=\"email\" type=\"email\">\n  <textarea name=\"message\"></textarea>\n  <label><input name=\"consent\" type=\"checkbox\" value=\"yes\"> I agree to be contacted on WhatsApp</label>\n  <input name=\"_hp\" style=\"display:none\" tabindex=\"-1\" autocomplete=\"off\">\n  <button>Submit</button>\n</form>" },
      { title: "Read the response", body: "200 = created/merged (with leadId) · 202 = accepted, will retry automatically · 401 = missing or wrong key · 429 = slow down. Send the same Idempotency-Key when you retry." },
    ],
  },
  google_ads: {
    summary: "People who searched your keywords on Google and filled the lead form on your ad — name, phone, email and your custom questions arrive here within seconds, with the campaign and click ID for attribution.",
    note: "This is the only Google channel that gives you the searcher’s own details: they type them into your lead form and agree to share them. Google Ads lead forms are available for Search, YouTube, Discovery/Demand Gen and Performance Max campaigns (the advertiser account must meet Google’s lead-form policy requirements).",
    steps: [
      { title: "Create this connector", body: "Click Connect. Copy the Webhook URL and the Key (the key is shown once — you can rotate it later)." },
      { title: "Create or open a lead form", body: "Google Ads → Campaigns → Assets → “+” → Lead form (or open an existing one). Add the questions you need: Name, Phone number, Email, City, plus custom questions such as “Which test?” or “Preferred time?”." },
      { title: "Add the webhook", body: "In the lead form, open “Lead delivery option” → Webhook integration → paste the URL and the Key below → Save.", code: "Webhook URL: {{endpoint}}\nKey: {{secret}}" },
      { title: "Send test data", body: "Click “Send test data”. A lead marked “[Google Ads TEST lead]” appears in Leads within seconds (and on the Deliveries tab)." },
      { title: "Attach the form to campaigns", body: "Add the lead form asset to your Search campaign(s) targeting keywords like “home sample collection Kolkata” or “full body checkup near me”. Every submission becomes a lead with source google_ads, medium cpc, the gclid, ad group and form IDs." },
      { title: "Name your campaigns (optional)", body: "Google sends campaign IDs, not names. In this connector’s Settings, map each campaign ID to a readable name so Reports show “Home collection – Kolkata” instead of a number." },
      { title: "Bring in older leads", body: "Google keeps form leads for 30 days: Assets → Lead forms → Leads column → Download (CSV). Import the file from Leads → Import; duplicates by phone/email are merged." },
    ],
    links: [
      { label: "About lead form assets", url: "https://support.google.com/google-ads/answer/9423234" },
      { label: "Lead form webhook integration", url: "https://developers.google.com/google-ads/webhook/docs/overview" },
    ],
  },
  indiamart: {
    summary: "Every IndiaMART enquiry — direct enquiries, buy-leads you purchase, PNS calls, catalog views and WhatsApp enquiries — with the buyer’s name, mobile, email, city, company and requirement. Push delivers in real time; Pull (every 15 minutes) is the safety net.",
    note: "Needs a paid IndiaMART seller account (Lead Manager). Log in with your registered primary mobile number.",
    steps: [
      { title: "Create this connector", body: "Click Connect. Copy your Lead URL (shown once) — it already contains your private token." },
      { title: "Turn on the Push API (real time)", body: "seller.indiamart.com → Lead Manager → ⋮ (three dots) → Import/Export Leads → Push API. Paste the Lead URL as the webhook URL and activate. Use the test option there — a test lead appears in Leads.", code: "{{pushUrl}}" },
      { title: "Turn on the Pull API (safety net)", body: "Same menu → Pull API (or seller.indiamart.com/leadmanager/crmapi) → Generate Key. Paste the key in this connector’s Settings → “IndiaMART Pull API key”. We fetch every 15 minutes (IndiaMART allows one call per 5 minutes) and the key never expires while it is in use." },
      { title: "Check", body: "Overview → Run now fetches the last 24 hours. Each enquiry is stored once (IndiaMART’s UNIQUE_QUERY_ID), even if it arrives by both Push and Pull." },
      { title: "What you get on each lead", body: "Name, mobile (+ alternate), email, city/state/pincode, company, subject, message and product; type (direct enquiry, buy-lead, PNS call, catalog view, WhatsApp enquiry) as medium and the product as campaign." },
      { title: "Keep it running", body: "If our URL stops answering for 48 hours IndiaMART switches Push off — the Pull keeps catching up, and you can re-activate Push from the same screen. Generating a new Pull key invalidates the old one: paste the new key here." },
    ],
    links: [
      { label: "IndiaMART Push API help", url: "https://help.indiamart.com/knowledge-base/integration-of-indiamarts-lead-manager-crm-push-api-with-third-party-crms-real-time-push-of-leads" },
      { label: "IndiaMART Pull API help", url: "https://help.indiamart.com/knowledge-base/lms-crm-integration-v2" },
    ],
  },
  justdial: {
    summary: "Every JustDial enquiry for your listing is pushed to your Lead URL the moment it is created — caller name, mobile, email, the category searched and area.",
    note: "JustDial switches this on from their side for paid listings: you send them the Lead URL and they configure it. There is no self-serve screen.",
    steps: [
      { title: "Create this connector", body: "Click Connect and copy the Lead URL (shown once — it contains your private token)." },
      { title: "Send it to JustDial", body: "Email or WhatsApp your JustDial account manager (or support) asking them to “push leads via API to this URL (GET)”. Mention your listing name and registered mobile.", code: "{{pushUrl}}" },
      { title: "Ask for a test lead", body: "When they confirm, ask JustDial to send a test lead. It appears in Leads (source justdial) and on the Deliveries tab. We reply “RECEIVED”, which is what JustDial expects." },
      { title: "Field names", body: "Standard JustDial fields (leadid, prefix, name, mobile, phone, email, category, city, area, pincode, date, time) are mapped automatically. If JustDial uses different names for your account, set them in Field mapping." },
    ],
  },
  tradeindia: {
    summary: "Buyer inquiries from your TradeIndia account are fetched every 15 minutes — name, mobile, email, company, city, product and message.",
    note: "Needs a TradeIndia seller account with the My Inquiry API enabled.",
    steps: [
      { title: "Find your API details", body: "TradeIndia → click your name (top right) → Inquiries & Contacts → My Inquiry API. You’ll see your User ID, Profile ID and Key (and an API link that contains all three)." },
      { title: "Create this connector", body: "Click Connect and paste the API link — User ID, Profile ID and Key are filled in for you — or type them separately." },
      { title: "Run now", body: "Overview → Run now fetches the last 2 days. After that it runs every 15 minutes; each inquiry is stored once (by its inquiry ID)." },
      { title: "Adjust if needed", body: "If your TradeIndia account returns different field names, set them in Field mapping (dot paths work)." },
    ],
  },
  sulekha: {
    summary: "Sulekha pushes each service enquiry (name, mobile, the service and locality) to your Lead URL in real time.",
    note: "Sulekha’s team enables the push for paid business accounts — share the Lead URL with your Sulekha point of contact.",
    steps: [
      { title: "Create this connector", body: "Click Connect and copy the Lead URL (shown once — it contains your private token)." },
      { title: "Send it to Sulekha", body: "Share the URL with your Sulekha account manager and ask them to push leads to it (POST JSON, form or GET — all are accepted).", code: "{{pushUrl}}" },
      { title: "Ask for a test lead", body: "It appears in Leads (source sulekha). If a field lands in the wrong place, map it in Field mapping using Sulekha’s field name." },
    ],
  },
  web_prospect: {
    summary: "Every day at 2:00 AM IST, finds people who publicly asked for what you offer — on web pages and blogs, feeds you choose, and Bluesky — and AI turns each into a lead. Missing details show as NA.",
    note: "Ethical by design: robots.txt and “noai” opt-outs are obeyed, only details people published about themselves are kept (every phone/email is checked against the page), no health details are stored, and these leads never receive automatic WhatsApp messages — get their consent first.",
    steps: [
      { title: "Choose keywords", body: "Write what people would say when they need you — “need home blood test”, “pathology lab near Salt Lake”. Add a location to focus the search." },
      { title: "Switch on sources", body: "Web pages & blogs need a search API key: Brave Search API (api-dashboard.search.brave.com) or SerpAPI (serpapi.com). Feeds & pages: paste RSS feeds of local blogs, forums or community boards. Bluesky: your handle and an App Password (Settings › Privacy and security › App passwords)." },
      { title: "Pick the AI model", body: "The model reads each page and fills Name, Phone, Email, WhatsApp, Location, Organisation, Requirement and Intent. It uses that model’s credits — set “Pages / posts per day” to control spend." },
      { title: "Test Now", body: "Runs on a small sample and shows the leads it would create — nothing is saved. Adjust keywords until the results look right." },
      { title: "Let it run", body: "From 2:00 AM IST each day it searches, then reads pages in the background every 15 minutes until done. New people appear in Leads with source “web_prospect”, the evidence quote and a link to where they posted. Run now starts a run immediately." },
      { title: "Follow up the right way", body: "Reply where the person posted or use the contact they published. Untouched leads are deleted after the period you choose. If someone asks to be removed, delete their lead — they go on a do-not-collect list and are never collected again. Site owners can block the reader with “User-agent: LeadHiveBot / Disallow: /” in robots.txt." },
    ],
    links: [
      { label: "Brave Search API", url: "https://brave.com/search/api/" },
      { label: "SerpAPI", url: "https://serpapi.com/" },
      { label: "Bluesky app passwords", url: "https://bsky.app/settings/app-passwords" },
    ],
  },
  shopify: {
    summary: "Shoppers who abandon checkout, create an account or place an order on your Shopify store become leads instantly — with cart, order value and the ad campaign that brought them.",
    note: "Pick what to capture in Settings. Abandoned checkouts are the warmest leads: the recovery link is on the lead so your team can send it on WhatsApp.",
    steps: [
      { title: "Create this connector", body: "Click Connect and copy the Lead URL (shown once — it contains your private token). Choose what to capture: abandoned checkouts, new customers, orders." },
      { title: "Add the webhooks in Shopify", body: "Shopify admin → Settings → Notifications → Webhooks → Create webhook. Format JSON, latest API version, URL below. Create one webhook for each event you want: “Checkout creation”, “Checkout update”, “Customer creation”, “Order creation”.", code: "{{pushUrl}}" },
      { title: "Save the signing key (recommended)", body: "On the same Webhooks page Shopify shows the code your webhooks are signed with. Paste it in this connector’s Settings → “Webhook signing key”. From then on every delivery’s signature is checked and anything unsigned is refused." },
      { title: "Test", body: "Use “Send test” next to a webhook in Shopify, or start a checkout on your store with your phone number and leave before paying. The lead appears in Leads (source shopify, medium “abandoned checkout”). One person across checkout → order stays one lead with both events in its history." },
      { title: "Older customers (optional)", body: "Shopify admin → Customers → Export → CSV, then Leads → Import. Webhooks cover everything from now on." },
    ],
    links: [{ label: "Shopify: creating webhooks", url: "https://help.shopify.com/en/manual/orders/notifications/webhooks" }],
  },
  woocommerce: {
    summary: "Orders and new customer accounts from your WordPress / WooCommerce shop become leads instantly through signed webhooks, with a 15-minute safety-net fetch.",
    steps: [
      { title: "Create this connector", body: "Click Connect. Copy the Delivery URL and the Secret (the secret is shown once — rotate it if you lose it)." },
      { title: "Add the webhooks in WooCommerce", body: "WordPress admin → WooCommerce → Settings → Advanced → Webhooks → Add webhook. Status: Active · Topic: “Order created” · Delivery URL and Secret below · API version: WP REST API Integration v3 → Save. Repeat with Topic “Customer created”.", code: "Delivery URL: {{endpoint}}\nSecret:       {{secret}}" },
      { title: "Check it’s connected", body: "On saving, WooCommerce pings the URL; the webhook stays Active. Place a test order — it appears in Leads (source woocommerce). Paid orders can start as Converted; pending / failed ones stay New for follow-up (choose in Settings)." },
      { title: "Safety net (optional)", body: "WooCommerce switches a webhook off after 5 failed deliveries. To never miss an order, create a Read-only key in WooCommerce → Settings → Advanced → REST API → Add key, and paste the Store URL, Consumer key and Consumer secret in this connector’s Settings. Recent orders are then fetched every 15 minutes; orders already received by webhook are not duplicated." },
    ],
    links: [
      { label: "WooCommerce webhooks", url: "https://woocommerce.com/document/webhooks/" },
      { label: "WooCommerce REST API keys", url: "https://woocommerce.com/document/woocommerce-rest-api/" },
    ],
  },
  email: {
    summary: "Turn enquiry emails into leads with an inbound-parse service — the sender, subject and body become the lead.",
    steps: [
      { title: "Create this connector", body: "Copy the endpoint and secret." },
      { title: "SendGrid Inbound Parse", body: "Point an MX record for a subdomain (e.g. leads.yourdomain.com) to mx.sendgrid.net → SendGrid → Settings → Inbound Parse → Add host & URL.", code: "{{endpoint}}?key={{secret}}" },
      { title: "Mailgun / Postmark", body: "Mailgun: Receiving → Create route → forward(\"{{endpoint}}?key={{secret}}\"). Postmark: Inbound stream → Webhook URL = the same address." },
      { title: "Forward your enquiry inbox", body: "In Gmail/Outlook, auto-forward enquiries@yourdomain.com to the parse address (e.g. anything@leads.yourdomain.com)." },
      { title: "Test", body: "Email the address with a phone number in the body — it becomes the lead’s phone." },
    ],
  },
  telephony: {
    summary: "Missed calls and IVR calls become leads with the caller’s number — Exotel, Knowlarity, Ozonetel, MyOperator and similar.",
    steps: [
      { title: "Create this connector", body: "Copy the endpoint and secret." },
      { title: "Exotel", body: "App Bazaar → your flow → add a “Passthru” applet → URL below (GET or POST)." , code: "{{endpoint}}?key={{secret}}" },
      { title: "Knowlarity / Ozonetel / MyOperator", body: "Settings → Webhooks / Call-back URL → paste the same URL for “call completed” or “missed call”." },
      { title: "Test", body: "Call your number and hang up. The caller number appears as a lead (source “phone_call”)." },
    ],
  },
  qr_campaign: {
    summary: "A hosted mobile form with a printable QR code — posters, camps, counters, ambulances, flyers.",
    steps: [
      { title: "Create one connector per campaign", body: "Name it after the campaign (e.g. “Puja Health Camp”) so every lead is tagged." },
      { title: "Print the QR", body: "Open the connector → download the QR (high resolution) and add it to your artwork.", code: "{{form}}" },
      { title: "Test", body: "Scan with your phone, submit — the lead appears with the campaign name." },
    ],
  },
  partner: {
    summary: "Give each partner, referrer or affiliate their own connector so every lead is credited correctly.",
    steps: [
      { title: "Create a connector per partner", body: "Name it after the partner; set Source label = partner and Campaign = their name or code." },
      { title: "Share how to send leads", body: "Send them the endpoint and key (for systems) — or a hosted form if you create a QR/Campaign connector for them.", code: "{{endpoint}}\nx-api-key: {{secret}}" },
      { title: "Track", body: "Leads carry the referral and the connector in their attribution history; filter by source in Reports." },
    ],
  },
  mcp: {
    summary: "Model Context Protocol (MCP) servers expose apps as tools. Point this connector at one and pick a tool that returns records — they are pulled as leads every night at 2 AM.",
    steps: [
      { title: "Get an MCP server URL", body: "Zapier MCP: mcp.zapier.com → New server → add the tools you need (e.g. a Google Sheets “find rows” or a CRM “search contacts/leads” action) → copy the server URL. Make, HubSpot, Pipedream and Composio offer hosted MCP servers too, or use your own (Streamable HTTP)." },
      { title: "Copy the access token", body: "If the server needs one, copy its API key / bearer token. It is stored encrypted." },
      { title: "List tools", body: "Paste the URL (and token) here → List tools → choose the tool that returns the records you want." },
      { title: "Tool arguments", body: "Fill the tool’s arguments as JSON (the tool’s fields are shown). Example for a sheet:", code: "{ \"spreadsheet\": \"Website leads\", \"worksheet\": \"Sheet1\" }" },
      { title: "Map the fields", body: "If records are inside a property (e.g. results), set Items path = results. Names like name/phone/email map automatically; use Field mapping for others." },
      { title: "Run & schedule", body: "Create → Run now to test. Then it runs daily at 2:00 AM IST. Each record is idempotent (its id, or a hash), so re-runs never duplicate leads." },
    ],
    links: [{ label: "About MCP", url: "https://modelcontextprotocol.io/" }],
  },
  manual: {
    summary: "Your team adds leads by hand.",
    steps: [
      { title: "Open Leads", body: "Leads → Add lead. Name and a phone/WhatsApp/email are enough; duplicates by phone/email are merged automatically." },
      { title: "Attribute it", body: "Choose Source and Campaign so Reports show where walk-ins and calls come from." },
    ],
  },
  bulk_import: {
    summary: "Upload many leads at once from Excel or CSV.",
    steps: [
      { title: "Download the template", body: "Leads → Import → Download template (.xlsx). Keep the header row." },
      { title: "Fill and upload", body: "Paste your rows (name, phone, email, source, campaign, comments…) and upload. Existing leads (same phone/email) are updated, not duplicated." },
      { title: "Check the summary", body: "The import shows created, merged and rejected rows with the reason for each rejection." },
    ],
  },
};

export function fillGuide(text: string, v: Record<string, string | undefined>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] || `<${k === "endpoint" ? "endpoint URL — connect first" : k === "pushUrl" ? "your Lead URL — connect first" : k === "secret" ? "your secret" : k === "verify" ? "verify token" : k}>`);
}
