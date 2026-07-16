import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Platform, Alert, Modal, TextInput } from 'react-native';
import { Feather, AntDesign } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { fetchPosts, toggleLike, publishPost, deletePost, PortfolioPost, fetchFolders, PortfolioFolder } from '../api/classPortfolioApi';
import { fetchMyClasses } from '../../classes/api/classesApi';
import PostLightbox from './PostLightbox';
import PortfolioComposerModal from './PortfolioComposerModal';

export default function PortfolioFeed({ grade, section, classTeacherEmail: classTeacherEmailProp, initialOpenPostId }: {
  grade: string; section: string; classTeacherEmail?: string | null; initialOpenPostId?: string | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';

  // When classTeacherEmail prop is missing (e.g. page refresh loses the URL
  // param), fetch it from the /classes/mine API so the "New post" button still
  // appears for the homeroom teacher.
  const [fetchedClassTeacherEmail, setFetchedClassTeacherEmail] = useState<string | null>(null);

  useEffect(() => {
    if (classTeacherEmailProp || !email || !grade) return;
    let cancelled = false;
    fetchMyClasses(email).then(classes => {
      if (cancelled) return;
      const match = classes.find(c => c.grade === grade && c.section === section);
      if (match?.classTeacherEmail) {
        setFetchedClassTeacherEmail(match.classTeacherEmail);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [classTeacherEmailProp, email, grade, section]);

  const classTeacherEmail = classTeacherEmailProp || fetchedClassTeacherEmail;
  const isHomeroomTeacher = !!classTeacherEmail && email.toLowerCase() === String(classTeacherEmail).toLowerCase();

  const [posts, setPosts] = useState<PortfolioPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openPostId, setOpenPostId] = useState<string | null>(initialOpenPostId || null);
  const [showComposer, setShowComposer] = useState(false);

  useEffect(() => {
    if (initialOpenPostId) {
      setOpenPostId(initialOpenPostId);
    }
  }, [initialOpenPostId]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dbFolders, setDbFolders] = useState<PortfolioFolder[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [activeDateField, setActiveDateField] = useState<'start' | 'end' | null>(null);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());

  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const startDayOfWeek = new Date(calendarYear, calendarMonth, 1).getDay();
    const days: { dayNum: number | null; dateString: string | null }[] = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ dayNum: null, dateString: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const monthStr = String(calendarMonth + 1).padStart(2, '0');
      const dayStr = String(d).padStart(2, '0');
      const dateString = `${calendarYear}-${monthStr}-${dayStr}`;
      days.push({ dayNum: d, dateString });
    }
    return days;
  }, [calendarYear, calendarMonth]);

  const monthsList = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekDaysList = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const changeMonth = (offset: number) => {
    let newMonth = calendarMonth + offset;
    let newYear = calendarYear;
    if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    }
    setCalendarMonth(newMonth);
    setCalendarYear(newYear);
  };

  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      // 1. Text Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const captionMatch = post.caption?.toLowerCase().includes(query);
        const creatorMatch = post.createdByName?.toLowerCase().includes(query) || post.createdBy?.toLowerCase().includes(query);
        if (!captionMatch && !creatorMatch) return false;
      }

      // 2. Folder filter
      if (selectedFolder !== 'all') {
        if (post.folderId !== selectedFolder) return false;
      }

      // 3. Date range filter
      if (startDate) {
        const postDate = new Date(post.createdAt);
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (postDate < start) return false;
      }
      if (endDate) {
        const postDate = new Date(post.createdAt);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (postDate > end) return false;
      }

      return true;
    });
  }, [posts, searchQuery, selectedFolder, startDate, endDate]);

  const load = useCallback(async () => {
    if (!email || !grade) return;
    setLoading(true);
    setError('');
    try {
      const [fetchedPosts, fetchedFolders] = await Promise.all([
        fetchPosts(grade, section, email),
        fetchFolders(grade, section, email)
      ]);
      setPosts(fetchedPosts);
      setDbFolders(fetchedFolders);
    } catch (e: any) {
      setError(e?.message || 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, [email, grade, section]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!email || !grade) return;
    const interval = setInterval(async () => {
      try {
        const [fetchedPosts, fetchedFolders] = await Promise.all([
          fetchPosts(grade, section, email),
          fetchFolders(grade, section, email)
        ]);
        setPosts(fetchedPosts);
        setDbFolders(fetchedFolders);
      } catch (e) {
        // silent catch to prevent interrupting user
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [email, grade, section]);

  async function onLike(post: PortfolioPost) {
    // Optimistic toggle — matches the app's existing like/dismiss patterns.
    setPosts((prev) => prev.map((p) => p.id === post.id
      ? { ...p, isLiked: !p.isLiked, likeCount: p.likeCount + (p.isLiked ? -1 : 1) }
      : p));
    try {
      await toggleLike(post.id, email);
    } catch {
      load(); // reconcile on failure
    }
  }

  async function onPublish(postId: string) {
    try {
      await publishPost(postId, email);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to publish draft');
    }
  }
  async function onDelete(postId: string) {
    setDeleteTargetId(postId);
  }
  const renderCustomCalendar = (field: 'start' | 'end') => {
    const currentValue = field === 'start' ? startDate : endDate;

    return (
      <View style={styles.calendarContainer}>
        {/* Month Selector Header */}
        <View style={styles.calendarHeader}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.calendarHeaderNavBtn}>
            <Feather name="chevron-left" size={16} color={colors.textMain} />
          </TouchableOpacity>
          <Text style={styles.calendarHeaderTitle}>
            {monthsList[calendarMonth]} {calendarYear}
          </Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.calendarHeaderNavBtn}>
            <Feather name="chevron-right" size={16} color={colors.textMain} />
          </TouchableOpacity>
        </View>

        {/* Days of Week Header */}
        <View style={styles.calendarWeekdaysRow}>
          {weekDaysList.map((wd) => (
            <Text key={wd} style={styles.calendarWeekdayText}>
              {wd}
            </Text>
          ))}
        </View>

        {/* Calendar Grid */}
        <View style={styles.calendarGrid}>
          {calendarDays.map((item, idx) => {
            const isSelected = item.dateString !== null && item.dateString === currentValue;
            const isToday = item.dateString !== null && item.dateString === new Date().toISOString().split('T')[0];

            return (
              <TouchableOpacity
                key={idx}
                disabled={item.dayNum === null}
                style={[
                  styles.calendarDayCell,
                  isSelected && styles.calendarDayCellSelected,
                ]}
                onPress={() => {
                  if (item.dateString) {
                    if (field === 'start') {
                      setStartDate(item.dateString);
                    } else {
                      setEndDate(item.dateString);
                    }
                    setActiveDateField(null); // collapse calendar after selection
                  }
                }}
              >
                {item.dayNum !== null ? (
                  <Text
                    style={[
                      styles.calendarDayText,
                      isSelected && styles.calendarDayTextSelected,
                      isToday && !isSelected && { color: colors.accentYellow, fontWeight: '700' },
                    ]}
                  >
                    {item.dayNum}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {Platform.OS === 'web' && (
        <style dangerouslySetInnerHTML={{__html: `
          .portfolio-card {
            transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
          .portfolio-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.12) !important;
          }
          .portfolio-action-btn {
            transition: background-color 0.2s ease, transform 0.15s ease !important;
            border-radius: 20px !important;
            padding: 6px 14px !important;
          }
          .portfolio-action-btn:hover {
            background-color: ${colors.cardHover || 'rgba(0,0,0,0.05)'} !important;
            transform: scale(1.02);
          }
          .portfolio-action-btn:active {
            transform: scale(0.98);
          }
          .portfolio-trash-btn {
            transition: color 0.2s ease, background-color 0.2s ease, transform 0.15s ease !important;
            border-radius: 20px !important;
          }
          .portfolio-trash-btn:hover {
            background-color: rgba(239, 68, 68, 0.1) !important;
            color: #ef4444 !important;
            transform: scale(1.08);
          }
          .portfolio-img {
            transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
          .portfolio-media-wrap {
            overflow: hidden;
            border-radius: 10px;
          }
          .portfolio-media-wrap:hover .portfolio-img {
            transform: scale(1.015);
          }
          @keyframes heartPop {
            0% { transform: scale(1); }
            15% { transform: scale(1.4); }
            30% { transform: scale(0.9); }
            45% { transform: scale(1.15); }
            60% { transform: scale(0.95); }
            100% { transform: scale(1); }
          }
          .heart-liked {
            animation: heartPop 0.45s ease-in-out !important;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        `}} />
      )}
      {isHomeroomTeacher && (
        <View style={styles.newBtnRow}>
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowComposer(true)} accessibilityRole="button">
            <Feather name="plus" size={15} color="#241f16" />
            <Text style={styles.newBtnText}>New post</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Toddle Search & Filter Header Bar */}
      <View style={styles.filterBar}>
        <View style={styles.searchContainer}>
          <Feather name="search" size={16} color={colors.textDim} style={{ marginLeft: 10, marginRight: 6 }} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search posts"
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
          />
        </View>

        {/* Date Filter Button */}
        <TouchableOpacity style={styles.filterBtn} onPress={() => setShowDateModal(true)} accessibilityRole="button">
          <Feather name="calendar" size={15} color={colors.textMain} />
          <Feather name="chevron-down" size={11} color={colors.textDim} style={{ marginLeft: 2 }} />
        </TouchableOpacity>

        {/* Folder Filter Button */}
        <View style={{ position: 'relative' }}>
          <TouchableOpacity style={styles.filterBtn} onPress={() => setShowFolderDropdown(!showFolderDropdown)} accessibilityRole="button">
            <Feather name="folder" size={15} color={colors.textMain} />
            <Feather name="chevron-down" size={11} color={colors.textDim} style={{ marginLeft: 2 }} />
          </TouchableOpacity>

          {/* Folder Dropdown Menu */}
          {showFolderDropdown && (
            <View style={styles.folderDropdown}>
              {[
                { id: 'all', name: 'All folders', color: '#0d9488' },
                ...dbFolders
              ].map(folder => (
                <TouchableOpacity
                  key={folder.id}
                  style={styles.folderOption}
                  onPress={() => {
                    setSelectedFolder(folder.id);
                    setShowFolderDropdown(false);
                  }}
                >
                  <Feather name="folder" size={15} color={folder.color || '#0d9488'} style={{ marginRight: 8 }} />
                  <Text style={styles.folderLabel}>{folder.name}</Text>
                  <View style={[styles.radioCircle, selectedFolder === folder.id && styles.radioActive]}>
                    {selectedFolder === folder.id && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.emptyBox}>
            <Feather name="alert-circle" size={28} color={colors.textDim} />
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : filteredPosts.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="image" size={28} color={colors.textDim} />
            <Text style={styles.emptyText}>No posts match your filters.</Text>
          </View>
        ) : (
          filteredPosts.map((post) => (
            <View key={post.id} style={styles.card} className="portfolio-card">
              <View style={styles.cardHeader}>
                <View style={styles.avatarContainer}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(post.createdByName || post.createdBy || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  {post.tags.length > 0 && (
                    <View style={styles.studentAvatar}>
                      <Text style={styles.studentAvatarText}>
                        {(post.tags[0].studentName || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                    <Text style={styles.creatorName}>{post.createdByName || post.createdBy}</Text>
                    {post.tags.length > 0 && (
                      <>
                        <Text style={styles.taggedText}>tagged</Text>
                        <Text style={styles.taggedStudentName}>{post.tags[0].studentName}</Text>
                        {post.tags.length > 1 && (
                          <Text style={styles.taggedText}>and {post.tags.length - 1} others</Text>
                        )}
                      </>
                    )}
                    {post.status === 'draft' && (
                      <View style={styles.draftBadge}>
                        <Text style={styles.draftBadgeText}>Draft</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <Text style={styles.postDate}>{formatToddleDate(post.createdAt)}</Text>
                    {post.folderName && (
                      <View style={[styles.folderBadge, { backgroundColor: `${post.folderColor || '#0d9488'}15`, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }]}>
                        <Feather name="folder" size={10} color={post.folderColor || '#0d9488'} style={{ marginRight: 3 }} />
                        <Text style={[styles.folderBadgeText, { color: post.folderColor || '#0d9488', fontSize: 10, fontWeight: '700', fontFamily: fonts.serif }]}>{post.folderName}</Text>
                      </View>
                    )}
                  </View>
                </View>
                {isHomeroomTeacher && (
                  <TouchableOpacity onPress={() => onDelete(post.id)} accessibilityRole="button" accessibilityLabel="Delete post" style={{ padding: 6 }} className="portfolio-trash-btn">
                    <Feather name="trash-2" size={15} color={colors.textDim} />
                  </TouchableOpacity>
                )}
              </View>

              {!!post.caption && renderFormattedText(post.caption, styles.caption)}

              {post.status === 'draft' && (
                <TouchableOpacity style={styles.publishBtn} onPress={() => onPublish(post.id)} accessibilityRole="button">
                  <Feather name="send" size={12} color="#241f16" />
                  <Text style={styles.publishBtnText}>Publish Now</Text>
                </TouchableOpacity>
              )}

              {post.attachments.length > 0 && (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setOpenPostId(post.id)} className="portfolio-media-wrap">
                  <MediaPreview attachment={post.attachments[0]} moreCount={post.attachments.length - 1} colors={colors} />
                </TouchableOpacity>
              )}

              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(post)} accessibilityRole="button" className="portfolio-action-btn">
                  <View className={post.isLiked ? "heart-liked" : ""} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {post.isLiked ? (
                      <AntDesign name="heart" size={16} color="#ef4444" />
                    ) : (
                      <Feather name="heart" size={16} color={colors.textMuted} />
                    )}
                  </View>
                  <Text style={styles.actionText}>Like</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => setOpenPostId(post.id)} accessibilityRole="button" className="portfolio-action-btn">
                  <Feather name="message-circle" size={16} color={colors.textMuted} />
                  <Text style={styles.actionText}>Comment</Text>
                </TouchableOpacity>
              </View>

              {post.likeCount > 0 && (
                <Text style={styles.likeCountLine}>
                  {formatLikeCount(post.isLiked, post.likeCount)}
                </Text>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {openPostId && (
        <PostLightbox
          post={posts.find((p) => p.id === openPostId)!}
          onClose={() => setOpenPostId(null)}
          onLikeChanged={load}
        />
      )}

      {showComposer && (
        <PortfolioComposerModal
          grade={grade}
          section={section}
          onClose={() => setShowComposer(false)}
          onSaved={() => { setShowComposer(false); load(); }}
        />
      )}

      {/* Custom Aivorah Confirmation Modal */}
      {deleteTargetId !== null && (
        <Modal transparent animationType="fade" visible={deleteTargetId !== null} onRequestClose={() => setDeleteTargetId(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.confirmModalCard}>
              <View style={styles.confirmModalHeader}>
                <View style={styles.warningIconContainer}>
                  <Feather name="alert-triangle" size={20} color={colors.accentYellow} />
                </View>
                <Text style={styles.confirmModalTitle}>Delete Post</Text>
              </View>

              <View style={styles.confirmModalBody}>
                <Text style={styles.confirmModalText}>
                  Are you sure you want to delete this post? This action cannot be undone.
                </Text>
              </View>

              <View style={styles.confirmModalFooter}>
                <TouchableOpacity
                  style={styles.confirmCancelBtn}
                  onPress={() => setDeleteTargetId(null)}
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmDeleteBtn}
                  onPress={async () => {
                    const idToDelete = deleteTargetId;
                    setDeleteTargetId(null);
                    try {
                      await deletePost(idToDelete, email);
                      load();
                    } catch (e: any) {
                      Alert.alert('Error', e?.message || 'Failed to delete post');
                    }
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmDeleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Toddle Select Date Range Modal */}
      {showDateModal && (
        <Modal transparent animationType="fade" visible={showDateModal} onRequestClose={() => setShowDateModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>Select date range</Text>
                <TouchableOpacity onPress={() => { setActiveDateField(null); setShowDateModal(false); }} accessibilityRole="button">
                  <Feather name="x" size={18} color={colors.textHeading} />
                </TouchableOpacity>
              </View>

              <View style={styles.dateModalBody}>
                <Text style={styles.dateInputLabel}>Start date</Text>
                <TouchableOpacity
                  style={styles.dateInputWrapper}
                  onPress={() => {
                    setActiveDateField(activeDateField === 'start' ? null : 'start');
                    if (startDate) {
                      const d = new Date(startDate);
                      if (!isNaN(d.getTime())) {
                        setCalendarYear(d.getFullYear());
                        setCalendarMonth(d.getMonth());
                      }
                    } else {
                      setCalendarYear(new Date().getFullYear());
                      setCalendarMonth(new Date().getMonth());
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Feather name="calendar" size={16} color={colors.textDim} style={{ marginRight: 8 }} />
                  <Text style={{ color: startDate ? colors.textMain : colors.textDim, fontSize: 13.5, fontFamily: fonts.serif, flex: 1 }}>
                    {startDate ? formatDateDisplay(startDate) : 'Select start date'}
                  </Text>
                  {!!startDate && (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation(); setStartDate(''); }} style={{ padding: 4 }}>
                      <Feather name="x" size={14} color={colors.textDim} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                {activeDateField === 'start' && renderCustomCalendar('start')}

                <Text style={[styles.dateInputLabel, { marginTop: 16 }]}>End date</Text>
                <TouchableOpacity
                  style={styles.dateInputWrapper}
                  onPress={() => {
                    setActiveDateField(activeDateField === 'end' ? null : 'end');
                    if (endDate) {
                      const d = new Date(endDate);
                      if (!isNaN(d.getTime())) {
                        setCalendarYear(d.getFullYear());
                        setCalendarMonth(d.getMonth());
                      }
                    } else {
                      setCalendarYear(new Date().getFullYear());
                      setCalendarMonth(new Date().getMonth());
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Feather name="calendar" size={16} color={colors.textDim} style={{ marginRight: 8 }} />
                  <Text style={{ color: endDate ? colors.textMain : colors.textDim, fontSize: 13.5, fontFamily: fonts.serif, flex: 1 }}>
                    {endDate ? formatDateDisplay(endDate) : 'Select end date'}
                  </Text>
                  {!!endDate && (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation(); setEndDate(''); }} style={{ padding: 4 }}>
                      <Feather name="x" size={14} color={colors.textDim} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                {activeDateField === 'end' && renderCustomCalendar('end')}
              </View>

              <View style={styles.dateModalFooter}>
                <TouchableOpacity style={styles.dateCancelBtn} onPress={() => {
                  setStartDate('');
                  setEndDate('');
                  setActiveDateField(null);
                  setShowDateModal(false);
                }}>
                  <Text style={styles.dateCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateApplyBtn} onPress={() => {
                  setActiveDateField(null);
                  setShowDateModal(false);
                }}>
                  <Text style={styles.dateApplyText}>View all posts</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function MediaPreview({ attachment, moreCount, colors }: { attachment: PortfolioPost['attachments'][0]; moreCount: number; colors: AppColors }) {
  return (
    <View style={{ position: 'relative' }}>
      {attachment.type === 'video' ? (
        Platform.OS === 'web' ? (
          // @ts-ignore — HTML5 video, per this app's convention (expo-av removed, crashes on web)
          <video src={attachment.url} style={{ width: '100%', maxHeight: 360, borderRadius: 10, objectFit: 'contain', background: '#000', display: 'block' }} muted />
        ) : (
          <View style={[previewStyles.fallback, { backgroundColor: colors.cardDark }]}>
            <Feather name="video" size={28} color={colors.textDim} />
          </View>
        )
      ) : (
        Platform.OS === 'web' ? (
          <img src={attachment.url} style={{ width: '100%', height: 'auto', maxHeight: 360, borderRadius: 10, objectFit: 'contain', background: colors.bgDark, display: 'block' }} />
        ) : (
          <Image source={{ uri: attachment.url }} style={[previewStyles.image, { backgroundColor: colors.bgDark }]} resizeMode="contain" />
        )
      )}
      {attachment.type === 'video' && (
        <View style={previewStyles.playBadge}>
          <Feather name="play" size={14} color="#fff" />
        </View>
      )}
      {moreCount > 0 && (
        <View style={previewStyles.moreBadge}>
          <Text style={previewStyles.moreBadgeText}>+{moreCount}</Text>
        </View>
      )}
    </View>
  );
}

const previewStyles = StyleSheet.create({
  image: { width: '100%', height: 260, borderRadius: 10 },
  fallback: { width: '100%', height: 260, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute', top: '50%', left: '50%', marginTop: -16, marginLeft: -16,
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  moreBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  moreBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    newBtnRow: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, maxWidth: 640, width: '100%', alignSelf: 'center' },
    newBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentYellow,
      paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.sm, alignSelf: 'flex-start',
    },
    newBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#241f16' },
    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 640, width: '100%', alignSelf: 'center', gap: 14 },
    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 10 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
    card: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, gap: 10,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    draftBadge: { backgroundColor: colors.borderColor, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    draftBadgeText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: colors.textMuted },
    publishBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentYellow, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, alignSelf: 'flex-start', marginTop: 4 },
    publishBtnText: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '700', color: '#241f16' },
    avatarContainer: { position: 'relative', width: 44, height: 44 },
    avatar: {
      width: 36, height: 36, borderRadius: 8, backgroundColor: `${colors.accentYellow}33`,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: colors.accentYellow },
    studentAvatar: {
      position: 'absolute', bottom: 2, right: 2,
      width: 22, height: 22, borderRadius: 6, backgroundColor: colors.accentYellow,
      borderWidth: 2, borderColor: colors.cardDark,
      alignItems: 'center', justifyContent: 'center',
    },
    studentAvatarText: { fontFamily: fonts.serif, fontSize: 9, fontWeight: '800', color: '#241f16' },
    taggedText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted },
    taggedStudentName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    creatorName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    postDate: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim },
    caption: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, lineHeight: 19 },
    actionsRow: { flexDirection: 'row', gap: 18, paddingTop: 2 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
    likeCountLine: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, marginTop: 4, paddingLeft: 4 },
    filterBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.xl, paddingTop: spacing.md, maxWidth: 640, width: '100%', alignSelf: 'center', zIndex: 10 },
    searchContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, height: 38 },
    searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, paddingVertical: 6, paddingRight: 10 },
    filterBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, width: 38, height: 38 },
    folderDropdown: { position: 'absolute', top: 44, right: 0, width: 180, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, padding: 4, zIndex: 99 },
    folderOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.xs },
    folderLabel: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: colors.textHeading },
    radioCircle: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
    radioActive: { borderColor: '#0d9488' },
    radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#0d9488' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    dateModalCard: { width: '100%', maxWidth: 360, backgroundColor: colors.bgDark, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderColor, overflow: 'hidden' },
    dateModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    dateModalTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading },
    dateModalBody: { padding: 16 },
    dateInputLabel: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.textDim, marginBottom: 6 },
    dateInputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, height: 40 },
    dateModalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.borderColor },
    dateCancelBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.sm },
    dateCancelText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textMuted },
    dateApplyBtn: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.accentYellow, borderRadius: radius.sm },
    dateApplyText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#241f16' },
    confirmModalCard: { width: '100%', maxWidth: 320, backgroundColor: colors.cardDark, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderColor, padding: 24, alignItems: 'center' },
    confirmModalHeader: { alignItems: 'center', gap: 10, marginBottom: 12 },
    warningIconContainer: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.accentYellow}18`, alignItems: 'center', justifyContent: 'center' },
    confirmModalTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.textHeading },
    confirmModalBody: { marginBottom: 20 },
    confirmModalText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
    confirmModalFooter: { flexDirection: 'row', width: '100%', gap: 10 },
    confirmCancelBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    confirmCancelText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textMuted },
    confirmDeleteBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.accentRed },
    confirmDeleteText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#fff' },
    calendarContainer: { marginTop: 10, padding: 12, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, width: '100%' },
    calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    calendarHeaderNavBtn: { padding: 6, borderRadius: 4 },
    calendarHeaderTitle: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    calendarWeekdaysRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    calendarWeekdayText: { width: 32, textAlign: 'center', fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    calendarDayCell: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginVertical: 2, borderRadius: 16 },
    calendarDayCellSelected: { backgroundColor: colors.accentYellow },
    calendarDayText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMain },
    calendarDayTextSelected: { color: '#241f16', fontWeight: '700' },
  });
}

function formatDateDisplay(dateStr: string) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
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

function formatToddleDate(dateString: string) {
  const d = new Date(dateString);
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${day} ${month} ${year}, ${hours}.${minStr} ${ampm}`;
}

function formatLikeCount(isLiked: boolean, count: number) {
  if (isLiked) {
    if (count === 1) return 'Liked by you';
    const others = count - 1;
    return `Liked by you and ${others} ${others === 1 ? 'other' : 'others'}`;
  } else {
    return `${count} ${count === 1 ? 'person' : 'people'} liked this`;
  }
}
