/**
 * "A newer version is out" — shown across the top of the app when one is.
 *
 * Checked when the app opens and each time it comes back to the foreground, against a public endpoint that
 * returns only a version number and the download page. An Android app installed from an .apk has no store
 * to update it, so without this a phone can sit on an old build indefinitely with nobody aware of it.
 *
 * Two things keep it from being a nuisance. A version somebody has dismissed is remembered, so the bar does
 * not come back for that version until a newer one exists. And the check is skipped entirely when the
 * platform does not answer — a build nobody can reach is not a reason to put a red bar on the screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE, BRAND } from "../lib/api";
import { T } from "../theme";

const DISMISSED = "lms.update.dismissed";

type Latest = { version: string | null; url: string | null; appName?: string; size?: number | null };

/** "1.0.0.16" vs "1.0.0.9" — compared piece by piece, so 9 is not newer than 16. */
function isNewer(theirs: string, mine: string) {
  const a = String(theirs).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(mine).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

export default function UpdateBar() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [hidden, setHidden] = useState(true);
  const checking = useRef(false);

  const mine = `${BRAND.version}.${BRAND.build}`.replace(/\.+$/, "");

  const check = useCallback(async () => {
    if (checking.current || !API_BASE || !BRAND.companyCode) return;
    checking.current = true;
    try {
      const res = await fetch(`${API_BASE}/api/public/mobile/latest?code=${encodeURIComponent(BRAND.companyCode)}&platform=${Platform.OS === "ios" ? "ios" : "android"}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return;
      const d: Latest = await res.json();
      if (!d?.version || !isNewer(d.version, mine)) return;
      const skipped = await AsyncStorage.getItem(DISMISSED).catch(() => null);
      setLatest(d);
      setHidden(skipped === d.version);
    } catch {
      /* no answer is not news */
    } finally {
      checking.current = false;
    }
  }, [mine]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  if (!latest || hidden) return null;

  return (
    <View style={s.bar}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Version {latest.version} is available</Text>
        <Text style={s.sub}>Tap Update to download and install it.</Text>
      </View>
      <Pressable style={s.btn} onPress={() => latest.url && Linking.openURL(latest.url)}>
        <Text style={s.btnText}>Update</Text>
      </Pressable>
      <Pressable
        hitSlop={10}
        onPress={() => {
          setHidden(true);
          AsyncStorage.setItem(DISMISSED, String(latest.version)).catch(() => {});
        }}
      >
        <Text style={s.x}>✕</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#1d3a16", paddingHorizontal: 14, paddingVertical: 9 },
  title: { color: "#fff", fontWeight: "800", fontSize: 12.5 },
  sub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 1 },
  btn: { backgroundColor: T.accent, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 6 },
  btnText: { color: "#1d3a16", fontWeight: "800", fontSize: 12 },
  x: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: "700", paddingHorizontal: 2 },
});
