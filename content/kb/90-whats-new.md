---
title: What’s new
slug: whats-new
order: 90
summary: Changes in recent deploys.
---
## November 2026 — v1.2.0 — deleting a client

- **Client → Clients** has a **Delete** action next to View journey, verified by a one-time code on WhatsApp — the same gate used for leads.
  - Before any code is sent, you are shown exactly what goes with the client: sales order lines, unpaid invoices and their amount, pay-ins received and their amount, and tickets (with the open count). You can record a reason.
  - The code goes to your own WhatsApp number (your company's number if your profile has none) through the existing **Delete OTP** webhook event. It is valid for 5 minutes.
  - The client then leaves Clients, the Service Board, Subscription Management and its support page, together with its sales orders, invoices, pay-ins and tickets — so no stray rows are left behind.
- **Nothing is erased.** A complete copy — profile, journey, sales orders, invoices, pay-ins and tickets — is archived in your company's own database, with who deleted it, when and why, and the same is written to the activity log. Payment files in S3 are left untouched. Ask your administrator if a deleted client has to be brought back.
- **Delete is a permission, and nobody gets it automatically.** In Role Management, the **Clients** sub-module now has a Delete box. Unlike the other boxes it does not follow the Client module — a role can delete a client only once that box is ticked, so no existing role gained the ability on its own. The company owner is unaffected, and Super Admin can still restrict or pause it per company under Company → Modules.

## November 2026 — v1.1.0

- Sales Order shows one row per client, expanding to its services, with **Convert to Invoice** (Discount as a fixed amount or a percentage, and Gross).
- **Outstanding** counts only what is due up to today; later months show as **Upcoming**.
- **Company Name** on leads and clients, in the list, in search, in import and export, and in the sample file.
- **Integration → Needs attention** lists any delivery that could not be saved as a lead, with Retry and Retry all.
- WhatsApp Logs rebuilt, a more compact interface throughout, and release notes at `/release`.

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
