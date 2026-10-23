---
title: REST API & webhooks
slug: rest-api
order: 30
summary: Website / landing-page forms, WhatsApp Business Platform and generic REST — all authenticated with the connector’s API key.
---
## One model for every push channel

**Website / Landing Page Form**, **WhatsApp Business Platform** and **REST API / Webhook** all work the same way: the sender POSTs to the connector’s **endpoint** and proves it is allowed with the connector’s **API key**.

Any one of these authenticates the request:
- header `x-api-key: <API key>`
- `?key=<API key>` in the URL, for senders that can’t set headers (Meta Cloud API, plain HTML forms)
- `x-signature: sha256=<HMAC-SHA256 of the raw body, keyed with the API key>`

Calls without a valid key get **401**. Fields like name, phone, mobile, email, message, city and utm_* are mapped automatically. Use **Field mapping** for anything else.

```
curl -X POST '{{platformUrl}}/api/intake/<connector key>' \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: <API key>' \
  -H 'Idempotency-Key: form-1042' \
  -d '{"name":"Riya Sen","phone":"9876543210","email":"riya@example.com","message":"Full body checkup","consent":"yes"}'
```

Responses:
- **200** — created or merged (includes `leadId`)
- **202** — accepted but failed; it is retried automatically every 15 minutes
- **401** — wrong or missing key
- **429** — slow down

Send the same `Idempotency-Key` header on retries, and the lead is never duplicated.

## Website / Landing Page Form

- **From your server or form plugin** (Elementor, Contact Form 7, Webflow, Wix): add a webhook to the endpoint with the `x-api-key` header, or put `?key=` in the URL.
- **Plain HTML form:** `action="<endpoint>?key=<API key>"`. After submitting, people land on the hosted thank-you page.
- **Browser fetch:** works too, but the key is visible in the page source. Rotate it if it is misused.

Keep a hidden `_hp` field: submissions where it is filled in are treated as bots.

## WhatsApp Business Platform

- **Meta Cloud API:** set the Callback URL to `<endpoint>?key=<API key>` and the Verify token to the API key, then subscribe to **messages**.
- **BSPs** (Interakt, AiSensy, Gupshup, WATI…): point the incoming-message webhook at the endpoint and add the `x-api-key` header.

## Older connectors

Website-form and WhatsApp connectors created before this change still accept deliveries without the key, so live sites don’t break. Their Setup tab shows **Require API key**: update the form or Callback URL first, then click it.
