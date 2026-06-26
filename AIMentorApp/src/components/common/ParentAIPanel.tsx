/**
 * ParentAIPanel.tsx
 * Collapsible right-side AI assistant for parents.
 * Focused on: understanding child progress, home activities, homework help,
 * decoding reports, drafting teacher messages.
 * Uses selected child's real data as context. Warm, jargon-free tone.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Animated, ActivityIndicator, Platform, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

const P = {
  rose:  '#B8797E',
  green: '#5A8A70',
  gold:  '#8A8358',
  peach: '#C4836A',
  teal:  '#7AADA8',
  slate: '#5F8A86',
};

const PANEL_WIDTH = 320;

const QUICK_PROMPTS = [
  'Why is my child struggling?',
  'What can I do at home to help?',
  'What should we focus on this week?',
  'Is my child\'s progress good?',
  'Help me message the teacher',
  'Explain the last topic they studied',
];

type Msg = {
  role: 'user' | 'ai';
  text: string;
};

// ── Web Speech Recognition ─────────────────────────────────
function useSpeechRecognition(onResult: (t: string) => void, onEnd: () => void) {
  const recRef = useRef<any>(null);
  const start = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    recRef.current = rec;
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      const text = e.results[0]?.[0]?.transcript || '';
      if (text) onResult(text);
    };
    rec.onend = onEnd;
    rec.onerror = onEnd;
    rec.start();
  }, [onResult, onEnd]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
  }, []);

  return { start, stop };
}

export default function ParentAIPanel() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [children, setChildren] = useState<any[]>([]);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  // Load parent's children
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setChildren(data); })
      .catch(() => {});
  }, [user?.email]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: open ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [open]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [messages, loading]);

  const selectedChild = children[selectedChildIdx] || null;

  // Build child context summary for AI
  const childSummary = selectedChild
    ? `Child: ${selectedChild.name}, ${selectedChild.grade}
Progress: ${selectedChild.progressPct ?? Math.round(((selectedChild.completedTopics?.length ?? 0) / 14) * 100)}%
Completed topics: ${(selectedChild.completedTopics ?? []).join(', ') || 'none yet'}
Current streak: ${selectedChild.currentStreak ?? 0} days
XP points: ${selectedChild.xpPoints ?? 0}
Assignments done: ${selectedChild.assignmentsDone ?? 0}
Last active: ${selectedChild.lastActive ? new Date(selectedChild.lastActive).toDateString() : 'unknown'}
Status: ${(selectedChild.currentStreak ?? 0) >= 3 ? 'On track' : 'Needs attention'}
Last lesson: ${selectedChild.lastLesson || 'unknown'}`
    : 'No child data available yet.';

  const { start: startMic, stop: stopMic } = useSpeechRecognition(
    (text) => setInput(prev => (prev + ' ' + text).trim()),
    () => setListening(false),
  );

  const toggleMic = () => {
    if (listening) { stopMic(); setListening(false); }
    else { setListening(true); startMic(); }
  };

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Msg = { role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/ask/parent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text.trim(),
          childSummary,
          childName: selectedChild?.name || '',
          parentEmail: user?.email || '',
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.answer || 'No response.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Could not reach AI. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }, [loading, childSummary, selectedChild, user?.email]);

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      send(input);
    }
  };

  const renderAIText = (text: string) =>
    text.split('\n').filter(l => l.trim()).map((line, i) => {
      const isBullet = /^[-•*\d+\.]\s/.test(line.trim());
      const isHeader = /^\*\*(.+)\*\*/.test(line.trim()) || /^#+\s/.test(line.trim());
      const clean = line.replace(/^[-•*\d+\.]\s*/, '').replace(/\*\*/g, '').replace(/^#+\s/, '');
      if (isHeader) return (
        <Text key={i} style={{ fontSize: 12, fontWeight: '800', color: colors.textMain, marginTop: i > 0 ? 6 : 0 }}>{clean}</Text>
      );
      if (isBullet) return (
        <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accentYellow, marginTop: 8, flexShrink: 0 }} />
          <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 20, flex: 1 }}>{clean}</Text>
        </View>
      );
      return <Text key={i} style={{ fontSize: 12, color: colors.textMuted, lineHeight: 19 }}>{clean}</Text>;
    });

  if (Platform.OS !== 'web') return null;

  const panelWidth = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, PANEL_WIDTH] });

  return (
    <View style={{ flexDirection: 'row', height: '100%' as any }}>
      {/* Animated panel */}
      <Animated.View style={{
        width: panelWidth, overflow: 'hidden',
        borderLeftWidth: 1, borderLeftColor: colors.borderColor,
        backgroundColor: colors.sidebarDark,
      }}>
        <View style={{ width: PANEL_WIDTH, flex: 1, flexDirection: 'column' }}>

          {/* Header */}
          <View style={{ padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderColor, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.accentYellow + '25', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="cpu" size={14} color={colors.accentYellow} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.textMain }}>Parent Assistant</Text>
                <Text style={{ fontSize: 10, color: colors.textDim }}>
                  {selectedChild ? `Viewing: ${selectedChild.name}` : 'Add a child to get started'}
                </Text>
              </View>
              {messages.length > 0 && (
                <TouchableOpacity onPress={() => setMessages([])} activeOpacity={0.7}>
                  <Feather name="trash-2" size={14} color={colors.textDim} />
                </TouchableOpacity>
              )}
            </View>

            {/* Child switcher */}
            {children.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {children.map((ch, i) => (
                    <TouchableOpacity
                      key={ch.id}
                      onPress={() => { setSelectedChildIdx(i); setMessages([]); }}
                      activeOpacity={0.75}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 4,
                        borderRadius: 20, borderWidth: 1,
                        backgroundColor: i === selectedChildIdx ? colors.accentYellow + '22' : 'transparent',
                        borderColor: i === selectedChildIdx ? colors.accentYellow : colors.borderColor,
                      }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: i === selectedChildIdx ? colors.accentYellow : colors.textDim }}>
                        {ch.name.split(' ')[0]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: spacing.md, gap: 10, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={{ gap: 7, paddingTop: 4 }}>
                {selectedChild && (
                  <View style={{ backgroundColor: colors.accentYellow + '12', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.accentYellow + '30', marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentYellow, marginBottom: 3 }}>{selectedChild.name}</Text>
                    <Text style={{ fontSize: 10, color: colors.textDim, lineHeight: 16 }}>
                      {selectedChild.grade} · {(selectedChild.completedTopics?.length ?? 0)} topics done · {selectedChild.currentStreak ?? 0}-day streak
                    </Text>
                  </View>
                )}
                <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600', marginBottom: 2 }}>Ask me anything</Text>
                {QUICK_PROMPTS.map((q, i) => (
                  <TouchableOpacity key={i} onPress={() => send(q)} activeOpacity={0.75}
                    style={{ backgroundColor: colors.accentYellow + '10', borderWidth: 1, borderColor: colors.accentYellow + '30', borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ fontSize: 11, color: colors.accentYellow, fontWeight: '600' }}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              messages.map((msg, i) => (
                <View key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', gap: 4 }}>
                  <View style={{
                    backgroundColor: msg.role === 'user' ? colors.accentYellow + '22' : colors.cardDark,
                    borderWidth: 1,
                    borderColor: msg.role === 'user' ? colors.accentYellow + '45' : colors.borderColor,
                    borderRadius: radius.lg, padding: spacing.md, gap: 4,
                  }}>
                    {msg.role === 'ai' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accentYellow + '30', alignItems: 'center', justifyContent: 'center' }}>
                          <Feather name="cpu" size={8} color={colors.accentYellow} />
                        </View>
                        <Text style={{ fontSize: 9, color: colors.accentYellow, fontWeight: '700', letterSpacing: 0.5 }}>PARENT ASSISTANT</Text>
                      </View>
                    )}
                    {msg.role === 'ai' ? renderAIText(msg.text) : (
                      <Text style={{ fontSize: 12, color: colors.textMain }}>{msg.text}</Text>
                    )}
                  </View>
                </View>
              ))
            )}
            {loading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
                <ActivityIndicator size="small" color={colors.accentYellow} />
                <Text style={{ fontSize: 11, color: colors.textDim }}>Thinking...</Text>
              </View>
            )}
          </ScrollView>

          {/* Input area */}
          <View style={{ borderTopWidth: 1, borderTopColor: colors.borderColor, padding: spacing.md, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <TouchableOpacity
                onPress={toggleMic}
                activeOpacity={0.75}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  backgroundColor: listening ? P.rose + '20' : colors.cardDark,
                  borderWidth: 1, borderColor: listening ? P.rose : colors.borderColor,
                  borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8,
                }}>
                <Feather name="mic" size={13} color={listening ? P.rose : colors.textDim} />
                <Text style={{ fontSize: 11, color: listening ? P.rose : colors.textDim, fontWeight: '600' }}>
                  {listening ? 'Listening...' : 'Mic'}
                </Text>
              </TouchableOpacity>

              <TextInput
                style={{
                  flex: 1, backgroundColor: colors.bgDark, borderWidth: 1,
                  borderColor: colors.borderColor, borderRadius: radius.md,
                  paddingHorizontal: 10, paddingVertical: 8,
                  color: colors.textMain, fontSize: 12, maxHeight: 80,
                }}
                placeholder="Ask about your child... (Enter to send)"
                placeholderTextColor={colors.textDim}
                value={input}
                onChangeText={setInput}
                onKeyPress={handleKeyPress}
                returnKeyType="send"
                multiline
                blurOnSubmit={false}
              />
              <TouchableOpacity
                onPress={() => send(input)}
                disabled={!input.trim() || loading}
                activeOpacity={0.8}
                style={{
                  backgroundColor: input.trim() && !loading ? colors.accentYellow : colors.borderColor,
                  width: 36, height: 36, borderRadius: radius.md,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <Feather name="send" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 9, color: colors.textDim, textAlign: 'center' }}>
              Enter to send · Shift+Enter for new line
            </Text>
          </View>

        </View>
      </Animated.View>

      {/* Toggle tab */}
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.85}
        style={{
          position: 'absolute' as any,
          right: open ? PANEL_WIDTH : 0,
          top: '50%' as any,
          transform: [{ translateY: -44 }],
          backgroundColor: colors.accentYellow,
          width: 24, paddingVertical: 18,
          borderTopLeftRadius: radius.md,
          borderBottomLeftRadius: radius.md,
          alignItems: 'center', justifyContent: 'center', gap: 4,
          zIndex: 100,
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
        }}>
        <Feather name="cpu" size={11} color="#fff" />
        <Text style={{ fontSize: 8, color: '#fff', fontWeight: '800', transform: [{ rotate: '90deg' }], marginTop: 4 }}>AI</Text>
        <Feather name={open ? 'chevron-right' : 'chevron-left'} size={11} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}
