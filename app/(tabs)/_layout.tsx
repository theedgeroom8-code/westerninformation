import { useEffect } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBettingStore } from "../../store/bettingStore";
import { useBreakpoint } from "../../lib/responsive";
import { WebSidebar } from "../../components/WebSidebar";
import { colors, font } from "../../theme";

function TabIcon({ name, color, focused }: { name: any; color: string; focused: boolean }) {
  return <Ionicons name={focused ? name : `${name}-outline`} size={22} color={color} />;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { isDesktop } = useBreakpoint();
  const unread = useBettingStore(
    (s) =>
      s.alerts.filter((a) => !a.read).length +
      s.broadcasts.filter((b) => b.createdAt > s.seenBroadcastsAt).length
  );

  // Browser-tab badge: "(3) WIN" while alerts are unread
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.title = unread > 0
      ? `(${unread}) Western Information Network`
      : "Western Information Network — Real-Time Sports Market Intelligence";
  }, [unread]);

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textMuted,
        // Desktop web navigates via the sidebar — hide the phone tab bar.
        tabBarStyle: isDesktop
          ? { display: "none" }
          : {
              backgroundColor: "#0C111D",
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: 60 + insets.bottom,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
              paddingTop: 8,
            },
        tabBarLabelStyle: { fontSize: font.caption, fontWeight: font.semibold, letterSpacing: 0.2 },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarLabel: "Edges", tabBarIcon: (p) => <TabIcon name="flash" {...p} /> }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          tabBarLabel: "Alerts",
          tabBarIcon: ({ color, focused }) => (
            <View>
              <TabIcon name="notifications" color={color} focused={focused} />
              {unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="bets"
        options={{ tabBarLabel: "Plays", tabBarIcon: (p) => <TabIcon name="receipt" {...p} /> }}
      />
      <Tabs.Screen
        name="bankroll"
        options={{ tabBarLabel: "Balance", tabBarIcon: (p) => <TabIcon name="wallet" {...p} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{ tabBarLabel: "Account", tabBarIcon: (p) => <TabIcon name="person-circle" {...p} /> }}
      />
    </Tabs>
  );

  if (!isDesktop) return tabs;

  return (
    <View style={styles.desktop}>
      <WebSidebar unread={unread} />
      <View style={{ flex: 1 }}>{tabs}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  desktop: { flex: 1, flexDirection: "row", backgroundColor: colors.bg },
  badge: {
    position: "absolute",
    top: -5,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#0C111D",
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: font.bold },
});
