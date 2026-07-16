/**
 * Workspace Settings — school-scoped configuration, distinct from personal
 * account preferences (theme lives in the sidebar footer, shared across
 * roles). Editable via a single Edit / Save Changes control:
 *   - General: School name, Academic year, Contact email — persisted to
 *     public.schools (PATCH /school-admin/workspace-settings). Renaming the
 *     school also re-syncs users.school so name-keyed lookups stay right;
 *     scoping always uses school_id, never the name.
 *   - Branding: School logo upload → POST /branding/logo (Cloudinary), keyed
 *     by the school name; preview refreshes from GET /branding/logos.
 *   - Administrators & Access: read-only summary of the admin's own scope.
 * On web the Academic year field renders as a native <select> so the option
 * list is painted in the browser's top layer (never clipped/overlapped by
 * sibling cards); native falls back to a lightweight custom dropdown.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Image, TextInput, TouchableOpacity, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { roleLabel } from '../../constants/roleLabels';
import { useToast } from '../../components/common/Toast';

const ACADEMIC_YEARS = ['2025-26', '2026-27', '2027-28'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Academic-year picker. On web this is a real <select> so its dropdown renders
// in the browser's native top layer — impossible to clip or be overlapped by
// the cards below it (the bug the custom absolute-positioned menu had). On
// native platforms it falls back to a small custom menu.
function YearField({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: AppColors; }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    return React.createElement('select', {
      value,
      onChange: (e: any) => onChange(e.target.value),
      style: {
        width: '100%', height: 42, borderRadius: 8, paddingLeft: 12, paddingRight: 8,
        border: `1px solid ${colors.borderColor}`, background: colors.bgDark,
        color: colors.textHeading, fontSize: 13, fontWeight: 600,
        fontFamily: 'inherit', cursor: 'pointer', appearance: 'auto',
      },
    }, ACADEMIC_YEARS.map((y) =>
      React.createElement('option', { key: y, value: y }, y.replace('-', '–'))
    ));
  }

  return (
    <View style={{ position: 'relative' }}>
      <Pressable style={styles.fieldBox} onPress={() => setOpen((v) => !v)} accessibilityRole="button">
        <Text style={styles.fieldBoxText}>{value ? value.replace('-', '–') : 'Select'}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
      </Pressable>
      {open && (
        <>
          <Pressable style={styles.ddBackdropNative} onPress={() => setOpen(false)} />
          <View style={styles.ddMenu}>
            {ACADEMIC_YEARS.map((y) => (
              <Pressable key={y} style={styles.ddItem} onPress={() => { onChange(y); setOpen(false); }}>
                <Text style={[styles.ddItemText, y === value && styles.ddItemTextActive]}>{y.replace('-', '–')}</Text>
                {y === value && <Feather name="check" size={13} color={colors.accentYellow} />}
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

export default function SchoolAdminSettingsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { showToast, ToastComponent } = useToast();

  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [academicYear, setAcademicYear] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftYear, setDraftYear] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const load = useCallback(async () => {
    if (!user?.email) return;
    let loadedSchoolName: string | null = null;
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/overview?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        loadedSchoolName = data?.school?.name || null;
        setSchoolName(loadedSchoolName);
        setAcademicYear(data?.school?.academicYear || '');
        setContactEmail(data?.school?.contactEmail || '');
      }
    } catch { /* silent — settings still renders with what we have */ }

    if (loadedSchoolName) {
      try {
        const res = await fetch(`${SERVER_URL}/branding/logos?school=${encodeURIComponent(loadedSchoolName)}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) setLogoUrl(data?.schoolLogoUrl || null);
      } catch { /* falls back to monogram */ }
    }
    setLoading(false);
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function startEdit() {
    setDraftName(schoolName || '');
    setDraftYear(academicYear || ACADEMIC_YEARS[ACADEMIC_YEARS.length - 1]);
    setDraftEmail(contactEmail || '');
    setSaveError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError('');
  }

  async function saveSettings() {
    if (!user?.email) return;
    const trimmedName = draftName.trim();
    const trimmedEmail = draftEmail.trim();
    if (!trimmedName) { setSaveError('School name cannot be empty.'); return; }
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) { setSaveError('Enter a valid contact email, or leave it blank.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/workspace-settings?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, academicYear: draftYear, contactEmail: trimmedEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data?.error || 'Failed to save workspace settings.');
        return;
      }
      setSchoolName(data?.school?.name || null);
      setAcademicYear(data?.school?.academicYear || '');
      setContactEmail(data?.school?.contactEmail || '');
      setEditing(false);
      showToast({ title: 'Workspace settings saved', type: 'success' });
    } catch {
      setSaveError('Failed to save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  // Upload a school logo via the browser file picker → POST /branding/logo.
  // Web-only (this console runs on web); the button is hidden on native.
  function uploadLogo() {
    if (Platform.OS !== 'web' || !schoolName) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/svg+xml,image/jpeg';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.split(',')[1];
        if (!base64) { showToast({ title: 'Could not read that image', type: 'error' }); return; }
        setUploadingLogo(true);
        try {
          const res = await fetch(`${SERVER_URL}/branding/logo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'school', name: schoolName, base64, mimeType: file.type || 'image/png' }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.logoUrl) throw new Error(data?.error || 'Upload failed');
          setLogoUrl(data.logoUrl);
          showToast({ title: 'Logo updated', type: 'success' });
        } catch (err: any) {
          showToast({ title: 'Logo upload failed', subtitle: err?.message, type: 'error' });
        } finally {
          setUploadingLogo(false);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  const monogram = (schoolName || 'A').trim().slice(0, 1).toUpperCase();

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Workspace Settings"
          subtitle="Configuration for your school's Aivorah workspace"
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : (
            <>
              <Section
                title="General"
                subtitle="Your school's core identity"
                right={!editing ? (
                  <TouchableOpacity style={styles.editBtn} onPress={startEdit} accessibilityRole="button">
                    <Feather name="edit-2" size={12} color={colors.accentYellow} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                ) : undefined}
              >
                <View style={styles.fieldGrid}>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>School name</Text>
                    {editing ? (
                      <TextInput
                        style={[styles.fieldBox, styles.textInput]}
                        value={draftName}
                        onChangeText={setDraftName}
                        placeholder="Your school's name"
                        placeholderTextColor={colors.textDim}
                      />
                    ) : (
                      <View style={[styles.fieldBox, styles.fieldBoxReadonly]}>
                        <Text style={styles.fieldBoxText} numberOfLines={1}>{schoolName || '—'}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>Academic year</Text>
                    {editing ? (
                      <YearField value={draftYear} onChange={setDraftYear} colors={colors} />
                    ) : (
                      <View style={[styles.fieldBox, styles.fieldBoxReadonly]}>
                        <Text style={styles.fieldBoxText}>{academicYear ? academicYear.replace('-', '–') : 'Not set'}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Contact email</Text>
                  {editing ? (
                    <TextInput
                      style={[styles.fieldBox, styles.textInput]}
                      value={draftEmail}
                      onChangeText={setDraftEmail}
                      placeholder="office@yourschool.edu"
                      placeholderTextColor={colors.textDim}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  ) : (
                    <View style={[styles.fieldBox, styles.fieldBoxReadonly]}>
                      <Text style={styles.fieldBoxText}>{contactEmail || 'Not set'}</Text>
                    </View>
                  )}
                </View>
              </Section>

              <Section title="Branding" subtitle="How your school is represented across its workspace">
                <View style={styles.brandRow}>
                  <View style={styles.brandLogo}>
                    {logoUrl ? (
                      <Image source={{ uri: logoUrl }} style={styles.brandLogoImg} />
                    ) : (
                      <Text style={styles.brandMonogram}>{monogram}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.brandName}>School logo</Text>
                    <Text style={styles.brandSub}>Shown in the sidebar, announcements, and parent communications. PNG or SVG, at least 128×128.</Text>
                  </View>
                  {Platform.OS === 'web' && (
                    <TouchableOpacity style={styles.uploadBtn} onPress={uploadLogo} disabled={uploadingLogo} accessibilityRole="button">
                      {uploadingLogo
                        ? <ActivityIndicator size="small" color={colors.textHeading} />
                        : <Text style={styles.uploadBtnText}>Upload logo</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              </Section>

              <Section title="Administrators & Access" subtitle="Your role and scope on this workspace">
                <Row label="Administrator" value={user?.name || user?.email || '—'} />
                <Row label="Role" value={roleLabel(user?.role)} />
                <Row label="Access scope" value="This school only" last />
                <View style={styles.hintWrap}>
                  <Text style={styles.hint}>Additional administrators can be granted access by the Aivorah team.</Text>
                </View>
              </Section>

              {!!saveError && <Text style={styles.errorText}>{saveError}</Text>}

              {editing && (
                <View style={styles.pageFooter}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={cancelEdit} disabled={saving} accessibilityRole="button">
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                    onPress={saveSettings}
                    disabled={saving}
                    accessibilityRole="button"
                  >
                    {saving ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
      {ToastComponent}
    </ScreenLayout>
  );
}

function Section({ title, subtitle, children, right }: { title: string; subtitle: string; children: React.ReactNode; right?: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
        {right ? <View style={styles.sectionHeaderAction}>{right}</View> : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 720, width: '100%', alignSelf: 'center' },
    section: { marginBottom: spacing.xxl },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    sectionHeaderAction: { flexShrink: 0, marginBottom: spacing.md },
    sectionTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading },
    sectionSubtitle: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, marginTop: 3, marginBottom: spacing.md },
    sectionBody: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, gap: spacing.md,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderColor,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted },
    rowValue: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading, maxWidth: '60%' },

    // ── Two-column field grid (matches the design's General card) ──────────
    fieldGrid: { flexDirection: 'row', gap: spacing.md },
    fieldHalf: { flex: 1, gap: 6 },
    field: { gap: 6 },
    fieldLabel: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: colors.textMuted },
    fieldBox: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark,
      borderRadius: radius.sm, paddingHorizontal: 12, height: 42,
    },
    fieldBoxReadonly: { opacity: 0.7 },
    fieldBoxText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    textInput: { fontFamily: fonts.serif, fontSize: 13, color: colors.textHeading, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },

    errorText: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentRed, marginBottom: spacing.md },

    pageFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
    editBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
    },
    editBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
    cancelBtn: {
      paddingHorizontal: 16, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
    },
    cancelBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    saveBtn: {
      paddingHorizontal: 20, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentYellow,
    },
    saveBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },

    // Native-only fallback dropdown
    ddBackdropNative: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },
    ddMenu: {
      position: 'absolute', top: 46, left: 0, right: 0, backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4,
      zIndex: 21, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },

    // ── Branding ───────────────────────────────────────────────────────────
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    brandLogo: {
      width: 52, height: 52, borderRadius: radius.sm, backgroundColor: `${colors.accentYellow}22`,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
    },
    brandLogoImg: { width: '100%', height: '100%' },
    brandMonogram: { fontFamily: fonts.serif, fontSize: 20, fontWeight: '700', color: colors.accentYellow },
    brandName: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: colors.textHeading },
    brandSub: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textMuted, marginTop: 3, lineHeight: 16 },
    uploadBtn: {
      paddingHorizontal: 16, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, flexShrink: 0,
    },
    uploadBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },

    hintWrap: { paddingHorizontal: 2, paddingTop: 4 },
    hint: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, lineHeight: 16 },
  });
}
