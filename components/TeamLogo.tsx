import React, { useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { teamLogoUrl, teamMonogram } from "../lib/teamLogos";
import { font } from "../theme";

interface Props { sport: string; team: string; size?: number }

/** Team logo with a monogram fallback — a missing/blocked image never leaves a hole. */
export const TeamLogo: React.FC<Props> = ({ sport, team, size = 28 }) => {
  const url = teamLogoUrl(sport, team);
  const [failed, setFailed] = useState(false);

  const box = size + 6; // soft disc behind the art so dark logos (Jets, Giants…) stay legible on the dark card
  if (url && !failed) {
    return (
      <View style={[styles.disc, { width: box, height: box, borderRadius: box / 2 }]}>
        <Image
          source={{ uri: url }}
          style={{ width: size, height: size }}
          resizeMode="contain"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${team} logo`}
        />
      </View>
    );
  }
  const m = teamMonogram(team);
  return (
    <View style={[styles.mono, { width: box, height: box, borderRadius: box / 2, backgroundColor: m.color }]}>
      <Text style={[styles.monoText, { fontSize: Math.max(9, Math.round(size * 0.36)) }]}>{m.text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  disc: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.13)" },
  mono: { alignItems: "center", justifyContent: "center" },
  monoText: { color: "#fff", fontWeight: font.heavy, letterSpacing: 0.3 },
});
