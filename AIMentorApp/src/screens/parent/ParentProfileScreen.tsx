import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function InfoField({ label, value, styles }: { label: string; value: string; styles: any }) {
  return (
    <View style={styles.infoField}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValueBox}>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function ParentProfileScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [children, setChildren] = useState<any[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(true);
  const [weeklyActivity, setWeeklyActivity] = useState<number[]>([0,0,0,0,0,0,0]);

  const parentEmail = user?.email || 'parent@demo.com';

  useEffect(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setChildren(data);
          // Sum weekly activity across all children
          if (data.length > 0) {
            Promise.all(
              data.map(c =>
                fetch(`${SERVER_URL}/student/${c.id}/weekly`)
                  .then(r => r.json())
                  .catch(() => ({ days: [] }))
              )
            ).then(results => {
              const combined = [0,0,0,0,0,0,0];
              results.forEach(res => {
                if (res?.days) {
                  const actMap: Record<string,number> = {};
                  res.days.forEach((d: any) => { actMap[d.day] = d.studyMinutes ?? 0; });
                  WEEK_DAYS.forEach((d, i) => { combined[i] += actMap[d] ?? 0; });
                }
              });
              setWeeklyActivity(combined);
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setChildrenLoading(false));
  }, [parentEmail]);

  const nameParts = (user?.name ?? '').split(' ');
  const firstName = nameParts[0] || 'Parent';
  const lastName = nameParts.slice(1).join(' ') || '';
  const email = user?.email ?? '';

  const maxActivity = Math.max(...weeklyActivity, 1);
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const totalStudyH = (weeklyActivity.reduce((a,b) => a+b, 0) / 60).toFixed(1);
  const activeDays = weeklyActivity.filter(m => m > 0).length;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Profile"
          subtitle="Manage your account"
          searchPlaceholder="Search parent settings..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroLeft}>
              <View style={styles.heroAvatar}>
                <Text style={styles.heroAvatarText}>{firstName[0]}</Text>
              </View>
              <View>
                <Text style={styles.heroWelcome}>Welcome,</Text>
                <Text style={styles.heroName}>{user?.name ?? 'Sarah Richardson'}</Text>
                <View style={styles.heroTags}>
                  <View style={[styles.heroTag, { backgroundColor: colors.accentGreen + '18', borderColor: colors.accentGreen + '33' }]}>
                    <Feather name="check-circle" size={11} color={colors.accentGreen} />
                    <Text style={[styles.heroTagText, { color: colors.accentGreen }]}>Verified Account</Text>
                  </View>
                  <View style={[styles.heroTag, { backgroundColor: colors.accentYellow + '18', borderColor: colors.accentYellow + '33' }]}>
                    <Feather name="star" size={11} color={colors.accentYellow} />
                    <Text style={[styles.heroTagText, { color: colors.accentYellow }]}>Premium Member</Text>
                  </View>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.editBtn} activeOpacity={0.8}>
              <Feather name="edit-2" size={13} color="white" />
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.twoCol}>
            {/* Profile Info */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Feather name="user" size={16} color={colors.primary} />
                <Text style={styles.cardTitle}>Profile Information</Text>
              </View>
              <View style={styles.infoGrid}>
                <InfoField label="First Name" value={firstName} styles={styles} />
                <InfoField label="Last Name" value={lastName} styles={styles} />
                <InfoField label="Email Address" value={email} styles={styles} />
                <InfoField label="Contact Number" value="+91 98765 43210" styles={styles} />
              </View>
            </View>

            {/* Activity Overview */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Feather name="activity" size={16} color={colors.accentGreen} />
                <Text style={styles.cardTitle}>Activity Overview</Text>
                <View style={styles.weekBadge}><Text style={styles.weekBadgeText}>This Week</Text></View>
              </View>
              <View style={styles.overviewStats}>
                <View style={styles.overviewStat}>
                  <Text style={[styles.overviewValue, { color: colors.primary }]}>{Math.round((activeDays / 7) * 100)}%</Text>
                  <Text style={styles.overviewLabel}>ACTIVE DAYS</Text>
                </View>
                <View style={styles.overviewStat}>
                  <Text style={[styles.overviewValue, { color: colors.textMain }]}>{totalStudyH}h</Text>
                  <Text style={styles.overviewLabel}>TOTAL LEARNING</Text>
                </View>
                <View style={styles.overviewStat}>
                  <Text style={[styles.overviewValue, { color: colors.accentGreen }]}>{children.length} kids</Text>
                  <Text style={styles.overviewLabel}>LINKED</Text>
                </View>
              </View>
              <Text style={styles.chartLabel}>Day-wise Time Spent</Text>
              <View style={styles.miniChart}>
                {WEEK_DAYS.map((d, i) => {
                  const h = maxActivity > 0 ? Math.max(4, (weeklyActivity[i] / maxActivity) * 64) : 4;
                  const isToday = i === todayIdx;
                  return (
                    <View key={d} style={styles.miniBarWrap}>
                      <View style={styles.miniBarTrack}>
                        <View style={[styles.miniBarFill, { height: h, backgroundColor: isToday ? colors.primary : colors.textDim + '40' }]} />
                      </View>
                      <Text style={[styles.miniBarLabel, isToday && { color: colors.primary, fontWeight: '700' }]}>{d}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Security */}
          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <View style={styles.cardHeader}>
              <Feather name="lock" size={16} color={colors.accentRed} />
              <Text style={styles.cardTitle}>Security & Account</Text>
              <TouchableOpacity style={styles.changePassBtn}>
                <Text style={styles.changePassText}>Change Password</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.securityRow}>
              <View>
                <Text style={styles.secTitle}>Two-Factor Authentication</Text>
                <Text style={styles.secSub}>Secure your account with 2FA code</Text>
              </View>
              <View style={styles.toggleOn}>
                <View style={styles.toggleThumb} />
              </View>
            </View>
          </View>

          {/* Linked Children */}
          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <View style={styles.cardHeader}>
              <Feather name="users" size={16} color={colors.accentBlue} />
              <Text style={styles.cardTitle}>Linked Children</Text>
              <TouchableOpacity onPress={() => navigation.navigate('ParentMyKids')}>
                <Text style={[styles.changePassText, { color: colors.accentGreen }]}>+ Add Child</Text>
              </TouchableOpacity>
            </View>
            {childrenLoading ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
            ) : children.length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>No children linked yet.</Text>
              </View>
            ) : children.map(ch => {
              const isOnTrack = (ch.currentStreak ?? 0) >= 3;
              const statusLabel = isOnTrack ? 'Active' : 'Needs Attention';
              const dotColor = isOnTrack ? colors.accentGreen : colors.accentYellow;
              return (
                <View key={ch.id} style={styles.childRow}>
                  <View style={[styles.childDot, { backgroundColor: dotColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.childRowName}>{ch.name}</Text>
                    <Text style={styles.childRowGrade}>{ch.grade} · {ch.xpPoints ?? 0} XP</Text>
                  </View>
                  <Text style={[styles.childStatus, { color: dotColor }]}>{statusLabel}</Text>
                </View>
              );
            })}
          </View>

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  heroCard: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: c.primary + '30',
    borderWidth: 3,
    borderColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: { fontSize: 28, fontWeight: '700', color: c.primary },
  heroWelcome: { fontSize: 13, color: c.textMuted },
  heroName: { fontSize: 22, fontWeight: '700', color: c.textMain, marginBottom: 8 },
  heroTags: { flexDirection: 'row', gap: spacing.sm },
  heroTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  heroTagText: { fontSize: 10, fontWeight: '600' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  editBtnText: { fontSize: 13, fontWeight: '700', color: 'white' },

  twoCol: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  card: {
    flex: 1,
    minWidth: 280,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: c.textMain },
  weekBadge: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  weekBadgeText: { fontSize: 10, fontWeight: '600', color: c.textMuted },

  infoGrid: { gap: spacing.md },
  infoField: {},
  infoLabel: { fontSize: 11, color: c.textMuted, marginBottom: 4 },
  infoValueBox: { backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  infoValue: { fontSize: 14, color: c.textMain },

  overviewStats: { flexDirection: 'row', marginBottom: spacing.xl },
  overviewStat: { flex: 1 },
  overviewValue: { fontSize: 22, fontWeight: '700' },
  overviewLabel: { fontSize: 9, color: c.textDim, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  chartLabel: { fontSize: 11, color: c.textMuted, marginBottom: spacing.md },
  miniChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 80 },
  miniBarWrap: { flex: 1, alignItems: 'center', gap: 4 },
  miniBarTrack: { width: 18, height: 64, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  miniBarFill: { width: '100%', borderRadius: 9 },
  miniBarLabel: { fontSize: 9, color: c.textDim },

  changePassBtn: { backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5 },
  changePassText: { fontSize: 11, fontWeight: '600', color: c.textMuted },
  securityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  secTitle: { fontSize: 14, fontWeight: '600', color: c.textMain },
  secSub: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  toggleOn: { width: 44, height: 24, borderRadius: 12, backgroundColor: c.primary, justifyContent: 'center', paddingRight: 4, alignItems: 'flex-end' },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'white' },

  childRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor },
  childDot: { width: 8, height: 8, borderRadius: 4 },
  childRowName: { fontSize: 13, fontWeight: '600', color: c.textMain },
  childRowGrade: { fontSize: 11, color: c.textMuted },
  childStatus: { fontSize: 11, fontWeight: '600' },
});
