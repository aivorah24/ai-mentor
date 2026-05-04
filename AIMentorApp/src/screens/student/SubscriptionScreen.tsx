import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, useWindowDimensions, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

const TEAL   = '#5F8A86';
const FOREST = '#5A8A70';
const AMBER  = '#C5A56A';
const ROSE   = '#EFD1D4';
const SAGE   = '#93B0AC';

/* ── Plan definitions ───────────────────────────────────────────── */

interface Plan {
  id: string;
  name: string;
  tagline: string;
  price: string;
  priceNote: string;
  color: string;
  icon: string;
  badge?: string;
  ctaLabel: string;
  featuresHeading?: string;
  features: string[];
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Try Aivorah',
    price: '\u20B90',
    priceNote: 'Free for everyone',
    color: TEAL,
    icon: 'feather',
    ctaLabel: 'Current Plan',
    features: [
      'Personalised Learning Paths',
      'AI Coach \u2014 10 messages/day',
      'Assignments & Schedule',
      'Progress Tracking',
      'Leaderboard & Rewards',
      '1 free story per collection',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For everyday learning',
    price: '\u20B9499',
    priceNote: 'Per month with annual plan (\u20B94,999/yr).\n\u20B9599 if billed monthly.',
    color: AMBER,
    icon: 'sun',
    badge: 'POPULAR',
    ctaLabel: 'Upgrade to Pro',
    featuresHeading: 'Everything in Free, plus:',
    features: [
      'Unlimited AI Coach messages',
      'All Bedtime Stories (all collections)',
      'Daily Habits Tracker',
      'Challenges & Competitions',
      'Parent daily task assignment',
      'Detailed analytics & insights',
    ],
  },
  {
    id: 'max',
    name: 'Max',
    tagline: 'For the whole family',
    price: 'From \u20B9999',
    priceNote: 'Per month',
    color: ROSE,
    icon: 'sunrise',
    ctaLabel: 'Upgrade to Max',
    featuresHeading: 'Everything in Pro, plus:',
    features: [
      'Up to 3 child profiles',
      'Priority AI Coach responses',
      'Advanced parent dashboard',
      'Early access to new features',
      'Dedicated support',
    ],
  },
];

/* ── Tier icon — Aivorah-branded (zap in rounded square, matching sidebar logo) */
function TierIcon({ color, plan }: { color: string; plan: Plan }) {
  return (
    <View style={[tierStyles.wrap, { backgroundColor: color + '14', borderColor: color + '30' }]}>
      <Feather name={plan.icon as any} size={24} color={color} />
    </View>
  );
}

const tierStyles = StyleSheet.create({
  wrap: {
    width: 52, height: 52, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});

/* ── Component ──────────────────────────────────────────────────── */

// Load Razorpay checkout script on web
function useRazorpayScript() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if ((window as any).Razorpay) { setLoaded(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setLoaded(true);
    document.body.appendChild(script);
  }, []);
  return loaded;
}

export default function SubscriptionScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user, updateUser } = useAuth();
  const isPro = user?.isPro === true;
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const styles = useMemo(() => makeStyles(colors, isWide), [colors, isWide]);
  const razorpayReady = useRazorpayScript();
  const [processing, setProcessing] = useState<string | null>(null); // planId being processed

  function getCurrentPlanId() {
    if (!isPro) return 'free';
    return 'pro';
  }
  const currentPlanId = getCurrentPlanId();

  async function handleUpgrade(planId: string) {
    if (processing) return;
    if (Platform.OS !== 'web' || !razorpayReady) {
      Alert.alert('Payment', 'Razorpay checkout is loading. Please try again in a moment.');
      return;
    }

    setProcessing(planId);
    try {
      // 1. Create order on backend
      const orderRes = await fetch(`${SERVER_URL}/payment/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, email: user?.email, name: user?.name }),
      });
      if (!orderRes.ok) {
        const err = await orderRes.json();
        throw new Error(err.error || 'Failed to create order');
      }
      const order = await orderRes.json();

      // 2. Open Razorpay checkout
      const RazorpayCheckout = (window as any).Razorpay;
      const rzp = new RazorpayCheckout({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Aivorah',
        description: order.description,
        order_id: order.orderId,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
          contact: '9876543210',
        },
        theme: {
          color: '#93B0AC', // Aivorah primary teal
        },
        handler: async (response: any) => {
          // 3. Verify payment on backend
          try {
            const verifyRes = await fetch(`${SERVER_URL}/payment/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                email: user?.email,
                planId,
              }),
            });
            const result = await verifyRes.json();
            if (result.success) {
              updateUser({ isPro: true });
              Alert.alert('Payment Successful', result.message || 'Your plan has been activated!');
            } else {
              Alert.alert('Verification Failed', result.error || 'Please contact support.');
            }
          } catch {
            Alert.alert('Error', 'Payment was received but verification failed. Please contact support@aivorah.ai.');
          }
          setProcessing(null);
        },
        modal: {
          ondismiss: () => setProcessing(null),
        },
      });
      rzp.open();
    } catch (err: any) {
      Alert.alert('Payment Error', err.message || 'Something went wrong. Please try again.');
      setProcessing(null);
    }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Plans"
          subtitle=""
          onMenuPress={() => navigation.openDrawer()}
          showSearch={false}
        />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Aivorah brand header ─────────────────────────── */}
          <View style={styles.brandHeader}>
            <View style={styles.brandLogoMark}>
              <Feather name="zap" size={20} color="#fff" />
            </View>
            <View>
              <Text style={[styles.brandTitle, { color: colors.textMain }]}>Aivorah Plans</Text>
              <Text style={[styles.brandSub, { color: colors.textMuted }]}>
                Choose the right plan for your learning journey
              </Text>
            </View>
          </View>

          {/* ── Plan cards ───────────────────────────────────── */}
          <View style={styles.cardsRow}>
            {PLANS.map((plan) => {
              const isCurrent = plan.id === currentPlanId;
              const isUpgrade = PLANS.findIndex(p => p.id === plan.id) > PLANS.findIndex(p => p.id === currentPlanId);

              return (
                <View
                  key={plan.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.cardDark,
                      borderColor: isCurrent ? plan.color + '50' : colors.borderColor,
                    },
                  ]}
                >
                  {/* Badge */}
                  {plan.badge && (
                    <View style={[styles.badge, { backgroundColor: plan.color }]}>
                      <Text style={styles.badgeText}>{plan.badge}</Text>
                    </View>
                  )}

                  {/* Tier icon */}
                  <TierIcon color={plan.color} plan={plan} />

                  {/* Name & tagline */}
                  <Text style={[styles.planName, { color: colors.textMain }]}>{plan.name}</Text>
                  <Text style={[styles.planTagline, { color: colors.textMuted }]}>{plan.tagline}</Text>

                  {/* Price */}
                  <Text style={[styles.price, { color: colors.textMain }]}>{plan.price}</Text>
                  <Text style={[styles.priceNote, { color: colors.textMuted }]}>{plan.priceNote}</Text>

                  {/* CTA */}
                  {isCurrent ? (
                    <View style={[styles.ctaOutline, { borderColor: plan.color + '50' }]}>
                      <Feather name="check-circle" size={14} color={plan.color} />
                      <Text style={[styles.ctaOutlineText, { color: plan.color, marginLeft: 6 }]}>Current Plan</Text>
                    </View>
                  ) : isUpgrade ? (
                    <TouchableOpacity
                      style={[styles.ctaFilled, { backgroundColor: plan.color, opacity: processing ? 0.7 : 1 }]}
                      onPress={() => handleUpgrade(plan.id)}
                      disabled={!!processing}
                    >
                      {processing === plan.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.ctaFilledText}>{plan.ctaLabel}</Text>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.ctaOutline, { borderColor: colors.borderColor }]}>
                      <Text style={[styles.ctaOutlineText, { color: colors.textDim }]}>Included</Text>
                    </View>
                  )}

                  {/* Divider */}
                  <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />

                  {/* Features heading */}
                  {plan.featuresHeading && (
                    <Text style={[styles.featuresHeading, { color: colors.textMain }]}>
                      {plan.featuresHeading}
                    </Text>
                  )}

                  {/* Feature list */}
                  <View style={styles.featureList}>
                    {plan.features.map((f, i) => (
                      <View key={i} style={styles.featureRow}>
                        <Feather name="check" size={14} color={plan.color} />
                        <Text style={[styles.featureText, { color: colors.textMain }]}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Feather name="info" size={13} color={colors.textDim} />
            <Text style={[styles.footerText, { color: colors.textDim }]}>
              Premium access can also be activated by your school or parent. Pricing may vary by institution. All plans include a 7-day free trial.
            </Text>
          </View>

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const makeStyles = (c: any, isWide: boolean) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  content: { padding: spacing.lg, paddingBottom: 48, gap: spacing.xl },

  // ── Brand header ─────────────────────────────────────────────
  brandHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md,
  },
  brandLogoMark: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#93B0AC',
    alignItems: 'center', justifyContent: 'center',
  },
  brandTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  brandSub:   { fontSize: 13, fontWeight: '500', marginTop: 1 },

  // ── Cards ────────────────────────────────────────────────────
  cardsRow: {
    flexDirection: isWide ? 'row' : 'column',
    gap: spacing.lg,
  },

  card: {
    flex: isWide ? 1 : undefined,
    borderRadius: radius.xl, borderWidth: 1,
    padding: spacing.xl, gap: 12, overflow: 'hidden',
  },
  badge: {
    position: 'absolute', top: 0, right: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },

  planName:    { fontSize: 24, fontWeight: '800', marginTop: 4 },
  planTagline: { fontSize: 13, fontWeight: '500', marginTop: -4 },

  price:     { fontSize: 28, fontWeight: '800', marginTop: 8 },
  priceNote: { fontSize: 12, lineHeight: 18, marginTop: -4 },

  ctaFilled: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: radius.md, marginTop: 8,
  },
  ctaFilledText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  ctaOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: radius.md, borderWidth: 1, marginTop: 8,
  },
  ctaOutlineText: { fontSize: 14, fontWeight: '700' },

  divider: { height: 1, marginVertical: 4 },

  featuresHeading: { fontSize: 13, fontWeight: '700' },

  featureList: { gap: 10 },
  featureRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 13, fontWeight: '500', flex: 1 },

  footer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 4,
  },
  footerText: { flex: 1, fontSize: 11, lineHeight: 16 },
});
