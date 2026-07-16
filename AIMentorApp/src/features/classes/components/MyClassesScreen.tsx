/**
 * "My Classes" — role-aware entry point (student/parent/teacher) into the
 * class homeroom card list, matching Toddle's "<Student>'s classes" screen.
 * A student/teacher sees their own class(es); a parent sees one card per
 * linked child. Tapping a card opens ClassDetailScreen (Portfolio/
 * Announcements/Assignments tabs, scoped to that grade+section).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { fetchMyClasses, MyClass } from '../api/classesApi';

export default function MyClassesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';

  const [classes, setClasses] = useState<MyClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      setClasses(await fetchMyClasses(email));
    } catch (e: any) {
      setError(e?.message || 'Failed to load classes');
    } finally {
      setLoading(false);
    }
  }, [email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const title = user?.role === 'parent' ? "My Kids' Classes" : 'My Classes';

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title={title} subtitle="Homeroom, portfolio and updates for your class" onMenuPress={() => navigation?.openDrawer?.()} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity onPress={load} style={styles.retryBtn} accessibilityRole="button">
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : classes.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="layers" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>
                No class assigned yet. Ask your school administrator to set a homeroom teacher for your grade & section.
              </Text>
            </View>
          ) : (
            classes.map((c, i) => (
              <TouchableOpacity
                key={`${c.grade}-${c.section}-${c.studentId || i}`}
                style={styles.card}
                activeOpacity={0.75}
                accessibilityRole="button"
                onPress={() => navigation?.navigate?.('ClassDetail', {
                  grade: c.grade, section: c.section, label: c.label, code: c.code,
                  classTeacherEmail: c.classTeacherEmail,
                  studentId: c.studentId, studentName: c.studentName,
                })}
              >
                {c.studentName && <Text style={styles.studentLabel}>{c.studentName}'s classes</Text>}
                <View style={styles.cardRow}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{(c.grade || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 2) || 'CL'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.label}</Text>
                    <Text style={styles.cardSubtitle}>{c.code}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.textDim} />
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 640, width: '100%', alignSelf: 'center', gap: 14 },
    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 10 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
    studentLabel: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textMuted, marginBottom: 8 },
    card: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg,
    },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: {
      width: 44, height: 44, borderRadius: radius.sm, backgroundColor: `${colors.accentYellow}22`,
      alignItems: 'center', justifyContent: 'center',
    },
    badgeText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: colors.accentYellow },
    cardTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading },
    cardSubtitle: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  });
}
