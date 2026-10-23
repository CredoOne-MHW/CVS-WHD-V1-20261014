---
title: What’s new
slug: whats-new
order: 90
summary: Changes in recent deploys.
---
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
