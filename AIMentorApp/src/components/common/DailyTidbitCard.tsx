/**
 * DailyTidbitCard.tsx
 * Dashboard widget — shows today's GK Fact + Current Affairs.
 * Content is grade-specific and rotates daily via the server cache.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface GKFact {
  fact: string;
  category: string;
}
interface CurrentAffair {
  headline: string;
  summary: string;
}
interface TidbitData {
  grade: string;
  date: string;
  gk: GKFact;
  currentAffairs: CurrentAffair;
}

const CATEGORY_ICONS: Record<string, string> = {
  'Geography':                'globe',
  'Science & Nature':         'zap',
  'Human Body':               'heart',
  'Indian History & Culture': 'book-open',
  'Space & Universe':         'moon',
  'Animals':                  'feather',
  'Technology':               'cpu',
  'Amazing World Records':    'award',
  'Current Affairs':          'radio',
};

function categoryIcon(cat: string): any {
  return CATEGORY_ICONS[cat] ?? 'star';
}

interface Props {
  grade: string;
}

export default function DailyTidbitCard({ grade }: Props) {
  const { colors, isDark } = useTheme();
  const [tab, setTab]         = useState<'gk' | 'news'>('gk');
  const [data, setData]       = useState<TidbitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `daily_tidbit_v2_${grade}_${today}`;

  useEffect(() => {
    loadTidbit();
  }, [grade]);

  async function loadTidbit() {
    setLoading(true);
    setError(false);
    try {
      // Check AsyncStorage cache first
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        setData(JSON.parse(cached));
        setLoading(false);
        return;
      }
      // Fetch from server
      const resp = await fetch(`${SERVER_URL}/daily-tidbit?grade=${encodeURIComponent(grade)}`);
      if (!resp.ok) throw new Error('Server error');
      const json: TidbitData = await resp.json();
      await AsyncStorage.setItem(cacheKey, JSON.stringify(json));
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // ── Theme tokens ─────────────────────────────────────────────────
  const teal        = '#5F8A86';
  const rose        = '#B8797E';
  const cardBg      = isDark ? colors.cardDark  : '#F0F7F6';
  const borderCol   = isDark ? colors.borderColor : teal + '25';
  const activeTab   = tab === 'gk' ? teal : rose;
  const titleColor  = isDark ? colors.textMain : '#1C2A28';
  const mutedColor  = colors.textMuted;

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <View style={[s.iconCircle, { backgroundColor: activeTab + '20' }]}>
            <Feather name={tab === 'gk' ? 'star' : 'radio'} size={14} color={activeTab} />
          </View>
          <View>
            <Text style={[s.cardTitle, { color: titleColor }]}>
              {tab === 'gk' ? 'Did You Know?' : 'Today in the World'}
            </Text>
            <Text style={[s.cardSub, { color: mutedColor }]}>
              {tab === 'gk' ? 'Daily Knowledge' : 'Current Affairs'} · {grade}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={loadTidbit} style={s.refreshBtn} disabled={loading}>
          <Feather name="refresh-cw" size={14} color={mutedColor} />
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={[s.tabs, { backgroundColor: isDark ? colors.bgDark : teal + '10', borderColor: borderCol }]}>
        <TouchableOpacity
          style={[s.tab, tab === 'gk' && { backgroundColor: teal, borderRadius: radius.sm - 2 }]}
          onPress={() => setTab('gk')}
          activeOpacity={0.8}
        >
          <Feather name="star" size={12} color={tab === 'gk' ? '#fff' : mutedColor} />
          <Text style={[s.tabText, { color: tab === 'gk' ? '#fff' : mutedColor }]}>GK Fact</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, tab === 'news' && { backgroundColor: rose, borderRadius: radius.sm - 2 }]}
          onPress={() => setTab('news')}
          activeOpacity={0.8}
        >
          <Feather name="radio" size={12} color={tab === 'news' ? '#fff' : mutedColor} />
          <Text style={[s.tabText, { color: tab === 'news' ? '#fff' : mutedColor }]}>Current Affairs</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator size="small" color={activeTab} />
          <Text style={[s.loadingText, { color: mutedColor }]}>Fetching today's tidbit...</Text>
        </View>
      ) : error ? (
        <View style={s.loadingBox}>
          <Feather name="wifi-off" size={20} color={mutedColor} />
          <Text style={[s.loadingText, { color: mutedColor }]}>Couldn't load. Tap refresh to try again.</Text>
        </View>
      ) : data ? (
        tab === 'gk' ? (
          <View style={s.content}>
            <View style={[s.categoryBadge, { backgroundColor: teal + '18', borderColor: teal + '40' }]}>
              <Feather name={categoryIcon(data.gk.category) as any} size={11} color={teal} />
              <Text style={[s.categoryText, { color: teal }]}>{data.gk.category}</Text>
            </View>
            <Text style={[s.factText, { color: titleColor }]}>{data.gk.fact}</Text>
          </View>
        ) : (
          <View style={s.content}>
            <View style={[s.categoryBadge, { backgroundColor: rose + '18', borderColor: rose + '40' }]}>
              <Feather name="radio" size={11} color={rose} />
              <Text style={[s.categoryText, { color: rose }]}>Current Affairs</Text>
            </View>
            <Text style={[s.headlineText, { color: titleColor }]}>{data.currentAffairs.headline}</Text>
            <Text style={[s.summaryText, { color: mutedColor }]}>{data.currentAffairs.summary}</Text>
          </View>
        )
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle:  { fontSize: 14, fontWeight: '700' },
  cardSub:    { fontSize: 11, marginTop: 1 },
  refreshBtn: { padding: 6 },

  tabs: {
    flexDirection: 'row',
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 3,
    gap: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
  },
  tabText: { fontSize: 12, fontWeight: '600' },

  loadingBox: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  loadingText: { fontSize: 12, textAlign: 'center' },

  content:      { gap: spacing.sm },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  categoryText: { fontSize: 11, fontWeight: '700' },
  factText:     { fontSize: 14, fontWeight: '500', lineHeight: 22 },
  headlineText: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  summaryText:  { fontSize: 13, lineHeight: 20 },
});
