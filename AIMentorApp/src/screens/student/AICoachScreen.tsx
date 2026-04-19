import React, { useState, useRef, useMemo, useCallback } from 'react';
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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useStudentData } from '../../context/StudentDataContext';
import { askAIMentor } from '../../services/aiMentorApi';

interface Message {
  id: number;
  role: 'user' | 'ai';
  text: string;
  timestamp: string;
  isError?: boolean;
}

const SUGGESTIONS = [
  'What is photosynthesis?',
  'How do fractions work?',
  'Explain the water cycle',
  'What are ecosystems?',
  'How does force and motion work?',
  'Tell me about ancient civilizations',
];

export default function AICoachScreen({ navigation }: any) {
  const { user } = useAuth();
  const { exploreTopic } = useStudentData();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const firstName = user?.name?.split(' ')[0] || 'there';

  const INITIAL_MESSAGES: Message[] = [
    {
      id: 1,
      role: 'ai',
      text: `Hi ${firstName}! I'm your Aivorah AI Coach for IB PYP. I can help you with Math, Science, and Social Studies for Grade 3, 4, and 5. Ask me anything from your curriculum!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ];

  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const recognitionRef = useRef<any>(null);
  const ttsAudioRef = useRef<any>(null);

  // ── Read aloud AI response (instant browser TTS — zero latency) ──────────
  const speakMessage = useCallback((msgId: number, text: string) => {
    if (Platform.OS !== 'web') return;

    // Toggle off if already speaking this message
    if (speakingId === msgId) {
      stopSpeaking();
      return;
    }

    stopSpeaking();
    setSpeakingId(msgId);

    if (!(window as any).speechSynthesis) { setSpeakingId(null); return; }

    const synth = (window as any).speechSynthesis;
    const utterance = new (window as any).SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    utterance.rate = 0.88;
    utterance.pitch = 1.1;
    utterance.volume = 1;

    // Pick a female voice if available
    const voices: SpeechSynthesisVoice[] = synth.getVoices();
    const female = voices.find(v =>
      v.lang.startsWith('en') && /female|woman|zira|samantha|victoria|karen|moira/i.test(v.name)
    ) || voices.find(v => v.lang.startsWith('en'));
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

  // ── Voice input via Web Speech API ────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (Platform.OS !== 'web') return;

    // Stop if already listening
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
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
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
      // Auto-send if we got meaningful text
      if (finalTranscript.trim().length > 2) {
        setInput(finalTranscript.trim());
      }
    };

    recognition.start();
  }, [isListening]);

  async function sendMessage(text?: string) {
    const msgText = (text ?? input).trim();
    if (!msgText || isTyping) return;

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: Message = { id: Date.now(), role: 'user', text: msgText, timestamp: now };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    const { answer, error } = await askAIMentor(msgText, 'Grade 3', undefined, 'IB_PYP');
    if (!error) exploreTopic(); // Track real topic exploration

    const aiMsg: Message = {
      id: Date.now() + 1,
      role: 'ai',
      text: error ? error : answer,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isError: !!error,
    };
    setMessages((prev) => [...prev, aiMsg]);
    setIsTyping(false);
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
        subtitle="Powered by Groq LLaMA 3 · IB PYP"
        searchPlaceholder="Search conversations..."
        onMenuPress={() => navigation.openDrawer()}
        onProfilePress={() => navigation.navigate('Profile')}
      />
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
          {/* Suggestions */}
          {messages.length === 1 && (
            <View style={styles.suggestionsSection}>
              <Text style={styles.suggestionsLabel}>Try asking...</Text>
              <View style={styles.suggestionsRow}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestionChip}
                    onPress={() => sendMessage(s)}
                    activeOpacity={0.7}
                  >
                    <Feather name="zap" size={11} color={colors.primary} style={{ marginRight: 4 }} />
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[styles.messageRow, msg.role === 'user' ? styles.messageRowUser : styles.messageRowAI]}
            >
              {msg.role === 'ai' && (
                <View style={[styles.aiAvatar, msg.isError && { backgroundColor: colors.accentRed }]}>
                  <Feather name={msg.isError ? 'alert-circle' : 'zap'} size={14} color="white" />
                </View>
              )}
              <View style={[
                styles.bubble,
                msg.role === 'user' ? styles.bubbleUser : styles.bubbleAI,
                msg.isError && styles.bubbleError,
              ]}>
                <Text style={[styles.bubbleText, msg.role === 'user' && styles.bubbleTextUser, msg.isError && styles.bubbleTextError]}>
                  {msg.text}
                </Text>
                <View style={styles.bubbleFooter}>
                  {msg.role === 'ai' && !msg.isError && Platform.OS === 'web' && (
                    <TouchableOpacity
                      style={[styles.speakBtn, speakingId === msg.id && styles.speakBtnActive]}
                      onPress={() => speakMessage(msg.id, msg.text)}
                      activeOpacity={0.7}
                    >
                      <Feather
                        name={speakingId === msg.id ? 'volume-2' : 'volume-1'}
                        size={13}
                        color={speakingId === msg.id ? '#fff' : colors.primary}
                      />
                      <Text style={[styles.speakBtnText, { color: speakingId === msg.id ? '#fff' : colors.primary }]}>
                        {speakingId === msg.id ? 'Playing...' : 'Listen'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <Text style={[styles.timestamp, msg.role === 'user' && { color: 'rgba(255,255,255,0.5)' }]}>
                    {msg.timestamp}
                  </Text>
                </View>
              </View>
              {msg.role === 'user' && (
                <View style={styles.userAvatar}>
                  <Feather name="user" size={14} color={colors.textMuted} />
                </View>
              )}
            </View>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <View style={styles.messageRow}>
              <View style={styles.aiAvatar}>
                <Feather name="zap" size={14} color="white" />
              </View>
              <View style={styles.typingBubble}>
                <Text style={styles.typingDots}>● ● ●</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputBar}>
          {messages.length > 1 && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearChat} activeOpacity={0.7}>
              <Feather name="trash-2" size={16} color={colors.textDim} />
            </TouchableOpacity>
          )}
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder={isListening ? 'Listening...' : 'Ask Aivorah anything...'}
              placeholderTextColor={isListening ? colors.primary : colors.textDim}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={() => sendMessage()}
              editable={!isTyping}
            />
          </View>
          {/* Mic button — voice input */}
          {Platform.OS === 'web' && (
            <TouchableOpacity
              style={[styles.micBtn, isListening && styles.micBtnActive]}
              onPress={toggleVoice}
              disabled={isTyping}
              activeOpacity={0.8}
            >
              {isListening ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="mic" size={18} color={isTyping ? colors.textDim : colors.primary} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || isTyping) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || isTyping}
            activeOpacity={0.8}
          >
            <Feather name={isTyping ? 'loader' : 'send'} size={18} color="white" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  keyboardView: { flex: 1 },

  messagesScroll: { flex: 1 },
  messagesContent: { padding: spacing.xl, paddingBottom: spacing.lg },

  apiWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: c.accentYellow + '12',
    borderWidth: 1,
    borderColor: c.accentYellow + '30',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  apiWarningText: { flex: 1, fontSize: 12, color: c.textMuted, lineHeight: 18 },

  suggestionsSection: { marginBottom: spacing.xxl },
  suggestionsLabel: { fontSize: 12, color: c.textMuted, fontWeight: '600', marginBottom: spacing.md },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.primary + '40',
    backgroundColor: c.primaryGlow,
  },
  suggestionText: { fontSize: 13, color: c.textMuted },

  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  messageRowUser: { flexDirection: 'row-reverse' },
  messageRowAI: {},

  aiAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  bubble: {
    maxWidth: '75%',
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  bubbleAI: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: c.primary,
    borderBottomRightRadius: 4,
  },
  bubbleError: { borderColor: c.accentRed + '40', backgroundColor: c.accentRed + '08' },
  bubbleText: { fontSize: 14, color: c.textMain, lineHeight: 22 },
  bubbleTextUser: { color: 'white' },
  bubbleTextError: { color: c.accentRed },
  bubbleFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 },
  speakBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 14, borderWidth: 1,
    borderColor: c.primary + '50',
    backgroundColor: c.primary + '12',
  },
  speakBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
  speakBtnText: { fontSize: 11, fontWeight: '700' },
  timestamp: { fontSize: 10, color: c.textDim, textAlign: 'right', flex: 1 },

  typingBubble: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  typingDots: { fontSize: 12, color: c.textMuted, letterSpacing: 4 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    padding: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.borderColor,
    backgroundColor: c.bgDark,
  },
  clearBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  input: { fontSize: 14, color: c.textMain, maxHeight: 120 },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.cardDark,
    borderWidth: 1.5,
    borderColor: c.primary + '50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
