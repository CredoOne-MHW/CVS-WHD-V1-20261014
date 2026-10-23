---
title: Troubleshooting
slug: troubleshooting
order: 50
summary: The exact messages platforms show, why, and the fix.
---
**First check, always:** Super Admin → Platform Apps → **Test** on the platform. It confirms the ID and secret, checks App Domains and the lead webhook (Meta), and lists the exact URLs to register.

| What you see | Cause | Fix |
|---|---|---|
| Card says **“Not enabled yet”** | That platform isn’t saved in Platform Apps | Platform Apps → enter the ID and secret → Save → Test |
| Popup: **“This sign-in link has expired”** | More than an hour passed, or the link was reused | Click Connect again |
| Nothing opens after “I agree” | The browser blocked the popup | Use **Open the sign-in window**, or allow popups for the site |
| Facebook: **“URL blocked”** / **redirect URI is not whitelisted** | Callback missing in the Meta app | Add `{{metaCallback}}` under Facebook Login for Business → Settings → Valid OAuth Redirect URIs |
| Facebook: **“Feature unavailable … updating additional details for this app”** | The person has no role on the Meta app, and Advanced Access isn’t approved yet | Add them as a **Tester**, or get Advanced Access + Business Verification |
| Facebook: **“App not active”** | App in Development mode | Switch the app to Live |
| Facebook: **“Invalid Scopes: leads_retrieval …”** | The Lead Ads use case isn’t added to the app | Add the use case and permissions (Platform Apps setup) |
| **“Connected without a permission we need”** | A box was unticked on Facebook’s screen | Connect again and keep every box ticked |
| **“No Facebook Pages came back”** | Pages weren’t selected, or the person isn’t a Page admin | Reconnect and select the Pages, or ask a Page admin |
| Instagram account greyed out | Not a professional account, or not linked to a Page | Switch to Professional and link it to the Facebook Page |
| Page shows **“Real-time off”** | The Page couldn’t install the app (task or Leads access) | Advertise task on the Page; Meta Business Suite → Integrations → Leads access → allow CredoOne. Leads still arrive every 15 minutes. |
| Leads arrive only every 15 minutes (Meta) | The app’s Page `leadgen` webhook isn’t set | Platform Apps → Meta → **Test** (it sets it), or add it in Webhooks |
| LinkedIn: **“redirect_uri does not match”** | Callback missing on the Auth tab | Add `{{linkedinCallback}}` |
| LinkedIn: **“unauthorized_scope_error”** | Lead Sync API not approved for the app | Request **Lead Sync API** in Products |
| LinkedIn: **“No ad accounts or Pages came back”** | The person lacks an ad-account role | Account Manager, Campaign Manager or Leads Manager on the ad account |
| Google: **“Error 400: redirect_uri_mismatch”** | Callback not on the OAuth client | Add `{{googleCallback}}` under Authorised redirect URIs |
| Google: **“access_denied — app is being tested”** | Consent screen in Testing | Publish the app, or add the user as a test user |
| Google: **“This Google account can’t open that sheet”** | Sheet not shared with that account | Share the sheet, or sign in with its owner |
| Connector says **“Login expired — reconnect”** | The token expired or was revoked | Open the connector → **Reconnect** |
| Website form / WhatsApp returns **401** | The API key is missing from the call | Send `x-api-key`, or add `?key=` to the URL (REST API & webhooks) |
