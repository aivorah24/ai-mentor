import React, { useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

const FAQS = [
  { q: 'How do I create an assignment for all students?', a: "Go to Assignments → tap '+'. Leave the student field set to 'All Students' to broadcast to everyone enrolled. The assignment appears instantly in every student's app and is auto-tracked in their schedule." },
  { q: 'How do I see which students need help?', a: "Your Dashboard shows a 'Needs Attention' section. The Students screen gives a full breakdown — look for red badges. Students with scores below 60% on recent assignments are automatically flagged." },
  { q: 'How is student progress calculated?', a: "Progress = completed topics ÷ total curriculum topics × 100. Students earn XP for each topic they complete via the Learn screen. You can view per-student breakdowns in the Progress tab." },
  { q: 'How does AI auto-grading work?', a: "When a student submits a scaffolded assignment (brainstorm, drawing, writing), the AI analyses each step against the topic and grade level. It returns a score (0–100%) and step-by-step feedback. You can review grades in Assignments." },
  { q: 'Can I message parents directly?', a: "Yes — go to Messages in the sidebar. Your conversation list shows all parent threads. Parents can only see messages related to their own child. Tap the compose icon to start a new conversation." },
  { q: 'How do I create a challenge for my class?', a: "Go to Challenges → '+'. Set the title, subject, time limit, and difficulty. Challenges are broadcast to all enrolled students. Per-student challenges and paid challenge flows are coming soon." },
  { q: 'What does the AI Suggested Action mean?', a: "The AI analyses class data — scores, engagement, topic completion — and recommends the single most impactful action you can take today. It could be a re-teach prompt, a challenge suggestion, or flagging a struggling student." },
  { q: 'How do I track assignment submissions?', a: "Go to Assignments → tap any assignment to see submission status. Completed assignments show the student's score and AI feedback. The status badge turns green when all students have submitted." },
  { q: 'Can students use the AI Coach without my permission?', a: "Yes — the AI Coach is always available for self-directed learning. It stays within the enrolled curriculum (IB PYP or NCERT) and grade level. You can see AI Coach usage in the student's Progress screen." },
  { q: 'How do I contact Aivorah support?', a: "Use the 'Submit Ticket' button below to send us a message, or chat with Aivorah 24/7 for instant answers. Our support team responds to tickets within 24 hours on business days." },
];

const CHAT_SUGGESTIONS = [
  'How do I create an assignment?',
  'How does AI grading work?',
  'How do I message parents?',
  'How is progress calculated?',
  'Can I create challenges?',
];

export default function TeacherHelpScreen({ navigation }: any) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const gold = colors.accentYellow;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const firstName = user?.name?.split(' ')[0] || 'there';

  const [search,       setSearch]       = useState('');
  const [openFaq,      setOpenFaq]      = useState<number | null>(null);
  const [chatVisible,  setChatVisible]  = useState(false);
  const [ticketVisible,setTicketVisible]= useState(false);

  // Chat
  interface ChatMsg { id: number; role: 'user' | 'ai'; text: string; }
  const [chatInput,   setChatInput]   = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMsgs,    setChatMsgs]    = useState<ChatMsg[]>([
    { id: 0, role: 'ai', text: `Hi! I'm your Aivorah 24/7 Support Assistant. Ask me anything about managing your class, assignments, grading, and more!` },
  ]);
  const chatScrollRef = useRef<ScrollView>(null);

  // Ticket
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError,   setTicketError]   = useState('');
  const [feedback,      setFeedback]      = useState<{ title: string; message: string } | null>(null);

  const filteredFaqs = FAQS.filter(f =>
    search === '' ||
    f.q.toLowerCase().includes(search.toLowerCase()) ||
    f.a.toLowerCase().includes(search.toLowerCase())
  );

  async function sendSupportMessage(text?: string) {
    const msg = (text ?? chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    const userMsg: ChatMsg = { id: Date.now(), role: 'user', text: msg };
    setChatMsgs(prev => [...prev, userMsg]);
    setChatLoading(true);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const res = await fetch(`${SERVER_URL}/help/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, userName: firstName }),
      });
      const data = await res.json();
      const aiMsg: ChatMsg = { id: Date.now() + 1, role: 'ai', text: data.reply || 'Something went wrong.' };
      setChatMsgs(prev => [...prev, aiMsg]);
    } catch {
      setChatMsgs(prev => [...prev, { id: Date.now() + 1, role: 'ai', text: 'Could not reach support. Please try again.' }]);
    }
    setChatLoading(false);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  async function handleSubmitTicket() {
    const subject = ticketSubject.trim();
    const message = ticketMessage.trim();
    if (!subject) { setTicketError('Please enter a subject.'); return; }
    if (!message) { setTicketError('Please describe your issue.'); return; }
    setTicketError('');
    setTicketLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/help/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email || '', subject, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not submit ticket.');
      setTicketVisible(false);
      setTicketSubject('');
      setTicketMessage('');
      setFeedback({ title: 'Ticket Submitted!', message: `We'll respond to ${user?.email || 'your email'} within 24 hours.` });
    } catch (err: any) {
      setTicketError(err?.message || 'Please try again.');
    } finally {
      setTicketLoading(false);
    }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Help Center"
          subtitle={`We're here to support you, ${firstName}.`}
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Hero + Search */}
          <View style={styles.hero}>
            <View style={styles.heroIconWrap}>
              <Feather name="help-circle" size={32} color={gold} />
            </View>
            <Text style={styles.heroTitle}>How can we help you?</Text>
            <Text style={styles.heroSub}>Find answers instantly or reach our support team.</Text>
            <View style={styles.searchBox}>
              <Feather name="search" size={16} color={colors.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search questions..."
                placeholderTextColor={colors.textDim}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Feather name="x" size={16} color={colors.textDim} />
                </TouchableOpacity>
              )}
            </View>
            {search.length > 0 && (
              <Text style={styles.searchResultCount}>{filteredFaqs.length} result{filteredFaqs.length !== 1 ? 's' : ''}</Text>
            )}
          </View>

          {/* FAQs */}
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {filteredFaqs.length === 0 && <Text style={styles.emptyText}>No FAQs match "{search}"</Text>}
          {filteredFaqs.map((faq, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.faqItem, openFaq === i && styles.faqItemOpen]}
              onPress={() => setOpenFaq(openFaq === i ? null : i)}
              activeOpacity={0.7}
            >
              <View style={styles.faqHeader}>
                <View style={styles.faqQWrap}>
                  <View style={styles.faqNum}>
                    <Text style={styles.faqNumText}>{String(i + 1).padStart(2, '0')}</Text>
                  </View>
                  <Text style={styles.faqQ}>{faq.q}</Text>
                </View>
                <Feather name={openFaq === i ? 'chevron-up' : 'chevron-down'} size={16} color={openFaq === i ? gold : colors.textMuted} />
              </View>
              {openFaq === i && <Text style={styles.faqA}>{faq.a}</Text>}
            </TouchableOpacity>
          ))}

          {/* Still need help? */}
          <Text style={styles.sectionTitle}>Still need help?</Text>
          <View style={styles.supportRow}>
            <TouchableOpacity style={[styles.supportCard, styles.supportCardPrimary]} onPress={() => setChatVisible(true)} activeOpacity={0.7}>
              <View style={styles.supportIconWrap}>
                <Feather name="message-circle" size={24} color={gold} />
              </View>
              <Text style={styles.supportTitle}>Aivorah 24/7</Text>
              <Text style={styles.supportSub}>Instant platform support</Text>
              <View style={styles.supportArrow}>
                <Feather name="arrow-right" size={14} color={gold} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.supportCard} onPress={() => setTicketVisible(true)} activeOpacity={0.7}>
              <View style={[styles.supportIconWrap, { backgroundColor: colors.accentBlue + '18' }]}>
                <Feather name="send" size={24} color={colors.accentBlue} />
              </View>
              <Text style={styles.supportTitle}>Submit Ticket</Text>
              <Text style={styles.supportSub}>We'll reply within 24h</Text>
              <View style={[styles.supportArrow, { backgroundColor: colors.accentBlue + '15' }]}>
                <Feather name="arrow-right" size={14} color={colors.accentBlue} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.versionRow}>
            <Text style={styles.versionText}>Aivorah v1.0.0 · NuShift</Text>
          </View>
        </ScrollView>

        {/* Aivorah 24/7 Chat Modal */}
        <Modal visible={chatVisible} transparent animationType="slide" onRequestClose={() => setChatVisible(false)}>
          <KeyboardAvoidingView style={styles.chatOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.chatBox, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
              <View style={styles.chatHeader}>
                <View style={styles.chatHeaderLeft}>
                  <View style={[styles.chatAiOrb, { backgroundColor: gold + '18' }]}>
                    <Feather name="zap" size={16} color={gold} />
                  </View>
                  <View>
                    <Text style={[styles.chatTitle, { color: colors.textMain }]}>Aivorah 24/7</Text>
                    <Text style={[styles.chatSubtitle, { color: colors.accentGreen }]}>Support Assistant · Online</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setChatVisible(false)}>
                  <Feather name="x" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView ref={chatScrollRef} style={styles.chatMsgs} contentContainerStyle={{ padding: 14, gap: 10 }} showsVerticalScrollIndicator={false}>
                {chatMsgs.map(m => (
                  <View key={m.id} style={[styles.chatBubble, m.role === 'user'
                    ? [styles.chatBubbleUser, { backgroundColor: gold }]
                    : [styles.chatBubbleAi, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]]}>
                    <Text style={[styles.chatBubbleTxt, { color: m.role === 'user' ? '#fff' : colors.textMain }]}>{m.text}</Text>
                  </View>
                ))}
                {chatLoading && (
                  <View style={[styles.chatBubble, styles.chatBubbleAi, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}>
                    <ActivityIndicator size="small" color={colors.accentYellow} />
                  </View>
                )}
              </ScrollView>
              {chatMsgs.length <= 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chatSuggestScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingBottom: 8 }}>
                  {CHAT_SUGGESTIONS.map(s => (
                    <TouchableOpacity key={s} style={[styles.chatSuggestChip, { backgroundColor: gold + '18', borderColor: gold + '40' }]} onPress={() => sendSupportMessage(s)} activeOpacity={0.7}>
                      <Text style={[styles.chatSuggestTxt, { color: gold }]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <View style={[styles.chatInputRow, { borderTopColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                <TextInput
                  style={[styles.chatTextInput, { color: colors.textMain }]}
                  placeholder="Ask about assignments, grading, students..."
                  placeholderTextColor={colors.textDim}
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={() => sendSupportMessage()}
                  returnKeyType="send"
                  editable={!chatLoading}
                />
                <TouchableOpacity
                  style={[styles.chatSendBtn, { backgroundColor: chatInput.trim() ? gold : colors.borderColor }]}
                  onPress={() => sendSupportMessage()}
                  disabled={!chatInput.trim() || chatLoading}
                  activeOpacity={0.8}
                >
                  <Feather name="send" size={16} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Submit Ticket Modal */}
        <Modal visible={ticketVisible} transparent animationType="fade" onRequestClose={() => setTicketVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Submit Support Ticket</Text>
                <TouchableOpacity onPress={() => setTicketVisible(false)}>
                  <Feather name="x" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.ticketNote}>
                Submitting as: <Text style={{ color: gold }}>{user?.email || 'guest'}</Text>
              </Text>
              <Text style={styles.modalFieldLabel}>Subject</Text>
              <View style={styles.ticketInput}>
                <TextInput
                  style={styles.ticketTextInput} value={ticketSubject} onChangeText={setTicketSubject}
                  placeholder="Brief summary of your issue" placeholderTextColor={colors.textDim} autoFocus
                />
              </View>
              <Text style={styles.modalFieldLabel}>Describe your issue</Text>
              <View style={[styles.ticketInput, { height: 100, alignItems: 'flex-start', paddingTop: spacing.md }]}>
                <TextInput
                  style={[styles.ticketTextInput, { textAlignVertical: 'top' }]}
                  value={ticketMessage} onChangeText={setTicketMessage}
                  placeholder="Please provide as much detail as possible..."
                  placeholderTextColor={colors.textDim} multiline numberOfLines={4}
                />
              </View>
              {ticketError ? <Text style={{ color: '#B8797E', fontSize: 13, marginTop: 8 }}>{ticketError}</Text> : null}
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setTicketVisible(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSubmitTicket} disabled={ticketLoading}>
                  {ticketLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Submit Ticket</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Feedback Modal */}
        <Modal visible={!!feedback} transparent animationType="fade" onRequestClose={() => setFeedback(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { maxWidth: 360 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{feedback?.title}</Text>
                <TouchableOpacity onPress={() => setFeedback(null)}>
                  <Feather name="x" size={20} color="#888" />
                </TouchableOpacity>
              </View>
              <Text style={styles.ticketNote}>{feedback?.message}</Text>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={() => setFeedback(null)}>
                <Text style={styles.modalSaveText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  hero: { alignItems: 'center', paddingVertical: spacing.xxl, marginBottom: spacing.lg },
  heroIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentYellow + '18', borderWidth: 1, borderColor: c.accentYellow + '40', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  heroTitle: { fontSize: 22, fontWeight: '800', color: c.textMain, textAlign: 'center', marginBottom: spacing.sm, letterSpacing: -0.5 },
  heroSub: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: spacing.xl, paddingHorizontal: spacing.xl },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: 28, paddingHorizontal: spacing.xl, height: 52, width: '100%' },
  searchInput: { flex: 1, fontSize: 14, color: c.textMain, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  searchResultCount: { fontSize: 12, color: c.textDim, marginTop: spacing.md },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: spacing.lg, marginTop: spacing.xl },
  emptyText: { fontSize: 14, color: c.textDim, fontStyle: 'italic', marginBottom: spacing.xl },

  faqItem: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  faqItemOpen: { borderColor: c.accentYellow + '60' },
  faqHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  faqQWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  faqNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.accentYellow + '18', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  faqNumText: { fontSize: 11, fontWeight: '700', color: c.accentYellow },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: c.textMain, lineHeight: 20, paddingTop: 4 },
  faqA: { fontSize: 13, color: c.textMuted, lineHeight: 21, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor },

  supportRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
  supportCard: { flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  supportCardPrimary: { borderColor: c.accentYellow + '40', backgroundColor: c.accentYellow + '18' },
  supportIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.accentYellow + '18', alignItems: 'center', justifyContent: 'center' },
  supportTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, textAlign: 'center' },
  supportSub: { fontSize: 11, color: c.textMuted, textAlign: 'center' },
  supportArrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.accentYellow + '18', alignItems: 'center', justifyContent: 'center' },

  versionRow: { alignItems: 'center', paddingTop: spacing.xl },
  versionText: { fontSize: 11, color: c.textDim },

  // Chat
  chatOverlay: { flex: 1, justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end', alignItems: Platform.OS === 'web' ? 'center' : 'stretch', backgroundColor: 'rgba(0,0,0,0.5)', padding: Platform.OS === 'web' ? 24 : 0 },
  chatBox: { borderRadius: Platform.OS === 'web' ? 20 : undefined, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: Platform.OS === 'web' ? 1 : 0, overflow: 'hidden', maxHeight: Platform.OS === 'web' ? 600 : ('85%' as any), ...(Platform.OS === 'web' ? { width: '100%', maxWidth: 560 } as any : {}) },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  chatHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chatAiOrb: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chatTitle: { fontSize: 15, fontWeight: '700' },
  chatSubtitle: { fontSize: 11, marginTop: 1 },
  chatMsgs: { maxHeight: 320 },
  chatBubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '80%' },
  chatBubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  chatBubbleAi: { alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1 },
  chatBubbleTxt: { fontSize: 14, lineHeight: 20 },
  chatSuggestScroll: { maxHeight: 44 },
  chatSuggestChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chatSuggestTxt: { fontSize: 12, fontWeight: '600' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderTopWidth: 1 },
  chatTextInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  chatSendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  // Ticket modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxWidth: 480 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  ticketNote: { fontSize: 13, color: c.textMuted, marginBottom: spacing.lg },
  modalFieldLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: spacing.md },
  ticketInput: { backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  ticketTextInput: { fontSize: 14, color: c.textMain, minHeight: 44 },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
