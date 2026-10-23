---
title: Company modules & access
slug: company-modules
order: 40
summary: Pause or restrict any module or sub-module for one company, on top of its plan.
---
## Where

**Company → Edit (or Create) → Modules** tab.

Every module and sub-module comes from the module registry, so new ones appear here automatically after each deploy.

## Three settings per row

| Setting | Effect |
|---|---|
| **Plan default** (modules) / **Follows module** (sub-modules) | Uses the plan’s access. Change the plan and this follows. |
| **Custom** | Tick exactly which of Create, Read, Update and Delete this company gets. You can restrict below the plan, or give more than the plan. A sub-module can never go beyond its module. |
| **Paused** | Switches the module (or sub-module) off for this company. The module stays in its menu marked **Paused** and shows a notice; its data is kept. Set it back to Plan default to resume. |

## What it affects

- **Every user of the company**, the owner included. Changes apply within about 30 seconds, with no sign-out needed.
- **Role Management inside the company:** the grid is capped by these settings, so paused or restricted actions can’t be granted. Roles saved earlier are capped automatically.
- **The API:** paused or restricted actions are refused on the server, not only hidden in the screens.

**Reset all to plan** removes every override for the company.
