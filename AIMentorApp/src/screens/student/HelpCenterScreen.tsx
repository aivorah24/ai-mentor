import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import SERVER_URL from '../../config/serverUrl';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const FAQS = [
  { q: 'How do I start a new learning path?', a: 'Go to "My Learning Paths" in the sidebar, then select a subject. Tap "Start" on any available level to begin.' },
  { q: 'How are XP points and levels calculated?', a: 'XP is earned by completing lessons (+50 XP), assignments (+75 XP), and challenges (+100 XP). Your level increases as you accumulate XP.' },
  { q: 'Can I change my study schedule?', a: 'Yes! Go to Schedule and tap the "+" button to add a new study session. You can set the title, time, duration, and color.' },
  { q: 'How does the AI Coach work?', a: 'The AI Coach uses your progress data to suggest topics, answer questions, and provide personalised learning help. Just type your question in the chat.' },
  { q: 'What happens if I miss an assignment deadline?', a: 'Overdue assignments move to the "Overdue" tab. You can still complete them — XP earned for late submissions is reduced by 50%.' },
  { q: 'How do I maintain my daily streak?', a: 'Log in and complete at least one lesson or challenge every day. Your streak counter resets to 0 if you miss a day.' },
  { q: 'Can I use Aivorah on multiple devices?', a: 'Yes! Sign in with the same account on any device — web browser, tablet, or phone. Your progress syncs automatically.' },
  { q: 'How do I change my avatar or profile photo?', a: 'Go to Profile in the sidebar. In the "Choose Avatar Style" section, pick any style and tap "Save Avatar".' },
  { q: 'Is my data private and secure?', a: 'Yes. All data is encrypted and stored securely. We never sell your personal data. You can delete your account at any time from Settings.' },
  { q: 'How do I contact a human support agent?', a: 'Use the "Submit Ticket" button to send us a message. Our support team typically responds within 24 hours on business days.' },
];

const ARTICLE_CONTENT: Record<string, string> = {
  'How to set up your profile': 'Go to Profile from the sidebar. Tap Edit to update your name, grade, avatar and learning preferences.',
  'Choosing your role (Student / Teacher / Parent)': 'Your role is set during signup. Students access learning paths and AI Coach. Teachers can assign work and track progress.',
  'Navigating the dashboard': 'The Dashboard shows your daily goals, recent activity, badges, and quick links to your active learning paths.',
  'Setting your learning goal': 'Go to Profile > Settings and set your daily study time goal. Aivorah will suggest a schedule.',
  'Starting a new learning path': 'Go to My Learning Paths and tap "Explore Topics". Choose a subject and grade level.',
  'Understanding levels (locked, active, complete)': 'Each topic has Basic, Intermediate and Advanced levels. Complete Basic to unlock Intermediate.',
  'Switching between subjects': 'From My Learning Paths, use the subject filter tabs at the top to switch between subjects.',
  'Weekly focus and milestones': 'Each week Aivorah sets a focus topic based on your progress. Complete the week\'s milestone to earn bonus XP.',
  'How to submit an assignment': 'Open Assignments, tap the assignment card, complete each question, then tap Submit.',
  'Understanding due dates': 'Due dates appear on each assignment card and in your Schedule. Assignments due today are highlighted.',
  'Overdue assignment policy': 'Overdue assignments stay visible and can still be submitted. XP for late submissions is reduced by 50%.',
  'Viewing feedback from your teacher': 'After submission, open the assignment and scroll to the Feedback section.',
  'How XP points are calculated': 'You earn XP for every activity: +10 per correct answer, +25 per lesson, +50 per level, +100 per challenge.',
  'Understanding daily challenges': 'Daily challenges appear on your Dashboard each morning — 5-question quizzes on recent topics.',
  'Maintaining your streak': 'Your streak increases by 1 each day you complete at least one activity. Miss a day and it resets to zero.',
  'Unlocking badges and achievements': 'Badges are awarded automatically when you hit milestones — first lesson, 7-day streak, leaderboard, and more.',
  'What the AI Coach can do': 'The AI Coach explains concepts, answers questions, generates practice problems, and adapts to your level.',
  'Asking for help on a topic': 'Open AI Coach and type your question naturally — for example "I don\'t understand fractions".',
  'Getting personalized suggestions': 'The AI Coach tracks which topics you find difficult and proactively suggests practice.',
  'AI Coach limitations': 'The AI Coach is designed for school subjects. For platform issues, use the 24/7 Support or Submit a Ticket.',
  'Adding study sessions': 'Go to Schedule and tap the + button. Choose a subject, set the time and duration.',
  'Setting event reminders': 'When adding a study session, toggle on Reminder and choose how many minutes before you\'d like to be notified.',
  'Viewing upcoming deadlines': 'The Schedule screen shows all assignment due dates and study sessions in a calendar view.',
  'Syncing with your calendar': 'On web, go to Settings > Integrations to connect Google Calendar.',
  'Understanding your overall score': 'Your overall score is a weighted average of XP earned, assignments completed, and challenge performance.',
  'Reading the weekly activity chart': 'The bar chart on your Progress screen shows daily activity minutes for the past 7 days.',
  'Subject performance breakdown': 'Scroll down on the Progress screen to see a card for each subject showing completion percentage.',
  'What achievements mean': 'Achievements are permanent records of your best moments on Aivorah.',
  'Changing your email or password': 'Go to Settings > Account. Tap Change Email or Change Password.',
  'Managing notification preferences': 'Go to Settings > Notifications. Toggle on or off various notification types.',
  'Switching app theme': 'Use the Theme selector at the bottom of the sidebar — choose Dark, Light, or Auto.',
  'Deleting your account': 'Go to Settings > Account > Delete Account. This is permanent and removes all your data.',
};

export default function HelpCenterScreen({ navigation }: any) {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const TOPICS = [
    { label: 'Account & Profile', icon: 'user' as const,         color: colors.accentYellow,       desc: 'Profile, security, preferences',  screen: 'Settings',       articles: ['How to set up your profile', 'Choosing your role (Student / Teacher / Parent)', 'Navigating the dashboard', 'Setting your learning goal'] },
    { label: 'XP & Streaks',      icon: 'award' as const,        color: colors.accentYellow,  desc: 'Points, levels, daily streaks',   screen: 'Challenges',     articles: ['How XP points are calculated', 'Understanding daily challenges', 'Maintaining your streak', 'Unlocking badges and achievements'] },
    { label: 'Badges',            icon: 'shield' as const,       color: colors.accentYellow,       desc: 'Achievements and milestones',     screen: 'Challenges',     articles: ['Unlocking badges and achievements', 'What achievements mean', 'How XP points are calculated', 'Understanding daily challenges'] },
    { label: 'Learning Paths',    icon: 'map' as const,          color: colors.accentYellow,  desc: 'Courses, levels, subjects',       screen: 'LearningPaths',  articles: ['Starting a new learning path', 'Understanding levels (locked, active, complete)', 'Switching between subjects', 'Weekly focus and milestones'] },
    { label: 'Billing & Plans',   icon: 'credit-card' as const,  color: colors.accentYellow,       desc: 'Subscriptions, upgrades',         screen: 'Subscription',   articles: ['How XP points are calculated', 'What the AI Coach can do', 'Getting personalized suggestions', 'AI Coach limitations'] },
    { label: 'Technical Support', icon: 'tool' as const,         color: colors.accentYellow,  desc: 'Bugs, troubleshooting',           screen: 'Profile',        articles: ['Can I use Aivorah on multiple devices?', 'Changing your email or password', 'Managing notification preferences', 'Deleting your account'] },
    { label: 'Assignments',       icon: 'check-circle' as const, color: colors.accentYellow,       desc: 'Submitting work, grading',        screen: 'Assignments',    articles: ['How to submit an assignment', 'Understanding due dates', 'Overdue assignment policy', 'Viewing feedback from your teacher'] },
    { label: 'AI Coach',          icon: 'message-circle' as const, color: colors.accentYellow, desc: 'How to use AI features',         screen: 'AICoach',        articles: ['What the AI Coach can do', 'Asking for help on a topic', 'Getting personalized suggestions', 'AI Coach limitations'] },
  ];

  const [search, setSearch] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTopic, setActiveTopic] = useState<typeof TOPICS[0] | null>(null);
  const [activeArticle, setActiveArticle] = useState<string | null>(null);
  const [ticketVisible, setTicketVisible] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);

  interface ChatMsg { id: number; role: 'user' | 'ai'; text: string; time: string; }
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  function nowTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { id: 0, role: 'ai', text: `Hi! I'm your Aivorah 24/7 Support Assistant. Ask me anything about how the platform works — XP, streaks, badges, learning paths, and more!`, time: nowTime() },
  ]);
  const chatScrollRef = useRef<ScrollView>(null);

  const CHAT_SUGGESTIONS = ['About XP', 'About badges', 'Learning paths', 'How XP works?', 'Daily streaks'];

  const firstName = user?.name?.split(' ')[0] || 'there';

  async function sendSupportMessage(text?: string) {
    const msg = (text ?? chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    const userMsg: ChatMsg = { id: Date.now(), role: 'user', text: msg, time: nowTime() };
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
      const aiMsg: ChatMsg = { id: Date.now() + 1, role: 'ai', text: data.reply || data.error || 'Something went wrong.', time: nowTime() };
      setChatMsgs(prev => [...prev, aiMsg]);
    } catch {
      setChatMsgs(prev => [...prev, { id: Date.now() + 1, role: 'ai', text: 'Could not reach support. Please try again.', time: nowTime() }]);
    }
    setChatLoading(false);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const filteredTopics = useMemo(() =>
    TOPICS.filter(t =>
      t.label.toLowerCase().includes(search.toLowerCase()) ||
      t.desc.toLowerCase().includes(search.toLowerCase()) ||
      t.articles.some(a => a.toLowerCase().includes(search.toLowerCase()))
    ), [search, colors]);

  const filteredFaqs = useMemo(() =>
    FAQS.filter(f =>
      search === '' ||
      f.q.toLowerCase().includes(search.toLowerCase()) ||
      f.a.toLowerCase().includes(search.toLowerCase())
    ), [search]);

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
      setTicketSubject(''); setTicketMessage('');
      Alert.alert('Ticket Submitted', `We'll respond to ${user?.email || 'your email'} within 24 hours.`, [{ text: 'OK' }]);
    } catch (err: any) {
      Alert.alert('Submission Failed', err?.message || 'Could not submit ticket. Please try again.');
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
          showBack
          onBack={() => navigation.goBack()}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Landing-style hero header */}
          <View style={styles.heroSection}>
            <View style={styles.heroPill}>
              <View style={styles.heroPillDot} />
              <Text style={styles.heroPillText}>HELP CENTER · AIVORAH</Text>
            </View>
            <Text style={styles.heroHeadline}>How can we{'\n'}help you?</Text>
          </View>

          {/* Search */}
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={colors.textDim} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search topics, questions..."
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
            <Text style={styles.searchCount}>{filteredTopics.length} topic{filteredTopics.length !== 1 ? 's' : ''} · {filteredFaqs.length} FAQ{filteredFaqs.length !== 1 ? 's' : ''}</Text>
          )}

          {/* Still need help? */}
          <Text style={styles.sectionTitle}>Still need help?</Text>
          <View style={styles.supportRow}>
            {/* Chat card */}
            <TouchableOpacity style={[styles.supportCard, styles.supportCardChat]} onPress={() => setChatVisible(true)} activeOpacity={0.75}>
              <View style={styles.supportCardInner}>
                <Text style={styles.supportCardTitle}>Chat with Aivorah 24/7</Text>
                <Text style={styles.supportCardSub}>Get instant answers about{'\n'}XP, streaks, badges,{'\n'}learning paths & more.</Text>
                <View style={[styles.supportArrowBtn, { backgroundColor: colors.accentYellow + 'CC' }]}>
                  <Feather name="arrow-right" size={16} color={isDark ? '#0B140F' : '#fff'} />
                </View>
              </View>
              {/* Owl decoration */}
              <View style={styles.owlWrap}>
                <View style={styles.owlCircle}>
                  <Feather name="zap" size={28} color={colors.accentYellow} />
                </View>
              </View>
            </TouchableOpacity>

            {/* Ticket card */}
            <TouchableOpacity style={[styles.supportCard, styles.supportCardTicket]} onPress={() => setTicketVisible(true)} activeOpacity={0.75}>
              <View style={styles.ticketIconWrap}>
                <Feather name="mail" size={28} color={colors.textMuted} />
              </View>
              <Text style={styles.supportCardTitle}>Submit a Ticket</Text>
              <Text style={styles.supportCardSub}>We'll reply within 24h</Text>
              <View style={[styles.supportArrowBtn, { backgroundColor: colors.accentYellow + '20', borderWidth: 1, borderColor: colors.accentYellow + '40' }]}>
                <Feather name="arrow-right" size={16} color={colors.accentYellow} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Browse Topics */}
          <Text style={styles.sectionTitle}>Browse Topics</Text>
          <View style={styles.topicsGrid}>
            {filteredTopics.map(t => (
              <TouchableOpacity key={t.label} style={[styles.topicRow, { borderColor: colors.borderColor }]} onPress={() => setActiveTopic(t)} activeOpacity={0.7}>
                <View style={[styles.topicIcon, { backgroundColor: t.color + '18' }]}>
                  <Feather name={t.icon} size={18} color={t.color} />
                </View>
                <Text style={styles.topicLabel}>{t.label}</Text>
                <Feather name="chevron-right" size={16} color={colors.textDim} style={{ marginLeft: 'auto' as any }} />
              </TouchableOpacity>
            ))}
            {filteredTopics.length === 0 && <Text style={styles.emptyText}>No topics match "{search}"</Text>}
          </View>

          {/* FAQs */}
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {filteredFaqs.length === 0 && <Text style={styles.emptyText}>No FAQs match "{search}"</Text>}
          {filteredFaqs.map((faq, i) => (
            <TouchableOpacity key={i} style={[styles.faqItem, openFaq === i && { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '06' }]} onPress={() => setOpenFaq(openFaq === i ? null : i)} activeOpacity={0.7}>
              <View style={styles.faqHeader}>
                <View style={[styles.faqNum, { backgroundColor: colors.accentYellow + '22' }]}>
                  <Text style={[styles.faqNumText, { color: colors.accentYellow }]}>{String(i + 1).padStart(2, '0')}</Text>
                </View>
                <Text style={[styles.faqQ, { color: colors.textMain }]}>{faq.q}</Text>
                <Feather name={openFaq === i ? 'chevron-up' : 'chevron-down'} size={16} color={openFaq === i ? colors.accentYellow : colors.textMuted} />
              </View>
              {openFaq === i && <Text style={[styles.faqA, { color: colors.textMuted }]}>{faq.a}</Text>}
            </TouchableOpacity>
          ))}

        </ScrollView>

        {/* ── 24/7 Chat Modal ── */}
        <Modal visible={chatVisible} transparent animationType="slide" onRequestClose={() => setChatVisible(false)}>
          <KeyboardAvoidingView style={styles.chatOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.chatBox, { backgroundColor: isDark ? '#0B0B0B' : '#F5F3EE', borderColor: colors.borderColor }]}>

              {/* Chat header */}
              <View style={[styles.chatHeader, { borderBottomColor: colors.borderColor }]}>
                <View style={styles.chatHeaderLeft}>
                  <View style={styles.chatAvatar}>
                    <Feather name="zap" size={16} color={colors.accentYellow} />
                    <View style={styles.onlineDot} />
                  </View>
                  <View>
                    <Text style={[styles.chatTitle, { color: colors.textMain }]}>Aivorah 24/7</Text>
                    <Text style={[styles.chatSubtitle, { color: colors.accentYellow }]}>Your AI support assistant</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setChatVisible(false)} style={styles.chatCloseBtn}>
                  <Feather name="x" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Messages */}
              <ScrollView ref={chatScrollRef} style={styles.chatMsgs} contentContainerStyle={styles.chatMsgsContent} showsVerticalScrollIndicator={false}>
                {chatMsgs.map((m, idx) => {
                  const isFirst = idx === 0 && m.role === 'ai';
                  if (isFirst) {
                    return (
                      <View key={m.id} style={styles.firstMsgWrap}>
                        {/* Owl mascot */}
                        <View style={styles.mascotWrap}>
                          <View style={styles.mascotCircle}>
                            <Feather name="zap" size={36} color={colors.accentYellow} />
                          </View>
                        </View>
                        <View style={[styles.firstMsgBubble, { backgroundColor: isDark ? '#141414' : '#fff', borderColor: colors.borderColor }]}>
                          <Text style={[styles.firstMsgTitle, { color: colors.textMain }]}>Hi! I'm your Aivorah 24/7{'\n'}Support Assistant.</Text>
                          <Text style={[styles.firstMsgBody, { color: colors.textMuted }]}>{m.text.replace("Hi! I'm your Aivorah 24/7 Support Assistant. ", '')}</Text>
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View key={m.id} style={[styles.msgRow, m.role === 'user' ? styles.msgRowUser : styles.msgRowAi]}>
                      {m.role === 'ai' && (
                        <View style={styles.msgAvatar}>
                          <Feather name="zap" size={10} color="#fff" />
                        </View>
                      )}
                      <View style={{ maxWidth: '72%' }}>
                        <View style={[
                          styles.msgBubble,
                          m.role === 'user'
                            ? [styles.msgBubbleUser, { backgroundColor: colors.accentYellow }]
                            : [styles.msgBubbleAi, { backgroundColor: isDark ? '#141414' : '#fff', borderColor: colors.borderColor }],
                        ]}>
                          <Text style={[styles.msgText, { color: m.role === 'user' ? '#fff' : colors.textMain }]}>{m.text}</Text>
                        </View>
                        <Text style={[styles.msgTime, { color: colors.textDim, textAlign: m.role === 'user' ? 'right' : 'left' }]}>{m.time}</Text>
                      </View>
                    </View>
                  );
                })}
                {chatLoading && (
                  <View style={[styles.msgRow, styles.msgRowAi]}>
                    <View style={styles.msgAvatar}>
                      <Feather name="zap" size={10} color={colors.accentYellow} />
                    </View>
                    <View style={[styles.msgBubble, styles.msgBubbleAi, { backgroundColor: isDark ? '#141414' : '#fff', borderColor: colors.borderColor }]}>
                      <ActivityIndicator size="small" color={colors.accentYellow} />
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* Suggestion chips — always visible */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestScroll} contentContainerStyle={styles.suggestContent}>
                {CHAT_SUGGESTIONS.map(s => (
                  <TouchableOpacity key={s} style={styles.suggestChip} onPress={() => sendSupportMessage(s)} activeOpacity={0.7} disabled={chatLoading}>
                    <Feather name="zap" size={11} color={colors.accentYellow} />
                    <Text style={[styles.suggestChipText, { color: colors.textMain }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Input */}
              <View style={[styles.chatInputRow, { borderTopColor: colors.borderColor, backgroundColor: isDark ? '#0B0B0B' : '#F5F3EE' }]}>
                <Feather name="star" size={16} color={colors.accentYellow} style={{ marginHorizontal: 4 }} />
                <TextInput
                  style={[styles.chatTextInput, { color: colors.textMain, backgroundColor: isDark ? '#141414' : '#fff', borderColor: colors.borderColor }]}
                  placeholder="Ask about XP, streaks, badges..."
                  placeholderTextColor={colors.textDim}
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={() => sendSupportMessage()}
                  returnKeyType="send"
                  editable={!chatLoading}
                />
                <TouchableOpacity
                  style={[styles.chatSendBtn, { backgroundColor: chatInput.trim() ? colors.accentYellow : colors.borderColor }]}
                  onPress={() => sendSupportMessage()}
                  disabled={!chatInput.trim() || chatLoading}
                  activeOpacity={0.8}
                >
                  <Feather name="send" size={15} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── Topic Detail Modal ── */}
        <Modal visible={!!activeTopic} transparent animationType="fade" onRequestClose={() => setActiveTopic(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
              {activeTopic && (
                <>
                  <View style={styles.modalHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                      <View style={[styles.modalTopicIcon, { backgroundColor: activeTopic.color + '18' }]}>
                        <Feather name={activeTopic.icon} size={20} color={activeTopic.color} />
                      </View>
                      <Text style={[styles.modalTitle, { color: colors.textMain }]}>{activeTopic.label}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setActiveTopic(null)}>
                      <Feather name="x" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>{activeTopic.desc}</Text>
                  <Text style={[styles.modalArticlesLabel, { color: colors.textDim }]}>Articles in this topic</Text>
                  {activeTopic.articles.map((article, i) => (
                    <View key={i}>
                      <TouchableOpacity
                        style={[styles.articleRow, { borderBottomColor: colors.borderColor }, activeArticle === article && { backgroundColor: activeTopic.color + '12', borderRadius: 10 }]}
                        onPress={() => setActiveArticle(activeArticle === article ? null : article)}
                        activeOpacity={0.7}
                      >
                        <Feather name={activeArticle === article ? 'book-open' : 'file-text'} size={14} color={activeArticle === article ? activeTopic.color : colors.textDim} />
                        <Text style={[styles.articleText, { color: colors.textMain }, activeArticle === article && { color: activeTopic.color, fontWeight: '700' }]}>{article}</Text>
                        <Feather name={activeArticle === article ? 'chevron-down' : 'chevron-right'} size={14} color={activeArticle === article ? activeTopic.color : colors.textDim} />
                      </TouchableOpacity>
                      {activeArticle === article && ARTICLE_CONTENT[article] && (
                        <View style={[styles.articleContent, { borderLeftColor: activeTopic.color, backgroundColor: 'rgba(255,255,255,0.04)' }]}>
                          <Text style={[styles.articleContentText, { color: colors.textMain }]}>{ARTICLE_CONTENT[article]}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                  <View style={styles.modalBtns}>
                    <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: colors.borderColor }]} onPress={() => setActiveTopic(null)}>
                      <Text style={[styles.modalCancelText, { color: colors.textMuted }]}>Close</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: activeTopic.color }]} onPress={() => { setActiveTopic(null); navigation.navigate(activeTopic.screen); }}>
                      <Text style={styles.modalSaveText}>Go to {activeTopic.label}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* ── Submit Ticket Modal ── */}
        <Modal visible={ticketVisible} transparent animationType="fade" onRequestClose={() => setTicketVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.textMain }]}>Submit Support Ticket</Text>
                <TouchableOpacity onPress={() => setTicketVisible(false)}>
                  <Feather name="x" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.ticketNote, { color: colors.textMuted }]}>Submitting as: <Text style={{ color: colors.accentYellow }}>{user?.email || 'guest'}</Text></Text>
              <Text style={[styles.modalArticlesLabel, { color: colors.textDim }]}>Subject</Text>
              <View style={[styles.ticketInput, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                <TextInput style={[styles.ticketTextInput, { color: colors.textMain }]} value={ticketSubject} onChangeText={setTicketSubject} placeholder="Brief summary of your issue" placeholderTextColor={colors.textDim} autoFocus />
              </View>
              <Text style={[styles.modalArticlesLabel, { color: colors.textDim }]}>Describe your issue</Text>
              <View style={[styles.ticketInput, { height: 100, alignItems: 'flex-start', paddingTop: spacing.md, borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                <TextInput style={[styles.ticketTextInput, { color: colors.textMain, textAlignVertical: 'top' }]} value={ticketMessage} onChangeText={setTicketMessage} placeholder="Please provide as much detail as possible..." placeholderTextColor={colors.textDim} multiline numberOfLines={4} />
              </View>
              <View style={styles.modalBtns}>
                <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: colors.borderColor }]} onPress={() => setTicketVisible(false)}>
                  <Text style={[styles.modalCancelText, { color: colors.textMuted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: colors.accentYellow }]} onPress={handleSubmitTicket} disabled={ticketLoading}>
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

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 960, alignSelf: 'center', width: '100%' },

  // Hero
  heroSection: { paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: 14 },
  heroPill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: c.accentYellow + '50', backgroundColor: c.accentYellow + '10' },
  heroPillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.accentYellow },
  heroPillText: { fontSize: 10, fontWeight: '700', color: c.accentYellow, letterSpacing: 1.2 },
  heroHeadline: { fontSize: 40, fontWeight: '700', color: c.textMain, lineHeight: 48, fontFamily: fonts.serif, letterSpacing: -0.5 },

  // Search
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: 28, paddingHorizontal: spacing.xl, height: 52, marginBottom: spacing.sm },
  searchInput: { flex: 1, fontSize: 14, color: c.textMain, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  searchCount: { fontSize: 12, color: c.textDim, marginBottom: spacing.md, marginLeft: 4 },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: c.textMain, marginTop: spacing.xl, marginBottom: spacing.md, fontFamily: fonts.serif },

  // Support cards
  supportRow: { flexDirection: 'row', gap: spacing.md },
  supportCard: { flex: 1, borderRadius: radius.xl, padding: spacing.xl, overflow: 'hidden', minHeight: 180 },
  supportCardChat: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.accentYellow + '30' },
  supportCardTicket: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, alignItems: 'flex-start', justifyContent: 'space-between' },
  supportCardInner: { flex: 1, gap: 8, zIndex: 1 },
  supportCardTitle: { fontSize: 16, fontWeight: '800', color: c.textMain, fontFamily: fonts.serif },
  supportCardSub: { fontSize: 12, color: isDark ? 'rgba(245,243,238,0.55)' : c.textMuted, lineHeight: 18 },
  supportArrowBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 8, alignSelf: 'flex-start' },
  owlWrap: { position: 'absolute', bottom: 0, right: 0, width: 90, height: 90, alignItems: 'center', justifyContent: 'center' },
  owlCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: isDark ? '#1E1E1E' : '#2A2A2A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.accentYellow + '40' },
  ticketIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.bgDark, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },

  // Topics
  topicsGrid: { gap: 0, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden', marginBottom: spacing.sm },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 15, backgroundColor: c.cardDark, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  topicIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  topicLabel: { fontSize: 14, fontWeight: '600', color: isDark ? '#F5F3EE' : c.textMain, flex: 1 },
  emptyText: { fontSize: 14, color: c.textDim, fontStyle: 'italic', padding: spacing.lg },

  // FAQs
  faqItem: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  faqHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  faqNum: { minWidth: 28, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  faqNumText: { fontSize: 10, fontWeight: '700' },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  faqA: { fontSize: 13, lineHeight: 21, marginTop: spacing.md, paddingLeft: 36 },

  // Chat modal
  chatOverlay: {
    flex: 1,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: Platform.OS === 'web' ? 24 : 0,
  },
  chatBox: {
    borderRadius: Platform.OS === 'web' ? 20 : undefined,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: Platform.OS === 'web' ? 1 : 0,
    maxHeight: Platform.OS === 'web' ? 620 : ('82%' as any),
    minHeight: 440,
    ...(Platform.OS === 'web' ? { width: '100%', maxWidth: 560 } as any : {}),
    overflow: 'hidden',
  },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1 },
  chatHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chatAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: isDark ? '#1E1E1E' : '#2A2A2A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.accentYellow + '50' },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentYellow, borderWidth: 2, borderColor: isDark ? '#0B0B0B' : '#F5F3EE' },
  chatTitle: { fontSize: 15, fontWeight: '800', fontFamily: fonts.serif },
  chatSubtitle: { fontSize: 11, marginTop: 1 },
  chatCloseBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
  chatMsgs: { flex: 1 },
  chatMsgsContent: { padding: 16, gap: 12 },

  // First message — mascot + speech bubble
  firstMsgWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginBottom: 4 },
  mascotWrap: { flexShrink: 0 },
  mascotCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: isDark ? '#1E1E1E' : '#2A2A2A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.accentYellow + '40' },
  firstMsgBubble: { flex: 1, borderRadius: 16, borderTopLeftRadius: 4, padding: 14, borderWidth: 1, gap: 6 },
  firstMsgTitle: { fontSize: 14, fontWeight: '800', lineHeight: 21, fontFamily: fonts.serif },
  firstMsgBody: { fontSize: 13, lineHeight: 19 },

  // Regular messages
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowAi: { justifyContent: 'flex-start' },
  msgAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: isDark ? '#1E1E1E' : '#2A2A2A', borderWidth: 1, borderColor: c.accentYellow + '40', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  msgBubble: { borderRadius: 16, padding: 11, paddingHorizontal: 14, borderWidth: 1 },
  msgBubbleUser: { borderTopRightRadius: 4, borderColor: 'transparent' },
  msgBubbleAi: { borderTopLeftRadius: 4 },
  msgText: { fontSize: 13, lineHeight: 20 },
  msgTime: { fontSize: 10, color: c.textDim, marginTop: 3, paddingHorizontal: 2 },

  // Suggestions
  suggestScroll: { maxHeight: 48, borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
  suggestContent: { gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  suggestChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: c.accentYellow + '40', backgroundColor: c.accentYellow + '0D' },
  suggestChipText: { fontSize: 12, fontWeight: '600', color: c.textMain },

  // Input
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderTopWidth: 1 },
  chatTextInput: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, maxHeight: 80 },
  chatSendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: { borderWidth: 1, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxWidth: 480 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  modalTopicIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalSubtitle: { fontSize: 13, marginBottom: spacing.xl },
  modalArticlesLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.md, marginTop: spacing.md },
  articleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11, borderBottomWidth: 1 },
  articleText: { flex: 1, fontSize: 13 },
  articleContent: { marginHorizontal: 4, marginBottom: 6, marginTop: 2, paddingHorizontal: 14, paddingVertical: 10, borderLeftWidth: 3, borderRadius: 6 },
  articleContentText: { fontSize: 13, lineHeight: 21 },
  ticketNote: { fontSize: 13, marginBottom: spacing.sm },
  ticketInput: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, minHeight: 46 },
  ticketTextInput: { flex: 1, fontSize: 14, paddingVertical: spacing.md },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600' },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
