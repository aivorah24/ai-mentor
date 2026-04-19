import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import { spacing, radius } from '../../theme';

// ── Palette ──────────────────────────────────────────────────
const TEAL   = '#5F8A86';
const GOLD   = '#8A8358';
const ROSE   = '#B8797E';
const GREEN  = '#5A8A70';

// ── Merchandise catalogue ─────────────────────────────────────
const MERCH = [
  {
    icon: 'star'      as const,
    label: 'Aivorah Sticker Pack',
    desc: '10 exclusive Aivorah stickers',
    credits: 5,
    color: TEAL,
  },
  {
    icon: 'book'      as const,
    label: 'Aivorah Notebook',
    desc: 'Premium learning journal with Aivorah branding',
    credits: 15,
    color: GOLD,
  },
  {
    icon: 'award'     as const,
    label: 'Champion Badge',
    desc: 'Official Aivorah gold champion badge',
    credits: 25,
    color: ROSE,
  },
  {
    icon: 'package'   as const,
    label: 'Surprise Goodie Box',
    desc: 'Mystery box of Aivorah goodies delivered to you',
    credits: 50,
    color: GREEN,
  },
  {
    icon: 'tag'       as const,
    label: 'Aivorah T-Shirt',
    desc: 'Wear your achievement with pride',
    credits: 80,
    color: TEAL,
  },
  {
    icon: 'shield'    as const,
    label: 'Elite Learner Trophy',
    desc: 'Physical trophy for top performers',
    credits: 150,
    color: GOLD,
  },
];

// ── How to earn credits ───────────────────────────────────────
const HOW_TO_EARN = [
  { icon: 'book-open' as const, label: 'Complete a Topic',     credits: '+1 credit',  color: TEAL  },
  { icon: 'check-circle' as const, label: 'Finish a Quiz',     credits: '+2 credits', color: GREEN },
  { icon: 'zap'       as const, label: 'Daily Goal Streak',    credits: '+3 credits', color: GOLD  },
  { icon: 'target'    as const, label: 'Win a Challenge',      credits: '+10 credits',color: ROSE  },
];

export default function RewardsScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { stats } = useStudentData();

  const credits    = Math.floor(stats.xpPoints / 100);
  const cardBg     = isDark ? colors.cardDark  : '#F4FAF9';
  const borderCol  = isDark ? colors.borderColor : TEAL + '25';
  const titleColor = isDark ? colors.textMain  : '#1C2A28';

  return (
    <ScreenLayout>
      <Header
        title="Rewards"
        subtitle="Earn credits · Redeem goodies"
        onMenuPress={() => navigation.openDrawer()}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bgDark }}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero credits card ─────────────────────────────── */}
        <View style={[s.heroCard, { backgroundColor: TEAL + '18', borderColor: TEAL + '35' }]}>
          <View style={[s.heroIconCircle, { backgroundColor: TEAL + '25' }]}>
            <Feather name="award" size={32} color={TEAL} />
          </View>
          <Text style={[s.heroCredits, { color: titleColor }]}>{credits}</Text>
          <Text style={[s.heroCreditsLabel, { color: TEAL }]}>Aivorah Credits</Text>
          <View style={[s.xpRow, { backgroundColor: GOLD + '15', borderColor: GOLD + '35' }]}>
            <Feather name="star" size={12} color={GOLD} />
            <Text style={[s.xpRowText, { color: GOLD }]}>{stats.xpPoints} XP  ·  100 XP = 1 Credit</Text>
          </View>

          {/* Brand tagline */}
          <View style={[s.taglineBox, { backgroundColor: colors.bgDark + 'aa', borderColor: borderCol }]}>
            <Feather name="lock" size={12} color={colors.textMuted} />
            <Text style={[s.taglineText, { color: colors.textMuted }]}>
              You earn it, you can't buy it.
            </Text>
          </View>
        </View>

        {/* ── How to earn credits ───────────────────────────── */}
        <Text style={[s.sectionLabel, { color: colors.textMuted }]}>HOW TO EARN CREDITS</Text>
        <View style={[s.earnCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
          {HOW_TO_EARN.map((item, i) => (
            <View key={item.label}>
              <View style={s.earnRow}>
                <View style={[s.earnIcon, { backgroundColor: item.color + '18' }]}>
                  <Feather name={item.icon} size={16} color={item.color} />
                </View>
                <Text style={[s.earnLabel, { color: titleColor }]}>{item.label}</Text>
                <View style={[s.earnBadge, { backgroundColor: item.color + '18', borderColor: item.color + '40' }]}>
                  <Text style={[s.earnBadgeText, { color: item.color }]}>{item.credits}</Text>
                </View>
              </View>
              {i < HOW_TO_EARN.length - 1 && (
                <View style={[s.divider, { backgroundColor: borderCol }]} />
              )}
            </View>
          ))}
        </View>

        {/* ── Merchandise ───────────────────────────────────── */}
        <Text style={[s.sectionLabel, { color: colors.textMuted }]}>REDEEM YOUR CREDITS</Text>
        <View style={s.merchGrid}>
          {MERCH.map(item => {
            const canAfford = credits >= item.credits;
            return (
              <View
                key={item.label}
                style={[
                  s.merchCard,
                  {
                    backgroundColor: isDark ? colors.cardDark : item.color + '0C',
                    borderColor: canAfford ? item.color + '50' : borderCol,
                  },
                ]}
              >
                <View style={[s.merchIconCircle, { backgroundColor: canAfford ? item.color + '20' : colors.cardHover }]}>
                  <Feather name={item.icon} size={24} color={canAfford ? item.color : colors.textDim} />
                </View>

                <Text style={[s.merchLabel, { color: canAfford ? titleColor : colors.textMuted }]}>{item.label}</Text>
                <Text style={[s.merchDesc, { color: colors.textMuted }]}>{item.desc}</Text>

                <View style={[s.creditCost, { backgroundColor: canAfford ? item.color + '18' : colors.cardHover }]}>
                  <Feather name="award" size={11} color={canAfford ? item.color : colors.textDim} />
                  <Text style={[s.creditCostText, { color: canAfford ? item.color : colors.textDim }]}>
                    {item.credits} credits
                  </Text>
                </View>

                {/* Redeem button */}
                <TouchableOpacity
                  style={[
                    s.redeemBtn,
                    {
                      backgroundColor: canAfford ? item.color + '18' : colors.cardHover,
                      borderColor: canAfford ? item.color + '40' : borderCol,
                    },
                  ]}
                  activeOpacity={0.7}
                  disabled
                >
                  <Feather name="clock" size={12} color={canAfford ? item.color : colors.textDim} />
                  <Text style={[s.redeemBtnText, { color: canAfford ? item.color : colors.textDim }]}>
                    Coming Soon
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* ── Bottom note ───────────────────────────────────── */}
        <View style={[s.noteCard, { backgroundColor: TEAL + '0C', borderColor: TEAL + '30' }]}>
          <Feather name="info" size={14} color={TEAL} />
          <Text style={[s.noteText, { color: colors.textMuted }]}>
            Physical rewards are shipped directly to your school address. Top performers each term will receive their goodies from the Aivorah team!
          </Text>
        </View>

      </ScrollView>
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  // Hero
  heroCard: {
    borderRadius: radius.xl, borderWidth: 1,
    padding: spacing.xl, alignItems: 'center', gap: spacing.md,
  },
  heroIconCircle:  { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  heroCredits:     { fontSize: 52, fontWeight: '900', lineHeight: 58 },
  heroCreditsLabel:{ fontSize: 14, fontWeight: '700' },
  xpRow:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  xpRowText:       { fontSize: 12, fontWeight: '700' },
  taglineBox:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1 },
  taglineText:     { fontSize: 12, fontStyle: 'italic' },

  // Section label
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },

  // How to earn
  earnCard:   { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  earnRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  earnIcon:   { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  earnLabel:  { flex: 1, fontSize: 13, fontWeight: '600' },
  earnBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  earnBadgeText: { fontSize: 11, fontWeight: '700' },
  divider:    { height: 1, marginHorizontal: spacing.lg },

  // Merch grid
  merchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  merchCard: {
    width: '47%', borderRadius: radius.lg, borderWidth: 1,
    padding: spacing.lg, gap: spacing.sm, alignItems: 'center',
  },
  merchIconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  merchLabel:      { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  merchDesc:       { fontSize: 11, textAlign: 'center', lineHeight: 16 },
  creditCost:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  creditCostText:  { fontSize: 11, fontWeight: '700' },
  redeemBtn:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, marginTop: 2 },
  redeemBtnText:   { fontSize: 12, fontWeight: '600' },

  // Bottom note
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
