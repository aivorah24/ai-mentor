import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, typography } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import SERVER_URL from '../../config/serverUrl';

interface Contact {
  id: string;
  name: string;
  email: string;
  role: string;
  context: string; // e.g. "Teacher of Alex" or "Parent of Alex"
}

interface Conversation {
  otherEmail: string;
  otherName: string;
  otherRole: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface Message {
  id: string;
  sender_email: string;
  sender_name: string;
  sender_role: string;
  recipient_email: string;
  content: string;
  created_at: string;
  read_at: string | null;
  is_edited: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Date chip shown above the first message of each day in a thread.
function formatDateDivider(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

const AIVORAH_EMAIL = 'system@aivorah.com';
// The Aivorah system sender (assignment/challenge reminders) is shown as a friendly
// "Learning Buddy" rather than the raw DB role ('teacher').
function isAivorah(c?: { otherEmail?: string; otherName?: string } | null) {
  return c?.otherEmail === AIVORAH_EMAIL || c?.otherName === 'Aivorah';
}
function roleLabel(role: string) {
  return role === 'teacher' ? 'Teacher' : 'Parent';
}
function convoRoleLabel(c: { otherEmail?: string; otherName?: string; otherRole: string }) {
  return isAivorah(c) ? 'Learning Buddy' : roleLabel(c.otherRole);
}

// Parse message content — may be plain text or JSON with attachment
function parseContent(content: string): { text: string; attachment?: { url: string; name: string; size: number; type: string } } {
  try {
    if (content.startsWith('{')) {
      const parsed = JSON.parse(content);
      if (parsed.attachment) return parsed;
    }
  } catch {}
  return { text: content };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string): string {
  if (/pdf/.test(type)) return 'file-text';
  if (/png|jpg|jpeg|gif/.test(type)) return 'image';
  if (/doc|docx/.test(type)) return 'file-text';
  if (/xls|xlsx|csv/.test(type)) return 'grid';
  if (/ppt|pptx/.test(type)) return 'monitor';
  return 'paperclip';
}

export default function MessagesScreen(_props: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { refresh } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const userEmail = (user?.email || '').toLowerCase();
  const userName  = user?.name  || userEmail;
  const userRole  = user?.role  || 'teacher';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo]     = useState<Conversation | null>(null);
  const [messages, setMessages]           = useState<Message[]>([]);
  const [inputText, setInputText]         = useState('');
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending]             = useState(false);

  // Contact picker
  const [showContacts, setShowContacts]   = useState(false);
  const [contacts, setContacts]           = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Edit message
  const [editingMsg, setEditingMsg]   = useState<Message | null>(null);
  const [editText, setEditText]       = useState('');

  // Attachment
  const [uploading, setUploading]     = useState(false);
  const [attachment, setAttachment]   = useState<{ url: string; name: string; size: number; type: string } | null>(null);
  const [convoFilter, setConvoFilter] = useState<'all' | 'unread' | 'starred'>('all');
  const fileInputRef = useRef<any>(null);

  const flatListRef        = useRef<FlatList>(null);
  const pollRef            = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeEmailRef     = useRef<string | null>(null); // always current, no stale closure

  // Keep ref in sync so loadConversations can read it without a stale closure
  useEffect(() => {
    activeEmailRef.current = activeConvo?.otherEmail ?? null;
  }, [activeConvo]);

  const loadConversations = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/messages/conversations?userEmail=${encodeURIComponent(userEmail)}&role=${encodeURIComponent(userRole)}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        // Client-side role filter (belt-and-suspenders in case server hasn't restarted):
        // teacher sees parents, parent sees teachers
        const filtered = data.filter((c: Conversation) => {
          if (userRole === 'teacher') return c.otherRole === 'parent';
          if (userRole === 'parent')  return c.otherRole === 'teacher';
          return true;
        });
        // Always force the active conversation's unread count to 0 — we're looking at it
        setConversations(filtered.map((c: Conversation) =>
          c.otherEmail === activeEmailRef.current ? { ...c, unreadCount: 0 } : c
        ));
      }
    } catch {}
    finally { setLoadingConvos(false); }
  };

  const loadThread = async (otherEmail: string, markRead = false) => {
    try {
      const res = await fetch(
        `${SERVER_URL}/messages/thread?userEmail=${encodeURIComponent(userEmail)}&otherEmail=${encodeURIComponent(otherEmail)}`
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        setMessages(data);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
      }
      if (markRead) {
        const markReadRes = await fetch(`${SERVER_URL}/messages/read?userEmail=${encodeURIComponent(userEmail)}&otherEmail=${encodeURIComponent(otherEmail)}`, {
          method: 'PATCH',
        });
        if (!markReadRes.ok) {
          const errText = await markReadRes.text().catch(() => '');
          console.error(`[MessagesScreen] Failed to mark conversation read (${markReadRes.status}):`, errText);
        } else {
          await refresh();
        }
        loadConversations();
      }
    } catch (err) {
      console.error('[MessagesScreen] Failed to load conversation thread:', err);
    }
    finally { setLoadingThread(false); }
  };

  const loadContacts = async () => {
    setLoadingContacts(true);
    try {
      const res = await fetch(`${SERVER_URL}/messages/contacts?userEmail=${encodeURIComponent(userEmail)}`);
      const data = await res.json();
      if (Array.isArray(data)) setContacts(data);
    } catch {}
    finally { setLoadingContacts(false); }
  };

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (activeConvo) {
      pollRef.current = setInterval(() => {
        loadThread(activeConvo.otherEmail, true); // marks read + reloads conversations inside
      }, 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeConvo]);

  const openConversation = (convo: Conversation) => {
    // Optimistically clear the badge on this conversation immediately
    setConversations(prev => prev.map(c =>
      c.otherEmail === convo.otherEmail ? { ...c, unreadCount: 0 } : c
    ));
    setActiveConvo(convo);
    setLoadingThread(true);
    loadThread(convo.otherEmail, true);
  };

  const startEdit = (msg: Message) => {
    setEditingMsg(msg);
    setEditText(msg.content);
  };

  const saveEdit = async () => {
    if (!editingMsg || !editText.trim()) return;
    try {
      await fetch(`${SERVER_URL}/messages/${editingMsg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderEmail: userEmail, content: editText.trim() }),
      });
      setEditingMsg(null);
      setEditText('');
      if (activeConvo) loadThread(activeConvo.otherEmail);
    } catch {}
  };

  // track which message shows the edit button (tap to toggle)
  const [focusedMsgId, setFocusedMsgId] = useState<string | null>(null);
  // context menu (right-click / long-press)
  const [contextMenu, setContextMenu] = useState<{ msgId: string; x: number; y: number; isMine: boolean } | null>(null);

  // Start a new conversation from contact picker
  const startConversation = (contact: Contact) => {
    setShowContacts(false);
    const convo: Conversation = {
      otherEmail:    contact.email,
      otherName:     contact.name,
      otherRole:     contact.role,
      lastMessage:   '',
      lastMessageAt: new Date().toISOString(),
      unreadCount:   0,
    };
    setActiveConvo(convo);
    setLoadingThread(true);
    loadThread(contact.email, false);
  };

  // ── File picker + upload ────────────────────────────────
  const pickFile = () => {
    if (Platform.OS !== 'web') return;
    // Create a hidden file input and click it
    if (fileInputRef.current) {
      fileInputRef.current.click();
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';
    input.style.display = 'none';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        Alert.alert('File too large', 'Maximum file size is 10 MB.');
        return;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${SERVER_URL}/messages/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url) {
          setAttachment(data);
        } else {
          Alert.alert('Upload failed', data.error || 'Could not upload file.');
        }
      } catch {
        Alert.alert('Upload failed', 'Could not upload file. Please try again.');
      } finally {
        setUploading(false);
      }
      document.body.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
  };

  const removeAttachment = () => setAttachment(null);

  const deleteMessage = async (msgId: string) => {
    try {
      await fetch(`${SERVER_URL}/messages/${msgId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderEmail: userEmail }),
      });
      if (activeConvo) {
        await loadThread(activeConvo.otherEmail);
        await loadConversations();
      }
    } catch {}
  };

  const sendMessage = async () => {
    if ((!inputText.trim() && !attachment) || !activeConvo || sending) return;
    setSending(true);
    const text = inputText.trim();
    setInputText('');
    const att = attachment;
    setAttachment(null);
    try {
      await fetch(`${SERVER_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderEmail:    userEmail,
          senderName:     userName,
          senderRole:     userRole,
          recipientEmail: activeConvo.otherEmail,
          recipientName:  activeConvo.otherName,
          content:        text,
          ...(att ? {
            attachmentUrl:  att.url,
            attachmentName: att.name,
            attachmentSize: att.size,
            attachmentType: att.type,
          } : {}),
        }),
      });
      await loadThread(activeConvo.otherEmail);
      await loadConversations();

      // If chatting with Aivorah, trigger AI reply
      if (isAivorah(activeConvo) && text) {
        fetch(`${SERVER_URL}/messages/aivorah-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentEmail: userEmail,
            parentName: userName,
            message: text,
          }),
        }).then(() => loadThread(activeConvo.otherEmail)).catch(() => {});
      }
    } catch {}
    finally { setSending(false); }
  };

  // ── Conversation List ──────────────────────────────────
  const renderConvoItem = ({ item, index }: { item: Conversation; index: number }) => {
    const isActive = activeConvo?.otherEmail === item.otherEmail;
    const isToday = sameDay(new Date(item.lastMessageAt), new Date());
    const prevItem = index > 0 ? filteredConvos[index - 1] : null;
    const prevIsToday = prevItem ? sameDay(new Date(prevItem.lastMessageAt), new Date()) : null;
    const showTodayHeader = isToday && (index === 0 || prevIsToday === false);
    const showEarlierHeader = !isToday && (index === 0 || prevIsToday === true);

    return (
      <>
        {showTodayHeader && <Text style={styles.convoSectionLabel}>TODAY</Text>}
        {showEarlierHeader && <Text style={styles.convoSectionLabel}>EARLIER</Text>}
        <TouchableOpacity
          style={[styles.convoItem, isActive && styles.convoItemActive]}
          onPress={() => openConversation(item)}
          activeOpacity={0.7}
        >
          <View style={styles.convoAvatar}>
            <Feather name={isAivorah(item) ? 'cpu' : (item.otherRole === 'teacher' ? 'book-open' : 'user')} size={18} color={colors.accentYellow} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.convoHeader}>
              <Text style={styles.convoName} numberOfLines={1}>{item.otherName}</Text>
              <Text style={styles.convoTime}>{isToday ? formatTime(item.lastMessageAt) : new Date(item.lastMessageAt).toLocaleDateString('en-IN', { weekday: 'short' })}</Text>
            </View>
            <View style={styles.convoFooter}>
              <Text style={styles.convoPreview} numberOfLines={1}>{item.lastMessage}</Text>
              {item.unreadCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unreadCount}</Text>
                </View>
              ) : (
                <View style={styles.unreadDot} />
              )}
            </View>
            <View style={styles.convoRolePill}>
              <Text style={styles.convoRolePillText}>{convoRoleLabel(item)}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </>
    );
  };

  const totalUnread = conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
  const filteredConvos = conversations.filter(c => {
    if (convoFilter === 'unread') return c.unreadCount > 0;
    if (convoFilter === 'starred') return isAivorah(c);
    return true;
  });

  // ── Auto-Logout card (Aivorah special message) ────────────
  const renderAutoLogoutCard = (item: Message, index: number) => {
    const text = item.content;
    const nameMatch = text.match(/\[Auto-Logout\]\s+(.+?)\s+was automatically/);
    const childName = nameMatch ? nameMatch[1] : 'Your child';
    const timeMatch = text.match(/at\s+([\d:]+\s*[ap]m)/i);
    const timeStr = timeMatch ? timeMatch[1] : formatTime(item.created_at);
    const hour = new Date(item.created_at).getHours();

    // Icon + color + tip based on time of day
    const timeSlot =
      hour >= 5  && hour < 12 ? 'morning' :
      hour >= 12 && hour < 17 ? 'afternoon' :
      hour >= 17 && hour < 21 ? 'evening' : 'night';

    const slots: Record<string, { icon: string; iconBg: string; tipIcon: string; tipColor: string; tip: string; decorIcon: string }> = {
      morning:   { icon: 'log-out',  iconBg: '#7A6B3A',  tipIcon: 'shield',  tipColor: colors.accentYellow, tip: "Session ended safely. Encourage them to log back in and continue.",  decorIcon: 'lock' },
      afternoon: { icon: 'lock',     iconBg: '#7A6B3A',  tipIcon: 'shield',  tipColor: colors.accentYellow, tip: "Everything's safe! You can check in with them if needed.",             decorIcon: 'clock' },
      evening:   { icon: 'power',    iconBg: '#4A5A6A',  tipIcon: 'clock',   tipColor: '#8AACB8',           tip: "A short break is okay! Encourage them to come back and continue learning.", decorIcon: 'moon' },
      night:     { icon: 'moon',     iconBg: '#3A3A5A',  tipIcon: 'lock',    tipColor: '#A89AC8',           tip: "Session closed for the night. Hope everything is good!",                decorIcon: 'moon' },
    };
    const s = slots[timeSlot];

    const prev = index > 0 ? messages[index - 1] : null;
    const showDateDivider = !prev || !sameDay(new Date(prev.created_at), new Date(item.created_at));

    return (
      <>
        {showDateDivider && (
          <View style={styles.dateDividerRow}>
            <View style={styles.dateDividerLine} />
            <View style={styles.dateDividerPill}>
              <Text style={styles.dateDividerPillText}>{formatDateDivider(item.created_at)}</Text>
            </View>
            <View style={styles.dateDividerLine} />
          </View>
        )}
        <View style={[styles.autoLogoutCard, { maxWidth: 420, alignSelf: 'flex-start' }]}>
          {/* Left timeline dot */}
          <View style={styles.timelineDot} />
          {/* Icon */}
          <View style={[styles.autoLogoutIcon, { backgroundColor: s.iconBg }]}>
            <Feather name={s.icon as any} size={24} color="#F5F3EE" />
          </View>
          {/* Content */}
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={styles.autoLogoutTitle}>{childName} logged out</Text>
              <Text style={styles.autoLogoutTime}>{timeStr}</Text>
            </View>
            <Text style={styles.autoLogoutDesc}>{childName} was automatically logged out of Aivorah after 5 minutes of inactivity.</Text>
            <View style={[styles.autoLogoutTip, { borderColor: s.tipColor + '30', backgroundColor: s.tipColor + '10' }]}>
              <Feather name={s.tipIcon as any} size={12} color={s.tipColor} />
              <Text style={[styles.autoLogoutTipText, { color: s.tipColor }]}>{s.tip}</Text>
            </View>
          </View>
          {/* Decorative icon */}
          <View style={styles.autoLogoutDecor}>
            <Feather name={s.decorIcon as any} size={32} color={colors.accentYellow + '30'} />
          </View>
        </View>
      </>
    );
  };

  // ── Assignment notification card ──────────────────────
  const renderAssignmentCard = (item: Message, index: number) => {
    // Parse: [ChildName] New Assignment assigned: "TITLE" (Subject). Due: DD Mon.
    const childMatch = item.content.match(/^\[(.+?)\]/);
    const titleMatch = item.content.match(/"([^"]+)"/);
    const subjectMatch = item.content.match(/\(([^)]+)\)/);
    const dueMatch = item.content.match(/Due:\s*(.+?)\.?\s*$/);
    const childName = childMatch ? childMatch[1] : '';
    const title = titleMatch ? titleMatch[1] : item.content;
    const subject = subjectMatch ? subjectMatch[1] : '';
    const due = dueMatch ? dueMatch[1] : '';

    const prev = index > 0 ? messages[index - 1] : null;
    const showDateDivider = !prev || !sameDay(new Date(prev.created_at), new Date(item.created_at));

    return (
      <>
        {showDateDivider && (
          <View style={styles.dateDividerRow}>
            <View style={styles.dateDividerLine} />
            <View style={styles.dateDividerPill}>
              <Text style={styles.dateDividerPillText}>{formatDateDivider(item.created_at)}</Text>
            </View>
            <View style={styles.dateDividerLine} />
          </View>
        )}
        <View style={styles.assignmentCard}>
          {/* Header */}
          <View style={styles.assignmentCardHeader}>
            <View style={styles.assignmentAvatarWrap}>
              <Feather name="clipboard" size={20} color={colors.accentYellow} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.assignmentSender}>AIVORAH</Text>
                <View style={styles.assignmentAIBadge}><Text style={styles.assignmentAIBadgeText}>AI</Text></View>
                <Text style={styles.assignmentTime}>{formatTime(item.created_at)}</Text>
              </View>
              <Text style={styles.assignmentHeadline}>New assignment has been assigned!</Text>
            </View>
          </View>
          {/* Assignment detail pill */}
          <View style={styles.assignmentDetail}>
            <View style={styles.assignmentDetailIcon}>
              <Feather name="book-open" size={18} color={colors.accentYellow} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.assignmentTitle} numberOfLines={2}>{title}</Text>
              {subject ? <Text style={styles.assignmentSubject}>{subject}</Text> : null}
            </View>
            {due ? (
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Feather name="calendar" size={12} color={colors.textDim} />
                  <Text style={styles.assignmentDueLabel}>Due Date</Text>
                </View>
                <Text style={styles.assignmentDueDate}>{due}</Text>
              </View>
            ) : null}
          </View>
          {/* Tip */}
          <View style={styles.assignmentTip}>
            <Feather name="zap" size={12} color={colors.accentYellow} />
            <Text style={styles.assignmentTipText}>
              {childName ? `Encourage ${childName} to start early and do their best!` : 'Encourage your child to start early and do their best!'}
            </Text>
          </View>
        </View>
        <Text style={styles.assignmentDayLabel}>{new Date(item.created_at).toLocaleDateString('en-IN', { weekday: 'short' })}</Text>
      </>
    );
  };

  // ── Message Bubble ─────────────────────────────────────
  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMine   = item.sender_email === userEmail;
    const seen     = isMine && item.read_at !== null;
    const showEdit = isMine && focusedMsgId === item.id;

    // Auto-Logout messages from Aivorah get a special card
    if (!isMine && item.content.includes('[Auto-Logout]')) {
      return renderAutoLogoutCard(item, index);
    }

    // Assignment notification messages get a card
    if (!isMine && item.content.match(/New Assignment assigned:/i)) {
      return renderAssignmentCard(item, index);
    }

    // Show a date chip above the first message of each day.
    const prev = index > 0 ? messages[index - 1] : null;
    const showDateDivider = !prev || !sameDay(new Date(prev.created_at), new Date(item.created_at));

    return (
      <>
      {showDateDivider && (
        <View style={styles.dateDivider}>
          <Text style={styles.dateDividerText}>{formatDateDivider(item.created_at)}</Text>
        </View>
      )}
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => { setContextMenu(null); setFocusedMsgId(focusedMsgId === item.id ? null : (isMine ? item.id : null)); }}
        onLongPress={() => setContextMenu({ msgId: item.id, x: 0, y: 0, isMine })}
        {...(Platform.OS === 'web' ? {
          onContextMenu: (e: any) => {
            e.preventDefault?.();
            setContextMenu({ msgId: item.id, x: e.clientX ?? 0, y: e.clientY ?? 0, isMine });
          }
        } : {})}
      >
        <View style={[styles.bubbleWrap, isMine ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
          {/* Edit button — shows when own message is tapped */}
          {showEdit && (
            <TouchableOpacity style={styles.editIconBtn} onPress={() => { setFocusedMsgId(null); startEdit(item); }} activeOpacity={0.7}>
              <Feather name="edit-2" size={12} color={colors.accentYellow} />
            </TouchableOpacity>
          )}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            {(() => {
              const parsed = parseContent(item.content);
              return (
                <>
                  {parsed.attachment && (
                    <TouchableOpacity
                      style={[styles.attachmentBubble, { borderColor: isMine ? 'rgba(255,255,255,0.3)' : colors.borderColor }]}
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          // New attachments are absolute Cloudinary URLs; older ones
                          // are server-relative ("/data/uploads/...") — handle both.
                          const u = parsed.attachment!.url;
                          const href = /^https?:\/\//i.test(u) ? u : `${SERVER_URL}${u}`;
                          (window as any).open(href, '_blank');
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Feather name={fileIcon(parsed.attachment.type) as any} size={18} color={isMine ? '#fff' : colors.accentYellow} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.attachName, { color: isMine ? '#fff' : colors.textMain }]} numberOfLines={1}>
                          {parsed.attachment.name}
                        </Text>
                        <Text style={[styles.attachSize, { color: isMine ? 'rgba(255,255,255,0.6)' : colors.textDim }]}>
                          {formatFileSize(parsed.attachment.size)} · {parsed.attachment.type.toUpperCase()}
                        </Text>
                      </View>
                      <Feather name="download" size={14} color={isMine ? 'rgba(255,255,255,0.7)' : colors.textDim} />
                    </TouchableOpacity>
                  )}
                  {parsed.text ? (
                    <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
                      {parsed.text}
                    </Text>
                  ) : null}
                </>
              );
            })()}
          </View>
          <View style={styles.bubbleMeta}>
            {item.is_edited && <Text style={styles.editedLabel}>edited</Text>}
            <Text style={styles.bubbleTime}>{formatTime(item.created_at)}</Text>
            {isMine && (
              <View style={styles.tickWrap}>
                <Feather name="check" size={11} color={seen ? colors.accentYellow : colors.textDim} />
                {seen && <Feather name="check" size={11} color={colors.accentYellow} style={{ marginLeft: -6 }} />}
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
      </>
    );
  };

  return (
    <ScreenLayout>
      <Header title="Messages" />
      <View style={styles.container}>

        {/* ── Left panel: conversation list ── */}
        <View style={styles.sidebar}>
          {/* Big header */}
          <View style={styles.sidebarHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Feather name="star" size={20} color={colors.accentYellow} />
              <View>
                <Text style={styles.sidebarTitle}>Conversations</Text>
                <Text style={styles.sidebarSubtitle}>Stay connected with Aivorah</Text>
              </View>
            </View>
            {userRole !== 'student' && (
              <TouchableOpacity
                style={styles.newBtn}
                onPress={() => { setShowContacts(true); loadContacts(); }}
                activeOpacity={0.7}
              >
                <Feather name="edit" size={13} color={colors.accentYellow} />
                <Text style={styles.newBtnText}>New</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Filter tabs */}
          <View style={styles.filterRow}>
            {(['all', 'unread', 'starred'] as const).map(tab => {
              const count = tab === 'all' ? conversations.length : tab === 'unread' ? totalUnread : conversations.filter(c => isAivorah(c)).length;
              const active = convoFilter === tab;
              return (
                <TouchableOpacity key={tab} style={[styles.filterTab, active && styles.filterTabActive]} onPress={() => setConvoFilter(tab)} activeOpacity={0.7}>
                  <Feather name={tab === 'all' ? 'message-square' : tab === 'unread' ? 'mail' : 'star'} size={12} color={active ? colors.accentYellow : colors.textDim} />
                  <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
                  {count > 0 && <View style={[styles.filterBadge, active && styles.filterBadgeActive]}><Text style={[styles.filterBadgeText, active && { color: '#0B0B0B' }]}>{count}</Text></View>}
                </TouchableOpacity>
              );
            })}
          </View>

          {loadingConvos ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 24 }} />
          ) : filteredConvos.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="message-square" size={32} color={colors.textDim} />
              <Text style={styles.emptyText}>No messages yet</Text>
              {userRole !== 'student' && (
                <Text style={styles.emptySubText}>Tap <Text style={{ color: colors.accentYellow }}>New</Text> to start a conversation</Text>
              )}
              {userRole === 'student' && (
                <Text style={styles.emptySubText}>Messages from your teacher or parent will appear here.</Text>
              )}
            </View>
          ) : (
            <FlatList
              data={filteredConvos}
              keyExtractor={i => i.otherEmail}
              renderItem={({ item, index }) => renderConvoItem({ item, index })}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
            />
          )}

          {/* Aivorah bottom banner */}
          <TouchableOpacity style={styles.aivBanner} activeOpacity={0.8} onPress={() => {
            const aiConvo = conversations.find(c => isAivorah(c));
            if (aiConvo) openConversation(aiConvo);
          }}>
            <View style={styles.aivBannerIcon}><Feather name="cpu" size={22} color={colors.accentYellow} /></View>
            <Text style={styles.aivBannerText}>Aivorah is here to <Text style={{ color: colors.accentYellow, fontWeight: '700' }}>support</Text>{'\n'}your child's learning journey.</Text>
            <Feather name="chevron-right" size={16} color={colors.accentYellow} />
          </TouchableOpacity>
        </View>

        {/* ── Right panel: chat thread ── */}
        <View style={styles.chatPanel}>
          {!activeConvo ? (
            <View style={styles.noConvoState}>
              <Feather name="message-circle" size={48} color={colors.textDim} />
              <Text style={styles.noConvoText}>Select a conversation</Text>
              {userRole !== 'student' && (
                <Text style={styles.noConvoSub}>
                  or tap <Text style={{ color: colors.accentYellow }}>New</Text> to message a {userRole === 'teacher' ? 'parent' : 'teacher'}
                </Text>
              )}
            </View>
          ) : (
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={80}
            >
              {/* Chat header */}
              <View style={[styles.chatHeader, isAivorah(activeConvo) && styles.chatHeaderAivorah]}>
                <View style={[styles.chatAvatar, isAivorah(activeConvo) && styles.chatAvatarAivorah]}>
                  <Feather
                    name={isAivorah(activeConvo) ? 'cpu' : (activeConvo.otherRole === 'teacher' ? 'book-open' : 'user')}
                    size={isAivorah(activeConvo) ? 18 : 16}
                    color={colors.accentYellow}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.chatName, isAivorah(activeConvo) && { fontSize: 16, fontWeight: '800' }]}>{activeConvo.otherName}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {isAivorah(activeConvo) ? (
                      <>
                        <View style={styles.onlineDot} />
                        <Text style={[styles.chatRole, { color: colors.accentYellow }]}>Always online · Learning Buddy</Text>
                      </>
                    ) : (
                      <>
                        <View style={[styles.onlineDot, { backgroundColor: colors.textDim }]} />
                        <Text style={styles.chatRole}>
                          {activeConvo.lastMessageAt
                            ? `Last seen ${new Date(activeConvo.lastMessageAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} at ${formatTime(activeConvo.lastMessageAt)}`
                            : convoRoleLabel(activeConvo)}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              </View>

              {/* Messages */}
              {loadingThread ? (
                <ActivityIndicator color={colors.accentYellow} style={{ flex: 1 }} />
              ) : (
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  keyExtractor={i => i.id}
                  renderItem={renderMessage}
                  contentContainerStyle={styles.messageList}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                  ListEmptyComponent={
                    <View style={styles.noMessagesState}>
                      <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
                    </View>
                  }
                />
              )}

              {/* Attachment preview */}
              {attachment && userRole !== 'student' && (
                <View style={styles.attachPreviewRow}>
                  <Feather name={fileIcon(attachment.type) as any} size={16} color={colors.accentYellow} />
                  <Text style={styles.attachPreviewName} numberOfLines={1}>{attachment.name}</Text>
                  <Text style={styles.attachPreviewSize}>{formatFileSize(attachment.size)}</Text>
                  <TouchableOpacity onPress={removeAttachment} activeOpacity={0.7}>
                    <Feather name="x" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              )}

              {/* Input — hidden for students (read-only) */}
              {userRole === 'student' ? (
                <View style={{ padding: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.borderColor }}>
                  <Text style={{ fontSize: 12, color: colors.textDim }}>Messages from your teacher or parent appear here.</Text>
                </View>
              ) : (
                <View style={styles.inputRow}>
                  {Platform.OS === 'web' && (
                    <TouchableOpacity
                      style={styles.attachBtn}
                      onPress={pickFile}
                      disabled={uploading || sending}
                      activeOpacity={0.7}
                    >
                      {uploading
                        ? <ActivityIndicator size="small" color={colors.accentYellow} />
                        : <Feather name="paperclip" size={18} color={colors.accentYellow} />
                      }
                    </TouchableOpacity>
                  )}
                  <TextInput
                    style={styles.input}
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder={`Message ${activeConvo.otherName}...`}
                    placeholderTextColor={colors.textDim}
                    multiline
                    maxLength={1000}
                    onKeyPress={(e: any) => {
                      if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
                        e.preventDefault?.();
                        if (inputText.trim() || attachment) sendMessage();
                      }
                    }}
                  />
                  <TouchableOpacity
                    style={[styles.sendBtn, (!inputText.trim() && !attachment || sending) && styles.sendBtnDisabled]}
                    onPress={sendMessage}
                    disabled={(!inputText.trim() && !attachment) || sending}
                    activeOpacity={0.7}
                  >
                    {sending
                      ? <ActivityIndicator size="small" color="white" />
                      : <Feather name="send" size={16} color="white" />
                    }
                  </TouchableOpacity>
                </View>
              )}
            </KeyboardAvoidingView>
          )}
        </View>
      </View>

      {/* ── Edit Message Modal ── */}
      <Modal visible={!!editingMsg} transparent animationType="fade" onRequestClose={() => setEditingMsg(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { padding: spacing.lg }]}>
            <Text style={styles.modalTitle}>Edit Message</Text>
            <TextInput
              style={[styles.input, { marginTop: spacing.md, minHeight: 80 }]}
              value={editText}
              onChangeText={setEditText}
              multiline
              autoFocus
              placeholderTextColor={colors.textDim}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, justifyContent: 'flex-end' }}>
              <TouchableOpacity onPress={() => setEditingMsg(null)} style={styles.cancelBtn} activeOpacity={0.7}>
                <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveEdit} style={styles.saveBtn} activeOpacity={0.7}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Context Menu (right-click / long-press on message) ── */}
      {contextMenu && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setContextMenu(null)}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setContextMenu(null)}>
            <View style={[styles.contextMenuBox, Platform.OS === 'web' && contextMenu.x > 0
              ? { position: 'absolute', left: contextMenu.x, top: contextMenu.y }
              : { position: 'absolute', bottom: 120, alignSelf: 'center' }
            ]}>
              {contextMenu.isMine && (
                <TouchableOpacity style={styles.contextMenuItem} activeOpacity={0.7} onPress={() => {
                  const msg = messages.find(m => m.id === contextMenu.msgId);
                  if (msg) { setEditingMsg(msg); setEditText(parseContent(msg.content).text || ''); }
                  setContextMenu(null);
                }}>
                  <Feather name="edit-2" size={14} color={colors.accentYellow} />
                  <Text style={styles.contextMenuText}>Edit</Text>
                </TouchableOpacity>
              )}
              {contextMenu.isMine && (
                <TouchableOpacity style={styles.contextMenuItem} activeOpacity={0.7} onPress={() => {
                  deleteMessage(contextMenu.msgId);
                  setContextMenu(null);
                }}>
                  <Feather name="trash-2" size={14} color={colors.accentRed} />
                  <Text style={[styles.contextMenuText, { color: colors.accentRed }]}>Delete</Text>
                </TouchableOpacity>
              )}
              {!contextMenu.isMine && (
                <TouchableOpacity style={styles.contextMenuItem} activeOpacity={0.7} onPress={() => {
                  const msg = messages.find(m => m.id === contextMenu.msgId);
                  if (msg) setInputText(parseContent(msg.content).text || '');
                  setContextMenu(null);
                }}>
                  <Feather name="corner-up-left" size={14} color={colors.textMuted} />
                  <Text style={styles.contextMenuText}>Reply</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── Contact Picker Modal ── */}
      <Modal visible={showContacts} transparent animationType="fade" onRequestClose={() => setShowContacts(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {userRole === 'teacher' ? 'Message a Parent' : 'Message a Teacher'}
              </Text>
              <TouchableOpacity onPress={() => setShowContacts(false)} activeOpacity={0.7}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {loadingContacts ? (
              <ActivityIndicator color={colors.accentYellow} style={{ padding: spacing.xl }} />
            ) : contacts.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="users" size={28} color={colors.textDim} />
                <Text style={styles.emptyText}>No contacts found</Text>
                <Text style={styles.emptySubText}>
                  {userRole === 'teacher'
                    ? 'Parents will appear here once students are linked'
                    : 'Teachers will appear here once your child is linked to a teacher'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={contacts}
                keyExtractor={c => c.email}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.contactItem}
                    onPress={() => startConversation(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.contactAvatar}>
                      <Feather
                        name={item.role === 'teacher' ? 'book-open' : 'user'}
                        size={18}
                        color={colors.accentYellow}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{item.name}</Text>
                      <Text style={styles.contactContext}>{item.context}</Text>
                      <Text style={styles.contactEmail}>{item.email}</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },

  // ── Sidebar ──
  sidebar: {
    width: 280,
    borderRightWidth: 1,
    borderRightColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
  },
  sidebarTitle: {
    fontSize: 18, fontWeight: '800', color: c.textMain,
  },
  sidebarSubtitle: { fontSize: 11, color: c.textDim, marginTop: 1 },
  filterRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  filterTab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.bgDark,
  },
  filterTabActive: { borderColor: c.accentYellow + '60', backgroundColor: c.accentYellow + '12' },
  filterTabText: { fontSize: 11, fontWeight: '600', color: c.textDim },
  filterTabTextActive: { color: c.accentYellow },
  filterBadge: {
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: c.borderColor, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  filterBadgeActive: { backgroundColor: c.accentYellow },
  filterBadgeText: { fontSize: 9, fontWeight: '800', color: c.textDim },
  convoSectionLabel: {
    fontSize: 10, fontWeight: '700', color: c.textDim,
    letterSpacing: 1, paddingHorizontal: spacing.md,
    paddingTop: 12, paddingBottom: 4,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.accentYellow,
  },
  newBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.accentYellow,
  },
  convoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
  },
  convoItemActive: { backgroundColor: 'rgba(186,164,103,0.08)' },
  convoAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: c.accentYellow + '15',
    borderWidth: 1, borderColor: c.accentYellow + '40',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  convoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  convoName: { fontSize: 14, fontWeight: '700', color: c.textMain, flex: 1 },
  convoTime: { fontSize: 11, color: c.textDim, marginLeft: spacing.sm },
  convoFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convoPreview: { fontSize: 12, color: c.textMuted, flex: 1 },
  convoRole: { fontSize: 11, color: c.accentYellow, marginTop: 2 },
  convoRolePill: {
    alignSelf: 'flex-start', marginTop: 5,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10, borderWidth: 1,
    borderColor: c.accentYellow + '50',
    backgroundColor: c.accentYellow + '12',
  },
  convoRolePillText: { fontSize: 10, fontWeight: '600', color: c.accentYellow },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: c.accentYellow + '60', marginLeft: 4,
  },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: c.accentYellow,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5, marginLeft: spacing.sm,
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#0B0B0B' },
  aivBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: spacing.md, padding: 12,
    backgroundColor: c.accentYellow + '10',
    borderWidth: 1, borderColor: c.accentYellow + '35',
    borderRadius: radius.xl,
  },
  aivBannerIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: c.accentYellow + '15',
    borderWidth: 1, borderColor: c.accentYellow + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  aivBannerText: { flex: 1, fontSize: 12, color: c.textMuted, lineHeight: 18 },
  emptyState: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: c.textMuted, textAlign: 'center' },
  emptySubText: { fontSize: 12, color: c.textDim, textAlign: 'center', lineHeight: 18 },

  // ── Chat panel ──
  chatPanel: { flex: 1, backgroundColor: c.bgDark },
  noConvoState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md,
  },
  noConvoText: { fontSize: 15, fontWeight: '600', color: c.textMuted },
  noConvoSub: { fontSize: 13, color: c.textDim },
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  chatAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.accentYellowGlow,
    alignItems: 'center', justifyContent: 'center',
  },
  chatName: { fontSize: 14, fontWeight: '600', color: c.textMain },
  chatRole: { fontSize: 11, color: c.accentYellow },
  messageList: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  dateDivider: { alignSelf: 'stretch', alignItems: 'center', marginVertical: spacing.sm },
  dateDividerText: { fontSize: 11, fontWeight: '600', color: c.textDim, backgroundColor: c.cardDark,
                     borderWidth: 1, borderColor: c.borderColor, borderRadius: 12,
                     paddingHorizontal: 12, paddingVertical: 4, overflow: 'hidden' },
  bubbleWrap: { marginBottom: spacing.md, maxWidth: '70%' },
  bubbleWrapRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapLeft:  { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine:   { backgroundColor: c.accentYellow, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextMine:   { color: '#0B0B0B' },
  bubbleTextTheirs: { color: c.textMain },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 2 },
  bubbleTime: { fontSize: 10, color: c.textDim },
  editedLabel: { fontSize: 10, color: c.textDim, fontStyle: 'italic' },
  tickWrap: { flexDirection: 'row', alignItems: 'center' },
  noMessagesState: { flex: 1, alignItems: 'center', paddingTop: 60 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md,
    padding: spacing.md,
    borderTopWidth: 1, borderTopColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  input: {
    flex: 1, backgroundColor: c.bgDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 14, color: c.textMain,
    maxHeight: 100, minHeight: 40,
  },
  attachBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.accentYellowGlow,
    borderWidth: 1, borderColor: c.accentYellow + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  attachPreviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    marginHorizontal: spacing.md, marginBottom: 0,
    backgroundColor: c.accentYellowGlow, borderRadius: radius.sm,
    borderWidth: 1, borderColor: c.accentYellow + '30',
  },
  attachPreviewName: { flex: 1, fontSize: 12, fontWeight: '600', color: c.textMain },
  attachPreviewSize: { fontSize: 11, color: c.textDim },
  attachmentBubble: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, marginBottom: 4,
  },
  attachName: { fontSize: 13, fontWeight: '600' },
  attachSize: { fontSize: 11 },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.accentYellow,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },

  // ── Contact Picker Modal ──
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalBox: {
    width: 400, maxHeight: '70%',
    backgroundColor: c.cardDark,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  contactItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  contactAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: c.accentYellowGlow,
    alignItems: 'center', justifyContent: 'center',
  },
  contactName:    { fontSize: 14, fontWeight: '600', color: c.textMain },
  contactContext: { fontSize: 12, color: c.accentYellow, marginTop: 1 },
  contactEmail:   { fontSize: 11, color: c.textDim, marginTop: 1 },
  cancelBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor,
  },
  saveBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.sm, backgroundColor: c.accentYellow,
  },
  editIconBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.accentYellow,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },

  // Aivorah header variant
  chatHeaderAivorah: { borderBottomColor: c.accentYellow + '20', paddingVertical: spacing.md },
  chatAvatarAivorah: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: c.accentYellow + '20',
    borderWidth: 1.5, borderColor: c.accentYellow + '50',
  },

  // Auto-Logout card
  autoLogoutCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.cardDark, borderRadius: radius.xl,
    borderWidth: 1, borderColor: c.borderColor,
    padding: 12, marginBottom: 6,
    position: 'relative',
  },
  timelineDot: {
    position: 'absolute', left: -5, top: '50%' as any,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: c.accentYellow,
    borderWidth: 2, borderColor: c.bgDark,
  },
  autoLogoutIcon: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  autoLogoutTitle: { fontSize: 13, fontWeight: '800', color: c.textMain },
  autoLogoutTime: { fontSize: 11, color: c.accentYellow, fontWeight: '600' },
  autoLogoutDesc: { fontSize: 11, color: c.textMuted, lineHeight: 16 },
  autoLogoutTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: 9, paddingVertical: 6, marginTop: 2,
  },
  autoLogoutTipText: { fontSize: 11, lineHeight: 16, flex: 1, fontWeight: '500' },
  autoLogoutDecor: {
    alignItems: 'center', justifyContent: 'center',
    width: 36, flexShrink: 0, opacity: 0.7,
  },

  // Styled date divider for Aivorah chat
  dateDividerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginVertical: spacing.lg, paddingHorizontal: 4,
  },
  dateDividerLine: { flex: 1, height: 1, backgroundColor: c.accentYellow + '30' },
  dateDividerPill: {
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
    borderColor: c.accentYellow + '50', backgroundColor: c.cardDark,
  },
  dateDividerPillText: { fontSize: 11, fontWeight: '700', color: c.accentYellow },

  // Assignment notification card
  assignmentCard: {
    marginHorizontal: spacing.lg, marginVertical: 4,
    backgroundColor: c.cardDark, borderRadius: radius.xl,
    borderWidth: 1, borderColor: c.accentYellow + '30',
    padding: 12, gap: 8,
    maxWidth: 420, alignSelf: 'flex-start',
  },
  assignmentCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  assignmentAvatarWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.accentYellow + '18',
    borderWidth: 1, borderColor: c.accentYellow + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  assignmentSender: { fontSize: 10, fontWeight: '800', color: c.accentYellow, letterSpacing: 1.2 },
  assignmentAIBadge: {
    backgroundColor: c.accentYellow, borderRadius: 3,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  assignmentAIBadgeText: { fontSize: 8, fontWeight: '800', color: '#0B0B0B' },
  assignmentTime: { fontSize: 10, color: c.textDim },
  assignmentHeadline: { fontSize: 12, fontWeight: '700', color: c.textMain, marginTop: 1 },
  assignmentDetail: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.bgDark, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor,
    padding: 10,
  },
  assignmentDetailIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: c.accentYellow + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  assignmentTitle: { fontSize: 12, fontWeight: '700', color: c.textMain },
  assignmentSubject: { fontSize: 10, color: c.accentYellow, fontWeight: '600', marginTop: 1 },
  assignmentDueLabel: { fontSize: 9, color: c.textDim },
  assignmentDueDate: { fontSize: 11, fontWeight: '700', color: c.textMain },
  assignmentTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: c.accentYellow + '10',
    borderWidth: 1, borderColor: c.accentYellow + '30',
    borderRadius: radius.md, paddingHorizontal: 9, paddingVertical: 6,
  },
  assignmentTipText: { fontSize: 11, color: c.textMuted, flex: 1, lineHeight: 16 },
  assignmentDayLabel: { fontSize: 10, color: c.textDim, textAlign: 'center', marginBottom: 2 },

  // Context menu
  contextMenuBox: {
    backgroundColor: c.cardDark, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.accentYellow + '40',
    paddingVertical: 4, minWidth: 160,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 20,
  },
  contextMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  contextMenuText: { fontSize: 13, fontWeight: '600', color: c.textMain },

  // Online status dot
  onlineDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: '#4CAF50',
  },
});
