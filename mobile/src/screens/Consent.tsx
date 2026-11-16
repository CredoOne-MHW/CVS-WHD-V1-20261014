import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { API_BASE, BRAND, api } from "../lib/api";
import { T } from "../theme";

/**
 * The DPDP consent screen, shown at the first sign-in and again whenever the company publishes a new
 * version of its notice. Accept turns on only once the notice has been scrolled to the end and a sensible
 * amount of time has passed — the same rule the website uses, and the platform checks it again.
 *
 * There is no way past this screen other than accepting or signing out.
 */
export default function Consent({ notice, onAccepted, onSignOut }: { notice: any; onAccepted: () => void; onSignOut: () => void }) {
  const [read, setRead] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const opened = useRef(new Date());

  useEffect(() => {
    const t = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (pct >= 98 && seconds >= 5) setRead(true);
  }, [pct, seconds]);

  // the notice is HTML, so it is shown in a web view that tells us how far it has been scrolled
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.65 -apple-system,Roboto,system-ui;color:#16211a;margin:0;padding:18px}h1{font-size:21px}h2{font-size:17px;margin-top:26px}p,li{color:#2c3a32}</style>
<body>${notice.html}</body>
<script>
  function report(){var d=document.documentElement;var max=d.scrollHeight-window.innerHeight;
    var p=max<=4?100:Math.min(100,Math.round(window.scrollY/max*100));
    window.ReactNativeWebView.postMessage(String(p));}
  window.addEventListener('scroll',report);window.addEventListener('load',report);setTimeout(report,400);
</script>`;

  async function accept() {
    setBusy(true);
    setErr("");
    try {
      await api("/co/dpdp/accept", {
        body: {
          documentId: notice.id || notice._id,
          documentVersion: notice.version,
          purposes: ["contact", "service", "records"],
          source: "app",
          page: "app:first-login",
          openedAt: opened.current,
          readSeconds: seconds,
          scrollPct: pct,
          reachedEndAt: new Date(),
        },
      });
      onAccepted();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={s.head}>
        <Text style={s.title}>{notice.title}</Text>
        <Text style={s.sub}>
          {BRAND.companyName} · Digital Personal Data Protection Act, 2023 · v{notice.version}
        </Text>
      </View>
      <View style={s.doc}>
        <WebView originWhitelist={["*"]} source={{ html, baseUrl: API_BASE }} onMessage={(e) => setPct((p) => Math.max(p, Number(e.nativeEvent.data) || 0))} />
      </View>
      <View style={s.foot}>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${pct}%`, backgroundColor: T.brand }]} />
        </View>
        <Text style={s.progress}>{read ? "Read" : `${pct}% read — please scroll to the end`}</Text>
        {!!err && <Text style={s.err}>{err}</Text>}
        <Pressable style={[s.btn, { backgroundColor: read ? T.brand : "rgba(22,33,26,0.15)" }]} disabled={!read || busy} onPress={accept}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={[s.btnText, { color: read ? "#fff" : T.muted }]}>I have read and accept</Text>}
        </Pressable>
        <Pressable onPress={onSignOut}>
          <Text style={s.out}>Sign out instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { padding: 16, paddingTop: 54, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: T.line },
  title: { fontSize: 18, fontWeight: "800", color: T.text },
  sub: { marginTop: 4, color: T.muted, fontSize: 12 },
  doc: { flex: 1, backgroundColor: "#fff" },
  foot: { padding: 16, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: T.line },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(22,33,26,0.1)", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  progress: { marginTop: 8, color: T.muted, fontSize: 12, fontWeight: "600" },
  btn: { marginTop: 12, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnText: { fontWeight: "800", fontSize: 16 },
  err: { marginTop: 10, color: T.danger, fontWeight: "600" },
  out: { textAlign: "center", marginTop: 14, color: T.muted, fontWeight: "600" },
});
