/**
 * The scrolling notice, across the top of the app.
 *
 * It is the same notice the web shows — one source, so an administrator writes it once. The text slides
 * from right to left and starts again; tapping it stops the movement so a long notice can be read, and
 * tapping again lets it run.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { subscribe, poller } from "../lib/live";
import { T } from "../theme";

const TONE: Record<string, { bg: string; fg: string }> = {
  info: { bg: T.brand, fg: "#ffffff" },
  warning: { bg: T.accent, fg: "#2a2206" },
  success: { bg: "#0f7a4a", fg: "#ffffff" },
};

export default function NoticeBanner({ companyId }: { companyId?: string }) {
  const inset = useSafeAreaInsets(); // the bar sits above the screen header, so it owns the status-bar gap
  const [items, setItems] = useState<any[]>([]);
  const [paused, setPaused] = useState(false);
  const [width, setWidth] = useState(0); // the bar
  const [textWidth, setTextWidth] = useState(0); // the notice itself
  const x = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    const r = await api("/co/chat/notices").catch(() => ({ items: [] }));
    setItems(r.items || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!companyId) return;
    let stop = () => {};
    subscribe(`private-co-${companyId}-all`, { notice: load }).then((f) => (stop = f));
    const off = poller(load, 60000);
    return () => {
      stop();
      off();
    };
  }, [companyId, load]);

  // a short notice stays put and is read at a glance; only one too long for the bar slides
  const scrolls = textWidth > width + 4;

  // one loop of the text, at a readable speed whatever its length
  useEffect(() => {
    if (!width || !scrolls || paused || !items.length) return;
    x.setValue(width);
    const anim = Animated.loop(
      Animated.timing(x, { toValue: -width, duration: Math.max(9000, width * 28), easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, [width, scrolls, paused, items.length, x]);

  if (!items.length) return null;
  const n = items[0];
  const tone = TONE[n.tone] || TONE.info;

  return (
    <Pressable onPress={() => setPaused((p) => !p)} style={[s.bar, { backgroundColor: tone.bg, paddingTop: 7 + inset.top }]}>
      <View style={s.clip} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        <Animated.Text
          onLayout={(e: any) => setTextWidth(Math.round(e.nativeEvent.layout.width))}
          style={[s.text, { color: tone.fg }, scrolls && !paused && { transform: [{ translateX: x }] }]}
        >
          {n.text}
          {items.length > 1 ? `   ·   +${items.length - 1} more` : ""}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: { paddingVertical: 7, paddingHorizontal: 12 },
  clip: { overflow: "hidden", flexDirection: "row" },
  text: { fontSize: 13, fontWeight: "700", flexShrink: 0 },
});
