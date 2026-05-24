import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
  Modal,
  Dimensions,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useStudentData } from '../../context/StudentDataContext';
import { askAIMentorStream, type ChatHistoryTurn, type AskImage } from '../../services/aiMentorApi';
import SERVER_URL from '../../config/serverUrl';

interface Message {
  id: number;
  role: 'user' | 'ai';
  text: string;
  isError?: boolean;
  images?: AskImage[];
}

function sanitizeDisplayedAIText(text: string): string {
  return String(text || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\r/g, '')
    .replace(/\s+(Step\s*\d+[\s:→–])/g, '\n$1')
    .replace(/\s+(Answer\s*:)/gi, '\n$1')
    .replace(/\s+(Try this\s*:|Now,?\s*can you|Here'?s? a practice)/gi, '\n$1')
    .replace(/\bkeyboards and mice\b/gi, 'keyboards and a mouse')
    .replace(/\bmice\b(?=.*computer|\b)/gi, 'mouse');
}

const FALLBACK_SUGGESTIONS: Record<string, string[]> = {
  'Grade 3': ['What is colour theory?', 'How do we add numbers?', 'What is internet safety?', 'What is rhythm and beat?', 'How do plants grow?'],
  'Grade 4': ['What are fractions?', 'How does the water cycle work?', 'What is a food chain?', 'What are adjectives?', 'How does electricity work?'],
  'Grade 5': ['What is photosynthesis?', 'How do decimals work?', 'What are ecosystems?', 'What is force and motion?', 'How does the human body work?'],
};

// Animated thinking shimmer
function ThinkingIndicator({ colors }: { colors: AppColors }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(shimmer, { toValue: 0.3, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 4 }}>
      <Animated.View style={{
        width: 18, height: 18, borderRadius: 9,
        backgroundColor: colors.primary,
        opacity: shimmer,
      }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="zap" size={10} color="#fff" />
        </View>
      </Animated.View>
      <Animated.Text style={{ fontSize: 13, color: colors.textMuted, opacity: shimmer, fontWeight: '500' }}>
        Aivorah is thinking...
      </Animated.Text>
    </View>
  );
}

// Render markdown-style AI text with bullets, bold, and structure
function renderFormattedAIText(text: string, colors: AppColors) {
  const lines = text.split('\n').filter(l => l.trim());
  return (
    <View style={{ gap: 5 }}>
      {lines.map((line, li) => {
        const trimmed = line.trim();
        const isStep = /^step\s*\d+[:.]/i.test(trimmed);
        const isAnswer = /^answer[:.]/i.test(trimmed);
        const isPractice = /^(try this|practice|here is a question|question)[:.]/i.test(trimmed);
        const isOption = /^[A-D][).]/.test(trimmed);
        const isBullet = /^[-•]\s/.test(trimmed);
        const isNumbered = /^\d+[.)]\s/.test(trimmed);

        const parts = trimmed.replace(/^[-•]\s+/, '').replace(/^\d+[.)]\s+/, '');
        const boldRegex = /\*\*(.*?)\*\*/g;
        const segments: { text: string; bold: boolean }[] = [];
        let lastIdx = 0;
        let match;
        const source = isBullet || isNumbered ? parts : trimmed;
        while ((match = boldRegex.exec(source)) !== null) {
          if (match.index > lastIdx) segments.push({ text: source.slice(lastIdx, match.index), bold: false });
          segments.push({ text: match[1], bold: true });
          lastIdx = match.index + match[0].length;
        }
        if (lastIdx < source.length) segments.push({ text: source.slice(lastIdx), bold: false });

        return (
          <View key={li} style={{ flexDirection: 'row', paddingLeft: (isBullet || isNumbered || isOption) ? 14 : 0, marginTop: (isStep || isAnswer || isPractice) && li > 0 ? 8 : 2 }}>
            {(isBullet || isNumbered) && (
              <Text style={{ fontSize: 15, color: colors.textMuted, marginRight: 6, lineHeight: 24 }}>
                {isNumbered ? trimmed.match(/^\d+[.)]/)?.[0] || '•' : '•'}
              </Text>
            )}
            <Text style={[
              { fontSize: 15, color: colors.textMain, lineHeight: 24, flex: 1 },
              isStep && { fontWeight: '700', color: colors.primary },
              isAnswer && { fontWeight: '700', color: '#4A9E70' },
              isPractice && { fontWeight: '600', color: colors.textMuted, fontStyle: 'italic' as const },
              isOption && { color: colors.textMain },
            ]}>
              {segments.map((seg, si) => (
                <Text key={si} style={seg.bold ? { fontWeight: '700' } : undefined}>{seg.text}</Text>
              ))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function AICoachScreen({ navigation }: any) {
  const { user } = useAuth();
  const { exploreTopic } = useStudentData();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userGrade = user?.grade || 'Grade 3';
  const userCurriculum = user?.curriculum || 'IB PYP';
  const isPro = user?.isPro === true;

  // ── Free-tier usage tracking
  const [dailyUsage, setDailyUsage] = useState<{ used: number; remaining: number; dailyLimit: number } | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => {
    if (isPro || !user?.email) return;
    fetch(`${SERVER_URL}/ask/usage?email=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.unlimited) {
          setDailyUsage({ used: data.used, remaining: data.remaining, dailyLimit: data.dailyLimit });
          if (data.remaining <= 0) setLimitReached(true);
        }
      })
      .catch(() => {});
  }, [user?.email, isPro]);

  const firstName = user?.name?.split(' ')[0] || 'there';

  const INITIAL_MESSAGES: Message[] = [
    {
      id: 1,
      role: 'ai',
      text: `Hi ${firstName}! I'm your Aivorah AI Coach for ${userCurriculum}. I can help you with ${userGrade} topics. Ask me anything from your curriculum!`,
    },
  ];

  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<number | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; caption: string } | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS[userGrade] ?? FALLBACK_SUGGESTIONS['Grade 3']);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);
  const recognitionRef = useRef<any>(null);
  const ttsAudioRef = useRef<any>(null);
  const inputRef = useRef<TextInput>(null);

  // Fetch real curriculum topics for suggestions
  useEffect(() => {
    const isIBPYP = !userCurriculum || userCurriculum.toLowerCase().includes('ib');
    const endpoint = isIBPYP
      ? `${SERVER_URL}/curriculum?curriculum=IB_PYP&grade=${encodeURIComponent(userGrade)}`
      : `${SERVER_URL}/curriculum?curriculum=NCERT&grade=${encodeURIComponent(userGrade)}`;

    fetch(endpoint)
      .then(r => r.json())
      .then(data => {
        const topics: { topic: string; subject: string }[] = data.topics || [];
        if (!topics.length) return;
        const bySubject: Record<string, string> = {};
        for (const t of topics) {
          if (!bySubject[t.subject]) bySubject[t.subject] = t.topic;
        }
        const QUESTION_TEMPLATES = [
          (t: string) => `What is ${t}?`,
          (t: string) => `Can you explain ${t}?`,
          (t: string) => `How does ${t} work?`,
          (t: string) => `Tell me about ${t}`,
          (t: string) => `What do we learn in ${t}?`,
        ];
        const chips = Object.values(bySubject)
          .slice(0, 6)
          .map((topic, i) => QUESTION_TEMPLATES[i % QUESTION_TEMPLATES.length](topic));
        setSuggestions(chips);
      })
      .catch(() => {});
  }, [userGrade, userCurriculum]);

  // ── TTS ──
  function preprocessForTTS(raw: string): string {
    const ORDINALS: Record<string, string> = {
      '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
      '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
      '11': 'eleven', '12': 'twelve', '100': 'one hundred',
    };
    const DENOM: Record<string, string> = {
      '2': 'half', '3': 'thirds', '4': 'fourths', '5': 'fifths',
      '6': 'sixths', '7': 'sevenths', '8': 'eighths', '9': 'ninths',
      '10': 'tenths', '11': 'elevenths', '12': 'twelfths',
      '100': 'hundredths', '1000': 'thousandths',
    };
    return raw
      .replace(/\b(\d+)\/(\d+)\b/g, (_m, num, den) => {
        const n = ORDINALS[num] || num;
        const d = DENOM[den] || `over ${den}`;
        return `${n} ${d}`;
      })
      .replace(/\b(\d+)\.(\d+)\b/g, (_m, int, frac) => `${int} point ${frac}`)
      .replace(/\s*\+\s*/g, ' plus ')
      .replace(/\s*=\s*/g, ' equals ')
      .replace(/\s*×\s*/g, ' times ')
      .replace(/\s*÷\s*/g, ' divided by ');
  }

  const speakMessage = useCallback((msgId: number, text: string) => {
    if (Platform.OS !== 'web') return;
    if (speakingId === msgId) { stopSpeaking(); return; }
    stopSpeaking();
    setSpeakingId(msgId);
    if (!(window as any).speechSynthesis) { setSpeakingId(null); return; }
    const synth = (window as any).speechSynthesis;
    const utterance = new (window as any).SpeechSynthesisUtterance(preprocessForTTS(text));
    utterance.lang = 'en-IN';
    utterance.rate = 0.88;
    utterance.pitch = 1.1;
    utterance.volume = 1;
    const voices: SpeechSynthesisVoice[] = synth.getVoices();
    const female = voices.find((v: SpeechSynthesisVoice) =>
      v.lang.startsWith('en') && /female|woman|zira|samantha|victoria|karen|moira/i.test(v.name)
    ) || voices.find((v: SpeechSynthesisVoice) => v.lang.startsWith('en'));
    if (female) utterance.voice = female;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    synth.speak(utterance);
  }, [speakingId]);

  function stopSpeaking() {
    if (ttsAudioRef.current) {
      try { ttsAudioRef.current.pause(); ttsAudioRef.current.src = ''; } catch {}
      ttsAudioRef.current = null;
    }
    if (Platform.OS === 'web' && (window as any).speechSynthesis) {
      try { (window as any).speechSynthesis.cancel(); } catch {}
    }
    setSpeakingId(null);
  }

  // ── Voice input
  const toggleVoice = useCallback(() => {
    if (Platform.OS !== 'web') return;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      Alert.alert('Not Supported', 'Voice input is not supported in this browser. Try Chrome.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    let finalTranscript = '';
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      setInput(finalTranscript || interim);
    };
    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error === 'not-allowed') {
        Alert.alert('Microphone Access', 'Please allow microphone access in your browser settings.');
      }
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      if (finalTranscript.trim().length > 2) setInput(finalTranscript.trim());
    };
    recognition.start();
  }, [isListening]);

  // ── Send message with streaming ──
  async function sendMessage(text?: string) {
    const msgText = (text ?? input).trim();
    if (!msgText || isTyping || limitReached) return;

    const userMsg: Message = { id: Date.now(), role: 'user', text: msgText };
    const aiMsgId = Date.now() + 1;

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    setStreamingMsgId(aiMsgId);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    const history: ChatHistoryTurn[] = messages
      .slice(-8)
      .map(m => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, text: m.text }));

    // Add placeholder AI message for streaming
    const aiPlaceholder: Message = { id: aiMsgId, role: 'ai', text: '' };
    setMessages(prev => [...prev, aiPlaceholder]);

    const { answer, images: answerImages, error, limitReached: hitLimit } = await askAIMentorStream(
      msgText,
      userGrade,
      undefined,
      userCurriculum,
      undefined,
      user?.email,
      user?.role,
      history,
      (token: string) => {
        // Update the streaming message in real-time
        setMessages(prev =>
          prev.map(m => m.id === aiMsgId ? { ...m, text: m.text + token } : m)
        );
        // Auto-scroll during streaming
        scrollRef.current?.scrollToEnd({ animated: false });
      }
    );

    if (!error) {
      exploreTopic();
      if (!isPro && dailyUsage) {
        const newUsed = dailyUsage.used + 1;
        const newRemaining = Math.max(0, dailyUsage.dailyLimit - newUsed);
        setDailyUsage({ ...dailyUsage, used: newUsed, remaining: newRemaining });
        if (newRemaining <= 0) setLimitReached(true);
      }
    }
    if (hitLimit) setLimitReached(true);

    // Finalize the AI message
    setMessages(prev =>
      prev.map(m => m.id === aiMsgId ? {
        ...m,
        text: error ? error : (answer || m.text),
        isError: !!error,
        images: !error && answerImages && answerImages.length > 0 ? answerImages : undefined,
      } : m)
    );
    setIsTyping(false);
    setStreamingMsgId(null);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  function clearChat() {
    Alert.alert('Clear Chat', 'Start a new conversation?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => setMessages(INITIAL_MESSAGES) },
    ]);
  }

  return (
    <ScreenLayout>
    <View style={styles.screen}>
      <Header
        title="AI Coach"
        subtitle={`Powered by Aivorah · ${userCurriculum}`}
        searchPlaceholder="Search conversations..."
        onMenuPress={() => navigation.openDrawer()}
        onProfilePress={() => navigation.navigate('Profile')}
      />
      {/* Free-tier usage bar */}
      {!isPro && dailyUsage && (
        <View style={styles.usageBar}>
          <Feather name="zap" size={12} color={limitReached ? '#C5A56A' : colors.primary} />
          <Text style={[styles.usageText, { color: limitReached ? '#C5A56A' : colors.textMuted }]}>
            {limitReached
              ? 'Daily limit reached'
              : `${dailyUsage.remaining} of ${dailyUsage.dailyLimit} free messages left today`}
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Subscription')}>
            <Text style={styles.usageUpgrade}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.messagesScroll}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {/* Welcome + Suggestions — ChatGPT style centered */}
          {messages.length === 1 && (
            <View style={styles.welcomeSection}>
              <View style={styles.welcomeIconWrap}>
                <Feather name="zap" size={28} color={colors.primary} />
              </View>
              <Text style={styles.welcomeTitle}>Aivorah AI Coach</Text>
              <Text style={styles.welcomeSub}>Ask me anything about your {userGrade} curriculum</Text>
              <View style={styles.suggestionsGrid}>
                {suggestions.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestionCard}
                    onPress={() => sendMessage(s)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.suggestionText} numberOfLines={2}>{s}</Text>
                    <Feather name="arrow-up-right" size={14} color={colors.textDim} style={{ marginTop: 4 }} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Messages — clean, modern layout */}
          {messages.map((msg) => {
            const shownText = msg.role === 'ai' ? sanitizeDisplayedAIText(msg.text) : msg.text;
            const isStreaming = msg.id === streamingMsgId;

            return (
              <View key={msg.id} style={[
                styles.messageRow,
                msg.role === 'user' ? styles.messageRowUser : styles.messageRowAI,
              ]}>
                {msg.role === 'ai' && (
                  <View style={styles.aiHeader}>
                    <View style={[styles.aiAvatar, msg.isError && { backgroundColor: colors.accentRed }]}>
                      <Feather name={msg.isError ? 'alert-circle' : 'zap'} size={12} color="white" />
                    </View>
                    <Text style={styles.aiName}>Aivorah</Text>
                  </View>
                )}

                {msg.role === 'user' ? (
                  <View style={[styles.userBubble, msg.role === 'user' && styles.userBubbleStyle]}>
                    <Text style={styles.userText}>{shownText}</Text>
                  </View>
                ) : (
                  <View style={styles.aiBody}>
                    {shownText ? (
                      <>
                        {msg.isError ? (
                          <Text style={styles.errorText}>{shownText}</Text>
                        ) : (
                          renderFormattedAIText(shownText, colors)
                        )}
                        {/* Cursor while streaming */}
                        {isStreaming && (
                          <Animated.View style={styles.streamCursor} />
                        )}
                      </>
                    ) : isStreaming ? (
                      <ThinkingIndicator colors={colors} />
                    ) : null}

                    {/* Action buttons — show after streaming done */}
                    {msg.role === 'ai' && !msg.isError && !isStreaming && shownText && (
                      <View style={styles.actionRow}>
                        {Platform.OS === 'web' && (
                          <TouchableOpacity
                            style={[styles.actionBtn, speakingId === msg.id && styles.actionBtnActive]}
                            onPress={() => speakMessage(msg.id, shownText)}
                            activeOpacity={0.7}
                          >
                            <Feather
                              name={speakingId === msg.id ? 'volume-2' : 'volume-1'}
                              size={14}
                              color={speakingId === msg.id ? '#fff' : colors.textDim}
                            />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* Images — hide any that fail to load */}
                    {msg.images && msg.images.filter(img => !failedImages.has(img.url)).length > 0 && (
                      <View style={styles.imageGrid}>
                        {msg.images.filter(img => !failedImages.has(img.url)).map((img, imgIdx) => (
                          <TouchableOpacity
                            key={imgIdx}
                            activeOpacity={0.8}
                            onPress={() => setZoomedImage({ url: img.url, caption: (img.caption || '').replace(/\*\*/g, '').replace(/\*/g, '') })}
                          >
                            <View style={[styles.imageCard, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
                              <Image
                                source={{ uri: img.url }}
                                style={styles.imageThumb}
                                resizeMode="cover"
                                onError={() => setFailedImages(prev => new Set(prev).add(img.url))}
                              />
                              {!!img.caption && (
                                <Text style={[styles.imageCaption, { color: colors.textMuted }]} numberOfLines={2}>
                                  {img.caption.replace(/\*\*/g, '').replace(/\*/g, '')}
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Thinking — only if no streaming placeholder yet */}
          {isTyping && !streamingMsgId && (
            <View style={[styles.messageRow, styles.messageRowAI]}>
              <View style={styles.aiHeader}>
                <View style={styles.aiAvatar}>
                  <Feather name="zap" size={12} color="white" />
                </View>
                <Text style={styles.aiName}>Aivorah</Text>
              </View>
              <View style={styles.aiBody}>
                <ThinkingIndicator colors={colors} />
              </View>
            </View>
          )}

          {/* Upgrade card */}
          {limitReached && !isPro && (
            <View style={styles.upgradeCard}>
              <View style={styles.upgradeIconWrap}>
                <Feather name="zap" size={24} color="#C5A56A" />
              </View>
              <Text style={[styles.upgradeTitle, { color: colors.textMain }]}>
                You've reached your daily limit
              </Text>
              <Text style={[styles.upgradeSub, { color: colors.textMuted }]}>
                You've used all {dailyUsage?.dailyLimit || 10} free messages for today.{'\n'}
                Upgrade your plan for more AI Coach interactions.
              </Text>
              <View style={styles.upgradePlans}>
                <TouchableOpacity
                  style={styles.upgradePlanCard}
                  onPress={() => navigation.navigate('Subscription')}
                  activeOpacity={0.85}
                >
                  <View style={styles.upgradePlanHeader}>
                    <Text style={[styles.upgradePlanName, { color: '#C5A56A' }]}>Pro</Text>
                    <View style={styles.upgradePlanBadge}>
                      <Text style={styles.upgradePlanBadgeText}>POPULAR</Text>
                    </View>
                  </View>
                  <Text style={[styles.upgradePlanPrice, { color: colors.textMain }]}>
                    {'\u20B9'}499<Text style={[styles.upgradePlanPeriod, { color: colors.textDim }]}>/mo</Text>
                  </Text>
                  <View style={styles.upgradePlanFeatures}>
                    <View style={styles.upgradePlanFeatureRow}>
                      <Feather name="check" size={12} color="#C5A56A" />
                      <Text style={[styles.upgradePlanFeatureText, { color: colors.textMuted }]}>Unlimited AI Coach messages</Text>
                    </View>
                    <View style={styles.upgradePlanFeatureRow}>
                      <Feather name="check" size={12} color="#C5A56A" />
                      <Text style={[styles.upgradePlanFeatureText, { color: colors.textMuted }]}>All Bedtime Stories</Text>
                    </View>
                    <View style={styles.upgradePlanFeatureRow}>
                      <Feather name="check" size={12} color="#C5A56A" />
                      <Text style={[styles.upgradePlanFeatureText, { color: colors.textMuted }]}>Challenges & Daily Habits</Text>
                    </View>
                  </View>
                  <View style={styles.upgradePlanCta}>
                    <Text style={styles.upgradePlanCtaText}>Upgrade to Pro</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.upgradePlanCard, { borderColor: '#EFD1D4' + '30' }]}
                  onPress={() => navigation.navigate('Subscription')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.upgradePlanName, { color: '#EFD1D4' }]}>Max</Text>
                  <Text style={[styles.upgradePlanPrice, { color: colors.textMain }]}>
                    {'\u20B9'}999<Text style={[styles.upgradePlanPeriod, { color: colors.textDim }]}>/mo</Text>
                  </Text>
                  <View style={styles.upgradePlanFeatures}>
                    <View style={styles.upgradePlanFeatureRow}>
                      <Feather name="check" size={12} color="#EFD1D4" />
                      <Text style={[styles.upgradePlanFeatureText, { color: colors.textMuted }]}>Everything in Pro</Text>
                    </View>
                    <View style={styles.upgradePlanFeatureRow}>
                      <Feather name="check" size={12} color="#EFD1D4" />
                      <Text style={[styles.upgradePlanFeatureText, { color: colors.textMuted }]}>Up to 3 child profiles</Text>
                    </View>
                    <View style={styles.upgradePlanFeatureRow}>
                      <Feather name="check" size={12} color="#EFD1D4" />
                      <Text style={[styles.upgradePlanFeatureText, { color: colors.textMuted }]}>Priority responses</Text>
                    </View>
                  </View>
                  <View style={[styles.upgradePlanCta, { backgroundColor: '#EFD1D4' }]}>
                    <Text style={styles.upgradePlanCtaText}>Upgrade to Max</Text>
                  </View>
                </TouchableOpacity>
              </View>
              <Text style={[styles.upgradeFooter, { color: colors.textDim }]}>
                Your free messages reset daily at midnight
              </Text>
            </View>
          )}

        </ScrollView>

        {/* Input bar — ChatGPT/Claude style */}
        <View style={styles.inputBar}>
          <View style={styles.inputContainer}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={isListening ? 'Listening...' : 'Message Aivorah...'}
              placeholderTextColor={isListening ? colors.primary : colors.textDim}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={() => sendMessage()}
              onKeyPress={(e: any) => {
                if (Platform.OS === 'web' && e?.nativeEvent?.key === 'Enter' && !e?.nativeEvent?.shiftKey) {
                  e.preventDefault?.();
                  sendMessage();
                }
              }}
              blurOnSubmit={false}
              editable={!isTyping && !limitReached}
            />
            <View style={styles.inputActions}>
              {messages.length > 1 && (
                <TouchableOpacity style={styles.inputActionBtn} onPress={clearChat} activeOpacity={0.7}>
                  <Feather name="trash-2" size={16} color={colors.textDim} />
                </TouchableOpacity>
              )}
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  style={[styles.inputActionBtn, isListening && styles.micActive]}
                  onPress={toggleVoice}
                  disabled={isTyping}
                  activeOpacity={0.8}
                >
                  {isListening ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Feather name="mic" size={16} color={isTyping ? colors.textDim : colors.textMuted} />
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.sendBtn, (!input.trim() || isTyping) && styles.sendBtnDisabled]}
                onPress={() => sendMessage()}
                disabled={!input.trim() || isTyping || limitReached}
                activeOpacity={0.8}
              >
                <Feather name="arrow-up" size={18} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>

    {/* Image Zoom Modal */}
    {zoomedImage && (
      <Modal transparent visible animationType="fade" onRequestClose={() => setZoomedImage(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }}
          onPress={() => setZoomedImage(null)}
        >
          <TouchableOpacity
            style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 }}
            onPress={() => setZoomedImage(null)}
          >
            <Feather name="x" size={28} color="white" />
          </TouchableOpacity>
          <Image
            source={{ uri: zoomedImage.url }}
            style={{ width: Dimensions.get('window').width * 0.9, height: Dimensions.get('window').height * 0.6 }}
            resizeMode="contain"
          />
          {!!zoomedImage.caption && (
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 12, textAlign: 'center', paddingHorizontal: 20 }}>
              {zoomedImage.caption}
            </Text>
          )}
        </Pressable>
      </Modal>
    )}

    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  keyboardView: { flex: 1 },

  messagesScroll: { flex: 1 },
  messagesContent: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    ...(Platform.OS === 'web' ? { maxWidth: 760, alignSelf: 'center', width: '100%' } as any : {}),
  },

  // ── Welcome / suggestions — centered like ChatGPT ──
  welcomeSection: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: spacing.xl,
  },
  welcomeIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: c.primary + '18',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1, borderColor: c.primary + '30',
  },
  welcomeTitle: {
    fontSize: 22, fontWeight: '700', color: c.textMain, marginBottom: 6,
  },
  welcomeSub: {
    fontSize: 14, color: c.textMuted, marginBottom: 28,
  },
  suggestionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    justifyContent: 'center', maxWidth: 600,
  },
  suggestionCard: {
    width: 170, minHeight: 72,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, borderWidth: 1,
    borderColor: c.borderColor + '60',
    backgroundColor: c.cardDark,
    justifyContent: 'space-between',
  },
  suggestionText: { fontSize: 13, color: c.textMuted, lineHeight: 18 },

  // ── Messages ──
  messageRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
  },
  messageRowUser: {
    alignItems: 'flex-end',
    paddingVertical: 4,
  },
  messageRowAI: {
    alignItems: 'flex-start',
    paddingVertical: 10,
  },

  aiHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  aiAvatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  aiName: {
    fontSize: 13, fontWeight: '600', color: c.textMuted,
  },

  aiBody: {
    paddingLeft: 34,
    paddingRight: spacing.md,
    maxWidth: '100%',
  },

  userBubble: {
    maxWidth: '80%',
  },
  userBubbleStyle: {
    backgroundColor: c.cardDark,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: c.borderColor + '50',
  },
  userText: {
    fontSize: 15, color: c.textMain, lineHeight: 22,
  },

  errorText: {
    fontSize: 15, color: c.accentRed, lineHeight: 22,
  },

  streamCursor: {
    width: 2, height: 18,
    backgroundColor: c.primary,
    borderRadius: 1,
    marginTop: 2,
    opacity: 0.8,
  },

  // ── Action buttons (listen, copy) ──
  actionRow: {
    flexDirection: 'row', gap: 4, marginTop: 10,
  },
  actionBtn: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  actionBtnActive: {
    backgroundColor: c.primary,
    borderRadius: 8,
  },

  // ── Images ──
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  imageCard: { width: 160, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  imageThumb: { width: 160, height: 100 },
  imageCaption: { fontSize: 11, lineHeight: 15, padding: 6 },

  // ── Input bar — modern, centered ──
  inputBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: c.bgDark,
    ...(Platform.OS === 'web' ? { maxWidth: 760, alignSelf: 'center', width: '100%' } as any : {}),
  },
  inputContainer: {
    flexDirection: 'column',
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor + '60',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    minHeight: 52,
  },
  input: {
    fontSize: 15,
    color: c.textMain,
    maxHeight: 120,
    paddingVertical: 2,
    lineHeight: 22,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } as any : {}),
  },
  inputActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingTop: 4,
  },
  inputActionBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  micActive: {
    backgroundColor: c.primary,
  },
  sendBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.25, backgroundColor: c.textDim },

  // ── Free-tier usage bar ──
  usageBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.xl, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  usageText: { flex: 1, fontSize: 11, fontWeight: '600' },
  usageUpgrade: { fontSize: 11, fontWeight: '800', color: '#C5A56A' },

  // ── Upgrade card ──
  upgradeCard: {
    alignItems: 'center', gap: 14,
    marginTop: spacing.xl, marginBottom: spacing.lg,
    paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl,
    borderRadius: radius.xl, borderWidth: 1,
    borderColor: '#C5A56A30',
    backgroundColor: c.cardDark,
  },
  upgradeIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#C5A56A18',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#C5A56A30',
  },
  upgradeTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  upgradeSub: { fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 340 },
  upgradePlans: {
    flexDirection: 'row', gap: spacing.md,
    width: '100%', marginTop: 4,
  },
  upgradePlanCard: {
    flex: 1, padding: spacing.lg, gap: 10,
    borderRadius: radius.lg, borderWidth: 1,
    borderColor: '#C5A56A30',
    backgroundColor: c.bgDark,
  },
  upgradePlanHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  upgradePlanName: { fontSize: 16, fontWeight: '800' },
  upgradePlanBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: '#C5A56A',
  },
  upgradePlanBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  upgradePlanPrice: { fontSize: 22, fontWeight: '800' },
  upgradePlanPeriod: { fontSize: 12, fontWeight: '500' },
  upgradePlanFeatures: { gap: 6 },
  upgradePlanFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  upgradePlanFeatureText: { fontSize: 11, fontWeight: '500' },
  upgradePlanCta: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#C5A56A', marginTop: 4,
  },
  upgradePlanCtaText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  upgradeFooter: { fontSize: 11, textAlign: 'center', marginTop: 2 },
});
