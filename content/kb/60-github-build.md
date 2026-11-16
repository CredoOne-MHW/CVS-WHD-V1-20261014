---
title: GitHub build
slug: github-build
order: 60
summary: Set up the Android and iOS app builds once — after that, each company's app is one button on its Mobile App tab.
---
## What this is

Every company gets its own Android (and, once signing is set up, iOS) app, built from one shared source. The build runs on **GitHub Actions** in this platform's own repository, the finished signed file is uploaded to **that company's own S3 folder**, and the company downloads it from its **Mobile App** page.

Nothing is built on this server, and **no signing key is ever stored on the platform**. The keys live in the build repository's GitHub secrets, where a build can use them and nobody can read them back.

```
Super Admin → Company → Mobile App → Build
        ↓
GitHub Actions  (build-mobile.yml)   ← signing keys live here
        ↓
S3   <COMPANY CODE>/app/<platform>/<version>/<file>
        ↓
Company → Mobile App → Download
```

---

## 1. The repository

The app source is the **`mobile/`** folder of this repository, and the workflow is **`.github/workflows/build-mobile.yml`**. Both are already in the code you deploy — push them to the branch you build from, and **open the repository's Actions tab once** so Actions are enabled for it.

If you would rather keep the app in a repository of its own, copy `mobile/`, `.github/workflows/build-mobile.yml` and `.github/scripts/report.mjs` into it and point `GITHUB_BUILD_REPO` there instead. Nothing else changes.

---

## 2. Platform settings

Set these where the platform runs (Vercel → Settings → Environment Variables), then redeploy:

| Variable | What to put |
|---|---|
| `GITHUB_BUILD_REPO` | `owner/repo` of the repository above |
| `GITHUB_BUILD_TOKEN` | A fine-grained token with **Actions: read and write** on that repository |
| `GITHUB_BUILD_REF` | The branch to build from — leave empty for the default branch |
| `GITHUB_BUILD_WORKFLOW` | Leave empty unless you renamed `build-mobile.yml` |
| `MOBILE_BUILD_SECRET` | A long random value. **The same value goes in the repository's secrets** — it is how a finished build proves it is yours |
| `MOBILE_BASE_VERSION` | `1.0.0` — builds are numbered `1.0.0.1`, `1.0.0.2`, … per company |
| `MOBILE_PACKAGE_PREFIX` | e.g. `in.credoone.lms` → each company gets `in.credoone.lms.<code>` |
| `MOBILE_IOS_SIGNING` | `1` only after step 4 |

The Mobile App tab shows each of these as green or red under **Your set-up now**, so you can check without leaving the screen.

---

## 3. Repository secrets — Android

GitHub → the repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | What to put |
|---|---|
| `MOBILE_BUILD_SECRET` | The same value as on the platform |
| `S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | The bucket the platform uses, with write access |
| `ANDROID_KEYSTORE_BASE64` | base64 of your `.jks` keystore |
| `ANDROID_KEYSTORE_PASSWORD` | |
| `ANDROID_KEY_ALIAS` | |
| `ANDROID_KEY_PASSWORD` | |

> **Do this before the first Android build.** Android only installs an update when it is signed with the **same key** as the installed app. Without these secrets the build stops rather than signing with a throw-away key — because a throw-away key means staff must uninstall the app, and lose anything held on the device, to take the next version.

Make the keystore once, for every company, on any machine with Java (`keytool` comes with it):

```bash
keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias credoone
base64 -w0 release.jks > release.jks.b64      # macOS: base64 -i release.jks -o release.jks.b64
```

Paste the contents of `release.jks.b64` into `ANDROID_KEYSTORE_BASE64`, and **keep `release.jks` somewhere safe** — losing it means no company's app can ever be updated again.

With the GitHub command line, from the repository folder:

```bash
gh secret set MOBILE_BUILD_SECRET
gh secret set ANDROID_KEYSTORE_BASE64 < release.jks.b64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

---

## 4. Repository secrets — iOS (optional)

iOS needs an Apple Developer account. Add `IOS_CERT_P12_BASE64`, `IOS_CERT_PASSWORD`, `IOS_PROFILE_BASE64` and `IOS_TEAM_ID` as secrets, then set `MOBILE_IOS_SIGNING=1` on the platform. Until then, the iOS button stays switched off and says why.

---

## 5. The first build

1. Super Admin → a company → **Mobile App**.
2. Check the app name, the application id and the colour, upload a 1024×1024 icon, and **Save**.
3. **Build Android**. It takes 10–20 minutes; the row shows Queued → Building → Ready and links to the run on GitHub.
4. When it says Ready, download the `.apk` on an Android phone, allow "Install unknown apps" for the browser, and sign in with a staff login of that company.
5. Build again and install over it — it must update **without** uninstalling. If Android says "App not installed", the signing key changed: check step 3.

The apps are **native screens**, not the website in a frame. They talk to the address the company uses — its own domain where it has one, otherwise its platform address — over HTTPS, so that address must be reachable from phones. Changing a company's address needs a new build.

---

## 6. What the app shows

The **Mobile Modules** tab decides which modules the apps may show, and each user's role decides what they may open. Both are read when the app starts, so changing either needs **no** new build. A new build is needed only for the name, icon, colours, application id or address.

At the first sign-in the app shows the company's **DPDP notice**, which must be scrolled to the end before it can be accepted — and every acceptance appears under DPDP → Acceptance status, marked as coming from the app.

---

## 7. If something goes wrong

| Message | What it means |
|---|---|
| **GitHub refused the build (404)** | The workflow file is not on the branch, or Actions have never been enabled. Push `.github/workflows/build-mobile.yml` and open the Actions tab once. |
| **GitHub refused the build (401 / 403)** | `GITHUB_BUILD_TOKEN` is wrong, expired, or lacks **Actions: read and write** on that repository. |
| **Not set up yet — missing …** | One of the platform settings in step 2 is empty. The red lines under *Your set-up now* name them. |
| **ANDROID_KEYSTORE_BASE64 is not set** | The build stopped on purpose. Finish step 3 first. |
| **App not installed** on the phone | The build was signed with a different key than the installed app. Use the same keystore. |
| **Build stuck on Building** | The run failed without reporting back. Open the run on GitHub; the nightly housekeeping job marks builds older than 90 minutes as failed. |
| Nothing arrives in S3 | The repository's AWS secrets cannot write to the bucket, or `S3_BUCKET` differs from the platform's. |
