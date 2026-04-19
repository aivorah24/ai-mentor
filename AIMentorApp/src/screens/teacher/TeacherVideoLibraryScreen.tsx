import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

import SERVER_URL from '../../config/serverUrl';

interface Video {
  id: string;
  title: string;
  topic: string;
  grade: string;
  url: string;
  embedUrl: string;
  description: string;
  source: string;
  createdAt: string;
}

const SOURCE_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  vyond:   'film',
  youtube: 'youtube',
  vimeo:   'video',
  custom:  'link',
};

function detectSource(url: string): string {
  if (url.includes('vyond.com')) return 'vyond';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('vimeo.com')) return 'vimeo';
  if (url.includes('loom.com')) return 'loom';
  return 'custom';
}

const SOURCE_COLORS: Record<string, string> = {
  vyond:   '#7c3aed',
  youtube: '#ef4444',
  vimeo:   '#1ab7ea',
  custom:  '#6366f1',
};

const GRADES = ['All Grades', 'Grade 3', 'Grade 4', 'Grade 5'];

export default function TeacherVideoLibraryScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [newGrade, setNewGrade] = useState('All Grades');
  const [newUrl, setNewUrl] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [urlError, setUrlError] = useState('');

  const [filterGrade, setFilterGrade] = useState('All Grades');
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    fetch(`${SERVER_URL}/videos`)
      .then(r => r.json())
      .then(data => { setVideos(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function addVideo() {
    if (!newTitle.trim() || !newTopic.trim() || !newUrl.trim()) return;
    if (!newUrl.startsWith('http')) { setUrlError('URL must start with http:// or https://'); return; }
    setUrlError('');
    setSaving(true);
    try {
      const res = await fetch(`${SERVER_URL}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       newTitle,
          topic:       newTopic,
          grade:       newGrade,
          url:         newUrl,
          description: newDesc,
          source:      detectSource(newUrl),
        }),
      });
      if (res.ok) {
        const v = await res.json();
        setVideos(prev => [v, ...prev]);
        resetModal();
      }
    } catch {}
    setSaving(false);
  }

  async function deleteVideo(id: string) {
    setDeleting(id);
    try {
      await fetch(`${SERVER_URL}/videos/${id}`, { method: 'DELETE' });
      setVideos(prev => prev.filter(v => v.id !== id));
    } catch {}
    setDeleting(null);
  }

  function resetModal() {
    setNewTitle(''); setNewTopic(''); setNewGrade('All Grades');
    setNewUrl(''); setNewDesc(''); setUrlError('');
    setModalVisible(false);
  }

  const filtered = useMemo(() => videos.filter(v => {
    const matchGrade = filterGrade === 'All Grades' || v.grade === filterGrade || v.grade === 'All Grades';
    const q = searchQ.toLowerCase();
    const matchQ = !q || v.title.toLowerCase().includes(q) || v.topic.toLowerCase().includes(q);
    return matchGrade && matchQ;
  }), [videos, filterGrade, searchQ]);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Video Library"
          subtitle="Add Vyond, YouTube or any video URL for each topic."
          searchPlaceholder="Search videos..."
          onMenuPress={() => (navigation as any).openDrawer?.()}
          onSearchChange={setSearchQ}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* How it works banner */}
          <View style={styles.howBanner}>
            <Feather name="film" size={16} color={colors.accentCyan} />
            <View style={{ flex: 1 }}>
              <Text style={styles.howTitle}>How to add a Vyond video</Text>
              <Text style={styles.howText}>
                {'1. Create video in Vyond → click Publish / Share\n'}
                {'2. Copy the share link (e.g. share.vyond.com/... or vyond.com/videos/share/...)\n'}
                {'3. Paste below — the system auto-converts it to an embed link\n'}
                {'✅ Also supports: YouTube, Vimeo, Loom, or any direct MP4 URL'}
              </Text>
            </View>
          </View>

          {/* Grade filter tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContainer}>
            {GRADES.map(g => (
              <TouchableOpacity key={g} style={[styles.tab, filterGrade === g && styles.tabActive]} onPress={() => setFilterGrade(g)} activeOpacity={0.7}>
                <Text style={[styles.tabText, filterGrade === g && styles.tabTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Add video button */}
          <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={styles.addBtnText}>Add Video for a Topic</Text>
          </TouchableOpacity>

          {/* Video list */}
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="film" size={36} color={colors.textDim} />
              <Text style={styles.emptyTitle}>No videos yet</Text>
              <Text style={styles.emptyText}>
                Add your first Vyond video link above. Students will see it when they open that topic in their app.
              </Text>
            </View>
          ) : (
            filtered.map(video => {
              const sc = detectSource(video.url);
              const scColor = SOURCE_COLORS[sc] ?? colors.primary;
              return (
                <View key={video.id} style={styles.videoCard}>
                  {/* Color strip */}
                  <View style={[styles.cardStrip, { backgroundColor: scColor }]} />
                  <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <View style={[styles.sourceIcon, { backgroundColor: scColor + '18' }]}>
                        <Feather name={SOURCE_ICONS[sc] ?? 'video'} size={16} color={scColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.videoTitle}>{video.title}</Text>
                        <Text style={styles.videoMeta}>{video.topic} · {video.grade}</Text>
                      </View>
                      <View style={[styles.sourceBadge, { borderColor: scColor + '40', backgroundColor: scColor + '12' }]}>
                        <Text style={[styles.sourceBadgeText, { color: scColor }]}>{sc.toUpperCase()}</Text>
                      </View>
                    </View>
                    {video.description ? <Text style={styles.videoDesc}>{video.description}</Text> : null}
                    <View style={styles.cardBottom}>
                      <Text style={styles.videoUrl} numberOfLines={1}>{video.embedUrl || video.url}</Text>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => deleteVideo(video.id)}
                        disabled={deleting === video.id}
                      >
                        {deleting === video.id
                          ? <ActivityIndicator size="small" color={colors.accentRed} />
                          : <Feather name="trash-2" size={14} color={colors.accentRed} />}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Add Video Modal */}
        <Modal visible={modalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.modal}>
                <Text style={styles.modalTitle}>Add Video</Text>

                <Text style={styles.modalLabel}>Video Title *</Text>
                <TextInput style={styles.modalInput} placeholder="e.g. Subtraction with Zara" placeholderTextColor={colors.textDim} value={newTitle} onChangeText={setNewTitle} />

                <Text style={styles.modalLabel}>Topic Name * (must match curriculum exactly)</Text>
                <TextInput style={styles.modalInput} placeholder="e.g. Addition" placeholderTextColor={colors.textDim} value={newTopic} onChangeText={setNewTopic} />

                <Text style={styles.modalLabel}>Grade</Text>
                <View style={styles.gradeRow}>
                  {GRADES.map(g => (
                    <TouchableOpacity key={g} style={[styles.gradeChip, newGrade === g && styles.gradeChipActive]} onPress={() => setNewGrade(g)}>
                      <Text style={[styles.gradeChipText, newGrade === g && { color: colors.primary }]}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.modalLabel}>Video URL * (Vyond share, YouTube, Vimeo, or MP4)</Text>
                <TextInput
                  style={[styles.modalInput, urlError ? { borderColor: colors.accentRed } : {}]}
                  placeholder="https://www.vyond.com/share/video/..."
                  placeholderTextColor={colors.textDim}
                  value={newUrl}
                  onChangeText={t => { setNewUrl(t); setUrlError(''); }}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                {urlError ? <Text style={[styles.modalLabel, { color: colors.accentRed }]}>{urlError}</Text> : null}
                {newUrl.length > 4 && (
                  <Text style={[styles.modalLabel, { color: SOURCE_COLORS[detectSource(newUrl)] ?? colors.textDim }]}>
                    Detected: {detectSource(newUrl).toUpperCase()}
                  </Text>
                )}

                <Text style={styles.modalLabel}>Description (optional)</Text>
                <TextInput style={[styles.modalInput, { height: 60 }]} placeholder="What will students learn?" placeholderTextColor={colors.textDim} value={newDesc} onChangeText={setNewDesc} multiline />

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancel} onPress={resetModal}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalConfirm, (!newTitle || !newTopic || !newUrl) && { opacity: 0.5 }]} onPress={addVideo} disabled={saving || !newTitle || !newTopic || !newUrl}>
                    <Text style={styles.modalConfirmText}>{saving ? 'Saving…' : 'Add Video'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 40 },

  howBanner: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: c.accentCyan + '10',
    borderWidth: 1,
    borderColor: c.accentCyan + '30',
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  howTitle: { fontSize: 13, fontWeight: '700', color: c.accentCyan, marginBottom: 4 },
  howText: { fontSize: 12, color: c.textMuted, lineHeight: 18 },

  tabsScroll: { marginBottom: spacing.lg },
  tabsContainer: { gap: spacing.md },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  tabActive: { backgroundColor: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.25)' },
  tabText: { fontSize: 13, fontWeight: '500', color: c.textMuted },
  tabTextActive: { color: c.accentBlue, fontWeight: '600' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: 14, backgroundColor: c.primaryGlow,
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(99,102,241,0.4)',
    borderRadius: radius.lg, marginBottom: spacing.xl,
  },
  addBtnText: { fontSize: 14, fontWeight: '600', color: c.primary },

  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 320 },

  videoCard: {
    flexDirection: 'row',
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardStrip: { width: 4 },
  cardBody: { flex: 1, padding: spacing.lg, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sourceIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  videoTitle: { fontSize: 14, fontWeight: '700', color: c.textMain },
  videoMeta: { fontSize: 12, color: c.textMuted },
  sourceBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  sourceBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  videoDesc: { fontSize: 12, color: c.textMuted, lineHeight: 17 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  videoUrl: { flex: 1, fontSize: 11, color: c.textDim },
  deleteBtn: { padding: 4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center' },
  modalScroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  modal: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xxl, gap: spacing.md,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.textMain },
  modalLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, padding: spacing.md, color: c.textMain, fontSize: 13,
  },
  gradeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gradeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: c.borderColor },
  gradeChipActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  gradeChipText: { fontSize: 12, color: c.textMuted },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center' },
  modalCancelText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalConfirm: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center' },
  modalConfirmText: { fontSize: 13, fontWeight: '700', color: 'white' },
});
