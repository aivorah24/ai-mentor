/**
 * WorldAndYouScreen.tsx
 * "The World & You" — GK facts, On This Day, Current Affairs
 * Reuses DailyTidbitCard + adds On This Day & Brain Teaser from /world/daily
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import DailyTidbitCard from '../../components/common/DailyTidbitCard';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface OnThisDay { year: number; fact: string }
interface FunChallenge { question: string; answer: string }

interface WorldData {
  onThisDay: OnThisDay[];
  funChallenge: FunChallenge;
  date: string;
}

export default function WorldAndYouScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const grade = user?.grade || 'Grade 3';

  const [loading, setLoading] = useState(true);
  const [worldData, setWorldData] = useState<WorldData | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${SERVER_URL}/world/daily?grade=${encodeURIComponent(grade)}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setWorldData(json);
      } catch {
        setError('Could not load today\'s content. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [grade]);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="The World & You"
          subtitle="Learn something new every day"
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Date header */}
          {worldData?.date && (
            <View style={styles.dateRow}>
              <Feather name="calendar" size={16} color={colors.primary} />
              <Text style={[styles.dateText, { color: colors.primary }]}>{worldData.date}</Text>
              <Text style={[styles.gradeText, { color: colors.textMuted }]}>{grade}</Text>
            </View>
          )}

          {/* GK Fact + Current Affairs — reuse DailyTidbitCard */}
          <DailyTidbitCard grade={grade} />

          {/* On This Day */}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Loading history & challenge...
              </Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Feather name="wifi-off" size={28} color={colors.textDim} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>{error}</Text>
            </View>
          ) : worldData ? (
            <>
              {/* On This Day */}
              {worldData.onThisDay?.length > 0 && (
                <View style={[styles.card, { borderColor: '#4A9E9A50' }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBadge, { backgroundColor: '#4A9E9A22' }]}>
                      <Feather name="clock" size={16} color="#4A9E9A" />
                    </View>
                    <Text style={[styles.cardTitle, { color: '#4A9E9A' }]}>On This Day</Text>
                  </View>
                  {worldData.onThisDay.map((item, i) => (
                    <View key={i} style={styles.factRow}>
                      <View style={[styles.yearBadge, { backgroundColor: '#4A9E9A18' }]}>
                        <Text style={[styles.yearText, { color: '#4A9E9A' }]}>{item.year}</Text>
                      </View>
                      <Text style={[styles.factText, { color: colors.textMain }]}>{item.fact}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Brain Teaser */}
              {worldData.funChallenge && (
                <View style={[styles.card, { borderColor: '#C8587050' }]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBadge, { backgroundColor: '#C8587022' }]}>
                      <Feather name="help-circle" size={16} color="#C85870" />
                    </View>
                    <Text style={[styles.cardTitle, { color: '#C85870' }]}>Brain Teaser</Text>
                  </View>
                  <Text style={[styles.challengeQ, { color: colors.textMain }]}>{worldData.funChallenge.question}</Text>
                  {showAnswer ? (
                    <View style={[styles.answerBox, { backgroundColor: '#4A9E7018', borderColor: '#4A9E7040' }]}>
                      <Feather name="check-circle" size={14} color="#4A9E70" />
                      <Text style={[styles.answerText, { color: '#4A9E70' }]}>{worldData.funChallenge.answer}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.revealBtn, { backgroundColor: '#C85870' }]}
                      onPress={() => setShowAnswer(true)}
                      activeOpacity={0.85}
                    >
                      <Feather name="eye" size={14} color="#fff" />
                      <Text style={styles.revealBtnText}>Reveal Answer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 24 },
  loadingText: { fontSize: 13, textAlign: 'center' },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateText: { fontSize: 14, fontWeight: '700' },
  gradeText: { fontSize: 12, marginLeft: 'auto' },

  card: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBadge: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '800', flex: 1 },

  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  yearBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 2 },
  yearText: { fontSize: 12, fontWeight: '800' },
  factText: { flex: 1, fontSize: 14, lineHeight: 21 },

  challengeQ: { fontSize: 15, fontWeight: '700', lineHeight: 24 },
  answerBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1,
  },
  answerText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  revealBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: radius.md,
  },
  revealBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
