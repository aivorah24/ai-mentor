/**
 * Confetti.tsx
 * Full-screen Lottie confetti overlay — plays once, doesn't block interaction.
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

let DotLottieReact: any = null;
if (Platform.OS === 'web') {
  try { DotLottieReact = require('@lottiefiles/dotlottie-react').DotLottieReact; } catch {}
}

export default function Confetti({ trigger = true }: { trigger?: boolean }) {
  if (!trigger || !DotLottieReact) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <DotLottieReact
        src="https://lottie.host/6bec841b-4eb2-470e-a6f2-6a2a860c7ee8/W5Yn6XYk4s.lottie"
        autoplay
        loop={false}
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -100,
    left: -100,
    right: -100,
    bottom: -100,
    zIndex: 100,
  },
});
