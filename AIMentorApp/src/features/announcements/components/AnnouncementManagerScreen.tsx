/**
 * Announcement Manager — admin-only screen (registered in SuperAdminNavigator,
 * same access pattern as ChallengeManagerScreen) to create, edit, schedule,
 * publish and archive announcements. Server-side authorization remains the
 * source of truth (requireAnnouncementAdmin) — this screen just surfaces it.
 *
 * Body content is authored as the documented markdown subset (see
 * utils/markdown.tsx): ## headings, **bold**, - bullets, 1. numbered,
 * [label](https://url) links. A live preview toggle renders exactly what
 * recipients will see.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, Platform, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import DatePicker from '../../../components/common/DatePicker';
import TimePicker from '../../../components/common/TimePicker';
import RichBodyEditor from './RichBodyEditor';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import {
  adminListAnnouncements, adminListSchools, adminCreateAnnouncement,
  adminUpdateAnnouncement, adminPublishAnnouncement, adminArchiveAnnouncement,
  adminUploadAttachment, adminDraftAnnouncement, AnnouncementDraft,
} from '../api/announcementsApi';
import { SEVERITY_LABEL, severityColor } from '../utils/severity';
import { audienceLabel } from '../utils/audience';
import { Announcement, AnnouncementAttachment } from '../types/announcement.types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', scheduled: 'Scheduled', published: 'Published', archived: 'Archived',
};
const DISPLAY_LABEL: Record<string, string> = {
  inbox: 'Announcement Center', banner: 'Global Banner', both: 'Center + Banner',
};
const ROLE_OPTIONS = [
  { value: 'parent', label: 'Parents' },
  { value: 'student', label: 'Students' },
  { value: 'teacher', label: 'Teachers' },
];

function parseDateInput(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The combined "YYYY-MM-DD HH:mm" string (unchanged on-the-wire shape) split
// into the separate date/time parts DatePicker and TimePicker each need,
// and rejoined the same way.
function splitDateTime(v: string): { date: string; time: string } {
  const [date, time] = v.split(' ');
  return { date: date || '', time: time || '09:00' };
}
function joinDateTime(date: string, time: string): string {
  return date ? `${date} ${time || '09:00'}` : '';
}

export default function AnnouncementManagerScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const adminEmail = user?.email || '';
  // Teachers reach this same screen via TeacherNavigator's 'AnnouncementManager'
  // route, but the server (scopeTargets() in routes/announcements.js) forces
  // every teacher-created announcement to target only the parents of their own
  // assigned students — the composer reflects that by hiding audience/school
  // pickers instead of showing controls the backend silently overrides.
  const isTeacher = user?.role === 'teacher';

  const [items, setItems] = useState<Announcement[]>([]);
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<'all' | 'published' | 'scheduled' | 'draft' | 'archived'>(
    route?.params?.statusTab || 'all'
  );

  // Deep-link entry points from the Overview launcher's Quick Actions/Tools.
  useEffect(() => {
    if (route?.params?.openComposer) { setEditTarget(null); setShowComposer(true); }
    if (route?.params?.statusTab) setStatusTab(route.params.statusTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.openComposer, route?.params?.statusTab]);

  const load = useCallback(async () => {
    if (!adminEmail) return;
    setLoading(true);
    setError('');
    try {
      const [list, schoolList] = await Promise.all([
        adminListAnnouncements(adminEmail),
        adminListSchools(adminEmail).catch(() => []),
      ]);
      setItems(list);
      setSchools(schoolList);
    } catch (e: any) {
      setError(e?.message || 'Failed to load announcements');
    } finally {
      setLoading(false);
    }
  }, [adminEmail]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredItems = statusTab === 'all' ? items : items.filter((i) => i.status === statusTab);
  const countFor = (status: typeof statusTab) => status === 'all' ? items.length : items.filter((i) => i.status === status).length;

  async function doPublish(item: Announcement) {
    setActionBusy(item.id);
    try {
      await adminPublishAnnouncement(adminEmail, item.id);
      await load();
    } catch (e: any) {
      Alert.alert('Publish failed', e?.message || 'Please try again.');
    } finally { setActionBusy(null); }
  }

  async function doArchive(item: Announcement) {
    setActionBusy(item.id);
    try {
      await adminArchiveAnnouncement(adminEmail, item.id);
      await load();
    } catch (e: any) {
      Alert.alert('Archive failed', e?.message || 'Please try again.');
    } finally { setActionBusy(null); }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={isTeacher ? 'Send Announcement' : 'Announcements'}
          subtitle={isTeacher ? 'Send updates to the parents of your students' : 'Create and manage announcements for your workspace'}
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
              {(['all', 'published', 'scheduled', 'draft', 'archived'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStatusTab(s)}
                  style={[styles.statusTab, statusTab === s && styles.statusTabActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: statusTab === s }}
                >
                  <Text style={[styles.statusTabText, statusTab === s && styles.statusTabTextActive]}>
                    {s === 'all' ? 'All' : STATUS_LABEL[s]} <Text style={styles.statusTabCount}>{countFor(s)}</Text>
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.newBtn}
              onPress={() => { setEditTarget(null); setShowComposer(true); }}
              accessibilityRole="button"
            >
              <Feather name="plus" size={15} color="#241f16" />
              <Text style={styles.newBtnText}>New announcement</Text>
            </TouchableOpacity>
          </View>

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
          ) : filteredItems.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="volume-2" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>
                {items.length === 0 ? 'No announcements yet. Create your first one.' : `No ${statusTab} announcements.`}
              </Text>
            </View>
          ) : (
            filteredItems.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardMain}>
                  <View style={styles.cardTitleRow}>
                    <View style={[styles.sevDot, { backgroundColor: severityColor(colors, item.severity) }]} />
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={[styles.statusPill, statusPillStyle(item.status, colors)]}>
                      <Text style={[styles.statusPillText, { color: statusPillStyle(item.status, colors).textColor }]}>
                        {STATUS_LABEL[item.status] || item.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {audienceLabel(item)}  ·  {DISPLAY_LABEL[item.displayType] || item.displayType}  ·  {SEVERITY_LABEL[item.severity]}
                    {item.attachments.length > 0 ? `  ·  ${item.attachments.length} file${item.attachments.length > 1 ? 's' : ''}` : ''}
                  </Text>
                  <Text style={styles.cardDates} numberOfLines={1}>
                    {item.status === 'scheduled' && item.startsAt
                      ? `Goes live ${toDateInput(item.startsAt)}`
                      : `Created ${toDateInput(item.createdAt)}`}
                    {item.expiresAt ? `  ·  Expires ${toDateInput(item.expiresAt)}` : ''}
                  </Text>
                </View>
                <View style={styles.cardActions}>
                  {(item.status === 'draft' || item.status === 'scheduled') && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: colors.accentYellow }]}
                      onPress={() => doPublish(item)}
                      disabled={actionBusy === item.id}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.actionBtnText, { color: '#241f16' }]}>
                        {actionBusy === item.id ? '…' : 'Publish'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'archived' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnOutline]}
                      onPress={() => { setEditTarget(item); setShowComposer(true); }}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.actionBtnText, { color: colors.textMuted }]}>Edit</Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'archived' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnOutline]}
                      onPress={() => doArchive(item)}
                      disabled={actionBusy === item.id}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.actionBtnText, { color: colors.accentRed }]}>Archive</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>

        {showComposer && (
          <ComposerModal
            colors={colors}
            adminEmail={adminEmail}
            schools={schools}
            editTarget={editTarget}
            isTeacher={isTeacher}
            onClose={() => setShowComposer(false)}
            onSaved={() => { setShowComposer(false); load(); }}
          />
        )}
      </View>
    </ScreenLayout>
  );
}

function statusPillStyle(status: string, colors: AppColors): any {
  if (status === 'published') return { backgroundColor: `${colors.accentGreen}22`, textColor: colors.accentGreen };
  if (status === 'scheduled') return { backgroundColor: `${colors.accentOrange}22`, textColor: colors.accentOrange };
  if (status === 'archived') return { backgroundColor: `${colors.textDim}22`, textColor: colors.textDim };
  return { backgroundColor: `${colors.textMuted}22`, textColor: colors.textMuted };
}

// ─────────────────────────────────────────────────────────────────────────────

function ComposerModal({ colors, adminEmail, schools, editTarget, isTeacher, onClose, onSaved }: {
  colors: AppColors;
  adminEmail: string;
  schools: { id: string; name: string }[];
  editTarget: Announcement | null;
  isTeacher?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const styles = useMemo(() => makeComposerStyles(colors), [colors]);

  const [title, setTitle] = useState(editTarget?.title ?? '');
  const [body, setBody] = useState(editTarget?.body ?? '');
  const [severity, setSeverity] = useState(editTarget?.severity ?? 'info');
  const [displayType, setDisplayType] = useState(editTarget?.displayType ?? 'inbox');
  const [roles, setRoles] = useState<string[]>(editTarget?.audienceRoles ?? []);
  const [schoolId, setSchoolId] = useState<string | null>(editTarget?.audienceSchoolId ?? null);
  const [startsAt, setStartsAt] = useState(toDateInput(editTarget?.startsAt ?? null));
  const [expiresAt, setExpiresAt] = useState(toDateInput(editTarget?.expiresAt ?? null));
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>(editTarget?.attachments ?? []);
  const [notifyAgain, setNotifyAgain] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiError, setAiError] = useState('');

  function toggleRole(value: string) {
    setRoles((prev) => prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]);
  }

  async function generateDraft() {
    if (!aiPrompt.trim()) { setAiError('Describe what the announcement is about.'); return; }
    const run = async () => {
      setAiDrafting(true);
      setAiError('');
      try {
        const draft = await adminDraftAnnouncement(adminEmail, aiPrompt.trim());
        setTitle(draft.title);
        setBody(draft.body);
        setAiPromptOpen(false);
        setAiPrompt('');
      } catch (e: any) {
        setAiError(e?.message || 'Failed to draft with AI. Please try again.');
      } finally {
        setAiDrafting(false);
      }
    };
    if (title.trim() || body.trim()) {
      Alert.alert('Replace current draft?', "This will overwrite the title and message you've already written.", [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: run },
      ]);
    } else {
      run();
    }
  }

  function pickFile() {
    if (Platform.OS !== 'web') {
      Alert.alert('Attachments', 'Please add attachments from the web app.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.gif,.webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        setFormError('Files must be under 10 MB.');
        return;
      }
      setUploading(true);
      setFormError('');
      try {
        const uploaded = await adminUploadAttachment(adminEmail, file);
        setAttachments((prev) => [...prev, uploaded]);
      } catch (e: any) {
        setFormError(e?.message || 'Upload failed. Please try again.');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  function buildDraft(status: string): AnnouncementDraft | null {
    if (!title.trim()) { setFormError('Title is required.'); return null; }
    if (!body.trim()) { setFormError('Message content is required.'); return null; }
    const startsIso = parseDateInput(startsAt);
    const expiresIso = parseDateInput(expiresAt);
    if (startsAt.trim() && !startsIso) { setFormError('Start date must look like 2026-07-15 09:00'); return null; }
    if (expiresAt.trim() && !expiresIso) { setFormError('Expiry date must look like 2026-07-20 18:00'); return null; }
    if (status === 'scheduled' && !startsIso) { setFormError('Scheduling needs a start date.'); return null; }

    const targets: { schoolId?: string | null; role?: string | null }[] = [];
    if (roles.length === 0 && schoolId) targets.push({ schoolId, role: null });
    for (const role of roles) targets.push({ role, schoolId: schoolId || null });

    return {
      title: title.trim(),
      body,
      severity,
      displayType,
      status,
      startsAt: startsIso,
      expiresAt: expiresIso,
      targets,
      attachments: attachments.map((a) => ({ url: a.url, name: a.name, type: a.type, size: a.size })),
    };
  }

  async function save(status: string) {
    setFormError('');
    const draft = buildDraft(status);
    if (!draft) return;
    setSaving(status);
    try {
      if (editTarget) {
        await adminUpdateAnnouncement(adminEmail, editTarget.id, { ...draft, bumpVersion: notifyAgain });
      } else {
        await adminCreateAnnouncement(adminEmail, draft);
      }
      onSaved();
    } catch (e: any) {
      setFormError(e?.message || 'Save failed. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{editTarget ? 'Edit announcement' : 'New announcement'}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close composer" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={styles.aiDraftBtn}
              onPress={() => { setAiPromptOpen((o) => !o); setAiError(''); }}
              accessibilityRole="button"
            >
              <Feather name="zap" size={14} color={colors.accentYellow} />
              <Text style={styles.aiDraftBtnText}>Draft with Aivorah AI</Text>
            </TouchableOpacity>

            {aiPromptOpen && (
              <View style={styles.aiPromptBox}>
                <Text style={styles.aiPromptHint}>Describe what this announcement is about — Aivorah AI will draft a title and message.</Text>
                <TextInput
                  value={aiPrompt}
                  onChangeText={setAiPrompt}
                  placeholder="e.g. Cricket equipment reminder — helmet and batting pads needed, registration closes Friday"
                  placeholderTextColor={colors.textDim}
                  style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                  multiline
                  accessibilityLabel="Describe the announcement for AI to draft"
                />
                {!!aiError && <Text style={styles.errorText}>{aiError}</Text>}
                <View style={styles.aiPromptActions}>
                  <TouchableOpacity
                    style={[styles.footerBtn, styles.footerBtnOutline]}
                    onPress={() => { setAiPromptOpen(false); setAiPrompt(''); setAiError(''); }}
                    disabled={aiDrafting}
                  >
                    <Text style={[styles.footerBtnText, { color: colors.textMuted }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.footerBtn, styles.aiGenerateBtn, { backgroundColor: colors.accentYellow }]}
                    onPress={generateDraft}
                    disabled={aiDrafting}
                  >
                    {aiDrafting
                      ? <ActivityIndicator size="small" color="#0B0B0B" />
                      : <Feather name="zap" size={13} color="#0B0B0B" />}
                    <Text style={[styles.footerBtnText, { color: '#0B0B0B' }]}>{aiDrafting ? 'Drafting…' : 'Generate'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <Text style={styles.fieldLabel}>TITLE *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Sports Equipment Required for Each Sport"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              accessibilityLabel="Announcement title"
            />

            <Text style={styles.fieldLabel}>MESSAGE *</Text>
            {Platform.OS === 'web' ? (
              <RichBodyEditor
                value={body}
                onChange={setBody}
                placeholder={'Dear Parents,\n\nCricket\nHelmet\nBatting pads\n\nRegister here: https://example.com'}
                colors={colors}
              />
            ) : (
              // The rich WYSIWYG editor is web-only (contentEditable); native
              // falls back to plain markdown entry, same as before — this
              // screen is also reachable by the teacher role, which could run
              // on a native mobile build.
              <>
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  placeholder={'Dear Parents,\n\n## Cricket\n- Helmet\n- Batting pads\n\nRegister here: https://example.com'}
                  placeholderTextColor={colors.textDim}
                  style={[styles.input, styles.bodyInput]}
                  multiline
                  accessibilityLabel="Announcement message"
                />
                <Text style={styles.hint}>
                  Formatting: ## heading · **bold** · - bullet · 1. numbered · paste links directly or [label](https://url)
                </Text>
              </>
            )}

            {/* A teacher's announcement can only ever reach the parents of
                their own assigned students — the server forces this
                targeting regardless of what's sent (scopeTargets() in
                routes/announcements.js), so there's no picker to show. */}
            {isTeacher ? (
              <>
                <Text style={styles.fieldLabel}>AUDIENCE</Text>
                <Text style={styles.hint}>This goes to the parents of your students only.</Text>
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>AUDIENCE</Text>
                <View style={styles.pillRow}>
                  <Pill label="Everyone" active={roles.length === 0} onPress={() => setRoles([])} colors={colors} />
                  {ROLE_OPTIONS.map((r) => (
                    <Pill key={r.value} label={r.label} active={roles.includes(r.value)} onPress={() => toggleRole(r.value)} colors={colors} />
                  ))}
                </View>
                {/* School picker is only shown to platform admins with multiple
                    schools. A school_admin's picker endpoint returns exactly their
                    own school (and the server forces targeting to it regardless of
                    what the client sends), so there's nothing to choose. */}
                {schools.length > 1 && (
                  <>
                    <Text style={styles.subLabel}>School</Text>
                    <View style={styles.pillRow}>
                      <Pill label="All schools" active={!schoolId} onPress={() => setSchoolId(null)} colors={colors} />
                      {schools.map((s) => (
                        <Pill key={s.id} label={s.name} active={schoolId === s.id} onPress={() => setSchoolId(s.id)} colors={colors} />
                      ))}
                    </View>
                  </>
                )}
                {schools.length === 1 && (
                  <Text style={styles.hint}>This announcement goes to {schools[0].name} only.</Text>
                )}
              </>
            )}

            <Text style={styles.fieldLabel}>SEVERITY</Text>
            <View style={styles.pillRow}>
              {(['info', 'warning', 'critical'] as const).map((sev) => (
                <Pill
                  key={sev}
                  label={SEVERITY_LABEL[sev]}
                  active={severity === sev}
                  onPress={() => setSeverity(sev)}
                  colors={colors}
                  dotColor={severityColor(colors, sev)}
                />
              ))}
            </View>

            <Text style={styles.fieldLabel}>WHERE IT APPEARS</Text>
            <View style={styles.pillRow}>
              <Pill label="Announcement Center" active={displayType === 'inbox'} onPress={() => setDisplayType('inbox')} colors={colors} />
              <Pill label="Global Banner" active={displayType === 'banner'} onPress={() => setDisplayType('banner')} colors={colors} />
              <Pill label="Both" active={displayType === 'both'} onPress={() => setDisplayType('both')} colors={colors} />
            </View>
            <Text style={styles.hint}>
              Normal school communication belongs in the Announcement Center. Use the Global Banner only for urgent or time-critical notices — it appears at the top of every screen.
            </Text>

            <Text style={styles.fieldLabel}>SCHEDULE (OPTIONAL)</Text>
            <View style={[styles.dateRow, { zIndex: 101 }]}>
              <View style={{ flex: 1.2 }}>
                <Text style={styles.subLabel}>Starts</Text>
                <DatePicker
                  value={splitDateTime(startsAt).date}
                  onChange={(d) => setStartsAt(joinDateTime(d, splitDateTime(startsAt).time))}
                  placeholder="Select date"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TimePicker
                  label=" "
                  value={splitDateTime(startsAt).time}
                  onChange={(t) => setStartsAt(joinDateTime(splitDateTime(startsAt).date, t))}
                />
              </View>
            </View>
            <View style={[styles.dateRow, { zIndex: 100, marginTop: spacing.sm }]}>
              <View style={{ flex: 1.2 }}>
                <Text style={styles.subLabel}>Expires</Text>
                <DatePicker
                  value={splitDateTime(expiresAt).date}
                  onChange={(d) => setExpiresAt(joinDateTime(d, splitDateTime(expiresAt).time))}
                  placeholder="Select date"
                  minDate={splitDateTime(startsAt).date || undefined}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TimePicker
                  label=" "
                  value={splitDateTime(expiresAt).time}
                  onChange={(t) => setExpiresAt(joinDateTime(splitDateTime(expiresAt).date, t))}
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>ATTACHMENTS</Text>
            {attachments.map((att, i) => (
              <View key={`${att.url}-${i}`} style={styles.attRow}>
                <Feather name={att.type === 'pdf' ? 'file-text' : 'image'} size={15} color={colors.accentYellow} />
                <Text style={styles.attName} numberOfLines={1}>{att.name}</Text>
                <Text style={styles.attSize}>{att.size ? `${(att.size / 1024).toFixed(0)} KB` : ''}</Text>
                <TouchableOpacity
                  onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  accessibilityRole="button" accessibilityLabel={`Remove attachment ${att.name}`}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Feather name="x" size={14} color={colors.textDim} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.attachBtn} onPress={pickFile} disabled={uploading} accessibilityRole="button">
              {uploading
                ? <ActivityIndicator size="small" color={colors.accentYellow} />
                : <Feather name="paperclip" size={14} color={colors.accentYellow} />}
              <Text style={styles.attachBtnText}>{uploading ? 'Uploading…' : 'Add PDF or image (max 10 MB)'}</Text>
            </TouchableOpacity>

            {editTarget && editTarget.status !== 'draft' && (
              <TouchableOpacity style={styles.notifyRow} onPress={() => setNotifyAgain((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: notifyAgain }}>
                <Feather name={notifyAgain ? 'check-square' : 'square'} size={16} color={notifyAgain ? colors.accentYellow : colors.textDim} />
                <Text style={styles.notifyText}>Notify users again — the banner reappears for people who dismissed the previous version</Text>
              </TouchableOpacity>
            )}

            {!!formError && (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={14} color={colors.accentRed} />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.sheetFooter}>
            <TouchableOpacity style={[styles.footerBtn, styles.footerBtnOutline]} onPress={() => save('draft')} disabled={!!saving} accessibilityRole="button">
              <Text style={[styles.footerBtnText, { color: colors.textMuted }]}>{saving === 'draft' ? 'Saving…' : 'Save draft'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerBtn, styles.footerBtnOutline]} onPress={() => save('scheduled')} disabled={!!saving} accessibilityRole="button">
              <Text style={[styles.footerBtnText, { color: colors.accentOrange }]}>{saving === 'scheduled' ? 'Scheduling…' : 'Schedule'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerBtn, { backgroundColor: colors.accentYellow }]} onPress={() => save('published')} disabled={!!saving} accessibilityRole="button">
              <Text style={[styles.footerBtnText, { color: '#241f16' }]}>{saving === 'published' ? 'Publishing…' : 'Publish now'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Pill({ label, active, onPress, colors, dotColor }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        pillStyles.pill,
        { borderColor: active ? colors.accentYellow : colors.borderColor, backgroundColor: active ? `${colors.accentYellow}1F` : colors.cardDark },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {dotColor && <View style={[pillStyles.dot, { backgroundColor: dotColor }]} />}
      <Text style={[pillStyles.text, { color: active ? colors.textHeading : colors.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const pillStyles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600' },
});

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 860, width: '100%', alignSelf: 'center' },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg, gap: 10, flexWrap: 'wrap' },
    tabScroll: { flexGrow: 0, flexShrink: 1 },
    tabRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    statusTab: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark, alignSelf: 'flex-start' },
    statusTabActive: { borderColor: colors.accentYellow, backgroundColor: `${colors.accentYellow}1F` },
    statusTabText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: colors.textMuted },
    statusTabTextActive: { color: colors.textHeading },
    statusTabCount: { fontSize: 10.5, color: colors.textDim },
    countText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted },
    newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentYellow, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.sm },
    newBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#241f16' },
    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 10 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, marginBottom: 10, flexWrap: 'wrap',
    },
    cardMain: { flex: 1, minWidth: 240 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sevDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
    cardTitle: { flex: 1, fontFamily: fonts.serif, fontSize: 14.5, fontWeight: '700', color: colors.textHeading },
    statusPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
    statusPillText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700' },
    cardMeta: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, marginTop: 5 },
    cardDates: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 3 },
    cardActions: { flexDirection: 'row', gap: 8 },
    actionBtn: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.sm },
    actionBtnOutline: { borderWidth: 1, borderColor: colors.borderColor },
    actionBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700' },
  });
}

function makeComposerStyles(colors: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    sheet: {
      width: '100%', maxWidth: 640, maxHeight: '92%',
      backgroundColor: colors.bgDark, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.borderColor, overflow: 'hidden',
    },
    sheetHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderColor,
    },
    sheetTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.textHeading },
    sheetBody: { padding: spacing.lg, gap: 6 },
    sheetFooter: {
      flexDirection: 'row', gap: 10, justifyContent: 'flex-end',
      padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderColor,
    },
    fieldLabel: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: colors.textDim, marginTop: 14, marginBottom: 6 },
    aiDraftBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
      backgroundColor: `${colors.accentYellow}14`, borderWidth: 1, borderColor: `${colors.accentYellow}55`,
      borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    },
    aiDraftBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
    aiPromptBox: {
      backgroundColor: colors.cardHover, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.md, marginTop: 10, gap: 8,
    },
    aiPromptHint: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textMuted, lineHeight: 16 },
    aiPromptActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
    aiGenerateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    subLabel: { fontFamily: fonts.serif, fontSize: 11, color: colors.textMuted, marginBottom: 5, marginTop: 4 },
    input: {
      fontFamily: fonts.serif, fontSize: 13.5, color: colors.textMain,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10,
    },
    bodyInput: { minHeight: 180, textAlignVertical: 'top' },
    hint: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 6, lineHeight: 16 },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dateRow: { flexDirection: 'row', gap: 12 },
    attRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6,
    },
    attName: { flex: 1, fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMain },
    attSize: { fontFamily: fonts.serif, fontSize: 10.5, color: colors.textDim },
    attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, alignSelf: 'flex-start' },
    attachBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.accentYellow },
    notifyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14 },
    notifyText: { flex: 1, fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
    errorText: { flex: 1, fontFamily: fonts.serif, fontSize: 12.5, color: colors.accentRed },
    footerBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm },
    footerBtnOutline: { borderWidth: 1, borderColor: colors.borderColor },
    footerBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700' },
  });
}
