import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, typography } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import MarkdownText from '../../components/common/MarkdownText';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { useIsFocused } from '@react-navigation/native';
import SERVER_URL from '../../config/serverUrl';
// ── Channels (parallel path) — group chats merged into the inbox for non-students.
// Data stays 100% separate from the 1:1 `messages` API; if it errors, DMs still load.
import { fetchChannels, markChannelRead, sendChannelMessage, Channel, fmtChannelTime } from '../../features/channels/api/channelsApi';
import ChannelThreadView from '../../features/channels/components/ChannelThreadView';
import CreateChannelModal from '../../features/channels/components/CreateChannelModal';
import { pastelBg, pastelText, initials } from '../../features/channels/utils/avatar';
import { isGroupIcon } from '../../features/channels/utils/icons';

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
  reply_to?: { id: string; senderName: string; content: string } | null;
  reactions?: Record<string, number>;
  myReaction?: string | null;
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
// WhatsApp-style categorized picker — plain Unicode, no library/CSP risk,
// works identically on native and web since it's just Text glyphs.
const EMOJI_CATEGORIES: { label: string; icon: string; emojis: string[] }[] = [
  { label: 'Smileys', icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐'] },
  { label: 'Gestures', icon: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👋','🤚','🖐️','✋','🖖','👏','🙌','🤝','🙏','✍️','💪','🦾','👊','✊','🤛','🤜'] },
  { label: 'Hearts', icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','😍','🥰'] },
  { label: 'Animals', icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞'] },
  { label: 'Food', icon: '🍎', emojis: ['🍏','🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥕','🌽','🥐','🍞','🧀','🥚','🍳','🥞','🍔','🍟','🍕','🌮','🍣','🍦','🍩','🍪','🎂','🍫','🍭','☕','🍵','🧃','🥤'] },
  { label: 'Objects', icon: '📚', emojis: ['📚','📖','✏️','📝','📌','📎','📅','📊','📈','💻','📱','⌚','🎒','🎓','🏆','🏅','🎯','⚽','🏀','🎨','🎵','🎬','📷','💡','🔔','🔑','🎁','🎉','🎊','⭐','✨','🔥','💯','✅','❌','❗','❓','⚠️'] },
];
const QUICK_REACTS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
// The Aivorah system sender (assignment/challenge reminders) is shown as a friendly
// "Learning Buddy" rather than the raw DB role ('teacher').
function isAivorah(c?: { otherEmail?: string; otherName?: string } | null) {
  return c?.otherEmail === AIVORAH_EMAIL || c?.otherName === 'Aivorah';
}
function roleLabel(role: string) {
  return role === 'teacher' || role === 'school_admin' ? 'Staff' : 'Parent';
}
function convoRoleLabel(c: { otherEmail?: string; otherName?: string; otherRole: string }) {
  return isAivorah(c) ? 'Learning Buddy' : roleLabel(c.otherRole);
}

function renderPersonAvatar(
  name: string,
  role?: string,
  photoUrl?: string,
  size: number = 44,
  isAivorahItem: boolean = false,
  colors?: any
) {
  const radius = size / 2;
  if (isAivorahItem) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: (colors?.accentYellow || '#BAA467') + '20', borderWidth: 1, borderColor: (colors?.accentYellow || '#BAA467') + '50', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Feather name="cpu" size={Math.round(size * 0.42)} color={colors?.accentYellow || '#BAA467'} />
      </View>
    );
  }
  if (photoUrl && typeof photoUrl === 'string' && photoUrl.trim()) {
    return (
      <Image source={{ uri: photoUrl }} style={{ width: size, height: size, borderRadius: radius, flexShrink: 0 }} />
    );
  }
  const bg = pastelBg(name);
  const fg = pastelText(name);
  const init = initials(name);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Text style={{ fontSize: Math.round(size * 0.38), fontWeight: '700', color: fg }}>{init}</Text>
    </View>
  );
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
  const isFocused = useIsFocused();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const userEmail = (user?.email || '').toLowerCase();
  const userName  = user?.name  || userEmail;
  const userRole  = user?.role  || 'teacher';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo]     = useState<Conversation | null>(null);
  // ── Channels parallel-path (non-students only) ──
  const showChannels = userRole !== 'student';
  const [channels, setChannels]           = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showNewMenu, setShowNewMenu]     = useState(false);
  const [newMenuPos, setNewMenuPos]       = useState({ top: 120, left: 340 });
  const newBtnRef = useRef<any>(null);
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
  const [convoFilter, setConvoFilter] = useState<'all' | 'unread' | 'starred' | 'staff'>('all');
  const [convoSearch, setConvoSearch] = useState('');
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
        // teacher sees parents + staff (colleagues, school admin); parent sees teachers
        const filtered = data.filter((c: Conversation) => {
          if (userRole === 'teacher') return ['parent', 'teacher', 'school_admin'].includes(c.otherRole);
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
      const res = await fetch(`${SERVER_URL}/messages/contacts?userEmail=${encodeURIComponent(userEmail)}&role=${encodeURIComponent(userRole)}`);
      const data = await res.json();
      if (Array.isArray(data)) setContacts(data);
    } catch {}
    finally { setLoadingContacts(false); }
  };

  // Channels load in parallel and never block the DM list (isolated try/catch).
  const loadChannels = async () => {
    if (!showChannels || !userEmail) return;
    try { setChannels(await fetchChannels(userEmail)); } catch {}
  };

  useEffect(() => { loadConversations(); loadChannels(); }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Only auto-mark the open conversation read while the Messages screen is the
    // FOCUSED route. Without this, the screen stays mounted after navigating away
    // (React Navigation keeps tab/drawer screens alive) and its loop silently marks
    // new messages "seen" in the background — so the bell never notifies. We also
    // require the browser tab to be visible+focused (web), so a background tab won't
    // mark messages read either.
    if (activeConvo && isFocused) {
      pollRef.current = setInterval(() => {
        const tabActive = Platform.OS !== 'web'
          || (typeof document !== 'undefined' && document.visibilityState === 'visible'
              && (typeof document.hasFocus !== 'function' || document.hasFocus()));
        // When the conversation is genuinely being viewed → mark read; otherwise just
        // refresh the thread without marking read (so the bell can still notify).
        loadThread(activeConvo.otherEmail, tabActive);
      }, 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeConvo, isFocused]);

  const openConversation = (convo: Conversation) => {
    setActiveChannel(null); // parallel-path mutual exclusion
    setReplyTo(null);
    // Optimistically clear the badge on this conversation immediately
    setConversations(prev => prev.map(c =>
      c.otherEmail === convo.otherEmail ? { ...c, unreadCount: 0 } : c
    ));
    setActiveConvo(convo);
    setLoadingThread(true);
    loadThread(convo.otherEmail, true);
  };

  const openChannel = (ch: Channel) => {
    setActiveConvo(null); // parallel-path mutual exclusion
    setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, unread: 0 } : c));
    markChannelRead(userEmail, ch.id);
    setActiveChannel(ch);
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
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(0);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);

  // Auto-close emoji picker and focused message when clicking anywhere outside on Web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleOutsideClick = () => {
      if (showEmoji) setShowEmoji(false);
      if (focusedMsgId) setFocusedMsgId(null);
    };
    if (showEmoji || focusedMsgId) {
      const timer = setTimeout(() => {
        window.addEventListener('click', handleOutsideClick);
      }, 10);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('click', handleOutsideClick);
      };
    }
  }, [showEmoji, focusedMsgId]);

  const copyMessageText = async (text: string, msgId: string) => {
    try {
      if (Platform.OS === 'web' && (navigator as any)?.clipboard?.writeText) {
        await (navigator as any).clipboard.writeText(text);
        setCopiedMsgId(msgId);
        setTimeout(() => setCopiedMsgId((v) => (v === msgId ? null : v)), 1500);
      }
    } catch {}
  };

  const toggleReaction = async (msgId: string, emoji: string) => {
    try {
      await fetch(`${SERVER_URL}/messages/${msgId}/react`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail, emoji }),
      });
      if (activeConvo) await loadThread(activeConvo.otherEmail);
    } catch {}
  };

  const forwardMessage = async (target: { kind: 'convo'; email: string; name: string } | { kind: 'channel'; id: string }) => {
    if (!forwardMsg) return;
    const text = parseContent(forwardMsg.content).text || '';
    try {
      if (target.kind === 'convo') {
        await fetch(`${SERVER_URL}/messages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderEmail: userEmail, senderName: userName, senderRole: userRole,
            recipientEmail: target.email, recipientName: target.name, content: forwardMsg.content,
          }),
        });
      } else {
        await sendChannelMessage(userEmail, target.id, text);
      }
    } catch {}
    setForwardMsg(null);
  };

  // Start a new conversation from contact picker
  const startConversation = (contact: Contact) => {
    setShowContacts(false);
    setActiveChannel(null);
    setReplyTo(null);
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
    const replyToId = replyTo?.id;
    setInputText('');
    setReplyTo(null);
    setShowEmoji(false);
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
          ...(replyToId ? { replyToId } : {}),
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
            role: userRole,
          }),
        }).then(() => loadThread(activeConvo.otherEmail)).catch(() => {});
      }
    } catch {}
    finally { setSending(false); }
  };

  // ── Conversation List — WhatsApp-style: no date-group headers, just
  // newest-first ordering (the server already sorts by lastMessageAt desc). ──
  const renderConvoItem = ({ item }: { item: Conversation; index: number }) => {
    const isActive = activeConvo?.otherEmail === item.otherEmail;
    const isToday = sameDay(new Date(item.lastMessageAt), new Date());

    return (
      <>
        <TouchableOpacity
          style={[styles.convoItem, isActive && styles.convoItemActive]}
          onPress={() => openConversation(item)}
          activeOpacity={0.7}
        >
          {renderPersonAvatar(item.otherName, item.otherRole, (item as any).photoUrl, 44, isAivorah(item), colors)}
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
  const convoSearchLower = convoSearch.trim().toLowerCase();
  const filteredConvos = conversations.filter(c => {
    // "Staff" = DMs with a teacher/school admin (colleague chat), same
    // people who show under the unified "Staff" role pill, plus staff-only
    // broadcast channels (handled separately below).
    if (convoFilter === 'staff' && !['teacher', 'school_admin'].includes(c.otherRole)) return false;
    if (convoFilter === 'unread' && c.unreadCount <= 0) return false;
    if (convoFilter === 'starred' && !isAivorah(c)) return false;
    if (convoSearchLower && !c.otherName.toLowerCase().includes(convoSearchLower)) return false;
    return true;
  });

  // ── Unified inbox — WhatsApp-style: channels and DMs share one list sorted
  // by whoever has the most recent activity, not "channels always on top". ──
  type InboxItem = { key: string; time: number } & ({ kind: 'channel'; data: Channel } | { kind: 'convo'; data: Conversation });
  const unifiedInbox: InboxItem[] = useMemo(() => {
    const items: InboxItem[] = [];
    if (showChannels && convoFilter !== 'starred') {
      let chList = channels;
      if (convoFilter === 'staff') chList = chList.filter(c => c.category === 'staff');
      else if (convoFilter === 'unread') chList = chList.filter(c => c.unread > 0);
      if (convoSearchLower) chList = chList.filter(c => c.name.toLowerCase().includes(convoSearchLower));
      for (const c of chList) {
        items.push({ kind: 'channel', data: c, key: `ch-${c.id}`, time: c.lastMessage ? new Date(c.lastMessage.at).getTime() : 0 });
      }
    }
    for (const c of filteredConvos) {
      items.push({ kind: 'convo', data: c, key: `dm-${c.otherEmail}`, time: new Date(c.lastMessageAt).getTime() });
    }
    items.sort((a, b) => b.time - a.time);
    return items;
  }, [channels, filteredConvos, convoFilter, convoSearchLower, showChannels]);

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

  // ── Schedule event notification card ─────────────────
  const renderScheduleCard = (item: Message, index: number) => {
    // Format: "SCHEDULE_CARD|childName|title|date|startTime|type"
    const parts = item.content.split('|');
    const childName = parts[1] || '';
    const evTitle   = parts[2] || 'Event';
    const evDate    = parts[3] || '';
    const evTime    = parts[4] || '';
    const evType    = parts[5] || 'lesson';

    const typeLabel: Record<string, string> = {
      lesson: 'Lesson', study: 'Study Session', challenge: 'Challenge',
      deadline: 'Deadline', assignment: 'Assignment', break: 'Break',
    };
    const typeIcon: Record<string, any> = {
      lesson: 'book-open', study: 'edit', challenge: 'award',
      deadline: 'alert-circle', assignment: 'clipboard', break: 'coffee',
    };
    const formattedDate = evDate ? new Date(evDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const tip = `${childName ? `Check ${childName}'s schedule` : 'Check the schedule'} to stay updated!`;

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
          <View style={styles.assignmentCardHeader}>
            <View style={styles.assignmentAvatarWrap}>
              <Feather name="calendar" size={20} color={colors.accentYellow} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.assignmentSender}>AIVORAH</Text>
                <View style={styles.assignmentAIBadge}><Text style={styles.assignmentAIBadgeText}>AI</Text></View>
                <Text style={styles.assignmentTime}>{formatTime(item.created_at)}</Text>
              </View>
              <Text style={styles.assignmentHeadline}>New event has been scheduled!</Text>
            </View>
          </View>
          <View style={styles.assignmentDetail}>
            <View style={styles.assignmentDetailIcon}>
              <Feather name={typeIcon[evType] || 'calendar'} size={18} color={colors.accentYellow} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.assignmentTitle} numberOfLines={2}>{evTitle}</Text>
              <Text style={styles.assignmentSubject}>{typeLabel[evType] || evType}</Text>
            </View>
            {(formattedDate || evTime) ? (
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Feather name="calendar" size={12} color={colors.textDim} />
                  <Text style={styles.assignmentDueLabel}>Scheduled</Text>
                </View>
                <Text style={styles.assignmentDueDate}>{formattedDate}</Text>
                {evTime ? <Text style={[styles.assignmentDueDate, { fontSize: 11 }]}>{evTime}</Text> : null}
              </View>
            ) : null}
          </View>
          <View style={styles.assignmentTip}>
            <Feather name="zap" size={12} color={colors.accentYellow} />
            <Text style={styles.assignmentTipText}>{tip}</Text>
          </View>
        </View>
        <Text style={styles.assignmentDayLabel}>{new Date(item.created_at).toLocaleDateString('en-IN', { weekday: 'short' })}</Text>
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

    // Schedule event notification card
    if (!isMine && item.content.startsWith('SCHEDULE_CARD|')) {
      return renderScheduleCard(item, index);
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
      <View
        {...(Platform.OS === 'web' ? {
          onContextMenu: (e: any) => {
            e.preventDefault?.();
            setContextMenu({ msgId: item.id, x: e.clientX ?? e.nativeEvent?.pageX ?? 0, y: e.clientY ?? e.nativeEvent?.pageY ?? 0, isMine });
          }
        } : {})}
      >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => { setContextMenu(null); setFocusedMsgId(focusedMsgId === item.id ? null : (isMine ? item.id : null)); }}
        onLongPress={(e: any) => setContextMenu({ msgId: item.id, x: e.nativeEvent?.pageX ?? 0, y: e.nativeEvent?.pageY ?? 0, isMine })}
      >
        <View style={[styles.bubbleWrap, isMine ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
          {/* Edit button — shows when own message is tapped */}
          {showEdit && (
            <TouchableOpacity style={styles.editIconBtn} onPress={() => { setFocusedMsgId(null); startEdit(item); }} activeOpacity={0.7}>
              <Feather name="edit-2" size={12} color={colors.accentYellow} />
            </TouchableOpacity>
          )}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            {item.reply_to && (
              <View style={[styles.replyQuote, { borderLeftColor: isMine ? 'rgba(11,11,11,0.35)' : colors.accentYellow }]}>
                <Text style={[styles.replyQuoteName, { color: isMine ? 'rgba(11,11,11,0.7)' : colors.accentYellow }]} numberOfLines={1}>{item.reply_to.senderName}</Text>
                <Text style={[styles.replyQuoteText, { color: isMine ? 'rgba(11,11,11,0.6)' : colors.textDim }]} numberOfLines={2}>{parseContent(item.reply_to.content).text || 'Attachment'}</Text>
              </View>
            )}
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
                    item.sender_email === AIVORAH_EMAIL ? (
                      <MarkdownText
                        text={parsed.text}
                        style={[styles.bubbleText, styles.bubbleTextTheirs]}
                        boldStyle={styles.bubbleTextBold}
                      />
                    ) : (
                      <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
                        {parsed.text}
                      </Text>
                    )
                  ) : null}
                </>
              );
            })()}
          </View>
          {!!item.reactions && Object.keys(item.reactions).length > 0 && (
            <View style={[styles.reactionsRow, isMine && { alignSelf: 'flex-end' }]}>
              {Object.entries(item.reactions).map(([emoji, count]) => (
                <TouchableOpacity
                  key={emoji}
                  style={[styles.reactionPill, item.myReaction === emoji && styles.reactionPillMine]}
                  onPress={() => toggleReaction(item.id, emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.reactionPillText}>{emoji} {count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.bubbleMeta}>
            {copiedMsgId === item.id && <Text style={styles.copiedBadge}>Copied</Text>}
            {item.is_edited && <Text style={styles.editedLabel}>edited</Text>}
            <Text style={styles.bubbleTime}>{formatTime(item.created_at)}</Text>
            {isMine && (
              <View style={styles.tickWrap}>
                <Feather name="check" size={11} color={seen ? colors.accentYellow : colors.textDim} />
                {seen && <Feather name="check" size={11} color={colors.accentYellow} style={{ marginLeft: -6 }} />}
              </View>
            )}
            {/* Always-tappable entry point for Copy/Reply/Forward/React — long-press
                and right-click also work, but this guarantees discoverability. */}
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={(e: any) => setContextMenu({ msgId: item.id, x: e.nativeEvent?.pageX ?? e.clientX ?? 0, y: e.nativeEvent?.pageY ?? e.clientY ?? 0, isMine })}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="more-horizontal" size={14} color={colors.textDim} />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
      </View>
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
                ref={newBtnRef}
                style={styles.newBtn}
                onPress={() => {
                  const canCreate = userRole === 'teacher' || userRole === 'school_admin' || userRole === 'super_admin';
                  if (canCreate) {
                    // Anchor the chooser just below the New button (not the screen edge).
                    newBtnRef.current?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                      setNewMenuPos({ top: y + h + 6, left: Math.max(12, x + w - 224) });
                    });
                    setShowNewMenu(true);
                  } else { setShowContacts(true); loadContacts(); } // parents: direct New chat
                }}
                activeOpacity={0.7}
              >
                <Feather name="edit" size={13} color={colors.accentYellow} />
                <Text style={styles.newBtnText}>New</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Search — filters conversations & channels by name, WhatsApp-style. */}
          <View style={styles.convoSearchBar}>
            <Feather name="search" size={14} color={colors.textDim} />
            <TextInput
              style={styles.convoSearchInput}
              value={convoSearch}
              onChangeText={setConvoSearch}
              placeholder="Search chats and groups…"
              placeholderTextColor={colors.textDim}
            />
            {!!convoSearch && (
              <TouchableOpacity onPress={() => setConvoSearch('')}><Feather name="x" size={14} color={colors.textDim} /></TouchableOpacity>
            )}
          </View>

          {/* Filter tabs — students keep the lean DM tabs; everyone else gets the
              unified inbox tabs (channels merged in). Horizontally scrollable
              so labels never clip on narrower panels. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterRowContent}
            nestedScrollEnabled
            {...(Platform.OS === 'web' ? { persistentScrollbar: false } : {})}
          >
            {(showChannels ? (['all', 'unread', 'staff'] as const) : (['all', 'unread', 'starred'] as const)).map(tab => {
              const chUnread = channels.reduce((n, c) => n + c.unread, 0);
              const count = tab === 'all' ? conversations.length + channels.length
                : tab === 'unread' ? totalUnread + chUnread
                : tab === 'staff' ? channels.filter(c => c.category === 'staff').length + conversations.filter(c => ['teacher', 'school_admin'].includes(c.otherRole)).length
                : conversations.filter(c => isAivorah(c)).length;
              const active = convoFilter === tab;
              const icon = tab === 'all' ? 'message-square' : tab === 'unread' ? 'mail' : tab === 'staff' ? 'users' : 'star';
              return (
                <TouchableOpacity key={tab} style={[styles.filterTab, active && styles.filterTabActive]} onPress={() => setConvoFilter(tab)} activeOpacity={0.7}>
                  <Feather name={icon as any} size={11} color={active ? colors.accentYellow : colors.textDim} />
                  <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
                  {count > 0 && <View style={[styles.filterBadge, active && styles.filterBadgeActive]}><Text style={[styles.filterBadgeText, active && { color: '#0B0B0B' }]}>{count}</Text></View>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Unified inbox — channels and DMs share one scrollable, recency-
              sorted list (WhatsApp-style), instead of channels being pinned
              above the DM list regardless of which is more recent. */}
          {loadingConvos ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 24 }} />
          ) : unifiedInbox.length === 0 ? (
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
              data={unifiedInbox}
              keyExtractor={i => i.key}
              renderItem={({ item }) => item.kind === 'channel' ? (
                <TouchableOpacity style={styles.chRow} onPress={() => openChannel(item.data)} activeOpacity={0.75}>
                  <View style={[styles.chBadge, { backgroundColor: pastelBg(item.data.name) }]}><Feather name={isGroupIcon(item.data.iconLabel) ? item.data.iconLabel : 'users'} size={18} color={pastelText(item.data.name)} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.chName} numberOfLines={1}>{item.data.name}</Text>
                      <Text style={styles.chTime}>{item.data.lastMessage ? fmtChannelTime(item.data.lastMessage.at) : ''}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <Text style={styles.chSub} numberOfLines={1}>{item.data.memberCount} members{item.data.posting === 'staff_only' ? ' · broadcast' : ''}{item.data.lastMessage ? ` · ${item.data.lastMessage.body}` : ''}</Text>
                      {item.data.unread > 0 && <View style={styles.chUnread}><Text style={styles.chUnreadText}>{item.data.unread}</Text></View>}
                    </View>
                  </View>
                </TouchableOpacity>
              ) : renderConvoItem({ item: item.data, index: 0 })}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
            />
          )}

          {/* Aivorah bottom banner — opens the existing thread, or starts a
              fresh one if this user has never messaged Aivorah before (the
              banner previously did nothing in that case). */}
          <TouchableOpacity style={styles.aivBanner} activeOpacity={0.8} onPress={() => {
            const aiConvo = conversations.find(c => isAivorah(c));
            if (aiConvo) openConversation(aiConvo);
            else startConversation({ id: AIVORAH_EMAIL, email: AIVORAH_EMAIL, name: 'Aivorah', role: 'teacher', context: '' });
          }}>
            <View style={styles.aivBannerIcon}><Feather name="cpu" size={22} color={colors.accentYellow} /></View>
            <Text style={styles.aivBannerText}>Aivorah is here to <Text style={{ color: colors.accentYellow, fontWeight: '700' }}>support</Text>{'\n'}your child's learning journey.</Text>
            <Feather name="chevron-right" size={16} color={colors.accentYellow} />
          </TouchableOpacity>
        </View>

        {/* ── Right panel: chat thread (channel takes over via parallel path) ── */}
        <View style={styles.chatPanel}>
          {activeChannel ? (
            <ChannelThreadView channel={activeChannel} onBack={() => { setActiveChannel(null); loadChannels(); }} />
          ) : !activeConvo ? (
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
                {renderPersonAvatar(activeConvo.otherName, activeConvo.otherRole, (activeConvo as any).photoUrl, 38, isAivorah(activeConvo), colors)}
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
                <>
                  {showEmoji && (
                    <TouchableOpacity
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
                      activeOpacity={1}
                      onPress={() => setShowEmoji(false)}
                    />
                  )}
                  <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={i => i.id}
                    renderItem={renderMessage}
                    contentContainerStyle={styles.messageList}
                    showsVerticalScrollIndicator={false}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                    {...(Platform.OS === 'web' ? {
                      onClick: () => {
                        if (showEmoji) setShowEmoji(false);
                        if (focusedMsgId) setFocusedMsgId(null);
                      }
                    } : {})}
                    onTouchStart={() => {
                      if (showEmoji) setShowEmoji(false);
                      if (focusedMsgId) setFocusedMsgId(null);
                    }}
                    onScrollBeginDrag={() => {
                      if (showEmoji) setShowEmoji(false);
                      if (focusedMsgId) setFocusedMsgId(null);
                    }}
                    ListEmptyComponent={
                      <View style={styles.noMessagesState}>
                        <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
                      </View>
                    }
                  />
                </>
              )}

              {/* Reply preview — quoting the message being replied to */}
              {replyTo && userRole !== 'student' && (
                <View style={styles.replyPreviewRow}>
                  <Feather name="corner-up-left" size={14} color={colors.accentYellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.replyPreviewName}>{replyTo.sender_email === userEmail ? 'You' : replyTo.sender_name}</Text>
                    <Text style={styles.replyPreviewText} numberOfLines={1}>{parseContent(replyTo.content).text || 'Attachment'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setReplyTo(null)} activeOpacity={0.7}>
                    <Feather name="x" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
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
                <View>
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
                    <TouchableOpacity
                      style={styles.attachBtn}
                      onPress={() => setShowEmoji((v) => !v)}
                      {...(Platform.OS === 'web' ? { onClick: (e: any) => e.stopPropagation?.() } : {})}
                      activeOpacity={0.7}
                    >
                      <Feather name="smile" size={18} color={colors.accentYellow} />
                    </TouchableOpacity>
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
                </View>
              )}
            </KeyboardAvoidingView>
          )}

          {/* Emoji picker — floats above the composer as an overlay spanning the
              whole chat panel, so tapping anywhere outside (message list included)
              closes it, WhatsApp-style. */}
          {showEmoji && (
            <>
              <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowEmoji(false)} />
              <View style={styles.emojiPickerFloating}>
                <View style={styles.emojiCategoryTabs}>
                  {EMOJI_CATEGORIES.map((cat, i) => (
                    <TouchableOpacity
                      key={cat.label}
                      style={[styles.emojiCategoryTab, emojiCategory === i && styles.emojiCategoryTabActive]}
                      onPress={() => setEmojiCategory(i)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.emojiCategoryIcon}>{cat.icon}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <ScrollView style={styles.emojiPanel} contentContainerStyle={styles.emojiPanelContent} nestedScrollEnabled>
                  {EMOJI_CATEGORIES[emojiCategory].emojis.map((e, i) => (
                    <TouchableOpacity key={`${e}-${i}`} onPress={() => setInputText((t) => t + e)} activeOpacity={0.6} style={styles.emojiCell}>
                      <Text style={styles.emojiItem}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </>
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
      {contextMenu && (() => {
        const winW = Dimensions.get('window').width;
        const winH = Dimensions.get('window').height;
        const menuW = 230;
        const menuH = contextMenu.isMine ? 330 : 250;
        const hasCoords = contextMenu.x > 0 || contextMenu.y > 0;

        const clampedLeft = hasCoords
          ? Math.min(Math.max(16, contextMenu.x - (contextMenu.isMine ? menuW - 24 : 24)), winW - menuW - 16)
          : undefined;
        const clampedTop = hasCoords
          ? Math.min(Math.max(30, contextMenu.y - 10), winH - menuH - 30)
          : undefined;

        return (
          <Modal visible transparent animationType="fade" onRequestClose={() => setContextMenu(null)}>
            <TouchableOpacity
              style={[styles.contextMenuOverlay, !hasCoords && { justifyContent: 'center', alignItems: 'center' }]}
              activeOpacity={1}
              onPress={() => setContextMenu(null)}
            >
              <View
                style={hasCoords ? {
                  position: 'absolute',
                  left: clampedLeft,
                  top: clampedTop,
                  width: menuW,
                } : {
                  width: menuW,
                  alignSelf: contextMenu.isMine ? 'flex-end' : 'flex-start',
                  marginHorizontal: 32,
                }}
                onStartShouldSetResponder={() => true}
                onTouchEnd={(e) => e.stopPropagation?.()}
                {...(Platform.OS === 'web' ? { onClick: (e: any) => e.stopPropagation?.() } : {})}
              >
                <View style={styles.quickReactRow}>
                  {QUICK_REACTS.map((e) => (
                    <TouchableOpacity
                      key={e}
                      onPress={() => { toggleReaction(contextMenu.msgId, e); setContextMenu(null); }}
                      {...(Platform.OS === 'web' ? { onClick: () => { toggleReaction(contextMenu.msgId, e); setContextMenu(null); } } : {})}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.quickReactEmoji}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.contextMenuBox}>
                  <TouchableOpacity
                    style={styles.contextMenuItem}
                    activeOpacity={0.7}
                    onPress={() => {
                      const msg = messages.find(m => m.id === contextMenu.msgId);
                      if (msg) copyMessageText(parseContent(msg.content).text || '', msg.id);
                      setContextMenu(null);
                    }}
                    {...(Platform.OS === 'web' ? { onClick: () => {
                      const msg = messages.find(m => m.id === contextMenu.msgId);
                      if (msg) copyMessageText(parseContent(msg.content).text || '', msg.id);
                      setContextMenu(null);
                    } } : {})}
                  >
                    <Feather name="copy" size={17} color="#B8B9BC" />
                    <Text style={styles.contextMenuText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.contextMenuItem}
                    activeOpacity={0.7}
                    onPress={() => {
                      const msg = messages.find(m => m.id === contextMenu.msgId);
                      if (msg) setReplyTo(msg);
                      setContextMenu(null);
                    }}
                    {...(Platform.OS === 'web' ? { onClick: () => {
                      const msg = messages.find(m => m.id === contextMenu.msgId);
                      if (msg) setReplyTo(msg);
                      setContextMenu(null);
                    } } : {})}
                  >
                    <Feather name="corner-up-left" size={17} color="#B8B9BC" />
                    <Text style={styles.contextMenuText}>Reply</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.contextMenuItem}
                    activeOpacity={0.7}
                    onPress={() => {
                      const msg = messages.find(m => m.id === contextMenu.msgId);
                      if (msg) { setForwardMsg(msg); if (!contacts.length) loadContacts(); }
                      setContextMenu(null);
                    }}
                    {...(Platform.OS === 'web' ? { onClick: () => {
                      const msg = messages.find(m => m.id === contextMenu.msgId);
                      if (msg) { setForwardMsg(msg); if (!contacts.length) loadContacts(); }
                      setContextMenu(null);
                    } } : {})}
                  >
                    <Feather name="corner-up-right" size={17} color="#B8B9BC" />
                    <Text style={styles.contextMenuText}>Forward</Text>
                  </TouchableOpacity>
                  {contextMenu.isMine && (
                    <TouchableOpacity
                      style={styles.contextMenuItem}
                      activeOpacity={0.7}
                      onPress={() => {
                        const msg = messages.find(m => m.id === contextMenu.msgId);
                        if (msg) { setEditingMsg(msg); setEditText(parseContent(msg.content).text || ''); }
                        setContextMenu(null);
                      }}
                      {...(Platform.OS === 'web' ? { onClick: () => {
                        const msg = messages.find(m => m.id === contextMenu.msgId);
                        if (msg) { setEditingMsg(msg); setEditText(parseContent(msg.content).text || ''); }
                        setContextMenu(null);
                      } } : {})}
                    >
                      <Feather name="edit-2" size={17} color="#B8B9BC" />
                      <Text style={styles.contextMenuText}>Edit</Text>
                    </TouchableOpacity>
                  )}
                  {contextMenu.isMine && (
                    <>
                      <View style={styles.contextMenuDivider} />
                      <TouchableOpacity
                        style={styles.contextMenuItem}
                        activeOpacity={0.7}
                        onPress={() => {
                          deleteMessage(contextMenu.msgId);
                          setContextMenu(null);
                        }}
                        {...(Platform.OS === 'web' ? { onClick: () => {
                          deleteMessage(contextMenu.msgId);
                          setContextMenu(null);
                        } } : {})}
                      >
                        <Feather name="trash-2" size={17} color="#F26B6B" />
                        <Text style={[styles.contextMenuText, { color: '#F26B6B' }]}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
        );
      })()}

      {/* ── Forward Message Modal ── */}
      <Modal visible={!!forwardMsg} transparent animationType="fade" onRequestClose={() => setForwardMsg(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Forward to…</Text>
              <TouchableOpacity onPress={() => setForwardMsg(null)} activeOpacity={0.7}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {!!forwardMsg && (
              <View style={styles.forwardPreview}>
                <Text style={styles.forwardPreviewText} numberOfLines={2}>{parseContent(forwardMsg.content).text || 'Attachment'}</Text>
              </View>
            )}
            <ScrollView style={{ maxHeight: 360 }}>
              {loadingContacts && <ActivityIndicator color={colors.accentYellow} style={{ padding: spacing.xl }} />}
              {!!channels.length && (
                <>
                  <Text style={styles.forwardSectionLabel}>Channels</Text>
                  {channels.map((ch) => (
                    <TouchableOpacity key={ch.id} style={styles.contactItem} activeOpacity={0.7} onPress={() => forwardMessage({ kind: 'channel', id: ch.id })}>
                      <View style={styles.contactAvatar}><Feather name="users" size={16} color={colors.accentYellow} /></View>
                      <Text style={styles.contactName}>{ch.name}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
              {!!contacts.length && (
                <>
                  <Text style={styles.forwardSectionLabel}>People</Text>
                  {contacts.map((c) => (
                    <TouchableOpacity key={c.email} style={styles.contactItem} activeOpacity={0.7} onPress={() => forwardMessage({ kind: 'convo', email: c.email, name: c.name })}>
                      <View style={styles.contactAvatar}><Feather name="user" size={16} color={colors.accentYellow} /></View>
                      <Text style={styles.contactName}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
              {!loadingContacts && !contacts.length && !channels.length && (
                <Text style={{ padding: spacing.lg, color: colors.textDim, fontSize: 12.5 }}>No contacts to forward to yet.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
                    {renderPersonAvatar(item.name, item.role, (item as any).photoUrl, 38, false, colors)}
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

      {/* ── New (chooser) — teachers/admins pick New chat or New channel ── */}
      <Modal visible={showNewMenu} transparent animationType="fade" onRequestClose={() => setShowNewMenu(false)}>
        <TouchableOpacity style={styles.chMenuOverlay} activeOpacity={1} onPress={() => setShowNewMenu(false)}>
          <View style={[styles.chMenu, { top: newMenuPos.top, left: newMenuPos.left }]}>
            <TouchableOpacity style={styles.chMenuItem} onPress={() => { setShowNewMenu(false); setShowContacts(true); loadContacts(); }}>
              <Feather name="message-circle" size={16} color={colors.accentYellow} /><Text style={styles.chMenuText}>New direct message</Text>
            </TouchableOpacity>
            <View style={styles.chMenuDivider} />
            <TouchableOpacity style={styles.chMenuItem} onPress={() => { setShowNewMenu(false); setShowCreateChannel(true); }}>
              <Feather name="users" size={16} color={colors.accentYellow} /><Text style={styles.chMenuText}>New group channel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <CreateChannelModal visible={showCreateChannel} onClose={() => setShowCreateChannel(false)} onCreated={() => { setShowCreateChannel(false); loadChannels(); }} />
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
  convoSearchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.md, marginTop: 10, marginBottom: 2,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
  },
  convoSearchInput: {
    flex: 1, fontSize: 13, color: c.textHeading, padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  filterRow: {
    maxHeight: 40, flexGrow: 0, flexShrink: 0,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
    ...(Platform.OS === 'web' ? { overflowX: 'auto' as any, overflowY: 'hidden' as any } : {}),
  },
  filterRowContent: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  filterTab: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16,
    borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.bgDark, flexShrink: 0, alignSelf: 'flex-start',
  },
  filterTabActive: { borderColor: c.accentYellow + '60', backgroundColor: c.accentYellow + '12' },
  filterTabText: { fontSize: 10.5, fontWeight: '600', color: c.textDim },
  filterTabTextActive: { color: c.accentYellow },
  filterBadge: {
    minWidth: 14, height: 14, borderRadius: 7,
    backgroundColor: c.borderColor, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  filterBadgeActive: { backgroundColor: c.accentYellow },
  filterBadgeText: { fontSize: 8.5, fontWeight: '800', color: c.textDim },
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
  // Channel rows merged into the inbox
  chRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderColor },
  chBadge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chName: { flex: 1, fontSize: 14, fontWeight: '700', color: c.textHeading },
  chTime: { fontSize: 10.5, color: c.textDim },
  chSub: { flex: 1, fontSize: 11.5, color: c.textMuted },
  chUnread: { backgroundColor: c.accentRed, borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  chUnreadText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  chMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  chMenu: { position: 'absolute', backgroundColor: c.cardDark, borderRadius: 12, borderWidth: 1, borderColor: c.borderColor, paddingVertical: 6, width: 224, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  chMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  chMenuText: { fontSize: 13.5, fontWeight: '600', color: c.textHeading },
  chMenuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderColor, marginHorizontal: 8 },
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
    width: 44, height: 44, borderRadius: 22,
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
  messageList: { padding: spacing.lg, gap: spacing.md, flexGrow: 1, justifyContent: 'flex-end' },
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
  bubbleTextBold:   { fontWeight: '800', color: c.textHeading },
  replyQuote: { borderLeftWidth: 3, paddingLeft: 8, marginBottom: 6 },
  replyQuoteName: { fontSize: 11.5, fontWeight: '700' },
  replyQuoteText: { fontSize: 12, marginTop: 1 },
  copiedBadge: { fontSize: 10, fontWeight: '700', color: c.accentYellow },
  replyPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.borderColor, backgroundColor: c.bgDark },
  replyPreviewName: { fontSize: 11.5, fontWeight: '700', color: c.accentYellow },
  replyPreviewText: { fontSize: 12, color: c.textDim, marginTop: 1 },
  emojiPickerFloating: {
    position: 'absolute', left: 0, right: 0, bottom: 64,
    borderTopWidth: 1, borderTopColor: c.borderColor, backgroundColor: c.bgDark,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 10,
  },
  emojiCategoryTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.borderColor, paddingHorizontal: 6 },
  emojiCategoryTab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  emojiCategoryTabActive: { borderBottomColor: c.accentYellow },
  emojiCategoryIcon: { fontSize: 17 },
  emojiPanel: { maxHeight: 200 },
  emojiPanelContent: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingVertical: 8 },
  emojiCell: { width: '12.5%', alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  emojiItem: { fontSize: 22 },
  quickReactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1F2023', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8, alignSelf: 'flex-start',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 12,
  },
  quickReactEmoji: { fontSize: 22 },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionPill: { flexDirection: 'row', backgroundColor: c.cardHover, borderWidth: 1, borderColor: c.borderColor, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  reactionPillMine: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  reactionPillText: { fontSize: 11.5, color: c.textMain },
  forwardPreview: { backgroundColor: c.bgDark, borderRadius: radius.sm, padding: 10, marginBottom: 8 },
  forwardPreviewText: { fontSize: 12.5, color: c.textDim },
  forwardSectionLabel: { fontSize: 10.5, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 4 },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 2 },
  bubbleTime: { fontSize: 10, color: c.textDim },
  editedLabel: { fontSize: 10, color: c.textDim, fontStyle: 'italic' },
  tickWrap: { flexDirection: 'row', alignItems: 'center' },
  moreBtn: { marginLeft: 2, padding: 2 },
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
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
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

  // Context menu — WhatsApp-style: a floating quick-react pill above a dark rounded card,
  // always centered in the viewport so it can never clip off a screen edge.
  contextMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  contextMenuBox: {
    backgroundColor: '#1F2023', borderRadius: 18,
    paddingVertical: 6, minWidth: 210,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 20, elevation: 20,
  },
  contextMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 13,
  },
  contextMenuText: { fontSize: 14.5, fontWeight: '500', color: '#F2F2F2' },
  contextMenuDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 },

  // Online status dot
  onlineDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: '#4CAF50',
  },
});
