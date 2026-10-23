---
title: Platform Apps setup
slug: platform-apps
order: 10
summary: Enter Credovation’s Meta, LinkedIn and Google apps once — every company then connects with a sign-in button.
---
## How it works

The Super Admin sets up **one sign-in app per platform**, once, in **Settings → Platform Apps**. After that, every company connects its own accounts by clicking **Connect** in **Integration**. It signs in on the platform’s own page and never sees App IDs or secrets.

Until a platform is saved, companies see that channel as **“Not enabled yet”**, with no Connect button.

> **Already using these apps for SMC?** You can use the **same** Meta, LinkedIn and Google apps. Enter the same IDs and secrets here. In each app, also add this platform’s callback URL (below), and the lead permissions listed for that platform.

On each card:
1. Paste the **ID** and **Secret** → **Save**.
2. Register the **callback URL(s)** shown on the card in the platform’s developer console, exactly as shown (https, no trailing slash).
3. Click **Test** and fix anything marked in red.

| Platform | Callback URL | Webhook URL |
|---|---|---|
| Meta (Facebook & Instagram) | `{{metaCallback}}` | `{{metaWebhook}}` |
| LinkedIn | `{{linkedinCallback}}` | `{{linkedinWebhook}}` |
| Google | `{{googleCallback}}` | — |

## Meta — Facebook Lead Ads and Instagram Lead Ads

1. developers.facebook.com → **My Apps** → open the Credovation app, or **Create app** (type **Business**).
2. Add the use cases for **Lead Ads** (capture and manage ad leads) and **Facebook Login for Business**. Menu names can change slightly when Meta updates its dashboard.
3. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs** → add `{{metaCallback}}`.
4. **App settings → Basic**:
   - App Domains: add `{{baseDomain}}`
   - Privacy Policy URL: `{{privacyUrl}}`
   - Terms of Service URL: `{{termsUrl}}`
   - User data deletion → Data deletion instructions URL: `{{dataDeletionUrl}}`
   - Copy the **App ID** and **App Secret** into the Meta card → **Save**.
5. Click **Test**. It checks the ID and secret, checks App Domains, and **subscribes the lead webhook for you** (Page → `leadgen` → `{{metaWebhook}}`). If it can’t, do it by hand: **Webhooks → Page → Subscribe**, with the Callback URL `{{metaWebhook}}` and the **Verify token** from the card, then subscribe to **leadgen**.
6. Switch the app to **Live**.
7. **Permissions the connectors ask for:** `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, `ads_management` and `business_management`. Instagram also asks for `instagram_basic`.
8. **For companies other than Credovation:**
   - Until Meta approves **Advanced Access** for the permissions above, only people with a role on the app (Administrators, Developers, Testers) can connect.
   - To get Advanced Access: **App Review → Permissions and Features** → request Advanced Access for each permission (screen recording plus use-case text), and complete **Business Verification** of Credovation.
   - Until it’s approved, add client users as **Testers** (App roles → Roles).

**Use-case text for App Review:** “CredoOne is a lead management system. A business connects its Facebook Page so that the people who fill its Lead Ad forms are added to its CRM as leads. We list the user’s Pages so they can choose which to connect, subscribe the Page to leadgen webhooks and read each lead’s form answers.”

**Screen recording (1–3 min):**
1. Sign in to the company console → Integration → Facebook Lead Ads → Connect.
2. Consent notice → Facebook login → permission screen → pick the Page → Connected.
3. Create a test lead with the Lead Ads Testing Tool → the lead appears in Leads.

## LinkedIn — Lead Gen Forms

1. linkedin.com/developers/apps → open the Credovation app, or **Create app** linked to the Credovation Company Page. A Page admin must **Verify** it (Settings tab).
2. **Auth** tab:
   - Authorized redirect URLs → add `{{linkedinCallback}}`.
   - Copy the **Client ID** and **Client Secret** into the LinkedIn card → **Save** → **Test**.
3. **Products** tab → request **Lead Sync API**. LinkedIn reviews this. If it can’t be added next to the app’s other products, create a second app just for it and use that one here.
4. The scopes used are `r_marketing_leadgen_automation`, `r_ads` and `r_organization_admin`.
5. **Webhooks** tab (when available for the app) → add `{{linkedinWebhook}}`. LinkedIn validates it automatically, and responses then arrive within seconds. Without it, responses are fetched every 15 minutes.

LinkedIn logins last about 60 days. After that, companies see **“Reconnect”**.

## Google — Google Sheets / Google Forms

1. console.cloud.google.com → the Credovation project.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **OAuth consent screen** (Google Auth Platform):
   - Data access → add the scope `https://www.googleapis.com/auth/spreadsheets.readonly`.
   - Home page `{{platformUrl}}`, privacy `{{privacyUrl}}`, terms `{{termsUrl}}`, and the authorised domain for `{{baseDomain}}`.
   - Audience → **Publish app**.
4. **Credentials → OAuth client ID (Web application)** → Authorised redirect URIs → add `{{googleCallback}}`. Copy the **Client ID** and **Client Secret** into the Google card → **Save** → **Test**.
5. Until Google verifies the app, users see “Google hasn’t verified this app” and click **Advanced → Go to CredoOne**. This works for up to 100 users. Submit for verification to remove the warning.

## Privacy contact

The **Privacy contact** card sets the email, grievance officer, legal name and address. They appear on every consent notice and on the public pages the platform apps link to:
- `{{privacyUrl}}`
- `{{termsUrl}}`
- `{{dataDeletionUrl}}`

It starts as `support@credovation.tech`. Change it if privacy requests should go elsewhere. Currently: **{{privacyEmail}}**.
