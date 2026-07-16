import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Platform, Alert, ScrollView, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { createPost, uploadAttachment, fetchFolders, createFolder, PortfolioFolder } from '../api/classPortfolioApi';

// Teacher-only "New post" composer. Student tagging is a fast-follow — V1
// posts are visible to the whole class regardless (tagging only narrows a
// browse filter, per class_portfolio.sql's comment), so omitting it here
// doesn't limit who can see the post.
export default function PortfolioComposerModal({ grade, section, onClose, onSaved }: {
  grade: string; section: string; onClose: () => void; onSaved: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const teacherEmail = user?.email || '';

  const [caption, setCaption] = useState('');
  const [attachments, setAttachments] = useState<{ url: string; type: string; name: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'published' | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const [folders, setFolders] = useState<PortfolioFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showCreateFolderInput, setShowCreateFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    if (!teacherEmail || !grade) return;
    fetchFolders(grade, section, teacherEmail)
      .then(setFolders)
      .catch(() => {});
  }, [teacherEmail, grade, section]);

  async function handleCreateFolder() {
    if (!newFolderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    setError('');
    try {
      const folder = await createFolder(teacherEmail, grade, section, newFolderName.trim());
      setFolders(prev => [...prev, folder]);
      setSelectedFolderId(folder.id);
      setNewFolderName('');
      setShowCreateFolderInput(false);
    } catch (e: any) {
      setError(e?.message || 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  }

  function handleInsertBold() {
    const start = selection.start;
    const end = selection.end;
    const selectedText = caption.slice(start, end);
    const replacement = `**${selectedText || 'bold'}**`;
    const newCaption = caption.slice(0, start) + replacement + caption.slice(end);
    setCaption(newCaption);
  }

  function handleInsertEmoji(emoji: string) {
    const start = selection.start;
    const end = selection.end;
    const newCaption = caption.slice(0, start) + emoji + caption.slice(end);
    setCaption(newCaption);
  }

  function pickFile() {
    if (Platform.OS !== 'web') {
      Alert.alert('Attachments', 'Please add photos/videos from the web app.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) {
        setError('Files must be under 50 MB.');
        return;
      }
      setUploading(true);
      setError('');
      try {
        const uploaded = await uploadAttachment(file);
        setAttachments((prev) => [...prev, uploaded]);
      } catch (e: any) {
        setError(e?.message || 'Upload failed. Please try again.');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  async function save(status: 'draft' | 'published') {
    setError('');
    if (!caption.trim() && attachments.length === 0) {
      setError('Add a caption or at least one photo/video.');
      return;
    }
    setSaving(status);
    try {
      await createPost({ teacherEmail, grade, section, caption: caption.trim(), status, attachments, folderId: selectedFolderId });
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Save failed. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>New Portfolio post</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close composer">
              <Feather name="x" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetBody}>
            <Text style={styles.fieldLabel}>CAPTION</Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
              placeholder="What did the class get up to today?"
              placeholderTextColor={colors.textDim}
              style={[styles.input, styles.captionInput]}
              multiline
            />

            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.toolbarBtn} onPress={handleInsertBold} accessibilityRole="button" accessibilityLabel="Bold text">
                <Text style={styles.boldIcon}>B</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.emojiList}>
                {['😊', '👍', '🎉', '🌟', '❤️', '👏', '🏫', '🎨', '📚', '✍️'].map(emoji => (
                  <TouchableOpacity key={emoji} style={styles.emojiBtn} onPress={() => handleInsertEmoji(emoji)} accessibilityRole="button">
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>FOLDER (OPTIONAL)</Text>
            {showCreateFolderInput ? (
              <View style={styles.createFolderRow}>
                <TextInput
                  value={newFolderName}
                  onChangeText={setNewFolderName}
                  placeholder="New folder name (e.g. Sports Day)"
                  placeholderTextColor={colors.textDim}
                  style={[styles.input, { flex: 1, height: 38 }]}
                />
                <TouchableOpacity style={styles.folderActionBtn} onPress={handleCreateFolder} disabled={creatingFolder}>
                  {creatingFolder ? <ActivityIndicator size="small" color={colors.accentYellow} /> : <Feather name="check" size={16} color={colors.accentYellow} />}
                </TouchableOpacity>
                <TouchableOpacity style={styles.folderActionBtn} onPress={() => setShowCreateFolderInput(false)}>
                  <Feather name="x" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.folderSelectRow}>
                <View style={[styles.selectContainer, { flex: 1 }]}>
                  {Platform.OS === 'web' ? (
                    <select
                      value={selectedFolderId || ''}
                      onChange={(e) => setSelectedFolderId(e.target.value || null)}
                      style={{
                        width: '100%',
                        background: colors.cardDark,
                        border: `1px solid ${colors.borderColor}`,
                        color: colors.textMain,
                        borderRadius: '4px',
                        padding: '10px 12px',
                        outline: 'none',
                        fontSize: '13.5px',
                        fontFamily: fonts.serif
                      }}
                    >
                      <option value="">Choose a folder...</option>
                      {folders.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  ) : (
                    <TextInput
                      value={selectedFolderId || ''}
                      placeholder="Folder ID..."
                      placeholderTextColor={colors.textDim}
                      onChangeText={setSelectedFolderId}
                      style={[styles.input, { height: 38 }]}
                    />
                  )}
                </View>
                <TouchableOpacity style={styles.newFolderBtn} onPress={() => setShowCreateFolderInput(true)}>
                  <Feather name="plus" size={14} color="#241f16" />
                  <Text style={styles.newFolderBtnText}>New</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.fieldLabel}>PHOTOS & VIDEOS</Text>
            {attachments.length > 0 && (
              <View style={styles.attachGrid}>
                {attachments.map((a, i) => (
                  <View key={`${a.url}-${i}`} style={styles.attachThumbWrap}>
                    {a.type === 'video' ? (
                      <View style={[styles.attachThumb, styles.videoThumb]}>
                        <Feather name="video" size={20} color={colors.textDim} />
                      </View>
                    ) : (
                      <Image source={{ uri: a.url }} style={styles.attachThumb} />
                    )}
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`}
                    >
                      <Feather name="x" size={11} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.attachBtn} onPress={pickFile} disabled={uploading} accessibilityRole="button">
              {uploading ? <ActivityIndicator size="small" color={colors.accentYellow} /> : <Feather name="paperclip" size={14} color={colors.accentYellow} />}
              <Text style={styles.attachBtnText}>{uploading ? 'Uploading…' : 'Add photo or video (max 50 MB)'}</Text>
            </TouchableOpacity>

            {!!error && (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={14} color={colors.accentRed} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.sheetFooter}>
            <TouchableOpacity style={[styles.footerBtn, styles.footerBtnOutline]} onPress={() => save('draft')} disabled={!!saving} accessibilityRole="button">
              <Text style={[styles.footerBtnText, { color: colors.textMuted }]}>{saving === 'draft' ? 'Saving…' : 'Save draft'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerBtn, { backgroundColor: colors.accentYellow }]} onPress={() => save('published')} disabled={!!saving} accessibilityRole="button">
              <Text style={[styles.footerBtnText, { color: '#241f16' }]}>{saving === 'published' ? 'Posting…' : 'Post'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    sheet: {
      width: '100%', maxWidth: 560, maxHeight: '90%', backgroundColor: colors.bgDark,
      borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderColor, overflow: 'hidden',
    },
    sheetHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderColor,
    },
    sheetTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.textHeading },
    sheetBody: { padding: spacing.lg, gap: 6 },
    fieldLabel: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: colors.textDim, marginTop: 14, marginBottom: 6 },
    input: {
      fontFamily: fonts.serif, fontSize: 13.5, color: colors.textMain,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10,
    },
    captionInput: { minHeight: 90, textAlignVertical: 'top', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderTopWidth: 0, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, marginBottom: 8 },
    toolbarBtn: { width: 28, height: 28, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor },
    boldIcon: { color: colors.textMain, fontWeight: '800', fontSize: 13 },
    divider: { width: 1, height: 20, backgroundColor: colors.borderColor },
    emojiList: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    emojiBtn: { padding: 4 },
    emojiText: { fontSize: 16 },
    attachGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    attachThumbWrap: { position: 'relative' },
    attachThumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.cardDark },
    videoThumb: { alignItems: 'center', justifyContent: 'center' },
    removeBtn: {
      position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9,
      backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
    },
    attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 8 },
    attachBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.accentYellow },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
    errorText: { flex: 1, fontFamily: fonts.serif, fontSize: 12.5, color: colors.accentRed },
    sheetFooter: {
      flexDirection: 'row', gap: 10, justifyContent: 'flex-end',
      padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderColor,
    },
    footerBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm },
    footerBtnOutline: { borderWidth: 1, borderColor: colors.borderColor },
    footerBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700' },
    folderSelectRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    selectContainer: { borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, overflow: 'hidden' },
    newFolderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentYellow, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm, height: 38 },
    newFolderBtnText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: '#241f16' },
    createFolderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    folderActionBtn: { width: 38, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardDark },
  });
}
