/**
 * LottieTrophy.tsx
 * Animated Lottie trophy — plays once on mount (web only).
 */
import React from 'react';
import { Platform, View } from 'react-native';

let DotLottieReact: any = null;
if (Platform.OS === 'web') {
  try { DotLottieReact = require('@lottiefiles/dotlottie-react').DotLottieReact; } catch {}
}

export default function LottieTrophy({ size = 120 }: { size?: number }) {
  if (!DotLottieReact) return null;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <DotLottieReact
        src="https://lottie.host/6bec841b-4eb2-470e-a6f2-6a2a860c7ee8/W5Yn6XYk4s.lottie"
        loop
        autoplay
        style={{ width: size, height: size }}
      />
    </View>
  );
}
