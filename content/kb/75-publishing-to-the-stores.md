---
title: Publishing to Google Play and the App Store
slug: publishing-to-the-stores
order: 75
summary: What a store build is, the one-time set-up in each store, and how a build gets from here into Play and TestFlight.
---
## Two kinds of build

They are different files, and neither does the other's job.

| | **Direct install** | **Store upload** |
| --- | --- | --- |
| Android | `.apk` — anyone can install it from the company's download page | `.aab` — Google Play only. It does **not** install on a phone; Google makes the phone-ready files from it |
| iOS | ad-hoc `.ipa` — installs only on devices registered to the provisioning profile | App Store `.ipa` — App Store Connect only. It does **not** install by hand |

Pick with **Store build** on the company's Mobile App tab, or **What it is for** on *Mobile App Release*. The screen tells you which file you are about to get before you press the button.

A store build never appears on a company's download page, because handing somebody an `.aab` gives them a file that cannot work and no way to know why.

## One-time set-up: Google Play

1. **Create the app in the Play Console** with exactly the application id the Build screen shows (e.g. `in.credoone.lms.whd`). An id can never be changed once an app is published, so copy it rather than typing it.
2. **Upload one build by hand** to any track. Google will not accept an unknown application id over the API, so the very first one has to go through the console. Download the `.aab` from the Build screen and upload it there.
3. **Make a service account** — Play Console → Setup → API access → Create new service account → follow it into Google Cloud, make a key in JSON format, download it.
4. **Invite it back in Play Console** → Users and permissions → Invite the service-account address → give it **Release to testing tracks** on your apps.
5. **Add the key to GitHub** → the build repository → Settings → Secrets and variables → Actions → New repository secret:

   | Name | Value |
   | --- | --- |
   | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | the whole contents of the JSON file |

From then on, a store build uploads itself to the **Internal testing** track. Promoting it to Closed, Open or Production stays a decision somebody makes in the Play Console — nothing here can put an app in front of the public on its own.

## One-time set-up: the App Store

1. **Create the app in App Store Connect** with the same bundle id the Build screen shows.
2. **Make an API key** — App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key with the **App Manager** role. You can download the `.p8` **once**.
3. **Add three repository secrets** in GitHub:

   | Name | Value |
   | --- | --- |
   | `APP_STORE_CONNECT_KEY_ID` | the key's ID, e.g. `A1B2C3D4E5` |
   | `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID on the same page |
   | `APP_STORE_CONNECT_KEY_P8` | the `.p8` file, base64-encoded: `base64 -i AuthKey_XXX.p8` |

4. **The provisioning profile in `IOS_PROFILE_BASE64` must be an App Store profile.** An ad-hoc profile builds fine and is then refused on upload, which is a slow way to find out.

A store build then uploads itself, and the build appears in **TestFlight** once Apple has finished processing it — usually a few minutes, sometimes an hour. Submitting for review stays a decision somebody makes in App Store Connect.

## If you would rather upload by hand

Leave those secrets out. The store build still runs, the `.aab` or `.ipa` is still stored in the company's own folder, and the build row says *"kept on S3 — add … to upload automatically"*. Download it from the Build screen and upload it yourself. Nothing is lost by doing it this way, and for a first release it is often simpler.

## What goes wrong, and what it means

| What you see | What it is |
| --- | --- |
| *"Google Play refused the upload … Create `<id>` in the Play Console"* | Step 1 and 2 above have not been done for this company's application id. |
| *"Invite the service account in Play Console → Users and permissions"* | The key is valid but has no permission on this app. |
| *"App Store Connect refused it"* | Usually the app does not exist with that bundle id, the build number has already been used, or the profile is ad-hoc rather than App Store. |
| The build is **Ready** but nothing reached the store | The credentials are not set. The row says so, and the file is on S3. |

A failed upload **never fails the build**. The file is already stored by the time the upload is attempted, so a store that refuses costs you a retry, not a rebuild.

## Version numbers

Each company has its own version line, `<MOBILE_BASE_VERSION>.<n>`, counted per company and platform. Both stores refuse a build number they have seen before for that app, so always upload a **fresh** build rather than re-uploading one you already sent — press Build again and send the new one.
