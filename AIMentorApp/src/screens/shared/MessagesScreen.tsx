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

function roleLabel(role: string) {
  return role === 'teacher' ? 'Teacher' : 'Parent';
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
    } catch {}
    finally { setSending(false); }
  };

  // ── Conversation List ──────────────────────────────────
  const renderConvoItem = ({ item }: { item: Conversation }) => {
    const isActive = activeConvo?.otherEmail === item.otherEmail;
    return (
      <TouchableOpacity
        style={[styles.convoItem, isActive && styles.convoItemActive]}
        onPress={() => openConversation(item)}
        activeOpacity={0.7}
      >
        <View style={styles.convoAvatar}>
          <Feather name={item.otherRole === 'teacher' ? 'book-open' : 'user'} size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.convoHeader}>
            <Text style={styles.convoName} numberOfLines={1}>{item.otherName}</Text>
            <Text style={styles.convoTime}>{formatTime(item.lastMessageAt)}</Text>
          </View>
          <View style={styles.convoFooter}>
            <Text style={styles.convoPreview} numberOfLines={1}>{item.lastMessage}</Text>
            {item.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.convoRole}>{roleLabel(item.otherRole)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Message Bubble ─────────────────────────────────────
  const renderMessage = ({ item }: { item: Message }) => {
    const isMine   = item.sender_email === userEmail;
    const seen     = isMine && item.read_at !== null;
    const showEdit = isMine && focusedMsgId === item.id;

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setFocusedMsgId(focusedMsgId === item.id ? null : (isMine ? item.id : null))}
      >
        <View style={[styles.bubbleWrap, isMine ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
          {/* Edit button — shows when own message is tapped */}
          {showEdit && (
            <TouchableOpacity style={styles.editIconBtn} onPress={() => { setFocusedMsgId(null); startEdit(item); }} activeOpacity={0.7}>
              <Feather name="edit-2" size={12} color={colors.primary} />
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
                          (window as any).open(`${SERVER_URL}${parsed.attachment!.url}`, '_blank');
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Feather name={fileIcon(parsed.attachment.type) as any} size={18} color={isMine ? '#fff' : colors.primary} />
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
                <Feather name="check" size={11} color={seen ? colors.primary : colors.textDim} />
                {seen && <Feather name="check" size={11} color={colors.primary} style={{ marginLeft: -6 }} />}
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenLayout>
      <Header title="Messages" />
      <View style={styles.container}>

        {/* ── Left panel: conversation list ── */}
        <View style={styles.sidebar}>
          {/* Header row — New button hidden for students */}
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>Conversations</Text>
            {userRole !== 'student' && (
              <TouchableOpacity
                style={styles.newBtn}
                onPress={() => { setShowContacts(true); loadContacts(); }}
                activeOpacity={0.7}
              >
                <Feather name="edit" size={14} color={colors.primary} />
                <Text style={styles.newBtnText}>New</Text>
              </TouchableOpacity>
            )}
          </View>

          {loadingConvos ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : conversations.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="message-square" size={32} color={colors.textDim} />
              <Text style={styles.emptyText}>No messages yet</Text>
              {userRole !== 'student' && (
                <Text style={styles.emptySubText}>
                  Tap <Text style={{ color: colors.primary }}>New</Text> to start a conversation
                </Text>
              )}
              {userRole === 'student' && (
                <Text style={styles.emptySubText}>Messages from your teacher or parent will appear here.</Text>
              )}
            </View>
          ) : (
            <FlatList
              data={conversations}
              keyExtractor={i => i.otherEmail}
              renderItem={renderConvoItem}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* ── Right panel: chat thread ── */}
        <View style={styles.chatPanel}>
          {!activeConvo ? (
            <View style={styles.noConvoState}>
              <Feather name="message-circle" size={48} color={colors.textDim} />
              <Text style={styles.noConvoText}>Select a conversation</Text>
              {userRole !== 'student' && (
                <Text style={styles.noConvoSub}>
                  or tap <Text style={{ color: colors.primary }}>New</Text> to message a {userRole === 'teacher' ? 'parent' : 'teacher'}
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
              <View style={styles.chatHeader}>
                <View style={styles.chatAvatar}>
                  <Feather
                    name={activeConvo.otherRole === 'teacher' ? 'book-open' : 'user'}
                    size={16}
                    color={colors.primary}
                  />
                </View>
                <View>
                  <Text style={styles.chatName}>{activeConvo.otherName}</Text>
                  <Text style={styles.chatRole}>{roleLabel(activeConvo.otherRole)}</Text>
                </View>
              </View>

              {/* Messages */}
              {loadingThread ? (
                <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
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
                  <Feather name={fileIcon(attachment.type) as any} size={16} color={colors.primary} />
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
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <Feather name="paperclip" size={18} color={colors.primary} />
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
              <ActivityIndicator color={colors.primary} style={{ padding: spacing.xl }} />
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
                        color={colors.primary}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
  },
  sidebarTitle: {
    ...typography.smallBold,
    color: c.textDim,
    textTransform: 'uppercase',
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.primary,
  },
  newBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.primary,
  },
  convoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
  },
  convoItemActive: { backgroundColor: 'rgba(99,102,241,0.08)' },
  convoAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  convoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  convoName: { fontSize: 13, fontWeight: '600', color: c.textMain, flex: 1 },
  convoTime: { fontSize: 11, color: c.textDim, marginLeft: spacing.sm },
  convoFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convoPreview: { fontSize: 12, color: c.textMuted, flex: 1 },
  convoRole: { fontSize: 11, color: c.primary, marginTop: 2 },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, marginLeft: spacing.sm,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: 'white' },
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
    backgroundColor: c.primaryGlow,
    alignItems: 'center', justifyContent: 'center',
  },
  chatName: { fontSize: 14, fontWeight: '600', color: c.textMain },
  chatRole: { fontSize: 11, color: c.primary },
  messageList: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  bubbleWrap: { marginBottom: spacing.md, maxWidth: '70%' },
  bubbleWrapRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapLeft:  { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine:   { backgroundColor: c.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextMine:   { color: 'white' },
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
    backgroundColor: c.primaryGlow,
    borderWidth: 1, borderColor: c.primary + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  attachPreviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    marginHorizontal: spacing.md, marginBottom: 0,
    backgroundColor: c.primaryGlow, borderRadius: radius.sm,
    borderWidth: 1, borderColor: c.primary + '30',
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
    backgroundColor: c.primary,
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
    backgroundColor: c.primaryGlow,
    alignItems: 'center', justifyContent: 'center',
  },
  contactName:    { fontSize: 14, fontWeight: '600', color: c.textMain },
  contactContext: { fontSize: 12, color: c.primary, marginTop: 1 },
  contactEmail:   { fontSize: 11, color: c.textDim, marginTop: 1 },
  cancelBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor,
  },
  saveBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.sm, backgroundColor: c.primary,
  },
  editIconBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
});
