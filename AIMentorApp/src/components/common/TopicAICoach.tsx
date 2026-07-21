/**
 * TopicAICoach.tsx
 * Floating AI Coach icon (bottom-right) that opens a topic-scoped mini chat panel.
 * Scopes the AI to the current topic — e.g., "Fractions" only answers about Fractions.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Animated, ActivityIndicator, Keyboard,
  Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { askAIMentorStream, type ChatHistoryTurn, type AskImage } from '../../services/aiMentorApi';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

// ── Web Speech API helpers ──────────────────────────────────────────────────

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
  images?: AskImage[];
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

// Splits into non-empty lines, keeping each line's absolute start offset in
// the full string — so a word inside a line can be matched against a global
// TTS char-index (from the "Listen"-style karaoke highlight).
function linesWithOffsets(text: string): { line: string; start: number }[] {
  const out: { line: string; start: number }[] = [];
  let idx = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim()) out.push({ line: raw, start: idx });
    idx += raw.length + 1; // +1 for the '\n' consumed by split
  }
  return out;
}
function wordsWithOffsets(text: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ word: m[0], start: m.index });
  return out;
}

interface Props {
  topic: string;
  subject?: string;
  grade?: string;
  curriculum?: string;
  chapter?: string;
  autoOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onMessageSent?: (message: string) => void;
  // Renders as a plain panel filling its container — no floating FAB, no
  // backdrop, no slide-up animation. For dedicated "Ask AI" screens/tabs
  // (e.g. LessonScreen) where the chat IS the content, not an overlay on
  // top of other content.
  inline?: boolean;
}

export default function TopicAICoach({
  topic,
  subject = 'Mathematics',
  grade = 'Grade 3',
  curriculum = 'IB_PYP',
  chapter,
  autoOpen = false,
  onOpenChange,
  onMessageSent,
  inline = false,
}: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(autoOpen);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedbackByMsg, setFeedbackByMsg] = useState<Record<number, number>>({});
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [speakingCharIndex, setSpeakingCharIndex] = useState(0);
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

  // Reset conversation when topic changes (new topic = fresh start) — but not
  // on the initial mount, otherwise this fires right after autoOpen sets the
  // panel open and immediately closes it again (chat never visibly appears).
  const prevTopicRef = useRef(topic);
  useEffect(() => {
    if (prevTopicRef.current === topic) return;
    prevTopicRef.current = topic;
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

  // Reads a message aloud AND tracks word-boundary position (karaoke-style),
  // same mechanism as the Listen tab. Speaks the text exactly as displayed —
  // no fraction/decimal preprocessing — so char offsets line up with what's
  // on screen for highlighting.
  function handleSpeak(idx: number, text: string) {
    if (speakingIdx === idx) {
      stopSpeech();
      setSpeakingIdx(null);
      setSpeakingCharIndex(0);
      return;
    }
    stopSpeech();
    setSpeakingIdx(idx);
    setSpeakingCharIndex(0);
    if (Platform.OS !== 'web' || !(window as any).speechSynthesis) { setSpeakingIdx(null); return; }
    const synth = (window as any).speechSynthesis as SpeechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.85; utter.pitch = 1.1; utter.volume = 1.0;
    const voices = synth.getVoices();
    const pick = voices.find(v => /zira/i.test(v.name))
      || voices.find(v => /google.*en.*us/i.test(v.name))
      || voices.find(v => /en[-_]US/i.test(v.lang));
    if (pick) utter.voice = pick;
    utter.onboundary = (e: any) => { if (e.name === 'word' || e.charIndex !== undefined) setSpeakingCharIndex(e.charIndex ?? 0); };
    utter.onend = () => { setSpeakingIdx(null); setSpeakingCharIndex(0); };
    utter.onerror = () => { setSpeakingIdx(null); setSpeakingCharIndex(0); };
    synth.speak(utter);
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
    } else if (result.images && result.images.length > 0) {
      // Attach images to the last AI message
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'ai') {
          updated[updated.length - 1] = { ...last, images: result.images };
        }
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

  const fabBg     = colors.accentYellow;
  const panelBg   = colors.cardDark;
  const headerBg  = colors.sidebarDark;
  const userBubble = colors.accentYellow;
  const aiBubble  = colors.cardHover;

  return (
    <View style={inline ? styles.inlineWrapper : styles.wrapper} pointerEvents={inline ? 'auto' : 'box-none'}>
      {/* Backdrop — tap to close (floating mode only) */}
      {open && !inline && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        />
      )}

      {/* Chat panel — a plain filled panel when inline, a slide-up floating panel otherwise */}
      <Animated.View
        style={
          inline
            ? [styles.inlinePanel, { backgroundColor: panelBg, borderColor: colors.borderColor }]
            : [
                styles.panel,
                {
                  backgroundColor: panelBg,
                  borderColor: colors.borderColor,
                  transform: [{ translateY }],
                  opacity,
                },
              ]
        }
        pointerEvents={inline || open ? 'auto' : 'none'}
      >
        {/* Panel header */}
        <View style={[styles.panelHeader, { backgroundColor: headerBg, borderBottomColor: colors.borderColor }]}>
          <View style={[styles.aiDot, { backgroundColor: colors.accentYellow }]}>
            <Feather name="cpu" size={14} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.panelTitle, { color: colors.textMain }]}>AI Coach</Text>
            <Text style={[styles.panelSub, { color: colors.textMuted }]} numberOfLines={1}>{topic}</Text>
          </View>
          {!inline && (
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
              <Feather name="x" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
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
                      {linesWithOffsets(shownText).map(({ line, start }, li) => {
                        const isStep     = /^step\s*\d+[:.→]/i.test(line.trim());
                        const isAnswer   = /^answer[:.]/i.test(line.trim());
                        const isPractice = /^(try this|practice|question)[:.]/i.test(line.trim());
                        const lineStyle = [
                          styles.bubbleText,
                          { color: colors.textMain },
                          isStep     && { fontWeight: '700', color: colors.accentYellow, marginTop: li > 0 ? 3 : 0 },
                          isAnswer   && { fontWeight: '700', color: '#4A9E70', marginTop: 3 },
                          isPractice && { fontWeight: '600', color: colors.textMuted, fontStyle: 'italic', marginTop: 3 },
                        ];
                        // While this message is being read aloud, highlight the
                        // word currently spoken — same karaoke-style highlight
                        // as the Listen tab's read-along.
                        if (speakingIdx === i) {
                          const words = wordsWithOffsets(line);
                          const curWordIdx = words.reduce(
                            (best, w, wi) => (start + w.start <= speakingCharIndex ? wi : best), -1,
                          );
                          return (
                            <Text key={li} style={lineStyle}>
                              {words.map((w, wi) => (
                                <Text
                                  key={wi}
                                  style={wi === curWordIdx ? { backgroundColor: colors.accentYellow + '30', color: colors.accentYellow, fontWeight: '700' } : undefined}
                                >
                                  {w.word + ' '}
                                </Text>
                              ))}
                            </Text>
                          );
                        }
                        return (
                          <Text key={li} style={lineStyle}>
                            {line}
                          </Text>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={[styles.bubbleText, { color: '#fff' }]}>{shownText}</Text>
                  )}
                </View>
                {msg.role === 'ai' && msg.images && msg.images.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.imageStrip}
                    contentContainerStyle={styles.imageStripContent}
                  >
                    {msg.images.map((img, imgIdx) => (
                      <View key={imgIdx} style={[styles.imageCard, { backgroundColor: colors.cardHover, borderColor: colors.borderColor }]}>
                        <Image
                          source={{ uri: img.url }}
                          style={styles.imageThumb}
                          resizeMode="cover"
                        />
                        {!!img.caption && (
                          <Text style={[styles.imageCaption, { color: colors.textMuted }]} numberOfLines={2}>
                            {img.caption}
                          </Text>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}
                {msg.role === 'ai' && (
                  <View style={styles.feedbackRow}>
                    <TouchableOpacity
                      style={[
                        styles.feedbackBtn,
                        { borderColor: colors.accentYellow + '50', backgroundColor: colors.accentYellow + (speakingIdx === i ? '30' : '14') },
                      ]}
                      onPress={() => handleSpeak(i, shownText)}
                      activeOpacity={0.8}
                    >
                      <Feather name={speakingIdx === i ? 'volume-x' : 'volume-2'} size={12} color={colors.accentYellow} />
                    </TouchableOpacity>
                    {i > 0 && (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.feedbackBtn,
                            { borderColor: colors.accentYellow + '50', backgroundColor: colors.accentYellow + '14' },
                            feedbackByMsg[i] === 5 && { borderColor: '#10b981', backgroundColor: '#10b98122' },
                          ]}
                          onPress={() => submitFeedback(i, 5, msg.text)}
                          activeOpacity={0.8}
                        >
                          <Feather name="thumbs-up" size={12} color={feedbackByMsg[i] === 5 ? '#10b981' : colors.accentYellow} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.feedbackBtn,
                            { borderColor: colors.accentYellow + '50', backgroundColor: colors.accentYellow + '14' },
                            feedbackByMsg[i] === 1 && { borderColor: '#ef4444', backgroundColor: '#ef444422' },
                          ]}
                          onPress={() => submitFeedback(i, 1, msg.text)}
                          activeOpacity={0.8}
                        >
                          <Feather name="thumbs-down" size={12} color={feedbackByMsg[i] === 1 ? '#ef4444' : colors.accentYellow} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
            )})}
            {loading && messages[messages.length - 1]?.text === '' && (
              <View style={[styles.bubble, styles.bubbleAI, { backgroundColor: aiBubble, borderColor: colors.borderColor }]}>
                <ActivityIndicator size="small" color={colors.accentYellow} />
              </View>
            )}
          </ScrollView>

          {/* Input row */}
          <View style={[styles.inputRow, { borderTopColor: colors.borderColor, backgroundColor: panelBg }]}>
            <TouchableOpacity
              style={[styles.micBtn, {
                backgroundColor: recording ? '#ef444422' : colors.accentYellow + '14',
                borderColor: recording ? '#ef4444' : colors.accentYellow + '50',
              }]}
              onPress={toggleMic}
              activeOpacity={0.8}
            >
              <Feather name={recording ? 'mic-off' : 'mic'} size={16} color={recording ? '#ef4444' : colors.accentYellow} />
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
              style={[styles.sendBtn, { backgroundColor: loading ? colors.cardHover : colors.accentYellow }]}
              onPress={send}
              disabled={loading}
            >
              <Feather name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>

      {/* Floating action button (floating mode only) */}
      {!inline && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: fabBg, shadowColor: fabBg }]}
          onPress={() => setOpen(prev => !prev)}
          activeOpacity={0.85}
        >
          <Feather name={open ? 'x' : 'cpu'} size={22} color="#fff" />
        </TouchableOpacity>
      )}
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
  inlineWrapper: { flex: 1, minHeight: 420 },
  inlinePanel: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
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
  imageStrip: {
    marginTop: 8,
    marginLeft: 4,
  },
  imageStripContent: {
    gap: 8,
    paddingRight: 4,
  },
  imageCard: {
    width: 140,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageThumb: {
    width: 140,
    height: 90,
  },
  imageCaption: {
    fontSize: 10,
    lineHeight: 13,
    padding: 5,
  },
});
