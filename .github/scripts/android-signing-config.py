#!/usr/bin/env python3
"""
Teaches android/app/build.gradle to sign the release build with the keystore the workflow just wrote.

React Native ships a build.gradle whose release build is signed with the debug key — fine for a quick run on
your own machine, useless for anything a phone will keep, because a debug-signed app cannot be updated by a
properly signed one. This rewrites two things, once, and does nothing if it has already been done:

  • a `release` entry under signingConfigs, reading the four MYAPP_UPLOAD_* values from gradle.properties
  • the release buildType, so it uses `signingConfigs.release` instead of `signingConfigs.debug`

This lives in a file rather than inline in the workflow on purpose: an embedded heredoc has to stay indented
past the YAML block it sits in, and the moment a line of Python de-indents the workflow stops being valid
YAML — which is exactly what happened before.
"""
import pathlib
import re
import sys

RELEASE_CONFIG = """signingConfigs {
        release {
            storeFile file(MYAPP_UPLOAD_STORE_FILE)
            storePassword MYAPP_UPLOAD_STORE_PASSWORD
            keyAlias MYAPP_UPLOAD_KEY_ALIAS
            keyPassword MYAPP_UPLOAD_KEY_PASSWORD
        }"""


def main() -> int:
    path = pathlib.Path("android/app/build.gradle")
    if not path.exists():
        print("::error::android/app/build.gradle is missing — is this a React Native project?")
        return 1

    text = path.read_text()
    if "MYAPP_UPLOAD_STORE_FILE" in text:
        print("The release signing config is already there.")
        return 0

    if "signingConfigs {" not in text:
        print("::error::No signingConfigs block in build.gradle, so the release key cannot be wired in.")
        return 1

    text = text.replace("signingConfigs {", RELEASE_CONFIG, 1)

    # point the release buildType at the release key instead of the debug one
    patched, n = re.subn(
        r"(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig signingConfigs\.)debug",
        r"\1release",
        text,
        count=1,
    )
    if not n:
        print("::warning::Could not find the release buildType's signingConfig line — check build.gradle by hand.")
    path.write_text(patched)
    print("Release signing config added.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
