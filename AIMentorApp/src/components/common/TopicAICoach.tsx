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
import { askAIMentor } from '../../services/aiMentorApi';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

interface Props {
  topic: string;
  subject?: string;
  grade?: string;
  curriculum?: string;
}

export default function TopicAICoach({
  topic,
  subject = 'Mathematics',
  grade = 'Grade 3',
  curriculum = 'IB_PYP',
}: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedbackByMsg, setFeedbackByMsg] = useState<Record<number, number>>({});
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
  }, [open]);

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

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    Keyboard.dismiss();
    setInput('');
    const userMsg: Message = { role: 'user', text: q };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const result = await askAIMentor(q, grade, subject, curriculum, topic, user?.email, user?.role);
    setMessages(prev => [
      ...prev,
      { role: 'ai', text: result.error ? 'Sorry, I had trouble connecting. Please try again!' : result.answer },
    ]);
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
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
            {messages.map((msg, i) => (
              <View key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                <View
                  style={[
                    styles.bubble,
                    msg.role === 'user'
                      ? [styles.bubbleUser, { backgroundColor: userBubble }]
                      : [styles.bubbleAI,   { backgroundColor: aiBubble, borderColor: colors.borderColor }],
                  ]}
                >
                  <Text style={[
                    styles.bubbleText,
                    { color: msg.role === 'user' ? '#fff' : colors.textMain },
                  ]}>
                    {msg.text}
                  </Text>
                </View>
                {msg.role === 'ai' && i > 0 && (
                  <View style={styles.feedbackRow}>
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
                  </View>
                )}
              </View>
            ))}
            {loading && (
              <View style={[styles.bubble, styles.bubbleAI, { backgroundColor: aiBubble, borderColor: colors.borderColor }]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </ScrollView>

          {/* Input row */}
          <View style={[styles.inputRow, { borderTopColor: colors.borderColor, backgroundColor: panelBg }]}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.bgDark, color: colors.textMain, borderColor: colors.borderColor }]}
              placeholder={`Ask about ${topic}...`}
              placeholderTextColor={colors.textDim}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
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

const PANEL_HEIGHT = 420;

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
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleAI:   { alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 13, lineHeight: 19 },
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
    height: 40,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 13,
    borderWidth: 1,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
