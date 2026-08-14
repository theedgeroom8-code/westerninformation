import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../../components/Screen";
import { FadeIn } from "../../components/FadeIn";
import { useBreakpoint, webMaxWidth } from "../../lib/responsive";
import { colors, spacing, radius, font, shadow } from "../../theme";

const FEATURES = [
  {
    icon: "pulse",
    title: "Real-time edge detection",
    desc: "Our engine continuously compares prices across global sports markets and flags inefficiencies the moment they appear.",
  },
  {
    icon: "calculator",
    title: "Disciplined position sizing",
    desc: "Every alert arrives with a suggested amount computed from your balance using the Kelly Criterion — no guesswork.",
  },
  {
    icon: "trending-up",
    title: "Complete performance tracking",
    desc: "Track every play, get results settled automatically, and watch your ROI, win rate, and P&L in real time.",
  },
] as const;

const STEPS = [
  { n: "1", title: "We watch the markets", desc: "NFL, NBA, WNBA, MLB, NHL and college sports — scanned around the clock." },
  { n: "2", title: "You get the play", desc: "An instant alert with exactly what, where, and how much — sized to your balance." },
  { n: "3", title: "Results, tracked", desc: "Outcomes settle automatically and your performance record builds itself." },
] as const;

export default function LandingScreen() {
  const router = useRouter();
  const { isDesktop, isTablet } = useBreakpoint();

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, webMaxWidth(1040)]}>
        {/* top bar */}
        <View style={styles.topBar}>
          <View style={styles.topBrand}>
            <Image source={require("../../assets/images/logo.png")} style={styles.topLogo} />
            <Text style={styles.topName}>Western Information Network</Text>
          </View>
          <TouchableOpacity style={styles.signInBtn} onPress={() => router.push("/login")} activeOpacity={0.8}>
            <Text style={styles.signInText}>Sign In</Text>
          </TouchableOpacity>
        </View>

        {/* hero */}
        <FadeIn delay={0}>
          <View style={styles.hero}>
            <Image source={require("../../assets/images/logo.png")} style={styles.heroLogo} />
            <Text style={[styles.heroTitle, isTablet && { fontSize: 40, lineHeight: 46 }]}>
              Real-time sports market intelligence
            </Text>
            <Text style={styles.heroSub}>
              We find the pricing inefficiencies. You get the exact play, perfectly sized to your balance,
              the second it appears — with every result tracked automatically.
            </Text>
            <View style={styles.ctaRow}>
              <TouchableOpacity style={styles.primaryCta} onPress={() => router.push("/signup")} activeOpacity={0.85}>
                <Text style={styles.primaryCtaText}>Get Started</Text>
                <Ionicons name="arrow-forward" size={17} color={colors.ink} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryCta} onPress={() => router.push("/login")} activeOpacity={0.8}>
                <Text style={styles.secondaryCtaText}>I have an account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FadeIn>

        {/* features */}
        <FadeIn delay={120}>
          <View style={[styles.featureRow, !isDesktop && { flexDirection: "column" }]}>
            {FEATURES.map((f) => (
              <View key={f.title} style={[styles.featureCard, isDesktop && { flex: 1 }]}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon as any} size={22} color={colors.gold} />
                </View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </FadeIn>

        {/* how it works */}
        <FadeIn delay={200}>
          <Text style={styles.sectionTitle}>HOW IT WORKS</Text>
          <View style={[styles.stepsRow, !isDesktop && { flexDirection: "column" }]}>
            {STEPS.map((s) => (
              <View key={s.n} style={[styles.stepCard, isDesktop && { flex: 1 }]}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepNum}>{s.n}</Text>
                </View>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepDesc}>{s.desc}</Text>
              </View>
            ))}
          </View>
        </FadeIn>

        {/* bottom CTA */}
        <FadeIn delay={260}>
          <View style={styles.bottomCta}>
            <Text style={styles.bottomTitle}>Ready to see the edge?</Text>
            <TouchableOpacity style={[styles.primaryCta, { alignSelf: "center" }]} onPress={() => router.push("/signup")} activeOpacity={0.85}>
              <Text style={styles.primaryCtaText}>Create Your Account</Text>
              <Ionicons name="arrow-forward" size={17} color={colors.ink} />
            </TouchableOpacity>
          </View>
        </FadeIn>

        {/* footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            21+ only. Western Information Network provides sports market information for educational
            purposes only. It never holds funds or processes transactions.
          </Text>
          <Text style={styles.footerCopy}>© 2026 Western Information Network</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.lg },
  topBrand: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1, minWidth: 0 },
  topLogo: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: colors.border },
  topName: { color: colors.text, fontSize: font.small, fontWeight: font.heavy, flexShrink: 1 },
  signInBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  signInText: { color: colors.text, fontSize: font.small, fontWeight: font.bold },

  hero: { alignItems: "center", paddingTop: spacing.xxl, paddingBottom: spacing.xxl },
  heroLogo: { width: 110, height: 110, borderRadius: radius.xl, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border },
  heroTitle: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: font.heavy, textAlign: "center", letterSpacing: -0.5, maxWidth: 640 },
  heroSub: { color: colors.textDim, fontSize: font.body, lineHeight: 24, textAlign: "center", marginTop: spacing.md, maxWidth: 560 },
  ctaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xl, justifyContent: "center" },
  primaryCta: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.gold,
    borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: spacing.xxl, ...shadow.soft,
  },
  primaryCtaText: { color: colors.ink, fontSize: font.body, fontWeight: font.bold },
  secondaryCta: {
    alignItems: "center", justifyContent: "center", borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: spacing.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  secondaryCtaText: { color: colors.text, fontSize: font.body, fontWeight: font.semibold },

  featureRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  featureCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  featureIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md, borderWidth: 1, borderColor: "rgba(245,184,65,0.25)" },
  featureTitle: { color: colors.text, fontSize: font.body, fontWeight: font.bold },
  featureDesc: { color: colors.textDim, fontSize: font.small, lineHeight: 20, marginTop: 6 },

  sectionTitle: { color: colors.gold, fontSize: font.caption, fontWeight: font.bold, letterSpacing: 1.5, marginTop: spacing.xxl, marginBottom: spacing.md, textAlign: "center" },
  stepsRow: { flexDirection: "row", gap: spacing.md },
  stepCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  stepBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  stepNum: { color: colors.ink, fontSize: font.body, fontWeight: font.heavy },
  stepTitle: { color: colors.text, fontSize: font.body, fontWeight: font.bold, textAlign: "center" },
  stepDesc: { color: colors.textDim, fontSize: font.small, lineHeight: 20, textAlign: "center", marginTop: 6 },

  bottomCta: { alignItems: "center", marginTop: spacing.xxl, paddingVertical: spacing.xl },
  bottomTitle: { color: colors.text, fontSize: font.h2, fontWeight: font.heavy, marginBottom: spacing.lg, textAlign: "center" },

  footer: { borderTopWidth: 1, borderTopColor: colors.borderSoft, marginTop: spacing.xl, paddingTop: spacing.lg },
  footerText: { color: colors.textMuted, fontSize: font.caption, lineHeight: 18, textAlign: "center" },
  footerCopy: { color: colors.textMuted, fontSize: font.caption, textAlign: "center", marginTop: spacing.sm },
});
