#!/usr/bin/env python3
"""
Sends a finished Android App Bundle to Google Play, onto the Internal testing track.

It talks to Google's own Publishing API with a service-account key, so no third-party tool ever sees the
key or the bundle. The Internal track is deliberate: it puts the build in front of your testers within
minutes and never in front of the public, and promoting it to Closed, Open or Production stays a decision
somebody makes in the Play Console.

This never raises on a refusal from Google. The bundle is already on S3 by the time this runs, so a failure
here means "upload it by hand", not "build it again".

  PLAY_PACKAGE   the application id, which must already exist in the Play Console
  PLAY_AAB       path to the .aab
  PLAY_SA_JSON   path to the service-account key file
"""
import os
import sys


def main() -> int:
    pkg = os.environ.get("PLAY_PACKAGE", "").strip()
    aab = os.environ.get("PLAY_AAB", "").strip()
    key = os.environ.get("PLAY_SA_JSON", "/tmp/play.json")

    if not (pkg and aab and os.path.exists(aab) and os.path.exists(key)):
        print(f"::warning::Nothing to upload (package={pkg!r}, bundle={aab!r}). The .aab is on S3.")
        return 0

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        print("::warning::google-api-python-client is not installed, so the bundle was not uploaded. It is on S3.")
        return 0

    try:
        creds = service_account.Credentials.from_service_account_file(
            key, scopes=["https://www.googleapis.com/auth/androidpublisher"]
        )
        api = build("androidpublisher", "v3", credentials=creds, cache_discovery=False)

        edit = api.edits().insert(packageName=pkg, body={}).execute()["id"]
        up = (
            api.edits()
            .bundles()
            .upload(packageName=pkg, editId=edit, media_body=aab, media_mime_type="application/octet-stream")
            .execute()
        )
        code = up["versionCode"]
        api.edits().tracks().update(
            packageName=pkg,
            editId=edit,
            track="internal",
            body={"releases": [{"versionCodes": [code], "status": "completed"}]},
        ).execute()
        api.edits().commit(packageName=pkg, editId=edit).execute()
    except Exception as e:  # noqa: BLE001 — any refusal from Google is reported, never fatal
        hint = ""
        text = str(e)
        if "packageName" in text or "404" in text:
            hint = f" Create {pkg} in the Play Console and upload one build there by hand first — Google will not accept an unknown application id over the API."
        elif "403" in text or "permission" in text.lower():
            hint = " Invite the service account in Play Console → Users and permissions, with Release to testing tracks."
        print(f"::warning::Google Play refused the upload: {text}{hint} The .aab is on S3 and can be uploaded by hand.")
        return 0

    print(f"Uploaded version code {code} to the Internal testing track.")
    with open(os.environ.get("GITHUB_OUTPUT", "/dev/null"), "a") as fh:
        fh.write(f"note=uploaded to the Internal testing track (version code {code})\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
