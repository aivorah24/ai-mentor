/**
 * TopicAICoach.tsx
 * Floating AI Coach icon (bottom-right) that opens a topic-scoped mini chat panel.
 * Scopes the AI to the current topic — e.g., "Fractions" only answers about Fractions.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Animated, ActivityIndicator, Keyboard,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { askAIMentorStream, type ChatHistoryTurn } from '../../services/aiMentorApi';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

// ── TTS text preprocessor — prevents mis-readings of fractions, decimals ──────
function preprocessForTTS(raw: string): string {
  const DENOM: Record<string, string> = {
    '2': 'half', '3': 'thirds', '4': 'fourths', '5': 'fifths',
    '6': 'sixths', '7': 'sevenths', '8': 'eighths', '9': 'ninths',
    '10': 'tenths', '11': 'elevenths', '12': 'twelfths',
    '100': 'hundredths', '1000': 'thousandths',
  };
  return raw
    .replace(/\b(\d+)\/(\d+)\b/g, (_m, num, den) => `${num} ${DENOM[den] || 'over ' + den}`)
    .replace(/\b(\d+)\.(\d+)\b/g, (_m, int, frac) => `${int} point ${frac}`)
    .replace(/\s*\+\s*/g, ' plus ')
    .replace(/\s*=\s*/g, ' equals ')
    .replace(/\s*×\s*/g, ' times ')
    .replace(/\s*÷\s*/g, ' divided by ');
}

// ── Web Speech API helpers ──────────────────────────────────────────────────
function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web' || !(window as any).speechSynthesis) { resolve(); return; }
    const synth = (window as any).speechSynthesis as SpeechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(preprocessForTTS(text));
    utter.rate = 1.05; utter.pitch = 1.3; utter.volume = 1.0;
    const voices = synth.getVoices();
    const pick = voices.find(v => /zira/i.test(v.name))
      || voices.find(v => /google.*en.*us/i.test(v.name))
      || voices.find(v => /en[-_]US/i.test(v.lang));
    if (pick) utter.voice = pick;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    synth.speak(utter);
  });
}

function stopSpeech() {
  if (Platform.OS === 'web' && (window as any).speechSynthesis) {
    try { (window as any).speechSynthesis.cancel(); } catch {}
  }
}

function startSpeechRecognition(
  onResult: (text: string) => void,
  onListening: (listening: boolean) => void,
  onEnd: () => void,
  onAutoSend?: (finalText: string) => void,
) {
  if (Platform.OS !== 'web') return null;
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported in this browser');
    return null;
  }
  try {
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;       // single utterance — faster pickup, auto-stops on silence
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = '';
    let silenceTimer: any = null;

    recognition.onstart = () => onListening(true);

    recognition.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalTranscript += transcript + ' ';
          onResult(finalTranscript.trim());
        } else {
          interim += transcript;
        }
      }
      // Show interim results in real-time
      if (interim) onResult((finalTranscript + interim).trim());

      // Reset silence timer — auto-send 1.5s after last speech
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        const text = finalTranscript.trim();
        if (text && onAutoSend) {
          recognition.stop();
          onAutoSend(text);
        }
      }, 1500);
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      onListening(false);
      // Auto-send whatever we have when recognition ends naturally
      const text = finalTranscript.trim();
      if (text && onAutoSend) {
        onAutoSend(text);
      }
      onEnd();
    };
    recognition.onerror = (e: any) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      console.warn('Speech recognition error:', e.error);
      onListening(false);
      onEnd();
    };

    recognition.start();
    return recognition;
  } catch (err) {
    console.warn('Failed to start speech recognition:', err);
    return null;
  }
}

interface Message {
  role: 'user' | 'ai';
  text: string;
}

function sanitizeDisplayedAIText(text: string): string {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\r/g, '')
    // Insert newline before Step N: / Answer: / Try this: so they render as separate lines
    .replace(/\s+(Step\s*\d+[\s:→–])/g, '\n$1')
    .replace(/\s+(Answer\s*:)/gi, '\n$1')
    .replace(/\s+(Try this\s*:|Now,?\s*can you|Here'?s? a practice)/gi, '\n$1')
    .replace(/\bkeyboards and mice\b/gi, 'keyboards and a mouse')
    .replace(/\bmice\b/gi, 'mouse');
}

interface Props {
  topic: string;
  subject?: string;
  grade?: string;
  curriculum?: string;
  onOpenChange?: (open: boolean) => void;
  onMessageSent?: (message: string) => void;
}

export default function TopicAICoach({
  topic,
  subject = 'Mathematics',
  grade = 'Grade 3',
  curriculum = 'IB_PYP',
  onOpenChange,
  onMessageSent,
}: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedbackByMsg, setFeedbackByMsg] = useState<Record<number, number>>({});
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  // Slide panel up/down
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });
  const opacity = slideAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] });

  // Reset conversation when topic changes (new topic = fresh start)
  useEffect(() => {
    setMessages([]);
    setOpen(false);
    setInput('');
    setFeedbackByMsg({});
  }, [topic]);

  // Greeting message when panel opens for the first time
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'ai',
        text: `Hi! I'm your Aivorah AI Coach for "${topic}". Ask me anything about this topic and I'll help you understand it!`,
      }]);
    }
  }, [open]);

  async function handleSpeak(idx: number, text: string) {
    if (speakingIdx === idx) {
      stopSpeech();
      setSpeakingIdx(null);
      return;
    }
    setSpeakingIdx(idx);
    await speakText(text);
    setSpeakingIdx(null);
  }

  const pendingSendRef = useRef<string | null>(null);

  function toggleMic() {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const rec = startSpeechRecognition(
      (text) => setInput(text),
      (listening) => setRecording(listening),
      () => { setRecording(false); recognitionRef.current = null; },
      (finalText) => {
        // Auto-send: set input and trigger send on next render
        pendingSendRef.current = finalText;
        setInput(finalText);
      },
    );
    if (rec) {
      recognitionRef.current = rec;
    } else {
      alert('Microphone not available. Please allow mic access in your browser.');
    }
  }

  // Auto-send when voice input completes
  useEffect(() => {
    if (pendingSendRef.current && input === pendingSendRef.current && !loading) {
      pendingSendRef.current = null;
      send();
    }
  }, [input]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    onMessageSent?.(q);
    Keyboard.dismiss();
    setInput('');
    const userMsg: Message = { role: 'user', text: q };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Add an empty AI message that we'll stream into
    const aiIdx = messages.length + 1; // +1 for the user message we just added
    setMessages(prev => [...prev, { role: 'ai', text: '' }]);

    const history: ChatHistoryTurn[] = messages
      .slice(-8)
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text: m.text,
      }));

    const result = await askAIMentorStream(
      q, grade, subject, curriculum, topic, user?.email, user?.role, history,
      (token) => {
        // Append each token to the last AI message
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'ai') {
            updated[updated.length - 1] = { ...last, text: last.text + token };
          }
          return updated;
        });
        scrollRef.current?.scrollToEnd({ animated: false });
      },
    );

    // If there was an error, replace with error message
    if (result.error) {
      const errText = (result as any).limitReached
        ? result.error
        : 'Sorry, I had trouble connecting. Please try again!';
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'ai', text: errText };
        return updated;
      });
    }

    setLoading(false);
  }

  function submitFeedback(messageIndex: number, score: number, aiText: string) {
    setFeedbackByMsg(prev => ({ ...prev, [messageIndex]: score }));
    fetch(`${SERVER_URL}/analytics/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userEmail: user?.email,
        role: user?.role,
        source: 'topic_ai_coach',
        topic,
        subject,
        grade,
        score,
        comment: aiText?.slice(0, 240) || '',
      }),
    }).catch(() => {});
  }

  const fabBg     = colors.primary;
  const panelBg   = colors.cardDark;
  const headerBg  = colors.sidebarDark;
  const userBubble = colors.primary;
  const aiBubble  = colors.cardHover;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* Backdrop — tap to close */}
      {open && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        />
      )}

      {/* Slide-up chat panel */}
      <Animated.View
        style={[
          styles.panel,
          {
            backgroundColor: panelBg,
            borderColor: colors.borderColor,
            transform: [{ translateY }],
            opacity,
          },
        ]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        {/* Panel header */}
        <View style={[styles.panelHeader, { backgroundColor: headerBg, borderBottomColor: colors.borderColor }]}>
          <View style={[styles.aiDot, { backgroundColor: colors.primary }]}>
            <Feather name="cpu" size={14} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.panelTitle, { color: colors.textMain }]}>AI Coach</Text>
            <Text style={[styles.panelSub, { color: colors.textMuted }]} numberOfLines={1}>{topic}</Text>
          </View>
          <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
            <Feather name="x" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.msgList}
            contentContainerStyle={styles.msgContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.map((msg, i) => {
              const shownText = msg.role === 'ai' ? sanitizeDisplayedAIText(msg.text) : msg.text;
              return (
              <View key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
                <View
                  style={[
                    styles.bubble,
                    msg.role === 'user'
                      ? [styles.bubbleUser, { backgroundColor: userBubble }]
                      : [styles.bubbleAI,   { backgroundColor: aiBubble, borderColor: colors.borderColor }],
                  ]}
                >
                  {msg.role === 'ai' ? (
                    <View style={{ gap: 5 }}>
                      {shownText.split('\n').filter(l => l.trim()).map((line, li) => {
                        const isStep     = /^step\s*\d+[:.→]/i.test(line.trim());
                        const isAnswer   = /^answer[:.]/i.test(line.trim());
                        const isPractice = /^(try this|practice|question)[:.]/i.test(line.trim());
                        return (
                          <Text
                            key={li}
                            style={[
                              styles.bubbleText,
                              { color: colors.textMain },
                              isStep     && { fontWeight: '700', color: colors.primary, marginTop: li > 0 ? 3 : 0 },
                              isAnswer   && { fontWeight: '700', color: '#4A9E70', marginTop: 3 },
                              isPractice && { fontWeight: '600', color: colors.textMuted, fontStyle: 'italic', marginTop: 3 },
                            ]}
                          >
                            {line}
                          </Text>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={[styles.bubbleText, { color: '#fff' }]}>{shownText}</Text>
                  )}
                </View>
                {msg.role === 'ai' && (
                  <View style={styles.feedbackRow}>
                    <TouchableOpacity
                      style={[styles.feedbackBtn, speakingIdx === i && { borderColor: colors.primary, backgroundColor: colors.primary + '22' }]}
                      onPress={() => handleSpeak(i, shownText)}
                      activeOpacity={0.8}
                    >
                      <Feather name={speakingIdx === i ? 'volume-x' : 'volume-2'} size={12} color={speakingIdx === i ? colors.primary : colors.textDim} />
                    </TouchableOpacity>
                    {i > 0 && (
                      <>
                        <TouchableOpacity
                          style={[styles.feedbackBtn, feedbackByMsg[i] === 5 && { borderColor: '#10b981', backgroundColor: '#10b98122' }]}
                          onPress={() => submitFeedback(i, 5, msg.text)}
                          activeOpacity={0.8}
                        >
                          <Feather name="thumbs-up" size={12} color={feedbackByMsg[i] === 5 ? '#10b981' : colors.textDim} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.feedbackBtn, feedbackByMsg[i] === 1 && { borderColor: '#ef4444', backgroundColor: '#ef444422' }]}
                          onPress={() => submitFeedback(i, 1, msg.text)}
                          activeOpacity={0.8}
                        >
                          <Feather name="thumbs-down" size={12} color={feedbackByMsg[i] === 1 ? '#ef4444' : colors.textDim} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
            )})}
            {loading && messages[messages.length - 1]?.text === '' && (
              <View style={[styles.bubble, styles.bubbleAI, { backgroundColor: aiBubble, borderColor: colors.borderColor }]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </ScrollView>

          {/* Input row */}
          <View style={[styles.inputRow, { borderTopColor: colors.borderColor, backgroundColor: panelBg }]}>
            <TouchableOpacity
              style={[styles.micBtn, {
                backgroundColor: recording ? '#ef444422' : colors.bgDark,
                borderColor: recording ? '#ef4444' : colors.borderColor,
              }]}
              onPress={toggleMic}
              activeOpacity={0.8}
            >
              <Feather name={recording ? 'mic-off' : 'mic'} size={16} color={recording ? '#ef4444' : colors.textMuted} />
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { backgroundColor: colors.bgDark, color: colors.textMain, borderColor: colors.borderColor }]}
              placeholder={`Ask about ${topic}...`}
              placeholderTextColor={colors.textDim}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              onKeyPress={(e: any) => {
                if (
                  Platform.OS === 'web' &&
                  e?.nativeEvent?.key === 'Enter' &&
                  !e?.nativeEvent?.shiftKey
                ) {
                  e.preventDefault?.();
                  send();
                }
              }}
              returnKeyType="send"
              multiline={false}
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: loading ? colors.cardHover : colors.primary }]}
              onPress={send}
              disabled={loading}
            >
              <Feather name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>

      {/* Floating action button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: fabBg, shadowColor: fabBg }]}
        onPress={() => setOpen(prev => !prev)}
        activeOpacity={0.85}
      >
        <Feather name={open ? 'x' : 'cpu'} size={22} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const PANEL_HEIGHT = 520;

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    left: 0,
    top: 0,
    zIndex: 999,
  },
  backdrop: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  fab: {
    position: 'absolute',
    bottom: spacing.xl + 4,
    right: spacing.xl,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  panel: {
    position: 'absolute',
    bottom: 84,
    right: spacing.xl,
    left: spacing.xl,
    height: PANEL_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 12,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  aiDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelTitle: { fontSize: 14, fontWeight: '700' },
  panelSub:   { fontSize: 11, marginTop: 1 },
  closeBtn:   { padding: 4 },
  msgList:    { flex: 1 },
  msgContent: { padding: spacing.md, gap: spacing.sm },
  bubble: {
    maxWidth: '88%',
    minWidth: 80,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleAI:   { alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  feedbackRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    marginLeft: 4,
  },
  feedbackBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3340',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121923',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    borderWidth: 1,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
