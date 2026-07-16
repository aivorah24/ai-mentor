import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Image, TextInput, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { fetchComments, addComment, toggleLike, PortfolioPost, PortfolioComment } from '../api/classPortfolioApi';

// Full-screen media viewer + comment panel — the one genuinely new UI
// component this feature needed (no existing lightbox in the app to fork).
export default function PostLightbox({ post, onClose, onLikeChanged }: {
  post: PortfolioPost; onClose: () => void; onLikeChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';
  const canComment = user?.role === 'parent' || user?.role === 'teacher' || user?.role === 'school_admin';

  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [comments, setComments] = useState<PortfolioComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoadingComments(true);
    try {
      setComments(await fetchComments(post.id));
    } catch {
      // best-effort — leave list empty on failure
    } finally {
      setLoadingComments(false);
    }
  }, [post.id]);

  useEffect(() => { load(); }, [load]);

  async function onLike() {
    setLiked((v) => !v);
    setLikeCount((c) => c + (liked ? -1 : 1));
    try {
      await toggleLike(post.id, email);
      onLikeChanged();
    } catch {
      setLiked((v) => !v);
      setLikeCount((c) => c + (liked ? 1 : -1));
    }
  }

  async function onSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const created = await addComment(post.id, email, draft.trim());
      setComments((prev) => [...prev, created]);
      setDraft('');
    } catch {
      // leave draft intact so the user can retry
    } finally {
      setSending(false);
    }
  }

  const attachment = post.attachments[index];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.mediaPane}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={18} color="#fff" />
            </TouchableOpacity>
            {attachment?.type === 'video' ? (
              Platform.OS === 'web' ? (
                // @ts-ignore — HTML5 video, per this app's convention (expo-av removed, crashes on web)
                <video src={attachment.url} controls style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
              ) : (
                <View style={styles.videoFallback}><Feather name="video" size={36} color="#fff" /></View>
              )
            ) : attachment ? (
              Platform.OS === 'web' ? (
                <img src={attachment.url} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' }} />
              ) : (
                <Image source={{ uri: attachment.url }} style={styles.image} resizeMode="contain" />
              )
            ) : null}

            {post.attachments.length > 1 && (
              <>
                {index > 0 && (
                  <TouchableOpacity style={[styles.navBtn, styles.navBtnLeft]} onPress={() => setIndex((i) => i - 1)} accessibilityRole="button">
                    <Feather name="chevron-left" size={20} color="#fff" />
                  </TouchableOpacity>
                )}
                {index < post.attachments.length - 1 && (
                  <TouchableOpacity style={[styles.navBtn, styles.navBtnRight]} onPress={() => setIndex((i) => i + 1)} accessibilityRole="button">
                    <Feather name="chevron-right" size={20} color="#fff" />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(post.createdByName || post.createdBy || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.creatorName}>{post.createdByName || post.createdBy}</Text>
                <Text style={styles.postDate}>{new Date(post.createdAt).toLocaleDateString()}</Text>
              </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.commentsScroll}>
              {!!post.caption && renderFormattedText(post.caption, styles.caption)}
              {post.tags.length > 0 && (
                <Text style={styles.tagLine}>
                  Tagged: {post.tags.map((t) => t.studentName || 'Student').join(', ')}
                </Text>
              )}
              {loadingComments ? (
                <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 20 }} />
              ) : comments.length === 0 ? (
                <Text style={styles.emptyComments}>No comments yet.</Text>
              ) : (
                comments.map((c) => (
                  <View key={c.id} style={styles.commentRow}>
                    <Text style={styles.commentAuthor}>{c.userName || 'Parent'}</Text>
                    <Text style={styles.commentBody}>{c.body}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={onLike} accessibilityRole="button">
                <Feather name="heart" size={17} color={liked ? colors.accentRed : colors.textMuted} />
                <Text style={styles.actionText}>{likeCount > 0 ? likeCount : 'Like'}</Text>
              </TouchableOpacity>
              <View style={styles.actionBtn}>
                <Feather name="message-circle" size={17} color={colors.textMuted} />
                <Text style={styles.actionText}>{comments.length > 0 ? comments.length : 'Comment'}</Text>
              </View>
            </View>

            {canComment && (
              <View style={styles.inputRow}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Write your comment here"
                  placeholderTextColor={colors.textDim}
                  style={styles.input}
                  multiline
                />
                <TouchableOpacity onPress={onSend} disabled={sending || !draft.trim()} accessibilityRole="button" accessibilityLabel="Send comment">
                  <Feather name="send" size={18} color={draft.trim() ? colors.accentYellow : colors.textDim} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    sheet: {
      width: '100%', maxWidth: 960, maxHeight: '90%', flexDirection: Platform.OS === 'web' ? 'row' : 'column',
      backgroundColor: colors.bgDark, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderColor,
    },
    mediaPane: { flex: 1.4, minHeight: 300, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', position: 'relative' },
    image: { width: '100%', height: '100%' },
    videoFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
    closeBtn: {
      position: 'absolute', top: 10, right: 10, zIndex: 2,
      width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
    },
    navBtn: {
      position: 'absolute', top: '50%', marginTop: -16, zIndex: 2,
      width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
    },
    navBtnLeft: { left: 10 },
    navBtnRight: { right: 10 },
    panel: { flex: 1, minWidth: 280, maxWidth: 380, borderLeftWidth: Platform.OS === 'web' ? 1 : 0, borderLeftColor: colors.borderColor },
    panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: `${colors.accentYellow}33`, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '800', color: colors.accentYellow },
    creatorName: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    postDate: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim },
    commentsScroll: { padding: spacing.lg, gap: 10 },
    caption: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, lineHeight: 19, marginBottom: 8 },
    tagLine: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginBottom: 10 },
    emptyComments: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim },
    commentRow: { marginBottom: 10 },
    commentAuthor: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.textHeading },
    commentBody: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
    actionsRow: { flexDirection: 'row', gap: 18, paddingHorizontal: spacing.lg, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderColor },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
    inputRow: {
      flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: spacing.md,
      borderTopWidth: 1, borderTopColor: colors.borderColor,
    },
    input: {
      flex: 1, fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, maxHeight: 80,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8,
    },
  });
}

function renderFormattedText(text: string, baseStyle: any) {
  if (!text) return null;
  const parts = text.split('**');
  return (
    <Text style={baseStyle}>
      {parts.map((part, index) => {
        // Odd indices are bold
        if (index % 2 === 1) {
          return <Text key={index} style={{ fontWeight: 'bold' }}>{part}</Text>;
        }
        return part;
      })}
    </Text>
  );
}
