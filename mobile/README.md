# The company apps (Android & iOS)

One React Native (Expo) source, built once per company. A build is branded by `scripts/brand.mjs` from the
values the platform passes in — name, application id, colours, version and the company's own address — so an
app only ever talks to the company it was built for.

## What is in it

| Screen | What it does |
| --- | --- |
| Sign in | The company's own sign-in. There is no address to choose: it is part of the build. |
| Consent | The DPDP notice at the first sign-in, and again whenever the company publishes a new version. Accept turns on only after the notice has been read to the end. |
| Dashboard | Today's leads, follow-ups due, conversions and clients. |
| Chats | One-to-one and group messages — arriving in v1.6.0. |
| Profile | Who is signed in, sign out, and the version with its build number. |

Which screens appear follows the user's own permissions and the company's **Mobile Modules** tab, both of
which the platform answers in `/auth/me` — so neither needs a rebuild.

## Building

Builds run on GitHub Actions (`.github/workflows/build-mobile.yml`), started from Super Admin › Company ›
Mobile App › **Build**. The signed file is uploaded to that company's own S3 folder under
`<COMPANY CODE>/app/<platform>/<version>/` and the result is reported back to the platform.

**Android keeps the same signing key for every build.** Add the four `ANDROID_*` secrets to this repository
before the first build; a build signed with a throw-away key cannot be installed over an earlier one, and
staff would have to uninstall the app (losing anything held on the device) to take the update.

## Running it locally

```bash
cd mobile
npm install
API_BASE=https://<company>.mhw.credovation.tech COMPANY_CODE=WHD APP_NAME="Wellness Hive" node scripts/brand.mjs
npx expo start
```
