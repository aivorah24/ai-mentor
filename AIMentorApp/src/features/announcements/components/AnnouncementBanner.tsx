/**
 * AnnouncementBanner — persistent, in-flow bar at the top of the app for
 * admin-published announcements (school closures, downtime notices, etc.).
 * Unlike NotificationBanner (a toast that overlays and auto-hides), this
 * renders as a normal layout element that pushes content down, and stays
 * until the user dismisses it or it expires server-side.
 *
 * Styled as an inset, rounded card with a gold "View" pill and a severity
 * accent rail — deliberately not a flush, edge-to-edge alert strip (that's
 * the generic school-app look; this reads as an Aivorah component).
 *
 * Only the highest-priority announcement is shown — a stack of banners
 * would push the whole app down too far. If there are more, a compact
 * "N more" chip routes straight into the Announcement Center rather than
 * building a second, smaller inbox inline.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAnnouncements } from '../context/AnnouncementProvider';
import { useTheme } from '../../../context/ThemeContext';
import { spacing, radius } from '../../../theme';
import { SEVERITY_ICON, severityColor } from '../utils/severity';
import { plainPreview } from '../utils/markdown';

interface Props {
  onView?: (id: string) => void;
  onViewAll?: () => void;
}

export default function AnnouncementBanner({ onView, onViewAll }: Props) {
  const { bannerAnnouncements, dismiss } = useAnnouncements();
  const { colors } = useTheme();

  if (!bannerAnnouncements.length) return null;
  // Hide announcement banners in the Playwright visual-QA preview so screenshots
  // capture the lesson, not a downtime notice overlaying it.
  if (Platform.OS === 'web') {
    try { if (new URLSearchParams(window.location.search).get('qaPreview') === '1') return null; } catch {}
  }

  const current = bannerAnnouncements[0];
  const moreCount = bannerAnnouncements.length - 1;
  const tint = severityColor(colors, current.severity);

  return (
    <View style={styles.wrap} accessibilityRole={Platform.OS === 'web' ? ('banner' as any) : undefined}>
      <View style={[styles.card, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
        <View style={[styles.rail, { backgroundColor: tint }]} />

        <View style={[styles.iconBadge, { backgroundColor: `${tint}20` }]}>
          <Feather name={SEVERITY_ICON[current.severity] as any} size={15} color={tint} accessibilityElementsHidden />
        </View>

        <TouchableOpacity
          style={styles.textWrap}
          onPress={() => onView?.(current.id)}
          activeOpacity={onView ? 0.7 : 1}
          disabled={!onView}
          accessibilityRole="button"
          accessibilityLabel={`${current.title}. ${current.body}. Open announcement`}
        >
          <Text style={[styles.title, { color: colors.textHeading }]} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={[styles.body, { color: colors.textMuted }]} numberOfLines={1}>
            {plainPreview(current.body)}
          </Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          {onView && (
            <TouchableOpacity
              onPress={() => onView(current.id)}
              style={[styles.viewBtn, { backgroundColor: colors.accentYellow }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
            >
              <Text style={styles.viewBtnText}>View</Text>
            </TouchableOpacity>
          )}

          {moreCount > 0 && (
            <TouchableOpacity
              onPress={onViewAll}
              style={[styles.moreChip, { backgroundColor: colors.cardHover, borderColor: colors.borderColor }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`${moreCount} more announcement${moreCount > 1 ? 's' : ''}`}
            >
              <Text style={[styles.moreChipText, { color: colors.textMuted }]}>+{moreCount}</Text>
            </TouchableOpacity>
          )}

          {current.isDismissible && (
            <TouchableOpacity
              onPress={() => dismiss(current.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.closeBtn, { borderColor: colors.borderColor }]}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss announcement: ${current.title}`}
            >
              <Feather name="x" size={13} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 10,
    paddingRight: 10,
    overflow: 'hidden',
    // Soft elevation so it reads as a floating card, not a flush strip.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  rail: { width: 4, alignSelf: 'stretch' },
  iconBadge: {
    width: 30, height: 30, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 12, marginRight: 10, flexShrink: 0,
  },
  textWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 13.5, fontWeight: '700' },
  body: { fontSize: 12, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 10, flexShrink: 0 },
  viewBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  viewBtnText: { fontSize: 12, fontWeight: '700', color: '#241f16' },
  moreChip: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  moreChipText: { fontSize: 11.5, fontWeight: '700' },
  closeBtn: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
