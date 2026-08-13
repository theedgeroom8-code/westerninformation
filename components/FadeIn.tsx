import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";

interface FadeInProps {
  delay?: number;
  duration?: number;
  children: React.ReactNode;
  style?: object;
}

export const FadeIn: React.FC<FadeInProps> = ({ delay = 0, duration = 350, children, style }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
};
