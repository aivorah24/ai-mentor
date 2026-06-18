import React, { useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
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
  { q: "How do I monitor my child's learning progress?", a: "Go to My Kids → tap your child's name → view the Progress tab. You'll see completed topics, quiz scores, XP earned, and which areas need attention. The dashboard shows a real-time summary card for quick checks." },
  { q: 'How do I message my child\'s teacher?', a: 'Tap Messages in the sidebar. Your conversation list shows all teacher threads. Tap the compose icon to start a new message. Teachers typically respond within 24 hours on school days.' },
  { q: 'Can I assign extra practice work for my child?', a: "Yes — go to Assignments → tap '+'. You can create a custom assignment linked to any curriculum topic. The AI will auto-grade it and provide detailed feedback to your child." },
  { q: 'How do I switch between my children?', a: "If you have more than one child registered, tap the child selector at the top of the Dashboard or My Kids screen. Each child's progress, assignments, and scores are tracked separately." },
  { q: 'What do XP and badges mean?', a: "XP (Experience Points) is earned when your child completes topics, assignments, and quizzes. Badges are awarded for milestones — like finishing a chapter or scoring 90%+. Both are shown in the Profile screen." },
  { q: 'How does the AI tutor work with my child?', a: "The AI Coach is a patient, encouraging tutor available 24/7. Your child asks questions in plain language. When they get a quiz answer wrong, the AI explains the concept in simpler terms and lets them retry — never just showing a red mark." },
  { q: 'How do I know if my child is struggling?', a: "The Progress screen flags topics with low scores. The Dashboard also surfaces a 'Needs Attention' summary. Assignments scored below 60% are automatically highlighted. You can also check recent AI Coach sessions." },
  { q: 'Can my child use the app without my supervision?', a: "Yes — Aivorah is designed for independent use. All content is curriculum-aligned and age-appropriate. The AI stays within the enrolled grade level and subject. You can review all activity in the Progress screen at any time." },
  { q: 'How do I update my child\'s grade or curriculum?', a: "Go to My Kids → tap the child → Edit Profile. You can update their grade level (Grade 3, 4, or 5) and curriculum (IB PYP, CBSE, ICSE, or Cambridge). Changes take effect immediately." },
  { q: 'How do I contact Aivorah support?', a: "Use the 'Submit Ticket' button below to send us a message, or chat with Aivorah 24/7 for instant answers. Our team responds to tickets within 24 hours on business days." },
];

const CHAT_SUGGESTIONS = [
  "How do I check my child's progress?",
  'How do I message the teacher?',
  'What is XP and how is it earned?',
  'How does AI grading work?',
  'Can I add assignments for my child?',
];

export default function ParentHelpScreen({ navigation }: any) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const firstName = user?.name?.split(' ')[0] || 'there';

  const [search,        setSearch]        = useState('');
  const [openFaq,       setOpenFaq]       = useState<number | null>(null);
  const [chatVisible,   setChatVisible]   = useState(false);
  const [ticketVisible, setTicketVisible] = useState(false);

  // Chat
  interface ChatMsg { id: number; role: 'user' | 'ai'; text: string; }
  const [chatInput,   setChatInput]   = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMsgs,    setChatMsgs]    = useState<ChatMsg[]>([
    { id: 0, role: 'ai', text: `Hi! I'm your Aivorah 24/7 Support Assistant. Ask me anything about monitoring your child's learning, assignments, progress, and more!` },
  ]);
  const chatScrollRef = useRef<ScrollView>(null);

  // Ticket
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);

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
    if (!subject) { Alert.alert('Required', 'Please enter a subject.'); return; }
    if (!message) { Alert.alert('Required', 'Please describe your issue.'); return; }
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
      Alert.alert('Ticket Submitted!', `We'll respond to ${user?.email || 'your email'} within 24 hours.`);
    } catch (err: any) {
      Alert.alert('Submission Failed', err?.message || 'Please try again.');
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
              <Feather name="help-circle" size={32} color={colors.primary} />
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

          {/* Still need help? — top */}
          <Text style={styles.sectionTitle}>Still need help?</Text>
          <View style={styles.supportRow}>
            <TouchableOpacity style={[styles.supportCard, styles.supportCardPrimary]} onPress={() => setChatVisible(true)} activeOpacity={0.7}>
              <View style={styles.supportIconWrap}>
                <Feather name="message-circle" size={24} color={colors.primary} />
              </View>
              <Text style={styles.supportTitle}>Aivorah 24/7</Text>
              <Text style={styles.supportSub}>Instant platform support</Text>
              <View style={styles.supportArrow}>
                <Feather name="arrow-right" size={14} color={colors.primary} />
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
                <Feather name={openFaq === i ? 'chevron-up' : 'chevron-down'} size={16} color={openFaq === i ? colors.primary : colors.textMuted} />
              </View>
              {openFaq === i && <Text style={styles.faqA}>{faq.a}</Text>}
            </TouchableOpacity>
          ))}

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
                  <View style={[styles.chatAiOrb, { backgroundColor: colors.primaryGlow }]}>
                    <Feather name="zap" size={16} color={colors.primary} />
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
                    ? [styles.chatBubbleUser, { backgroundColor: colors.primary }]
                    : [styles.chatBubbleAi, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]]}>
                    <Text style={[styles.chatBubbleTxt, { color: m.role === 'user' ? '#fff' : colors.textMain }]}>{m.text}</Text>
                  </View>
                ))}
                {chatLoading && (
                  <View style={[styles.chatBubble, styles.chatBubbleAi, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                )}
              </ScrollView>
              {chatMsgs.length <= 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chatSuggestScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingBottom: 8 }}>
                  {CHAT_SUGGESTIONS.map(s => (
                    <TouchableOpacity key={s} style={[styles.chatSuggestChip, { backgroundColor: colors.primaryGlow, borderColor: colors.primary + '40' }]} onPress={() => sendSupportMessage(s)} activeOpacity={0.7}>
                      <Text style={[styles.chatSuggestTxt, { color: colors.primary }]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <View style={[styles.chatInputRow, { borderTopColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                <TextInput
                  style={[styles.chatTextInput, { color: colors.textMain }]}
                  placeholder="Ask about your child's learning..."
                  placeholderTextColor={colors.textDim}
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={() => sendSupportMessage()}
                  returnKeyType="send"
                  editable={!chatLoading}
                />
                <TouchableOpacity
                  style={[styles.chatSendBtn, { backgroundColor: chatInput.trim() ? colors.primary : colors.borderColor }]}
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
                Submitting as: <Text style={{ color: colors.primary }}>{user?.email || 'guest'}</Text>
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
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  hero: { alignItems: 'center', paddingVertical: spacing.xxl, marginBottom: spacing.lg },
  heroIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.primaryGlow, borderWidth: 1, borderColor: c.primary + '40', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  heroTitle: { fontSize: 22, fontWeight: '800', color: c.textMain, textAlign: 'center', marginBottom: spacing.sm, letterSpacing: -0.5 },
  heroSub: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: spacing.xl, paddingHorizontal: spacing.xl },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: 28, paddingHorizontal: spacing.xl, height: 52, width: '100%' },
  searchInput: { flex: 1, fontSize: 14, color: c.textMain },
  searchResultCount: { fontSize: 12, color: c.textDim, marginTop: spacing.md },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: spacing.lg, marginTop: spacing.xl },
  emptyText: { fontSize: 14, color: c.textDim, fontStyle: 'italic', marginBottom: spacing.xl },

  faqItem: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  faqItemOpen: { borderColor: c.primary + '60' },
  faqHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  faqQWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  faqNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.primaryGlow, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  faqNumText: { fontSize: 11, fontWeight: '700', color: c.primary },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: c.textMain, lineHeight: 20, paddingTop: 4 },
  faqA: { fontSize: 13, color: c.textMuted, lineHeight: 21, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor },

  supportRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
  supportCard: { flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  supportCardPrimary: { borderColor: c.primary + '40', backgroundColor: c.primaryGlow },
  supportIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.primaryGlow, alignItems: 'center', justifyContent: 'center' },
  supportTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, textAlign: 'center' },
  supportSub: { fontSize: 11, color: c.textMuted, textAlign: 'center' },
  supportArrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.primaryGlow, alignItems: 'center', justifyContent: 'center' },

  versionRow: { alignItems: 'center', paddingTop: spacing.xl },
  versionText: { fontSize: 11, color: c.textDim },

  chatOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  chatBox: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, overflow: 'hidden', maxHeight: '85%' },
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
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
