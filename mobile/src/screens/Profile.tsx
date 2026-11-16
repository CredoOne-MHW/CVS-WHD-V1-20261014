import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BRAND } from "../lib/api";
import { T } from "../theme";

/** Who is signed in, sign out, and the version with its build number. */
export default function Profile({ me, onSignOut }: { me: any; onSignOut: () => void }) {
  const rows = [
    ["Name", me?.name],
    ["E-mail", me?.email],
    ["Company", me?.companyName || BRAND.companyName],
    ["Role", me?.isOwner ? "Owner" : me?.roleName || "Team member"],
  ].filter(([, v]) => !!v) as [string, string][];

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: T.pad }}>
      <View style={s.card}>
        <View style={[s.avatar, { backgroundColor: T.brand }]}>
          <Text style={s.avatarText}>{(me?.name || "U").slice(0, 2).toUpperCase()}</Text>
        </View>
        {rows.map(([k, v]) => (
          <View key={k} style={s.row}>
            <Text style={s.k}>{k}</Text>
            <Text style={s.v}>{v}</Text>
          </View>
        ))}
      </View>

      <Pressable style={s.out} onPress={onSignOut}>
        <Text style={s.outText}>Sign out</Text>
      </Pressable>
      <Text style={s.version}>
        {BRAND.companyName} · v{BRAND.version} (build {BRAND.build})
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.card, borderRadius: T.radius, padding: 18, borderWidth: 1, borderColor: T.line },
  avatar: { alignSelf: "center", width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  avatarText: { color: "#fff", fontWeight: "800", fontSize: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.line },
  k: { color: T.muted },
  v: { color: T.text, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  out: { marginTop: 18, backgroundColor: T.card, borderRadius: 14, borderWidth: 1, borderColor: T.line, paddingVertical: 14, alignItems: "center" },
  outText: { color: T.danger, fontWeight: "800", fontSize: 15 },
  version: { textAlign: "center", marginTop: 16, color: T.muted, fontSize: 12 },
});
