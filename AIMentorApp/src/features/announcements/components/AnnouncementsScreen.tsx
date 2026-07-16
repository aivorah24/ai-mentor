/**
 * Announcement Center — full history of published announcements, shared
 * across student/parent/teacher. Role-specific screens (ParentAnnouncementsScreen
 * etc.) are thin re-exports of this component; the backend (/announcements)
 * already resolves audience server-side from the logged-in user's email, so
 * no role-specific branching is needed here.
 *
 * Desktop/tablet: master-detail, mirroring the same list+thread pattern
 * MessagesScreen already uses (one "active id" state + useResponsive()).
 * Mobile: list-only, tapping an item swaps to a detail view with a back button.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput, Platform, Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useResponsive } from '../../../hooks/useResponsive';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { fetchInbox, markSeen } from '../api/announcementsApi';
import { SEVERITY_LABEL, SEVERITY_ORDER, severityColor } from '../utils/severity';
import { MarkdownBody, plainPreview } from '../utils/markdown';
import { audienceLabel } from '../utils/audience';
import { Announcement } from '../types/announcement.types';

type Filter = 'all' | 'unread' | Announcement['severity'];

const AVATAR_PALETTE_KEYS: (keyof AppColors)[] = ['accentBlue', 'accentGreen', 'accentPurple', 'accentOrange', 'primary'];

function initialsFor(name: string | null, email: string | null): string {
  const source = (name || '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }
  const local = (email || '').split('@')[0] || 'AV';
  return local.slice(0, 2).toUpperCase();
}

function avatarColor(colors: AppColors, key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const paletteKey = AVATAR_PALETTE_KEYS[hash % AVATAR_PALETTE_KEYS.length];
  return colors[paletteKey] as string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

function formatFullDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

export default function AnnouncementsScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { isMobile } = useResponsive();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const userEmail = user?.email || '';

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const fetchItems = useCallback(async (silent = false) => {
    if (!userEmail) return;
    if (!silent) setLoading(true);
    setError(false);
    try {
      const data = await fetchInbox(userEmail);
      setItems(data.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userEmail]);

  useFocusEffect(useCallback(() => { fetchItems(); }, [fetchItems]));

  // Deep-link from the banner's "View" button: open a specific announcement.
  useEffect(() => {
    const openId = route?.params?.openId;
    if (openId) {
      setActiveId(openId);
      if (isMobile) setMobileShowDetail(true);
    }
  }, [route?.params?.openId]);

  function onRefresh() {
    setRefreshing(true);
    fetchItems(true);
  }

  const filteredItems = useMemo(() => {
    let list = items;
    if (filter === 'unread') list = list.filter((a) => !a.isSeen);
    else if (filter !== 'all') list = list.filter((a) => a.severity === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        (a.createdByName || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, filter, query]);

  const unreadCount = useMemo(() => items.filter((a) => !a.isSeen).length, [items]);
  const activeItem = useMemo(() => items.find((a) => a.id === activeId) || null, [items, activeId]);

  async function openItem(item: Announcement) {
    setActiveId(item.id);
    if (isMobile) setMobileShowDetail(true);
    if (!item.isSeen) {
      setItems((prev) => prev.map((a) => (a.id === item.id ? { ...a, isSeen: true } : a)));
      try { await markSeen(item.id, userEmail); } catch {
        // Non-fatal — the seen state is re-derived from the server on next fetch.
      }
    }
  }

  async function markAllRead() {
    const unread = items.filter((a) => !a.isSeen);
    if (!unread.length) return;
    setItems((prev) => prev.map((a) => ({ ...a, isSeen: true })));
    try {
      await Promise.all(unread.map((a) => markSeen(a.id, userEmail)));
    } catch {
      // Best-effort — a failed item just stays unread on next real fetch.
    }
  }

  const showList = !isMobile || !mobileShowDetail;
  const showDetail = !isMobile || mobileShowDetail;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Announcements"
          subtitle="Stay updated with important school information"
          onMenuPress={() => navigation?.openDrawer?.()}
        />

        <View style={styles.body}>
          {showList && (
            <View style={[styles.listPane, isMobile && styles.listPaneMobile]}>
              <View style={styles.toolbar}>
                <View style={styles.searchBox}>
                  <Feather name="search" size={14} color={colors.textDim} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search announcements"
                    placeholderTextColor={colors.textDim}
                    style={styles.searchInput}
                    accessibilityLabel="Search announcements"
                  />
                </View>
                {unreadCount > 0 && (
                  <TouchableOpacity onPress={markAllRead} accessibilityRole="button">
                    <Text style={styles.markAllText}>Mark all read</Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipRow}
              >
                <FilterChip label="All" count={items.length} active={filter === 'all'} onPress={() => setFilter('all')} colors={colors} />
                <FilterChip label="Unread" count={unreadCount} active={filter === 'unread'} onPress={() => setFilter('unread')} colors={colors} dotColor={colors.primary} />
                {SEVERITY_ORDER.filter((s) => s !== 'info').map((sev) => (
                  <FilterChip
                    key={sev}
                    label={SEVERITY_LABEL[sev]}
                    count={items.filter((a) => a.severity === sev).length}
                    active={filter === sev}
                    onPress={() => setFilter(sev)}
                    colors={colors}
                    dotColor={severityColor(colors, sev)}
                  />
                ))}
              </ScrollView>

              <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentYellow} />}
              >
                {loading ? (
                  <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
                ) : error ? (
                  <EmptyState
                    icon="alert-circle"
                    title="Couldn't load announcements"
                    text="Check your connection and try again."
                    colors={colors}
                    onRetry={() => fetchItems()}
                  />
                ) : filteredItems.length === 0 ? (
                  <EmptyState
                    icon="bell"
                    title={items.length === 0 ? 'No announcements yet' : 'No matches'}
                    text={items.length === 0 ? "You'll see school and class updates here as soon as they're published." : 'No announcements match your search or filter.'}
                    colors={colors}
                  />
                ) : (
                  filteredItems.map((item) => (
                    <AnnouncementRow
                      key={item.id}
                      item={item}
                      isActive={item.id === activeId}
                      colors={colors}
                      onPress={() => openItem(item)}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          )}

          {showDetail && (
            <View style={styles.detailPane}>
              {isMobile && (
                <TouchableOpacity
                  style={styles.backRow}
                  onPress={() => setMobileShowDetail(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Back to announcement list"
                >
                  <Feather name="chevron-left" size={18} color={colors.textMuted} />
                  <Text style={styles.backText}>Announcements</Text>
                </TouchableOpacity>
              )}
              {activeItem ? (
                <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.badgeRow}>
                    <SeverityBadge severity={activeItem.severity} colors={colors} />
                    <View style={[styles.audienceTag, { backgroundColor: colors.cardHover, borderColor: colors.borderColor }]}>
                      <Feather name="users" size={10} color={colors.textDim} />
                      <Text style={[styles.audienceTagText, { color: colors.textMuted }]}>{audienceLabel(activeItem)}</Text>
                    </View>
                  </View>
                  <Text style={styles.detailTitle}>{activeItem.title}</Text>
                  <View style={styles.detailBody}>
                    <MarkdownBody body={activeItem.body} colors={colors} />
                  </View>
                  {activeItem.attachments.length > 0 && (
                    <View style={styles.attachmentsSection}>
                      <Text style={styles.footerLabel}>ATTACHMENTS ({activeItem.attachments.length})</Text>
                      {activeItem.attachments.map((att) => (
                        <TouchableOpacity
                          key={att.url}
                          style={[styles.attachmentRow, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}
                          onPress={() => {
                            if (Platform.OS === 'web') window.open(att.url, '_blank', 'noopener,noreferrer');
                            else Linking.openURL(att.url).catch(() => {});
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Open attachment ${att.name}`}
                        >
                          <Feather name={att.type === 'pdf' ? 'file-text' : 'image'} size={16} color={colors.accentYellow} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[styles.attachmentName, { color: colors.textMain }]} numberOfLines={1}>{att.name}</Text>
                            <Text style={[styles.attachmentMeta, { color: colors.textDim }]}>
                              {att.type.toUpperCase()}{att.size ? ` · ${(att.size / 1024).toFixed(0)} KB` : ''}
                            </Text>
                          </View>
                          <Feather name="download" size={14} color={colors.textDim} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  <View style={styles.footer}>
                    <View style={styles.footerField}>
                      <Text style={styles.footerLabel}>PUBLISHED BY</Text>
                      <View style={styles.publisherRow}>
                        <View style={[styles.avatar, { backgroundColor: avatarColor(colors, activeItem.createdBy || 'a') }]}>
                          <Text style={styles.avatarText}>{initialsFor(activeItem.createdByName, activeItem.createdBy)}</Text>
                        </View>
                        <Text style={styles.publisherName}>{activeItem.createdByName || activeItem.createdBy || 'Aivorah'}</Text>
                      </View>
                    </View>
                    <View style={styles.footerField}>
                      <Text style={styles.footerLabel}>PUBLISHED ON</Text>
                      <Text style={styles.footerValue}>{formatFullDate(activeItem.createdAt)}</Text>
                    </View>
                  </View>
                </ScrollView>
              ) : (
                <View style={styles.emptyDetail}>
                  <Feather name="mail" size={28} color={colors.textDim} />
                  <Text style={styles.emptyDetailText}>Select an announcement to read it</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </ScreenLayout>
  );
}

function FilterChip({ label, count, active, onPress, colors, dotColor }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        chipStyles.chip,
        { borderColor: colors.borderColor, backgroundColor: active ? `${colors.accentYellow}1F` : colors.cardDark },
        active && { borderColor: colors.accentYellow },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {dotColor && <View style={[chipStyles.dot, { backgroundColor: dotColor }]} />}
      <Text style={[chipStyles.label, { color: active ? colors.textHeading : colors.textMuted }]}>{label}</Text>
      <Text style={[chipStyles.count, { color: colors.textDim }]}>{count}</Text>
    </TouchableOpacity>
  );
}

function SeverityBadge({ severity, colors }: { severity: Announcement['severity']; colors: AppColors }) {
  const tint = severityColor(colors, severity);
  return (
    <View style={[chipStyles.sevBadge, { backgroundColor: `${tint}1A` }]}>
      <View style={[chipStyles.dot, { backgroundColor: tint }]} />
      <Text style={[chipStyles.sevBadgeText, { color: tint }]}>{SEVERITY_LABEL[severity]}</Text>
    </View>
  );
}

function AnnouncementRow({ item, isActive, colors, onPress }: { item: Announcement; isActive: boolean; colors: AppColors; onPress: () => void }) {
  const styles = rowStyles;
  const tint = severityColor(colors, item.severity);
  const unread = !item.isSeen;
  return (
    <TouchableOpacity
      style={[
        styles.row,
        { backgroundColor: isActive ? colors.cardHover : 'transparent', borderColor: isActive ? colors.borderColor : 'transparent' },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${SEVERITY_LABEL[item.severity]}. ${item.title}. ${formatDate(item.createdAt)}`}
    >
      <View style={[styles.rail, { backgroundColor: tint }]} />
      <View style={[styles.avatar, { backgroundColor: avatarColor(colors, item.createdBy || 'a') }]}>
        <Text style={styles.avatarText}>{initialsFor(item.createdByName, item.createdBy)}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, { color: colors.textHeading, fontWeight: unread ? '700' : '600' }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.rowTime, { color: colors.textDim }]}>{formatDate(item.createdAt)}</Text>
        </View>
        <Text style={[styles.rowSnippet, { color: colors.textMuted }]} numberOfLines={2}>{plainPreview(item.body)}</Text>
        <Text style={[styles.rowAudience, { color: colors.textDim }]} numberOfLines={1}>
          {audienceLabel(item)}{item.attachments.length > 0 ? `  ·  ${item.attachments.length} attachment${item.attachments.length > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      {unread && <View style={[styles.unreadDot, { backgroundColor: colors.accentYellow }]} accessibilityElementsHidden />}
    </TouchableOpacity>
  );
}

function EmptyState({ icon, title, text, colors, onRetry }: any) {
  return (
    <View style={emptyStyles.wrap}>
      <Feather name={icon} size={30} color={colors.textDim} />
      <Text style={[emptyStyles.title, { color: colors.textHeading }]}>{title}</Text>
      <Text style={[emptyStyles.text, { color: colors.textMuted }]}>{text}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={[emptyStyles.retryBtn, { borderColor: colors.borderColor }]} accessibilityRole="button">
          <Text style={{ color: colors.accentYellow, fontFamily: fonts.serif, fontWeight: '700', fontSize: 12.5 }}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    body: { flex: 1, flexDirection: 'row', minHeight: 0 },

    listPane: {
      width: 380,
      maxWidth: 420,
      borderRightWidth: 1,
      borderRightColor: colors.borderColor,
    },
    listPaneMobile: { width: '100%', maxWidth: '100%', borderRightWidth: 0 },

    toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
    searchBox: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 10, height: 36,
    },
    searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, height: '100%' },
    markAllText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.accentYellow },

    chipScroll: { flexGrow: 0, flexShrink: 0 },
    chipRow: { paddingHorizontal: spacing.lg, gap: 8, paddingBottom: spacing.sm, alignItems: 'center' },

    list: { flex: 1 },
    listContent: { paddingHorizontal: spacing.sm, paddingBottom: 40 },

    detailPane: { flex: 1, minWidth: 0 },
    detailContent: { maxWidth: 680, padding: spacing.xxl, paddingTop: spacing.lg },
    backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    backText: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '600', color: colors.textMuted },

    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md, flexWrap: 'wrap' },
    audienceTag: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
    },
    audienceTagText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600' },
    attachmentsSection: { marginTop: spacing.lg, gap: 8 },
    attachmentRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      borderWidth: 1, borderRadius: radius.sm, padding: 10, maxWidth: 420,
    },
    attachmentName: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600' },
    attachmentMeta: { fontFamily: fonts.serif, fontSize: 10.5, marginTop: 1 },
    detailTitle: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '700', color: colors.textHeading, marginBottom: spacing.lg, lineHeight: 28 },
    detailBody: { maxWidth: 620 },
    paragraph: { fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 23, color: colors.textMain, marginBottom: 14 },

    footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 28, marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderColor },
    footerField: {},
    footerLabel: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: colors.textDim, marginBottom: 6 },
    footerValue: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted },
    publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    publisherName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '600', color: colors.textMain },

    avatar: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: '#fff' },

    emptyDetail: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    emptyDetailText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textDim },
  });
}

const chipStyles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600' },
  count: { fontFamily: fonts.serif, fontSize: 11 },
  sevBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  sevBadgeText: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '700' },
});

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: radius.sm, borderWidth: 1, marginBottom: 3 },
  rail: { width: 3, borderRadius: 3, alignSelf: 'stretch' },
  avatar: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', color: '#fff' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  rowTitle: { flex: 1, fontFamily: fonts.serif, fontSize: 13.5 },
  rowTime: { fontFamily: fonts.serif, fontSize: 10.5 },
  rowSnippet: { fontFamily: fonts.serif, fontSize: 12, lineHeight: 17, marginTop: 2 },
  rowAudience: { fontFamily: fonts.serif, fontSize: 10.5, marginTop: 4 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5, flexShrink: 0 },
});

const emptyStyles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 24, gap: 8 },
  title: { fontFamily: fonts.serif, fontSize: 14.5, fontWeight: '700' },
  text: { fontFamily: fonts.serif, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  retryBtn: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1 },
});
