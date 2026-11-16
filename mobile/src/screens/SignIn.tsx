import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { BRAND, signIn } from "../lib/api";
import { T } from "../theme";

/** The company's own sign-in. The address is part of the build, so there is nothing to choose here. */
export default function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await signIn(email.trim().toLowerCase(), password);
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.wrap}>
        <View style={[s.logo, { backgroundColor: T.brand }]}>
          <Text style={s.logoText}>{BRAND.companyName.slice(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={s.title}>{BRAND.companyName}</Text>
        <Text style={s.sub}>Sign in with the e-mail and password your administrator gave you.</Text>

        <View style={s.card}>
          <Text style={s.label}>E-mail</Text>
          <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@company.com" placeholderTextColor={T.muted} />
          <Text style={s.label}>Password</Text>
          <TextInput style={s.input} secureTextEntry value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={T.muted} />
          {!!err && <Text style={s.err}>{err}</Text>}
          <Pressable style={[s.btn, { backgroundColor: T.brand, opacity: busy ? 0.7 : 1 }]} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sign in</Text>}
          </Pressable>
        </View>
        <Text style={s.foot}>v{BRAND.version} (build {BRAND.build})</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", padding: 24 },
  logo: { alignSelf: "center", width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  logoText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  title: { textAlign: "center", marginTop: 14, fontSize: 22, fontWeight: "800", color: T.text },
  sub: { textAlign: "center", marginTop: 6, color: T.muted, lineHeight: 20 },
  card: { marginTop: 22, backgroundColor: T.card, borderRadius: T.radius, padding: 18, borderWidth: 1, borderColor: T.line },
  label: { fontWeight: "700", color: T.text, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: T.text, backgroundColor: "#fff" },
  btn: { marginTop: 18, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  err: { marginTop: 12, color: T.danger, fontWeight: "600" },
  foot: { textAlign: "center", marginTop: 20, color: T.muted, fontSize: 12 },
});
