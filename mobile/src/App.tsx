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
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
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
          screenOptions={{
            headerStyle: { backgroundColor: T.brand },
            headerTintColor: "#fff",
            headerTitleStyle: { fontWeight: "800" },
            drawerActiveBackgroundColor: "rgba(47,92,36,0.1)",
            drawerActiveTintColor: T.brand,
            drawerLabelStyle: { fontWeight: "700" },
          }}
        >
          {can("dashboard") && (
            <Drawer.Screen name="Dashboard" options={{ title: BRAND.companyName }}>
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
