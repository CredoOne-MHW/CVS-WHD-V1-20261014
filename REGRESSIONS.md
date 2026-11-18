# Regression checklist

Every bug that has cost a release, and what now stops it coming back.

**This is not a list to read and nod at.** Each line names the check that fails if the bug returns. Run
`npm run preflight` before every release — it runs all of them and prints this list with the result.

A fix without a check on this list is not finished. If something breaks that is not here, it goes here in
the same release that fixes it.

---

## The rule that produced most of this list

> **The release ships as two halves, deployed separately.** Platform code goes to Vercel; `mobile/` and
> `.github/` go to the build repository. Four separate failures came from those two halves disagreeing.

Guarded by revision markers (`WORKFLOW_REVISION` / `MOBILE_REVISION` against the markers in the files),
checked by `test:workflow`. Mobile App Release shows the repository as "behind" until it is pushed.

---

## Build pipeline

| # | What went wrong | Release | What stops it now | Check |
|---|---|---|---|---|
| 1 | Workflow was not valid YAML — an inline Python heredoc de-indented below its block scalar, so GitHub rejected the whole file | 1.5.0–1.8.x | Scripts live in `.github/scripts/*.mjs`, never inline; the YAML is parsed in the test | `test:workflow` |
| 2 | Python used at all, against the stated stack | 1.8.x | Both build scripts are `.mjs`; no `python` anywhere in the workflow | `test:workflow` |
| 3 | `readyToBuild()` called with no arguments — panel showed green, build was refused | 1.8.x | The secret is resolved first, then passed in | `test:gate` |
| 4 | "0 builds started" — bulk build was a guaranteed no-op with 0 eligible companies | 1.8.x | Refuses with a sentence saying why, not a count | `test:errors` |
| 5 | `GITHUB_BUILD_WORKFLOW` pointed at `build-desktop.yml`, copied from another project | 1.8.x | The workflow name is a constant, not an env var | `test:workflow` |
| 6 | `setup-node` cache failed — no lockfile | 1.8.x | `mobile/package-lock.json` committed; cache step is conditional | `test:workflow` |
| 7 | `ENOENT ./assets/icon.png` — `mobile/assets/` was empty | 1.8.x | `brand.mjs` checks every image `app.json` names and says which is missing | `test:gate` |
| 8 | `spawn keytool ENOENT` — Vercel has no JDK | 1.8.x | Keystores are generated with `node-forge`, no JDK needed | `test:signing` |
| 9 | Keystore had separate store/key passwords and a meaningless fingerprint | 1.8.x | One password for both; fingerprint read from the certificate | `test:signing` |
| 10 | `Unable to resolve module @react-native-community/netinfo` — pulled in by `pusher-js` but declared nowhere | 1.8.12 | Declared in `mobile/package.json`; Metro bundles the app exactly as Gradle does | `verify:bundle` |
| 11 | `s3:///CVS/...` — empty bucket in the upload address | 1.8.x | The platform sends a full `s3://bucket/path`; shell parsing tested | `test:workflow` |
| 12 | `NoCredentialsError` — the runner had no AWS credentials of its own | 1.8.x | First step fails fast naming the missing secrets; the panel can push them | `test:workflow` |
| 13 | `404 · Company not found` — a sub-router mounted under `/:id` without `mergeParams` | 1.8.16 | Every router mounted under a parameter is scanned for it | `test:routes` |
| 14 | Shared code placed in `shared/` broke the app build — the build repo only receives `mobile/` and `.github/` | 1.11.0 | Caught by bundling the app the way Gradle does | `verify:bundle` |
| 15 | `Could not get unknown property 'MYAPP_UPLOAD_STORE_FILE'` — properties appended with `>>` to a file with no trailing newline | 1.11.1 | Properties are read-modify-written by a script that verifies them afterwards | `test:gradle` |
| 16 | `expo-modules-core:compileReleaseKotlin FAILED` — compiled against API 35, which Expo 51 cannot do | 1.11.2 | The ceiling per Expo release is recorded; a level above it fails in seconds, not minutes | `test:builds` |

## Errors and the interface

| # | What went wrong | Release | What stops it now | Check |
|---|---|---|---|---|
| 17 | Mobile App tab spun for ever — a `.then()` with no `.catch()` | 1.7.0 | Error state and retry on the tab; silent-failure screens audited | manual |
| 18 | "Internal server error (ref …)" — `startBuild` threw past a route with no `.catch` | 1.8.x | Every build route turns the real message into a 400 | `test:errors` |
| 19 | Unhandled rejections carrying a `.status` were swallowed, so nothing appeared | 1.8.14 | They raise a toast through `toastFromAnywhere` | manual |
| 20 | Multer and AWS refusals surfaced as 500s | 1.8.x | `known()` maps them to readable 400/502s | `test:errors` |
| 21 | "Exceeded File Size" wording had to be exact | 1.10.0 | The phrase itself is asserted | `test:errors` |
| 22 | All four app dashboard tiles read a payload shape that never existed — three showed `0`, one showed `[object Object]` | 1.9.0 | Tiles read the real shape through a `num()` guard | manual |
| 23 | "Add user" was permanently disabled for anyone with Users but not Roles permission | 1.9.0 | A narrower endpoint returns role names under the Users permission | manual |
| 24 | Ticks on sent messages could never change — catch-up only fetches *newer* messages | 1.11.0 | Read receipts arrive over the live channel, with a polling fallback that merges read counts | `test:chat` |
| 25 | Arriving messages scrolled the view away from what you were reading | 1.11.0 | Only follows when already at the newest message | manual |
| 26 | The polling note rendered underneath the floating buttons, half-hidden | 1.12.0 | Moved to the top of the screen as its own strip | manual |
| 27 | Journey had its own scroll inside a drawer that already scrolled — two scrollbars, entries cut off | 1.12.0 | No nested scroll; the drawer scrolls once | manual |

## Tenancy and privacy

| # | What went wrong | Release | What stops it now | Check |
|---|---|---|---|---|
| 28 | Chat exposes names and roles only — never a phone number or e-mail | — | `publicMember()` is the only shape that leaves the server | manual |
| 29 | Attachments must not be reachable without membership | 1.9.0 | Membership re-checked at read time; links expire in five minutes | manual |
| 30 | A customer must never see another customer's tickets | 1.12.0 | Customer endpoints scope by the client on the sign-in, never by a permission | `test:tenancy` |
| 31 | Registering a phone for notifications needed Chats permission, so customers and chat-less roles could never receive anything | 1.13.0 | Registering a device needs only a valid session | `test:push` |
| 32 | A build with no Expo project id or Firebase config produces an app that silently receives nothing | 1.13.0 | The build warns loudly for each, and Super Admin shows how many phones are registered | `test:push` |
| 33 | A customer could find every other customer of the same company in chat search — and reach them, since the member id travels in the request | 1.14.0 | The directory is filtered for a customer, and all three routes that build a member list refuse one; the number of User reads in `chat.ts` is asserted so a fourth cannot appear unnoticed | `test:tenancy` |
| 34 | The client and lead search was reachable by a customer whose role happened to include Users | 1.14.0 | It refuses a customer sign-in outright, before the permission is consulted | `test:tenancy` |

## The app's own interface

| # | What went wrong | Release | What stops it now | Check |
|---|---|---|---|---|
| 35 | The drawer was the library's stock panel and took 78–82% of a narrow screen, leaving nothing of the app beside it — it read as a web page's menu, not an app | 1.15.0 | The width is a proportion with a ceiling, asserted never wider than the default it replaced and never past 70% on any device | `test:drawer` |
| 36 | A custom drawer that lists its own items leaves a newly added screen unreachable, and an icon name not in the font renders as a blank box — both silent | 1.15.0 | Items are derived from the navigator's routes with an icon fallback, and every glyph name is checked against the font file | `test:drawer` |
| 37 | A hook added below an early return crashes only on the move from loading to signed-in, never on first paint | 1.15.0 | The width hook's position is asserted to be above the first early return | `test:drawer` |

---

## Before every release

```
npm run preflight
```

It runs, in order: typecheck (platform **and** app), the full test suite, the production build, and the
Metro bundle — then prints this checklist with a pass or fail against each automated line.

The lines marked **manual** have no automated guard yet. Read them and confirm by hand. Adding a check for
one of them is always worth more than adding a new feature on top of it.
