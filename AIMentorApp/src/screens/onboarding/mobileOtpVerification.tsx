/**
 * Mobile number OTP verification via Fast2SMS (server-side send/verify,
 * backed by the same otp_codes table used for email OTP). India only —
 * 10-digit numbers. Works on web AND native (unlike the parked Firebase
 * Phone Auth implementation in phoneOtpVerification.tsx, which is web-only).
 */
import { useState } from 'react';
import SERVER_URL from '../../config/serverUrl';

// Mobile-number OTP verification is not live yet (SMS sending currently errors),
// so the "Verify" button is hidden across onboarding to avoid a dead-end/error.
// The number is still collected; flip this to true once SMS delivery is enabled.
export const MOBILE_VERIFICATION_ENABLED = false;

export function useMobileOtpVerification(mobile: string, setMobile: (v: string) => void, mobileCode = '+91') {
  const [mobileVerified, setMobileVerified] = useState(false);
  const [verifiedMobile, setVerifiedMobile] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');

  async function handleSendOtp() {
    const digits = mobile.replace(/\D/g, '');
    if (mobileCode !== '+91') {
      setOtpError('Mobile OTP verification currently only supports Indian (+91) numbers.');
      return;
    }
    if (digits.length !== 10) {
      setOtpError('Enter a valid 10-digit mobile number.');
      return;
    }
    setOtpError('');
    setOtpSending(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/mobile-otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: digits }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not send the code.');
      setOtpModalVisible(true);
      setOtpCode('');
    } catch (e: any) {
      setOtpError(e?.message || 'Could not send the code. Please try again.');
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp() {
    setOtpVerifying(true);
    setOtpError('');
    try {
      const digits = mobile.replace(/\D/g, '');
      const res = await fetch(`${SERVER_URL}/user/mobile-otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: digits, otp: otpCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.verified) throw new Error(data?.error || 'Incorrect or expired code.');
      setMobileVerified(true);
      setVerifiedMobile(mobile);
      setOtpModalVisible(false);
      setOtpCode('');
    } catch (e: any) {
      setOtpError(e?.message || 'Incorrect or expired code.');
    } finally {
      setOtpVerifying(false);
    }
  }

  function handleCancelOtp() {
    setOtpModalVisible(false);
    setOtpCode('');
    setOtpError('');
  }

  return {
    mobileVerified, setMobileVerified, verifiedMobile, setVerifiedMobile,
    otpSending, otpVerifying, otpModalVisible, otpCode, setOtpCode, otpError,
    handleSendOtp, handleVerifyOtp, handleCancelOtp,
  };
}
