/**
 * TrophyIcon.tsx
 * Animated SVG trophy for quiz results — replaces emoji.
 * Scales up with a bounce on mount.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

type Props = {
  size?: number;
  /** 'gold' for 80%+, 'silver' for 60-79%, 'bronze' for <60% */
  tier?: 'gold' | 'silver' | 'bronze';
};

const TIER_COLORS = {
  gold:   { body: ['#FFD700', '#F5A623'], base: '#8B6914', shine: '#FFF3B0', star: '#FFF' },
  silver: { body: ['#C0C0C0', '#9A9A9A'], base: '#6B6B6B', shine: '#E8E8E8', star: '#FFF' },
  bronze: { body: ['#CD7F32', '#A0522D'], base: '#6B3A1F', shine: '#E8B87A', star: '#FFF' },
};

export default function TrophyIcon({ size = 80, tier = 'gold' }: Props) {
  const scale = useRef(new Animated.Value(0)).current;
  const glow  = useRef(new Animated.Value(0)).current;
  const t = TIER_COLORS[tier];

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 1,
        friction: 4,
        tension: 80,
        useNativeDriver: true,
        delay: 200,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: scale }}>
      <Svg width={size} height={size} viewBox="0 0 80 80">
        <Defs>
          <LinearGradient id="trophyGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.body[0]} />
            <Stop offset="1" stopColor={t.body[1]} />
          </LinearGradient>
          <LinearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.base} />
            <Stop offset="1" stopColor={t.body[1]} />
          </LinearGradient>
        </Defs>

        {/* Base / pedestal */}
        <Rect x="24" y="64" width="32" height="6" rx="2" fill="url(#baseGrad)" />
        <Rect x="28" y="60" width="24" height="6" rx="2" fill={t.base} />

        {/* Stem */}
        <Rect x="36" y="50" width="8" height="12" rx="2" fill={t.body[1]} />

        {/* Cup body */}
        <Path
          d="M22 16 C22 16 22 44 40 50 C58 44 58 16 58 16 Z"
          fill="url(#trophyGrad)"
        />

        {/* Left handle */}
        <Path
          d="M22 18 C14 18 12 28 18 32 C20 33 22 31 22 28"
          stroke={t.body[1]}
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />

        {/* Right handle */}
        <Path
          d="M58 18 C66 18 68 28 62 32 C60 33 58 31 58 28"
          stroke={t.body[1]}
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />

        {/* Rim */}
        <Rect x="20" y="14" width="40" height="5" rx="2.5" fill={t.body[0]} />

        {/* Shine highlight */}
        <Path
          d="M28 20 C28 20 28 36 36 42"
          stroke={t.shine}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          opacity="0.5"
        />

        {/* Star */}
        <Path
          d="M40 24 L42.2 30.5 L49 30.5 L43.4 34.5 L45.6 41 L40 37 L34.4 41 L36.6 34.5 L31 30.5 L37.8 30.5 Z"
          fill={t.star}
          opacity="0.85"
        />
      </Svg>
    </Animated.View>
  );
}
