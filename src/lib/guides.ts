/**
 * Step-by-step setup guides per connector. Tokens are filled with the live connector values:
 * {{endpoint}} intake URL · {{secret}} API key / secret · {{verify}} Meta verify token · {{form}} hosted form URL.
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
    summary: "Google Ads lead form assets send each lead straight here — these are people who searched on Google and filled your form.",
    steps: [
      { title: "Create this connector", body: "Copy the endpoint URL and the key (shown once)." },
      { title: "Open the lead form", body: "Google Ads → Campaigns → Assets → Lead forms → open (or create) your lead form asset." },
      { title: "Add the webhook", body: "Under “Lead delivery option” → Webhook integration → paste the URL and the key.", code: "Webhook URL: {{endpoint}}\nKey: {{secret}}" },
      { title: "Send test data", body: "Click “Send test data”. A test lead appears in Leads; check the Deliveries tab if not." },
      { title: "Save & attach", body: "Save the asset and attach it to your Search campaigns. Campaign ID and gclid are kept on every lead." },
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
  google_search: {
    summary: "Every night at 2 AM your keywords are searched on the public web. Results that show a phone number or email become leads; the rest are kept as prospects to review.",
    note: "Google does not reveal who searched for a keyword — no tool can. This finds public pages and posts that match your keywords (enquiries, listings, forums). To capture people who actually search on Google, run a Search campaign with a Google Ads lead form (see that connector). Contact people only in line with consent rules (India DPDP Act 2023).",
    steps: [
      { title: "Get a search API key", body: "Pick a provider: SerpAPI (real Google results, incl. local listings with phone numbers) — serpapi.com → Dashboard → API key; or Brave Search API — api-dashboard.search.brave.com → subscribe → API key. Google’s own Custom Search JSON API is closed to new customers and is switched off on 1 Jan 2027; use it only if you already have a key + Search engine ID (cx)." },
      { title: "Add your keywords", body: "Write them the way customers post, one per line — e.g. “need home sample collection Kolkata”, “full body checkup near Salt Lake”, “diagnostic centre Howrah review”. Up to 25." },
      { title: "Narrow it down (optional)", body: "Set the city/region, keep “last 24 hours only” on for a daily feed, and optionally limit to sites such as justdial.com, quora.com, reddit.com, sulekha.com." },
      { title: "Connect & run", body: "Click Create, then Run now to check results. After that it runs automatically every day at 2:00 AM IST (Run now is limited to 6 per hour because searches cost API credits)." },
      { title: "Review", body: "Open the connector → Results: every page found, with phone/email if published. Ones with contact details are already in Leads (source “google_search”, campaign = keyword)." },
    ],
    links: [
      { label: "SerpAPI", url: "https://serpapi.com/" },
      { label: "Brave Search API", url: "https://brave.com/search/api/" },
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
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] || `<${k === "endpoint" ? "endpoint URL — connect first" : k === "secret" ? "your secret" : k === "verify" ? "verify token" : k}>`);
}
