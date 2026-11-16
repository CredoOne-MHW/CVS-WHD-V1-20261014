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
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
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
import Profile from "./screens/Profile";
import NoticeBanner from "./components/NoticeBanner";
import { registerForPush, unregisterPush, setLiveConfig } from "./lib/live";

const Drawer = createDrawerNavigator();

type Stage = "loading" | "signin" | "consent" | "app";

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
    return !!me?.perms?.[key]?.read;
  };

  return (
    <Shell>
      <NoticeBanner companyId={me?.companyId} />
      <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: T.brand, background: T.bg, card: "#fff", text: T.text, border: T.line } }}>
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
          {can("dashboard") && <Drawer.Screen name="Dashboard" component={Dashboard} options={{ title: BRAND.companyName }} />}
          {can("chats") && <Drawer.Screen name="Chats">{() => <Chats me={me} />}</Drawer.Screen>}
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
