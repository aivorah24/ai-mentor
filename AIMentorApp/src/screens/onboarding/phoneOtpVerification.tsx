/**
 * Mobile number OTP verification via Firebase Phone Auth.
 *
 * STATUS: ON HOLD — not currently wired into onboarding, pending
 * founder confirmation on SMS provider/cost (Firebase Phone Auth
 * requires the Phone sign-in provider enabled + Blaze billing plan
 * beyond the free quota).
 *
 * This file preserves the working implementation (hook + modal) so it
 * can be dropped back into OnboardingParentBoxes.tsx's "Mobile Number"
 * field once approved. To re-integrate:
 *  1. Call `usePhoneOtpVerification(mobile, setMobile)` inside the component.
 *  2. Render `<PhoneOtpModal {...otp} mobile={mobile} colors={colors} styles={styles} />`
 *     alongside the other modals.
 *  3. In the Mobile Number field, show a "Verify" button
 *     (onPress={otp.handleSendOtp}, disabled={otp.otpSending}) or a
 *     "Verified" badge when `otp.mobileVerified` is true, and render
 *     `<View ref={otp.recaptchaContainerRef} />` on web.
 *  4. Include `mobileVerified: otp.mobileVerified && mobile === otp.verifiedMobile`
 *     in the preferences PATCH payload.
 *  5. Add styles `verifyBtn`, `verifyBtnTxt`, `verifiedBadge`, `verifiedTxt`,
 *     `warnTxt` to the screen's stylesheet.
 */
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signOut, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import firebaseApp from '../../config/firebase';
import { TEAL } from './OnboardingScreen';

export function usePhoneOtpVerification(mobile: string, setMobile: (v: string) => void) {
  const [mobileVerified, setMobileVerified] = useState(false);
  const [verifiedMobile, setVerifiedMobile] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const confirmationRef = useRef<any>(null);
  const recaptchaVerifierRef = useRef<any>(null);
  const recaptchaContainerRef = useRef<any>(null);
  const phoneAuthAppRef = useRef<any>(null);

  function cleanupPhoneAuth() {
    if (recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current.clear?.();
      recaptchaVerifierRef.current = null;
    }
    if (phoneAuthAppRef.current) {
      const app = phoneAuthAppRef.current;
      phoneAuthAppRef.current = null;
      signOut(getAuth(app)).catch(() => {});
      deleteApp(app).catch(() => {});
    }
  }

  async function handleSendOtp() {
    const digits = mobile.replace(/\D/g, '');
    if (digits.length !== 10) {
      setOtpError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (Platform.OS !== 'web') {
      setOtpError('Mobile verification is currently available on the web app.');
      return;
    }
    setOtpError('');
    setOtpSending(true);
    try {
      cleanupPhoneAuth();
      const secondaryName = `onboarding-phone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const phoneApp = initializeApp((firebaseApp as any).options, secondaryName);
      phoneAuthAppRef.current = phoneApp;
      const phoneAuth = getAuth(phoneApp);

      const verifier = new RecaptchaVerifier(phoneAuth, recaptchaContainerRef.current, { size: 'invisible' });
      recaptchaVerifierRef.current = verifier;

      const confirmation = await signInWithPhoneNumber(phoneAuth, `+91${digits}`, verifier);
      confirmationRef.current = confirmation;
      setOtpModalVisible(true);
      setOtpCode('');
    } catch (e: any) {
      setOtpError(e?.message || 'Could not send OTP. Please try again.');
      cleanupPhoneAuth();
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp() {
    if (!confirmationRef.current) {
      setOtpError('Please request a new code.');
      return;
    }
    setOtpVerifying(true);
    setOtpError('');
    try {
      await confirmationRef.current.confirm(otpCode.trim());
      setMobileVerified(true);
      setVerifiedMobile(mobile);
      setOtpModalVisible(false);
      setOtpCode('');
      confirmationRef.current = null;
      cleanupPhoneAuth();
    } catch (e: any) {
      setOtpError('Incorrect code. Please try again.');
    } finally {
      setOtpVerifying(false);
    }
  }

  function handleCancelOtp() {
    setOtpModalVisible(false);
    setOtpCode('');
    setOtpError('');
    confirmationRef.current = null;
    cleanupPhoneAuth();
  }

  return {
    mobileVerified, setMobileVerified, verifiedMobile, setVerifiedMobile,
    otpSending, otpVerifying, otpModalVisible, otpCode, setOtpCode, otpError,
    recaptchaContainerRef, handleSendOtp, handleVerifyOtp, handleCancelOtp,
  };
}

interface PhoneOtpModalProps {
  mobile: string;
  otpModalVisible: boolean;
  otpCode: string;
  setOtpCode: (v: string) => void;
  otpError: string;
  otpVerifying: boolean;
  handleVerifyOtp: () => void;
  handleCancelOtp: () => void;
  colors: any;
  styles: any;
}

export function PhoneOtpModal({
  mobile, otpModalVisible, otpCode, setOtpCode, otpError, otpVerifying,
  handleVerifyOtp, handleCancelOtp, colors, styles,
}: PhoneOtpModalProps) {
  return (
    <Modal visible={otpModalVisible} transparent animationType="fade" onRequestClose={handleCancelOtp}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: TEAL + '20', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="shield" size={17} color={TEAL} />
            </View>
            <View>
              <Text style={styles.modalTitle}>Verify Mobile Number</Text>
              <Text style={styles.modalText}>Enter the 6-digit code sent to +91 {mobile}</Text>
            </View>
          </View>
          <TextInput
            style={[styles.input, { textAlign: 'center', fontSize: 18, letterSpacing: 4 }]}
            value={otpCode}
            onChangeText={setOtpCode}
            placeholder="------"
            placeholderTextColor={colors.textDim}
            keyboardType="number-pad"
            maxLength={6}
          />
          {otpError ? <Text style={styles.warnTxt}>{otpError}</Text> : null}
          <TouchableOpacity style={styles.modalBtn} onPress={handleVerifyOtp} disabled={otpVerifying} activeOpacity={0.85}>
            <Text style={styles.modalBtnText}>{otpVerifying ? 'Verifying...' : 'Verify Code'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCancelOtp} activeOpacity={0.7}>
            <Text style={[styles.modalText, { textAlign: 'center' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** Extra stylesheet entries to merge into the screen's useStyles() output when re-enabling. */
export const phoneOtpStyles = {
  warnTxt: { color: '#ef4444', fontSize: 12, lineHeight: 17, marginTop: 4 },
  verifyBtn: {
    paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: TEAL,
  },
  verifyBtnTxt: { fontSize: 12, fontWeight: '700', color: TEAL },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, justifyContent: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: TEAL + '40', backgroundColor: TEAL + '12',
  },
  verifiedTxt: { fontSize: 12, fontWeight: '700', color: TEAL },
} as const;
