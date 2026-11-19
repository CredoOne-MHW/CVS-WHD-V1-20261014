/**
 * The navigation drawer.
 *
 * What was here before was React Navigation's stock drawer: a white panel of plain text links with nothing
 * else in it. That is the look being complained about — it reads as a website's hamburger menu rather than
 * an app, and three things cause that, none of which are the colours:
 *
 *   1  **It is too wide.** The library sizes itself to `min(screen − 56, 280)`, which on a narrow phone
 *      leaves almost no app visible beside it, so nothing signals "this slid over the top of something".
 *      The width is now set explicitly and always leaves a strip of the app showing.
 *   2  **There is no sense of place.** No brand, no signed-in person — nothing saying whose workspace this
 *      is. A header block now carries the company and who you are signed in as.
 *   3  **Text links, no icons, no grouping.** A list of four words in a tall white rectangle is a menu on a
 *      page. Icons, tighter rows and a separated account group make it a navigation surface.
 *
 * **The items are read from the navigator, never listed here.** A hand-written list is the standing trap in
 * a custom drawer: a screen gets added to the navigator, nobody thinks to add it here, and it becomes
 * unreachable while the code that declares it looks perfectly correct. Everything below is derived from
 * `state.routes`, so a screen that exists can always be reached, and an unmapped one still gets an icon.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { CommonActions, DrawerActions } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { T, TYPE, withAlpha } from "../theme";
import { BRAND } from "../lib/api";

/**
 * The selected row's tint, taken from the company's own brand colour.
 *
 * `T.tint` is a literal `rgba(47,92,36,…)` — the default green — so a company built with another colour
 * would get a green selection sitting under its own coloured header. Derived here instead.
 */
const TINT = withAlpha(T.brand, 0.1);

type Glyph = React.ComponentProps<typeof Ionicons>["name"];

/** Inactive and active glyph for each screen. Every name here is checked against the font's glyph map. */
const ICONS: Record<string, [Glyph, Glyph]> = {
  Dashboard: ["grid-outline", "grid"],
  Chats: ["chatbubbles-outline", "chatbubbles"],
  Users: ["people-outline", "people"],
  Tickets: ["ticket-outline", "ticket"],
  Profile: ["person-circle-outline", "person-circle"],
};
/** A screen added later, before anyone maps it, gets this rather than an empty space. */
const FALLBACK: [Glyph, Glyph] = ["ellipse-outline", "ellipse-outline"];

/** The account group is split out by name; a renamed screen simply joins the main group instead. */
const ACCOUNT = ["Profile"];

type Props = DrawerContentComponentProps & { me: any; onSignOut: () => void };

export default function AppDrawer({ state, navigation, descriptors, me, onSignOut }: Props) {
  const insets = useSafeAreaInsets();

  const items = state.routes.map((route, i) => {
    const o: any = descriptors[route.key]?.options || {};
    return {
      key: route.key,
      name: route.name,
      // the drawer's own label wins, then the header title, then the route name — the library's own order
      label: typeof o.drawerLabel === "string" ? o.drawerLabel : typeof o.title === "string" ? o.title : route.name,
      focused: state.index === i,
    };
  });

  /**
   * Exactly what the library's own drawer dispatches, rather than something that behaves like it.
   *
   * `navigation.navigate(name)` looked equivalent and tests against the real router say it is — but the
   * library closes the drawer explicitly when you tap the screen you are already on, and addresses the
   * action at this navigator instead of letting it find its own way. Writing a near-equivalent of a
   * library's own behaviour is a bet that nothing else depends on the difference. There is no reason to
   * take that bet.
   */
  const go = (route: { key: string; name: string }, focused: boolean) => {
    const event = navigation.emit({ type: "drawerItemPress", target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;
    navigation.dispatch({
      ...(focused ? DrawerActions.closeDrawer() : CommonActions.navigate({ name: route.name, merge: true })),
      target: state.key,
    });
  };

  const Row = ({ it }: { it: (typeof items)[number] }) => {
    const [off, on] = ICONS[it.name] || FALLBACK;
    const colour = it.focused ? T.brand : T.muted;
    return (
      <Pressable
        onPress={() => go(it, it.focused)}
        android_ripple={{ color: TINT, borderless: false }}
        accessibilityRole="button"
        accessibilityState={{ selected: it.focused }}
        style={({ pressed }) => [s.row, it.focused && s.rowOn, pressed && !it.focused && s.rowPressed]}
      >
        <Ionicons name={it.focused ? on : off} size={19} color={colour} style={s.rowIcon} />
        <Text numberOfLines={1} style={[s.rowText, { color: it.focused ? T.brand : T.text }]}>
          {it.label}
        </Text>
        {it.focused && <View style={s.dot} />}
      </Pressable>
    );
  };

  const main = items.filter((i) => !ACCOUNT.includes(i.name));
  const account = items.filter((i) => ACCOUNT.includes(i.name));
  const role = me?.isOwner ? "Owner" : me?.roleName || (me?.kind === "customer" ? "Customer" : "Team member");

  return (
    <View style={s.panel}>
      {/* full-bleed to the top edge, so the status bar sits on brand colour rather than on white */}
      <View style={[s.head, { paddingTop: insets.top + T.md }]}>
        <View style={s.headTop}>
          <View style={s.mark}>
            <Text style={s.markText}>{(BRAND.companyName || "L").slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text numberOfLines={1} style={s.company}>
            {me?.companyName || BRAND.companyName}
          </Text>
        </View>
        <Text numberOfLines={1} style={s.who}>
          {me?.name || "Signed in"}
        </Text>
        <View style={s.chip}>
          <Text numberOfLines={1} style={s.chipText}>
            {role}
          </Text>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
        <Text style={s.group}>Menu</Text>
        {main.map((it) => (
          <Row key={it.key} it={it} />
        ))}

        {account.length > 0 && (
          <>
            <View style={s.rule} />
            <Text style={s.group}>Account</Text>
            {account.map((it) => (
              <Row key={it.key} it={it} />
            ))}
          </>
        )}
      </ScrollView>

      <View style={[s.foot, { paddingBottom: Math.max(insets.bottom, T.sm) }]}>
        <Pressable
          onPress={onSignOut}
          android_ripple={{ color: "rgba(180,35,24,0.10)" }}
          accessibilityRole="button"
          style={({ pressed }) => [s.signOut, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="log-out-outline" size={17} color={T.danger} style={s.rowIcon} />
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>
        <Text style={s.version}>
          v{BRAND.version} ({BRAND.build})
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { flex: 1, backgroundColor: T.card },

  head: { backgroundColor: T.brand, paddingHorizontal: T.pad, paddingBottom: T.md },
  headTop: { flexDirection: "row", alignItems: "center", gap: T.sm },
  mark: {
    width: 34,
    height: 34,
    borderRadius: T.radiusSm,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  company: { flex: 1, color: "#fff", fontSize: 15.5, fontWeight: "800", letterSpacing: -0.2 },
  who: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "600", marginTop: T.md },
  chip: {
    alignSelf: "flex-start",
    marginTop: T.xs,
    paddingHorizontal: T.sm,
    paddingVertical: 3,
    borderRadius: T.radiusPill,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  chipText: { color: "#fff", fontSize: 10.5, fontWeight: "700", letterSpacing: 0.2 },

  scroll: { flex: 1 },
  scrollPad: { paddingHorizontal: T.sm, paddingTop: T.md, paddingBottom: T.md },
  group: {
    ...TYPE.meta,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginLeft: T.sm,
    marginBottom: T.xs,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 42,
    paddingHorizontal: T.sm,
    borderRadius: T.radiusSm,
    marginBottom: 2,
    overflow: "hidden",
  },
  rowOn: { backgroundColor: TINT },
  rowPressed: { backgroundColor: "rgba(20,32,26,0.04)" },
  rowIcon: { width: 24 },
  rowText: { flex: 1, fontSize: 13.5, fontWeight: "700" },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.brand },

  rule: { height: StyleSheet.hairlineWidth, backgroundColor: T.line, marginVertical: T.md, marginHorizontal: T.sm },

  foot: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line, paddingHorizontal: T.sm, paddingTop: T.sm },
  signOut: { flexDirection: "row", alignItems: "center", height: 40, paddingHorizontal: T.sm, borderRadius: T.radiusSm },
  signOutText: { flex: 1, fontSize: 13.5, fontWeight: "700", color: T.danger },
  version: { ...TYPE.meta, fontSize: 10.5, marginLeft: T.sm + T.xs, marginTop: 2 },
});
