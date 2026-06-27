/**
 * WorldAndYouScreen.tsx
 * "The World & You" — GK facts, On This Day, Current Affairs
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useStudentData } from '../../context/StudentDataContext';
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

const TEAL  = '#BAA467';
const ROSE  = '#BAA467';

export default function WorldAndYouScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { user }           = useAuth();
  const { studentId }      = useStudentData();
  const styles             = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const grade = user?.grade || 'Grade 3';

  const [loading, setLoading]   = useState(true);
  const [worldData, setWorldData] = useState<WorldData | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      setShowAnswer(false);
      try {
        const res  = await fetch(`${SERVER_URL}/world/daily?grade=${encodeURIComponent(grade)}`);
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
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Date pill ─────────────────────────────────────── */}
          <View style={styles.datePill}>
            <Feather name="calendar" size={13} color={TEAL} />
            <Text style={[styles.dateText, { color: TEAL }]}>
              {worldData?.date ?? new Date().toISOString().split('T')[0]}
            </Text>
            <View style={styles.gradePill}>
              <Text style={[styles.gradeText, { color: colors.textMuted }]}>{grade}</Text>
            </View>
          </View>

          {/* ── GK + Current Affairs card ─────────────────────── */}
          <DailyTidbitCard grade={grade} studentId={studentId || undefined} />

          {/* ── Loading / Error ───────────────────────────────── */}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="small" color={TEAL} />
              <Text style={[styles.hint, { color: colors.textMuted }]}>Loading history & challenge…</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Feather name="wifi-off" size={26} color={colors.textDim} />
              <Text style={[styles.hint, { color: colors.textMuted }]}>{error}</Text>
            </View>
          ) : worldData ? (
            <>
              {/* ── On This Day ───────────────────────────────── */}
              {worldData.onThisDay?.length > 0 && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBadge, { backgroundColor: TEAL + '20' }]}>
                      <Feather name="clock" size={15} color={TEAL} />
                    </View>
                    <View>
                      <Text style={[styles.cardTitle, { color: TEAL }]}>On This Day</Text>
                      <Text style={[styles.cardSub, { color: colors.textMuted }]}>Historical highlights</Text>
                    </View>
                  </View>

                  <View style={[styles.divider, { backgroundColor: TEAL + '25' }]} />

                  {worldData.onThisDay.map((item, i) => (
                    <View key={i} style={styles.factRow}>
                      <View style={[styles.yearBadge, { backgroundColor: TEAL + '18', borderColor: TEAL + '35' }]}>
                        <Text style={[styles.yearText, { color: TEAL }]}>{item.year}</Text>
                      </View>
                      <Text style={[styles.factText, { color: colors.textMain }]}>{item.fact}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* ── Brain Teaser ──────────────────────────────── */}
              {worldData.funChallenge && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBadge, { backgroundColor: ROSE + '20' }]}>
                      <Feather name="zap" size={15} color={ROSE} />
                    </View>
                    <View>
                      <Text style={[styles.cardTitle, { color: ROSE }]}>Brain Teaser</Text>
                      <Text style={[styles.cardSub, { color: colors.textMuted }]}>Can you figure it out?</Text>
                    </View>
                  </View>

                  <View style={[styles.divider, { backgroundColor: ROSE + '25' }]} />

                  <Text style={[styles.challengeQ, { color: colors.textMain }]}>
                    {worldData.funChallenge.question}
                  </Text>

                  {showAnswer ? (
                    <View style={[styles.answerBox, { backgroundColor: TEAL + '15', borderColor: TEAL + '40' }]}>
                      <Feather name="check-circle" size={15} color={TEAL} />
                      <Text style={[styles.answerText, { color: TEAL }]}>{worldData.funChallenge.answer}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.revealBtn, { backgroundColor: ROSE + '18', borderColor: ROSE + '50' }]}
                      onPress={() => setShowAnswer(true)}
                      activeOpacity={0.8}
                    >
                      <Feather name="eye" size={13} color={ROSE} />
                      <Text style={[styles.revealBtnText, { color: ROSE }]}>Reveal Answer</Text>
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

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  content: { padding: spacing.xl, paddingBottom: 56, gap: spacing.lg },
  center:  { alignItems: 'center', gap: 10, paddingVertical: 24 },
  hint:    { fontSize: 13, textAlign: 'center' },

  // Date row
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateText: { fontSize: 13, fontWeight: '700' },
  gradePill: { marginLeft: 'auto' },
  gradeText: { fontSize: 12 },

  // Card
  card: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: isDark ? c.borderColor : '#d0e0de',
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBadge: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub:   { fontSize: 11, marginTop: 1 },
  divider:   { height: 1, borderRadius: 1 },

  // On This Day
  factRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  yearBadge: {
    paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 7, borderWidth: 1, marginTop: 2,
  },
  yearText: { fontSize: 11, fontWeight: '800' },
  factText: { flex: 1, fontSize: 14, lineHeight: 21 },

  // Brain Teaser
  challengeQ: { fontSize: 15, fontWeight: '700', lineHeight: 24 },
  answerBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: radius.md, borderWidth: 1,
  },
  answerText: { flex: 1, fontSize: 14, fontWeight: '700' },
  revealBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    gap: 7, paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 10, borderWidth: 1,
  },
  revealBtnText: { fontSize: 13, fontWeight: '700' },
});
