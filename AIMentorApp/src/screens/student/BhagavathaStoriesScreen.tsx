import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

// Aivorah teal/sage pastel palette
const TEAL   = '#5F8A86';
const FOREST = '#5A8A70';

interface StoryMeta {
  id: string;
  title: string;
  subtitle: string;
  coverColor: string;
  coverIcon: string;
  coverImageUrl: string | null;
  ageGroup: string;
  pageCount: number;
  collection: string;
}

// Pastel gradients — always override server colors to match Aivorah theme
const PASTEL_GRAD: Record<string, [string, string]> = {
  '#7c3aed': ['#9B8FC0', '#7BA8A4'],
  '#4f46e5': ['#8FA0C0', '#7BA8A4'],
  '#0ea5e9': ['#7EA8C0', '#82A896'],
  '#6366f1': ['#9B8FC0', '#7EA8C0'],
  '#ea580c': ['#C0A07E', '#7BA8A4'],
  '#dc2626': ['#C08898', '#9B8FC0'],
  '#16a34a': ['#82A896', '#7BA8A4'],
  '#0891b2': ['#7EA8C0', '#82A896'],
  '#10b981': ['#82A896', '#7EA8C0'],
  '#f59e0b': ['#C0A07E', '#82A896'],
};

const COLLECTION_PASTEL: Record<string, string> = {
  'Srimad Bhagavatam': '#9B8FC0',
  'Ramayana':          '#C0A07E',
  'Bhagavad Gita':     '#82A896',
};

// Map server icon names to valid Feather icon names
const ICON_MAP: Record<string, string> = {
  crown:      'award',
  star:       'star',
  shield:     'shield',
  compass:    'compass',
  zap:        'zap',
  'book-open':'book-open',
  heart:      'heart',
};

function safeIcon(name: string): string {
  return ICON_MAP[name] ?? 'book-open';
}

export default function BhagavathaStoriesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [stories, setStories] = useState<StoryMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    fetch(`${SERVER_URL}/stories`)
      .then(r => r.json())
      .then(data => { setStories(data); setLoading(false); })
      .catch(() => { setError('Could not load stories. Please try again.'); setLoading(false); });
  }, []);

  // Group by collection
  const grouped = useMemo(() => {
    const map: Record<string, StoryMeta[]> = {};
    stories.forEach(s => {
      if (!map[s.collection]) map[s.collection] = [];
      map[s.collection].push(s);
    });
    return map;
  }, [stories]);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Bedtime Stories"
          subtitle="Bhagavatam · Ramayana · Bhagavad Gita"
          onMenuPress={() => navigation.openDrawer()}
          showSearch={false}
        />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Hero banner */}
          <LinearGradient
            colors={[TEAL + '30', FOREST + '18']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={[styles.heroIcon, { backgroundColor: TEAL + '30', borderColor: TEAL + '50' }]}>
              <Feather name="book-open" size={26} color={TEAL} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.heroTitle, { color: TEAL }]}>Bedtime Stories for Children</Text>
              <Text style={[styles.heroSub, { color: colors.textMuted }]}>
                Stories of devotion, courage and wisdom — narrated with love.
              </Text>
            </View>
          </LinearGradient>

          {loading && (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={TEAL} />
              <Text style={[styles.hint, { color: colors.textMuted }]}>Loading stories…</Text>
            </View>
          )}

          {!!error && (
            <View style={styles.center}>
              <Feather name="alert-circle" size={28} color={colors.accentRed} />
              <Text style={[styles.hint, { color: colors.textMuted }]}>{error}</Text>
            </View>
          )}

          {/* Grouped by collection */}
          {!loading && !error && Object.entries(grouped).map(([collection, items]) => {
            const collColor = COLLECTION_PASTEL[collection] ?? TEAL;
            return (
              <View key={collection} style={styles.section}>
                {/* Section header */}
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionDot, { backgroundColor: collColor }]} />
                  <Text style={[styles.sectionTitle, { color: collColor }]}>{collection}</Text>
                  <View style={[styles.sectionLine, { backgroundColor: collColor + '30' }]} />
                </View>

                {/* Story cards */}
                {items.map(story => {
                  const grad = PASTEL_GRAD[story.coverColor] ?? ['#7BA8A4', '#82A896'];
                  return (
                    <TouchableOpacity
                      key={story.id}
                      style={[styles.card, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}
                      onPress={() => navigation.navigate('StoryReader', { storyId: story.id, storyTitle: story.title })}
                      activeOpacity={0.88}
                    >
                      {/* Left: cover image or gradient icon fallback */}
                      {story.coverImageUrl ? (
                        <Image
                          source={{ uri: story.coverImageUrl.startsWith('http') ? story.coverImageUrl : `${SERVER_URL}${story.coverImageUrl}` }}
                          style={styles.cardIcon}
                          resizeMode="cover"
                        />
                      ) : (
                        <LinearGradient
                          colors={grad}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                          style={styles.cardIcon}
                        >
                          <View style={styles.cardIconInner}>
                            <Feather name={safeIcon(story.coverIcon) as any} size={26} color="#fff" />
                          </View>
                        </LinearGradient>
                      )}

                      {/* Right: info */}
                      <View style={styles.cardInfo}>
                        <Text style={[styles.cardTitle, { color: colors.textMain }]} numberOfLines={1}>
                          {story.title}
                        </Text>
                        <Text style={[styles.cardSub, { color: colors.textMuted }]} numberOfLines={2}>
                          {story.subtitle}
                        </Text>
                        <View style={styles.cardMeta}>
                          <View style={[styles.metaBadge, { backgroundColor: grad[0] + '20', borderColor: grad[0] + '50' }]}>
                            <Feather name="book" size={9} color={grad[0]} />
                            <Text style={[styles.metaText, { color: grad[0] }]}>{story.pageCount} pages</Text>
                          </View>
                          <View style={[styles.metaBadge, { backgroundColor: colors.borderColor, borderColor: 'transparent' }]}>
                            <Feather name="users" size={9} color={colors.textDim} />
                            <Text style={[styles.metaText, { color: colors.textDim }]}>Age {story.ageGroup}</Text>
                          </View>
                        </View>
                      </View>

                      {/* Read chevron */}
                      <View style={[styles.cardArrow, { backgroundColor: grad[0] + '18' }]}>
                        <Feather name="chevron-right" size={18} color={grad[0]} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen:   { flex: 1, backgroundColor: c.bgDark },
  content:  { padding: spacing.lg, paddingBottom: 48, gap: spacing.lg },
  center:   { alignItems: 'center', paddingVertical: 40, gap: 12 },
  hint:     { fontSize: 13, textAlign: 'center' },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.xl,
    borderWidth: 1, borderColor: TEAL + '30',
  },
  heroIcon: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  heroTitle: { fontSize: 15, fontWeight: '800', marginBottom: 3 },
  heroSub:   { fontSize: 12, lineHeight: 18 },

  // Section grouping
  section:       { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  sectionDot:    { width: 8, height: 8, borderRadius: 4 },
  sectionTitle:  { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionLine:   { flex: 1, height: 1 },

  // Horizontal card
  card: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.lg, borderWidth: 1,
    overflow: 'hidden',
  },
  cardIcon: {
    width: 90, height: 90,
    alignItems: 'center', justifyContent: 'center',
  },
  cardIconInner: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.30)',
  },
  cardInfo: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 4 },
  cardTitle: { fontSize: 14, fontWeight: '800' },
  cardSub:   { fontSize: 12, lineHeight: 17 },
  cardMeta:  { flexDirection: 'row', gap: 6, marginTop: 2 },
  metaBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 12, borderWidth: 1,
  },
  metaText:  { fontSize: 10, fontWeight: '600' },
  cardArrow: {
    width: 36, alignSelf: 'stretch',
    alignItems: 'center', justifyContent: 'center',
  },
});
