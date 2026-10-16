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
    summary: "Every inbound WhatsApp message to your business number becomes a lead (or updates the existing one) — Meta Cloud API or any BSP.",
    steps: [
      { title: "Create this connector", body: "Click Connect and copy the secret shown once — it is your webhook Verify token." },
      { title: "Meta Cloud API: open your app", body: "developers.facebook.com → your Business app → add product “WhatsApp” → link your WhatsApp Business Account and phone number." },
      { title: "Set the webhook", body: "WhatsApp → Configuration → Webhook → Edit → paste the Callback URL and Verify token → Verify and save.", code: "Callback URL: {{endpoint}}\nVerify token: {{secret}}" },
      { title: "Subscribe to messages", body: "In Webhook fields, click Subscribe next to “messages”." },
      { title: "Using a BSP instead (Interakt, AiSensy, Gupshup, WATI…)", body: "In the BSP’s settings, set the incoming-message webhook to this URL. Flat JSON like {\"phone\",\"name\",\"message\"} is understood automatically.", code: "{{endpoint}}?key={{secret}}" },
      { title: "Test", body: "Send “Hi” from your phone to the business number. A lead appears with the WhatsApp profile name, number and the message as comments." },
    ],
    links: [{ label: "WhatsApp Cloud API webhooks", url: "https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks" }],
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
    summary: "Point any website or landing-page form at the endpoint — plain HTML, WordPress, Elementor, Webflow, Wix or your own code.",
    steps: [
      { title: "Create this connector", body: "Copy the endpoint URL. Browser forms don’t need the key (a hidden honeypot field stops bots)." },
      { title: "Plain HTML", body: "Use this as your form (keep the hidden _hp field).", code: "<form action=\"{{endpoint}}\" method=\"POST\">\n  <input name=\"name\" required>\n  <input name=\"phone\" required>\n  <input name=\"email\" type=\"email\">\n  <textarea name=\"message\"></textarea>\n  <label><input name=\"consent\" type=\"checkbox\" value=\"yes\"> I agree to be contacted on WhatsApp</label>\n  <input name=\"_hp\" style=\"display:none\" tabindex=\"-1\" autocomplete=\"off\">\n  <button>Submit</button>\n</form>" },
      { title: "JavaScript (no page reload)", body: "Submit with fetch and show your own thank-you message.", code: "await fetch('{{endpoint}}', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name, phone, email, message, utm_source, utm_campaign })\n});" },
      { title: "WordPress / Elementor", body: "Elementor Pro: Form → Actions After Submit → add “Webhook” → paste the endpoint. Contact Form 7: install “CF7 to Webhook” and paste the endpoint." },
      { title: "UTM tracking", body: "Pass utm_source, utm_medium, utm_campaign (and gclid/fbclid) as hidden fields — they are saved on the lead for attribution." },
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
