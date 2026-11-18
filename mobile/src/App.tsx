/**
 * The company's app.
 *
 * One source, built once per company: the name, colours and address come from the build, so the app signs
 * in to its own company and nothing else. The first thing a signed-in user meets is the DPDP consent
 * screen, which cannot be passed without reading the notice; after that, the hamburger menu.
 *
 * Which screens appear follows the user's own permissions and the company's Mobile Modules — the platform
 * answers both in /auth/me, so nothing has to be rebuilt when they change.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { api, loadSession, me as fetchMe, signOut as doSignOut, BRAND } from "./lib/api";
import { T } from "./theme";
import SignIn from "./screens/SignIn";
import Consent from "./screens/Consent";
import Dashboard from "./screens/Dashboard";
import Chats from "./screens/Chats";
import Users from "./screens/Users";
import Tickets from "./screens/Tickets";
import Profile from "./screens/Profile";
import AppDrawer from "./components/AppDrawer";
import UpdateBar from "./components/UpdateBar";
import NoticeBanner from "./components/NoticeBanner";
import { registerForPush, unregisterPush, setLiveConfig, onNotificationTap } from "./lib/live";

const Drawer = createDrawerNavigator();

type Stage = "loading" | "signin" | "consent" | "app";

/**
 * A handle on the navigator, so a notification tap can move the app without going through a component.
 * The tap can arrive before anything is mounted — when the app was started *by* the notification — so it
 * is held until the navigator is ready.
 */
const navRef = createNavigationContainerRef<any>();
let pendingTap: any = null;

function goTo(data: any) {
  if (!navRef.isReady()) {
    pendingTap = data;
    return;
  }
  pendingTap = null;
  try {
    if (data?.kind === "chat" && data.threadId) navRef.navigate("Chats", { screen: "Thread", params: { threadId: String(data.threadId), title: data.title || "Conversation" } });
    else if (data?.kind === "notice") navRef.navigate("Dashboard");
    else if (data?.kind === "ticket") navRef.navigate("Tickets");
    else if (data?.kind === "app_update") navRef.navigate("Dashboard");
  } catch {
    /* a screen this user does not have — stay where we are rather than crash */
  }
}

export default function App() {
  const [stage, setStage] = useState<Stage>("loading");
  const [me, setMe] = useState<any>(null);
  const [notice, setNotice] = useState<any>(null);

  /**
   * The drawer's width, decided here rather than left to the library.
   *
   * React Navigation sizes a drawer to `min(screen − 56, 280)`. That subtracts a *fixed* 56, so the
   * narrower the phone the larger the share it takes: 68% of a 412dp screen, but 78% of a 360 and 82% of a
   * 320 — and at that point there is almost no app visible beside it, so nothing signals that a panel slid
   * over the top of something. That is the complaint.
   *
   * The rule is therefore a proportion with a ceiling: **never more than 70% of the screen, never more than
   * 280dp.** At least 30% of the app stays visible on every device. It is never wider than the stock value
   * and is 28dp narrower on a 360 and 40dp on a 320 — a proportion was checked against a fixed subtraction
   * precisely because the obvious `screen − 64` is *wider* than the default on a large phone.
   *
   * It must be read here, above the early returns below, because a hook called after them would be skipped
   * while the app is loading and then appear once it is not — which React counts as a different number of
   * hooks between renders and refuses to continue past.
   */
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = Math.min(screenWidth * 0.7, 280);

  /** Signed in? Then: has this user accepted the current version of the notice? */
  const start = useCallback(async () => {
    setStage("loading");
    await loadSession();
    try {
      const m = await fetchMe();
      setMe(m);
      const consent = await api("/co/dpdp/mine").catch(() => ({ needed: false }));
      if (consent?.needed && consent.notice) {
        setNotice(consent.notice);
        setStage("consent");
      } else setStage("app");
      // notifications and the real-time service, once signed in; neither is allowed to stop the app
      registerForPush();
      // tapping a notification opens the thing it was about, rather than wherever the app was last
      onNotificationTap(goTo);
      api("/co/chat/people").then((r: any) => setLiveConfig(r?.realtime)).catch(() => undefined);
    } catch {
      setStage("signin");
    }
  }, []);
  useEffect(() => {
    start();
  }, [start]);

  const signOut = useCallback(async () => {
    await unregisterPush(); // a shared phone stops receiving this person's messages
    await doSignOut();
    setMe(null);
    setStage("signin");
  }, []);

  if (stage === "loading")
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.brand} size="large" />
        <Text style={s.loading}>{BRAND.companyName}</Text>
      </View>
    );
  if (stage === "signin") return <Shell><SignIn onDone={start} /></Shell>;
  if (stage === "consent") return <Shell><Consent notice={notice} onAccepted={() => setStage("app")} onSignOut={signOut} /></Shell>;

  const can = (key: string) => {
    if (key === "profile") return true;
    const allowed = me?.mobileScreens; // set by the company's Mobile Modules tab
    if (Array.isArray(allowed) && !allowed.includes(key)) return false;
    /**
     * A screen's permission is not always its own name. Users sits under Role Management, whose permission
     * key is "roles:users", and a company that granted the whole of Role Management holds it as "roles" —
     * so both spellings count, exactly as the server reads them.
     */
    /**
     * A customer's screens are decided by who they are, not by a role grid.
     *
     * They are given a role so they can sign in at all, but what a customer may see is "their own things" —
     * so Tickets is always theirs, and anything belonging to the business is not.
     */
    if (me?.kind === "customer") return key === "dashboard" || key === "tickets" || key === "chats";
    const perm = key === "users" ? me?.perms?.["roles:users"] || me?.perms?.roles : key === "tickets" ? me?.perms?.["clients:tickets"] || me?.perms?.clients : me?.perms?.[key];
    return !!perm?.read;
  };

  return (
    <Shell>
      {/* above the notice, because an app that cannot be updated eventually cannot do anything else either */}
      <UpdateBar />
      <NoticeBanner companyId={me?.companyId} />
      <NavigationContainer ref={navRef} onReady={() => pendingTap && goTo(pendingTap)} theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: T.brand, background: T.bg, card: "#fff", text: T.text, border: T.line } }}>
        <Drawer.Navigator
          drawerContent={(p) => <AppDrawer {...p} me={me} onSignOut={signOut} />}
          screenOptions={{
            headerStyle: { backgroundColor: T.brand },
            headerTintColor: "#fff",
            headerTitleStyle: { fontWeight: "800" },
            /* kept, so removing the custom drawer above would still leave sane defaults behind */
            drawerActiveBackgroundColor: "rgba(47,92,36,0.1)",
            drawerActiveTintColor: T.brand,
            drawerLabelStyle: { fontWeight: "700" },
            /* a panel, not a page: fixed width, a rounded outer edge, and the app dimmed behind it */
            drawerStyle: {
              width: drawerWidth,
              backgroundColor: T.card,
              borderTopRightRadius: 18,
              borderBottomRightRadius: 18,
              overflow: "hidden",
            },
            overlayColor: "rgba(11,20,15,0.45)",
          }}
        >
          {can("dashboard") && (
            /* the header keeps the company name; the menu row says what the screen is */
            <Drawer.Screen name="Dashboard" options={{ title: BRAND.companyName, drawerLabel: "Dashboard" }}>
              {(p: any) => <Dashboard me={me} {...p} />}
            </Drawer.Screen>
          )}
          {can("chats") && <Drawer.Screen name="Chats">{() => <Chats me={me} />}</Drawer.Screen>}
          {can("users") && <Drawer.Screen name="Users">{() => <Users me={me} />}</Drawer.Screen>}
          {can("tickets") && <Drawer.Screen name="Tickets">{(p: any) => <Tickets me={me} {...p} />}</Drawer.Screen>}
          <Drawer.Screen name="Profile">{() => <Profile me={me} onSignOut={signOut} />}</Drawer.Screen>
        </Drawer.Navigator>
      </NavigationContainer>
    </Shell>
  );
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StatusBar style="light" />
      {children}
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg },
  loading: { marginTop: 14, color: T.muted, fontWeight: "700" },
});
