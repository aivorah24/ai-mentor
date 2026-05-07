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
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import SERVER_URL from '../../config/serverUrl';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const FAQS = [
  {
    q: 'How do I start a new learning path?',
    a: 'Go to "My Learning Paths" in the sidebar, then select a subject. You\'ll see levels listed as locked, active, or completed. Tap "Start" on any available level to begin.',
  },
  {
    q: 'How are XP points and levels calculated?',
    a: 'XP is earned by completing lessons (+50 XP), assignments (+75 XP), and challenges (+100 XP). Your level increases as you accumulate XP — each level requires progressively more XP.',
  },
  {
    q: 'Can I change my study schedule?',
    a: 'Yes! Go to Schedule and tap the "+" button to add a new study session. You can set the title, time, duration, and color. Tap any event to delete it.',
  },
  {
    q: 'How does the AI Coach work?',
    a: 'The AI Coach uses your progress data to suggest topics, answer questions, and provide personalized learning help. Just type your question in the chat — it responds to anything from math problems to essay tips.',
  },
  {
    q: 'What happens if I miss an assignment deadline?',
    a: 'Overdue assignments move to the "Overdue" tab. You can still complete them — your teacher may apply a late penalty. Check the assignment details for the submission policy.',
  },
  {
    q: 'How do I maintain my daily streak?',
    a: 'Log in and complete at least one lesson or challenge every day. Your streak counter resets to 0 if you miss a day. Streaks earn bonus XP and unlock special badges.',
  },
  {
    q: 'Can I use Aivorah on multiple devices?',
    a: 'Yes! Sign in with the same account on any device — web browser, tablet, or phone. Your progress, XP, and settings sync automatically.',
  },
  {
    q: 'How do I change my avatar or profile photo?',
    a: 'Go to Profile in the sidebar. In the "Choose Avatar Style" section, pick any of the 6 avatar styles and tap "Save Avatar". Your new avatar will appear everywhere in the app.',
  },
  {
    q: 'Is my data private and secure?',
    a: 'Yes. All data is encrypted and stored securely via Supabase. We never sell your personal data. You can delete your account at any time from Settings → Delete Account.',
  },
  {
    q: 'How do I contact a human support agent?',
    a: 'Use the "Submit Ticket" button below to send us a message. Our support team typically responds within 24 hours on business days.',
  },
];

export default function HelpCenterScreen({ navigation }: any) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const TOPICS = [
    {
      label: 'Getting Started',
      icon: 'compass' as const,
      color: colors.accentPurple,
      desc: 'Platform basics, profile setup',
      screen: 'Profile',
      articles: [
        'How to set up your profile',
        'Choosing your role (Student / Teacher / Parent)',
        'Navigating the dashboard',
        'Setting your learning goal',
      ],
    },
    {
      label: 'Learning Paths',
      icon: 'map' as const,
      color: colors.accentBlue,
      desc: 'Understanding courses, levels',
      screen: 'LearningPaths',
      articles: [
        'Starting a new learning path',
        'Understanding levels (locked, active, complete)',
        'Switching between subjects',
        'Weekly focus and milestones',
      ],
    },
    {
      label: 'Assignments',
      icon: 'check-circle' as const,
      color: colors.accentGreen,
      desc: 'Submitting work, grading',
      screen: 'Assignments',
      articles: [
        'How to submit an assignment',
        'Understanding due dates',
        'Overdue assignment policy',
        'Viewing feedback from your teacher',
      ],
    },
    {
      label: 'Challenges & XP',
      icon: 'award' as const,
      color: colors.accentYellow,
      desc: 'Leaderboards, badges, streaks',
      screen: 'Challenges',
      articles: [
        'How XP points are calculated',
        'Understanding daily challenges',
        'Maintaining your streak',
        'Unlocking badges and achievements',
      ],
    },
    {
      label: 'AI Coach',
      icon: 'message-circle' as const,
      color: colors.accentCyan,
      desc: 'How to use AI features',
      screen: 'AICoach',
      articles: [
        'What the AI Coach can do',
        'Asking for help on a topic',
        'Getting personalized suggestions',
        'AI Coach limitations',
      ],
    },
    {
      label: 'Schedule',
      icon: 'calendar' as const,
      color: colors.primary,
      desc: 'Managing your time',
      screen: 'Schedule',
      articles: [
        'Adding study sessions',
        'Setting event reminders',
        'Viewing upcoming deadlines',
        'Syncing with your calendar',
      ],
    },
    {
      label: 'Progress & Stats',
      icon: 'trending-up' as const,
      color: colors.accentGreen,
      desc: 'Tracking scores and stats',
      screen: 'Progress',
      articles: [
        'Understanding your overall score',
        'Reading the weekly activity chart',
        'Subject performance breakdown',
        'What achievements mean',
      ],
    },
    {
      label: 'Account & Settings',
      icon: 'settings' as const,
      color: colors.textMuted,
      desc: 'Profile, security, preferences',
      screen: 'Settings',
      articles: [
        'Changing your email or password',
        'Managing notification preferences',
        'Switching app theme',
        'Deleting your account',
      ],
    },
  ];

  const ARTICLE_CONTENT: Record<string, string> = {
    // Getting Started
    'How to set up your profile': 'Go to Profile from the sidebar. Tap Edit to update your name, grade, avatar and learning preferences. Your profile helps Aivorah personalise your learning journey.',
    'Choosing your role (Student / Teacher / Parent)': 'Your role is set during signup. Students access learning paths and AI Coach. Teachers can assign work and track student progress. Parents can monitor their child\'s progress and add assignments.',
    'Navigating the dashboard': 'The Dashboard shows your daily goals, recent activity, badges, and quick links to your active learning paths. Use the sidebar (web) or drawer (mobile) to navigate between screens.',
    'Setting your learning goal': 'Go to Profile > Settings and set your daily study time goal. Aivorah will suggest a schedule and remind you when it\'s time to study.',
    // Learning Paths
    'Starting a new learning path': 'Go to My Learning Paths and tap "Explore Topics". Choose a subject and grade level. Your teacher may also assign a path directly to you.',
    'Understanding levels (locked, active, complete)': 'Each topic has Basic, Intermediate and Advanced levels. Complete Basic to unlock Intermediate. Levels lock again if you haven\'t practiced in a while — this keeps your knowledge fresh.',
    'Switching between subjects': 'From My Learning Paths, use the subject filter tabs at the top to switch between Maths, Science, English and more.',
    'Weekly focus and milestones': 'Each week Aivorah sets a focus topic based on your progress. Complete the week\'s milestone to earn bonus XP and a streak shield.',
    // Assignments
    'How to submit an assignment': 'Open Assignments, tap the assignment card, complete each question, then tap Submit. For drawing questions, use the canvas and tap Capture before submitting.',
    'Understanding due dates': 'Due dates appear on each assignment card and in your Schedule. Assignments due today are highlighted. You\'ll receive a notification 1 hour before deadline.',
    'Overdue assignment policy': 'Overdue assignments stay visible and can still be submitted. However, XP earned for late submissions is reduced by 50%. Talk to your teacher if you need an extension.',
    'Viewing feedback from your teacher': 'After submission, open the assignment and scroll to the Feedback section. Your teacher\'s comments and score appear here within 24 hours.',
    // Challenges & XP
    'How XP points are calculated': 'You earn XP for every activity: +10 for each correct answer, +25 for completing a lesson, +50 for finishing a learning path level, +100 for a challenge. Streaks multiply your XP by up to 2x.',
    'Understanding daily challenges': 'Daily challenges appear on your Dashboard each morning. They are short 5-question quizzes on recent topics. Complete them before midnight to maintain your streak.',
    'Maintaining your streak': 'Your streak increases by 1 each day you complete at least one activity. Miss a day and it resets to zero. You can use a Streak Shield (earned from milestones) to protect your streak for one missed day.',
    'Unlocking badges and achievements': 'Badges are awarded automatically when you hit milestones — first lesson, 7-day streak, top of leaderboard, and more. View all your badges on your Profile page.',
    // AI Coach
    'What the AI Coach can do': 'The AI Coach explains concepts in simple language, answers your questions, generates practice problems, and adapts to your level. It\'s like having a patient tutor available 24/7.',
    'Asking for help on a topic': 'Open AI Coach and type your question naturally — for example "I don\'t understand fractions" or "Explain photosynthesis simply". The Coach will break it down step by step.',
    'Getting personalized suggestions': 'The AI Coach tracks which topics you find difficult and proactively suggests practice. Look for the "Suggested for you" section at the top of the AI Coach screen.',
    'AI Coach limitations': 'The AI Coach is designed for school subjects (Maths, Science, English). It will not help with non-educational topics. For platform issues, use the 24/7 Support or Submit a Ticket.',
    // Schedule
    'Adding study sessions': 'Go to Schedule and tap the + button. Choose a subject, set the time and duration. Aivorah will send you a reminder when it\'s time to start.',
    'Setting event reminders': 'When adding a study session, toggle on Reminder and choose how many minutes before you\'d like to be notified.',
    'Viewing upcoming deadlines': 'The Schedule screen shows all assignment due dates and study sessions in a calendar view. Tap any event to see details.',
    'Syncing with your calendar': 'On web, go to Settings > Integrations to connect Google Calendar. Assignment due dates and study sessions will sync automatically.',
    // Progress
    'Understanding your overall score': 'Your overall score is a weighted average of XP earned, assignments completed, and challenge performance. It updates in real time as you complete activities.',
    'Reading the weekly activity chart': 'The bar chart on your Progress screen shows daily activity minutes for the past 7 days. Tap any bar to see a breakdown by subject.',
    'Subject performance breakdown': 'Scroll down on the Progress screen to see a card for each subject showing your completion percentage, average score, and areas that need more practice.',
    'What achievements mean': 'Achievements are permanent records of your best moments on Aivorah — first 100% score, longest streak, fastest lesson completion and more. They\'re shown on your public profile.',
    // Account & Settings
    'Changing your email or password': 'Go to Settings > Account. Tap Change Email or Change Password. You\'ll receive a verification email to confirm the change.',
    'Managing notification preferences': 'Go to Settings > Notifications. Toggle on or off: assignment reminders, streak alerts, badge notifications, and weekly progress reports.',
    'Switching app theme': 'Use the Theme selector at the bottom of the sidebar — choose Dark, Light, or Auto (follows your device setting).',
    'Deleting your account': 'Go to Settings > Account > Delete Account. This is permanent and removes all your data. If you\'re a student, inform your teacher first.',
  };

  const [search, setSearch] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTopic, setActiveTopic] = useState<typeof TOPICS[0] | null>(null);
  const [activeArticle, setActiveArticle] = useState<string | null>(null);
  const [ticketVisible, setTicketVisible] = useState(false);

  // Ticket form state
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);

  // 24/7 Support Chat
  interface ChatMsg { id: number; role: 'user' | 'ai'; text: string; }
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { id: 0, role: 'ai', text: `Hi! I'm your Aivorah 24/7 Support Assistant. Ask me anything about how the platform works — XP, streaks, badges, learning paths, and more!` },
  ]);
  const chatScrollRef = useRef<ScrollView>(null);

  const CHAT_SUGGESTIONS = [
    'What is XP and how do I earn it?',
    'How do streaks work?',
    'How do badges get unlocked?',
    'How does the AI Coach work?',
    'How to change my avatar?',
  ];

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
      const aiMsg: ChatMsg = { id: Date.now() + 1, role: 'ai', text: data.reply || data.error || 'Something went wrong.' };
      setChatMsgs(prev => [...prev, aiMsg]);
    } catch {
      setChatMsgs(prev => [...prev, { id: Date.now() + 1, role: 'ai', text: 'Could not reach support. Please try again.' }]);
    }
    setChatLoading(false);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const firstName = user?.name?.split(' ')[0] || 'there';

  const filteredTopics = useMemo(() =>
    TOPICS.filter((t) =>
      t.label.toLowerCase().includes(search.toLowerCase()) ||
      t.desc.toLowerCase().includes(search.toLowerCase()) ||
      t.articles.some((a) => a.toLowerCase().includes(search.toLowerCase()))
    ),
    [search, colors]
  );

  const filteredFaqs = useMemo(() =>
    FAQS.filter((f) =>
      search === '' ||
      f.q.toLowerCase().includes(search.toLowerCase()) ||
      f.a.toLowerCase().includes(search.toLowerCase())
    ),
    [search]
  );

  function handleTopicPress(topic: typeof TOPICS[0]) {
    setActiveTopic(topic);
  }

  function handleGoToScreen(screen: string) {
    setActiveTopic(null);
    navigation.navigate(screen);
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
        body: JSON.stringify({
          email: user?.email || '',
          subject,
          message,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not submit ticket. Please try again.');
      }

      setTicketVisible(false);
      setTicketSubject('');
      setTicketMessage('');
      Alert.alert(
        'Ticket Submitted! ✓',
        'Your support request has been received. We\'ll respond to ' + (user?.email || 'your email') + ' within 24 hours.',
        [{ text: 'OK' }]
      );
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
          searchPlaceholder="Search anything..."
          showBack={true}
          onBack={() => navigation.navigate('Profile')}
          onMenuPress={() => navigation.openDrawer()}
        />        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Search */}
          <View style={styles.hero}>
            <View style={styles.heroIconWrap}>
              <Feather name="help-circle" size={32} color={colors.primary} />
            </View>
            <Text style={styles.heroTitle}>How can we help you today?</Text>
            <Text style={styles.heroSub}>
              Find answers instantly. Search tutorials, troubleshooting guides, and learning tips.
            </Text>
            <View style={styles.searchBox}>
              <Feather name="search" size={16} color={colors.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search topics, questions, features..."
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
              <Text style={styles.searchResultCount}>
                {filteredTopics.length} topic{filteredTopics.length !== 1 ? 's' : ''} · {filteredFaqs.length} FAQ{filteredFaqs.length !== 1 ? 's' : ''}
              </Text>
            )}
          </View>


          {/* Still need help? — top section */}
          <Text style={styles.sectionTitle}>Still need help?</Text>
          <View style={styles.supportRow}>
            <TouchableOpacity
              style={[styles.supportCard, styles.supportCardPrimary]}
              onPress={() => setChatVisible(true)}
              activeOpacity={0.7}
            >
              <View style={styles.supportIconWrap}>
                <Feather name="message-circle" size={24} color={colors.primary} />
              </View>
              <Text style={styles.supportTitle}>Aivorah 24/7</Text>
              <Text style={styles.supportSub}>Instant platform support</Text>
              <View style={styles.supportArrow}>
                <Feather name="arrow-right" size={14} color={colors.primary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.supportCard}
              onPress={() => setTicketVisible(true)}
              activeOpacity={0.7}
            >
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

          {/* Browse Topics */}
          <Text style={styles.sectionTitle}>Browse Topics</Text>
          <View style={styles.topicsGrid}>
            {filteredTopics.map((t) => (
              <TouchableOpacity
                key={t.label}
                style={styles.topicCard}
                onPress={() => handleTopicPress(t)}
                activeOpacity={0.7}
              >
                <View style={[styles.topicIcon, { backgroundColor: t.color + '18' }]}>
                  <Feather name={t.icon} size={22} color={t.color} />
                </View>
                <Text style={styles.topicLabel}>{t.label}</Text>
                <Text style={styles.topicDesc}>{t.desc}</Text>
                <Text style={styles.topicArticleCount}>{t.articles.length} articles</Text>
              </TouchableOpacity>
            ))}
            {filteredTopics.length === 0 && (
              <Text style={styles.emptyText}>No topics match "{search}"</Text>
            )}
          </View>

          {/* FAQ */}
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {filteredFaqs.length === 0 && (
            <Text style={styles.emptyText}>No FAQs match "{search}"</Text>
          )}
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
                <Feather
                  name={openFaq === i ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={openFaq === i ? colors.primary : colors.textMuted}
                />
              </View>
              {openFaq === i && (
                <Text style={styles.faqA}>{faq.a}</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      {/* 24/7 Support Chat Modal */}
      <Modal visible={chatVisible} transparent animationType="slide" onRequestClose={() => setChatVisible(false)}>
        <KeyboardAvoidingView style={styles.chatOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.chatBox, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
            {/* Header */}
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

            {/* Messages */}
            <ScrollView
              ref={chatScrollRef}
              style={styles.chatMsgs}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              showsVerticalScrollIndicator={false}
            >
              {chatMsgs.map(m => (
                <View key={m.id} style={[
                  styles.chatBubble,
                  m.role === 'user'
                    ? [styles.chatBubbleUser, { backgroundColor: colors.primary }]
                    : [styles.chatBubbleAi, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }],
                ]}>
                  <Text style={[styles.chatBubbleTxt, { color: m.role === 'user' ? '#fff' : colors.textMain }]}>{m.text}</Text>
                </View>
              ))}
              {chatLoading && (
                <View style={[styles.chatBubble, styles.chatBubbleAi, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              )}
            </ScrollView>

            {/* Suggestions (show only at start) */}
            {chatMsgs.length <= 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chatSuggestScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingBottom: 8 }}>
                {CHAT_SUGGESTIONS.map(s => (
                  <TouchableOpacity key={s} style={[styles.chatSuggestChip, { backgroundColor: colors.primaryGlow, borderColor: colors.primary + '40' }]} onPress={() => sendSupportMessage(s)} activeOpacity={0.7}>
                    <Text style={[styles.chatSuggestTxt, { color: colors.primary }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Input */}
            <View style={[styles.chatInputRow, { borderTopColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
              <TextInput
                style={[styles.chatTextInput, { color: colors.textMain }]}
                placeholder="Ask about XP, streaks, badges..."
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

      {/* Topic Detail Modal */}
      <Modal visible={!!activeTopic} transparent animationType="fade" onRequestClose={() => setActiveTopic(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            {activeTopic && (
              <>
                <View style={styles.modalHeader}>
                  <View style={styles.modalTopicHeader}>
                    <View style={[styles.modalTopicIcon, { backgroundColor: activeTopic.color + '18' }]}>
                      <Feather name={activeTopic.icon} size={20} color={activeTopic.color} />
                    </View>
                    <Text style={styles.modalTitle}>{activeTopic.label}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setActiveTopic(null)}>
                    <Feather name="x" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalSubtitle}>{activeTopic.desc}</Text>

                <Text style={styles.modalArticlesLabel}>Articles in this topic</Text>
                {activeTopic.articles.map((article, i) => (
                  <View key={i}>
                    <TouchableOpacity
                      style={[styles.articleRow, activeArticle === article && { backgroundColor: activeTopic.color + '12', borderRadius: 10 }]}
                      activeOpacity={0.7}
                      onPress={() => setActiveArticle(activeArticle === article ? null : article)}
                    >
                      <Feather name={activeArticle === article ? 'book-open' : 'file-text'} size={14} color={activeArticle === article ? activeTopic.color : colors.textDim} />
                      <Text style={[styles.articleText, activeArticle === article && { color: activeTopic.color, fontWeight: '700' }]}>{article}</Text>
                      <Feather name={activeArticle === article ? 'chevron-down' : 'chevron-right'} size={14} color={activeArticle === article ? activeTopic.color : colors.textDim} />
                    </TouchableOpacity>
                    {activeArticle === article && ARTICLE_CONTENT[article] && (
                      <View style={[styles.articleContent, { borderLeftColor: activeTopic.color }]}>
                        <Text style={[styles.articleContentText, { color: colors.textMain }]}>{ARTICLE_CONTENT[article]}</Text>
                      </View>
                    )}
                  </View>
                ))}

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setActiveTopic(null)}>
                    <Text style={styles.modalCancelText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalSaveBtn, { backgroundColor: activeTopic.color }]}
                    onPress={() => handleGoToScreen(activeTopic.screen)}
                  >
                    <Text style={styles.modalSaveText}>Go to {activeTopic.label}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
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

            <Text style={styles.modalArticlesLabel}>Subject</Text>
            <View style={styles.ticketInput}>
              <TextInput
                style={styles.ticketTextInput}
                value={ticketSubject}
                onChangeText={setTicketSubject}
                placeholder="Brief summary of your issue"
                placeholderTextColor={colors.textDim}
                autoFocus
              />
            </View>

            <Text style={styles.modalArticlesLabel}>Describe your issue</Text>
            <View style={[styles.ticketInput, { height: 100, alignItems: 'flex-start', paddingTop: spacing.md }]}>
              <TextInput
                style={[styles.ticketTextInput, { textAlignVertical: 'top' }]}
                value={ticketMessage}
                onChangeText={setTicketMessage}
                placeholder="Please provide as much detail as possible..."
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setTicketVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSubmitTicket} disabled={ticketLoading}>
                {ticketLoading
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text style={styles.modalSaveText}>Submit Ticket</Text>
                }
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

  hero: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    marginBottom: spacing.lg,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: c.primaryGlow,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: c.textMain, textAlign: 'center', marginBottom: spacing.sm, letterSpacing: -0.5 },
  heroSub: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: spacing.xl, paddingHorizontal: spacing.xl },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: 28,
    paddingHorizontal: spacing.xl,
    height: 52,
    width: '100%',
  },
  searchInput: { flex: 1, fontSize: 14, color: c.textMain },
  searchResultCount: { fontSize: 12, color: c.textDim, marginTop: spacing.md },

  quickLinksRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl, flexWrap: 'wrap' },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  quickLinkText: { fontSize: 12, color: c.textMuted, fontWeight: '500' },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: spacing.lg, marginTop: spacing.xl },
  emptyText: { fontSize: 14, color: c.textDim, fontStyle: 'italic', marginBottom: spacing.xl },

  topicsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.sm },
  topicCard: {
    flex: 1,
    minWidth: '44%',
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  topicIcon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  topicLabel: { fontSize: 13, fontWeight: '700', color: c.textMain, textAlign: 'center' },
  topicDesc: { fontSize: 11, color: c.textMuted, textAlign: 'center' },
  topicArticleCount: { fontSize: 10, color: c.textDim, marginTop: 2 },

  faqItem: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  faqItemOpen: { borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.04)' },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  faqQWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, flex: 1 },
  faqNum: {
    minWidth: 28,
    height: 20,
    borderRadius: 10,
    backgroundColor: c.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  faqNumText: { fontSize: 10, fontWeight: '700', color: c.primary },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: c.textMain },
  faqA: { fontSize: 13, color: c.textMuted, marginTop: spacing.md, lineHeight: 21, paddingLeft: 36 },

  supportRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg },
  supportCard: {
    flex: 1,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  supportCardPrimary: { borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.05)' },
  supportIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  supportTitle: { fontSize: 14, fontWeight: '700', color: c.textMain },
  supportSub: { fontSize: 12, color: c.textMuted, textAlign: 'center' },
  supportArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },

  communityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: 'rgba(34,197,94,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  communityTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, marginBottom: 2 },
  communitySub: { fontSize: 12, color: c.textMuted, lineHeight: 18 },
  communityBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: c.accentGreen,
  },
  communityBtnText: { fontSize: 13, fontWeight: '700', color: 'white' },

  // 24/7 Chat Modal
  chatOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  chatBox: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, maxHeight: '80%', minHeight: 420 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  chatHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatAiOrb: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chatTitle: { fontSize: 15, fontWeight: '800' },
  chatSubtitle: { fontSize: 11, marginTop: 1 },
  chatMsgs: { flex: 1 },
  chatBubble: { maxWidth: '85%', borderRadius: 14, padding: 12, borderWidth: 1 },
  chatBubbleUser: { alignSelf: 'flex-end', borderColor: 'transparent' },
  chatBubbleAi: { alignSelf: 'flex-start' },
  chatBubbleTxt: { fontSize: 13, lineHeight: 20 },
  chatSuggestScroll: { maxHeight: 44 },
  chatSuggestChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chatSuggestTxt: { fontSize: 12, fontWeight: '600' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: 1 },
  chatTextInput: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.06)' },
  chatSendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 480,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  modalTopicHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modalTopicIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalSubtitle: { fontSize: 13, color: c.textMuted, marginBottom: spacing.xl },
  modalArticlesLabel: { fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.md, marginTop: spacing.md },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
  },
  articleText: { flex: 1, fontSize: 13, color: c.textMain },
  articleContent: {
    marginHorizontal: 4, marginBottom: 6, marginTop: 2,
    paddingHorizontal: 14, paddingVertical: 10,
    borderLeftWidth: 3, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  articleContentText: { fontSize: 13, lineHeight: 21 },
  ticketNote: { fontSize: 13, color: c.textMuted, marginBottom: spacing.sm },
  ticketInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 46,
  },
  ticketTextInput: { flex: 1, fontSize: 14, color: c.textMain, paddingVertical: spacing.md },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
