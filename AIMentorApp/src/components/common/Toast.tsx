/**
 * Toast — lightweight one-off success/error notification in Aivorah style.
 * Usage:
 *   const { showToast, ToastComponent } = useToast();
 *   showToast({ title: 'Saved!', subtitle: 'Changes applied.', type: 'success' });
 *   return <View>...{ToastComponent}</View>
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

type ToastType = 'success' | 'error' | 'info';

interface ToastOptions {
  title: string;
  subtitle?: string;
  type?: ToastType;
  duration?: number;
}

const TYPE_CONFIG: Record<ToastType, { icon: string; color: string }> = {
  success: { icon: 'check-circle', color: '#4ADE80' },
  error:   { icon: 'alert-circle', color: '#F87171' },
  info:    { icon: 'info',         color: '#93B0AC' },
};

function ProgressBar({ color, duration, onComplete }: { color: string; duration: number; onComplete: () => void }) {
  const width = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.timing(width, { toValue: 0, duration, useNativeDriver: false });
    anim.start(({ finished }) => { if (finished) onComplete(); });
    return () => anim.stop();
  }, []);
  return (
    <View style={s.progressTrack}>
      <Animated.View style={[s.progressBar, { backgroundColor: color, flex: width }]} />
    </View>
  );
}

function ToastView({ title, subtitle, type = 'success', duration = 4000, onDismiss }: ToastOptions & { onDismiss: () => void }) {
  const { colors } = useTheme();
  const slideY  = useRef(new Animated.Value(-24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const { icon, color } = TYPE_CONFIG[type];

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideY,  { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY,  { toValue: -24, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0,   duration: 180, useNativeDriver: true }),
    ]).start(() => onDismiss());
  }, [onDismiss]);

  return (
    <Animated.View
      style={[s.container, {
        backgroundColor: colors.cardDark,
        borderColor: colors.borderColor,
        transform: [{ translateY: slideY }],
        opacity,
      }]}
      pointerEvents="box-none"
    >
      <TouchableOpacity style={s.inner} activeOpacity={0.88} onPress={dismiss}>
        <View style={[s.iconWrap, { backgroundColor: color + '22', borderWidth: 1, borderColor: color + '50' }]}>
          <Feather name={icon as any} size={20} color={color} />
        </View>
        <View style={s.textWrap}>
          <View style={s.titleRow}>
            <Text style={[s.appName, { color: colors.textMuted }]}>AIVORAH</Text>
            <Text style={[s.timeText, { color: colors.textDim }]}>now</Text>
          </View>
          <Text style={[s.title, { color: colors.textMain }]} numberOfLines={1}>{title}</Text>
          {!!subtitle && (
            <Text style={[s.subtitle, { color: colors.textMuted }]} numberOfLines={2}>{subtitle}</Text>
          )}
        </View>
        <TouchableOpacity onPress={dismiss} style={s.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="x" size={16} color={colors.textDim} />
        </TouchableOpacity>
      </TouchableOpacity>
      <ProgressBar color={color} duration={duration} onComplete={dismiss} />
    </Animated.View>
  );
}

export function useToast() {
  const [toast, setToast] = useState<(ToastOptions & { key: number }) | null>(null);
  const keyRef = useRef(0);

  const showToast = useCallback((opts: ToastOptions) => {
    keyRef.current += 1;
    setToast({ ...opts, key: keyRef.current });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  const ToastComponent = toast ? (
    <ToastView
      key={toast.key}
      title={toast.title}
      subtitle={toast.subtitle}
      type={toast.type}
      duration={toast.duration}
      onDismiss={dismiss}
    />
  ) : null;

  return { showToast, ToastComponent };
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 50,
    right: 16,
    width: 340,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 16,
    zIndex: 9999,
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1, gap: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  appName: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  timeText: { fontSize: 11 },
  title:    { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  subtitle: { fontSize: 13, lineHeight: 17, marginTop: 1 },
  closeBtn: { padding: 4, alignSelf: 'flex-start', marginTop: 2 },
  progressTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.06)', flexDirection: 'row' },
  progressBar:   { height: 3 },
});
