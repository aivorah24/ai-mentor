/**
 * TeacherAIPanel.tsx
 * Collapsible right-side AI assistant for teachers.
 * Features: text chat, image/PDF upload, mic voice input, Enter to send.
 * No student guardrails — professional educator context.
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
  rose:  '#BAA467',
  green: '#BAA467',
  gold:  '#BAA467',
  peach: '#BAA467',
  teal:  '#BAA467',
  slate: '#BAA467',
};

const PANEL_WIDTH = 340;

const QUICK_PROMPTS = [
  'Who needs urgent help this week?',
  'Which topics are class weak points?',
  'Give me a full class summary report',
  'Who is ready for advanced work?',
  'Suggest focus areas for next week',
];

type Attachment = {
  type: 'image' | 'pdf';
  name: string;
  preview?: string;   // base64 data URL for images
  base64?: string;    // raw base64 for API
  mimeType?: string;
  pdfText?: string;   // extracted text for PDFs
};

type Msg = {
  role: 'user' | 'ai';
  text: string;
  attachment?: Attachment;
};

// ── Web Speech Recognition ────────────────────────────────
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

// ── PDF text extraction (browser) ─────────────────────────
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function loadPdfJs(): Promise<any> {
  let pdfjsLib = (window as any).pdfjsLib;
  if (pdfjsLib) return pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  pdfjsLib = (window as any).pdfjsLib;
  if (pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib;
}

async function extractPdfText(file: File): Promise<string> {
  try {
    const pdfjsLib = await loadPdfJs();
    if (!pdfjsLib) return `[PDF: ${file.name} — could not load PDF.js]`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(' ') + '\n';
    }
    return text.trim() || `[PDF: ${file.name} — no extractable text found]`;
  } catch (e: any) {
    return `[PDF: ${file.name} — extraction error: ${e?.message || 'unknown'}]`;
  }
}

export default function TeacherAIPanel() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const fileInputRef = useRef<any>(null);

  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : [])
      .then(setStudents)
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

  const classSummary = students.map(s =>
    `${s.name} (${s.grade}, ${s.curriculum}): ${s.progressPct || 0}% progress, ` +
    `${(s.completedTopics || []).length} topics done [${(s.completedTopics || []).join(', ') || 'none'}], ` +
    `${s.currentStreak || 0}-day streak, ${s.assignmentsDone || 0} assignments, ` +
    `last active: ${s.lastActive ? new Date(s.lastActive).toDateString() : 'never'}, ` +
    `${s.needsAttention ? 'NEEDS ATTENTION' : 'on track'}`
  ).join('\n');

  const { start: startMic, stop: stopMic } = useSpeechRecognition(
    (text) => setInput(prev => (prev + ' ' + text).trim()),
    () => setListening(false),
  );

  const toggleMic = () => {
    if (listening) { stopMic(); setListening(false); }
    else { setListening(true); startMic(); }
  };

  const processFile = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(',')[1];
        setAttachment({ type: 'image', name: file.name, preview: dataUrl, base64, mimeType: file.type });
      };
      reader.readAsDataURL(file);
    } else if (isPdf) {
      // Read as base64 for server-side parsing (handles scanned PDFs too)
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(',')[1];
        // Also try client-side text extraction (works for text-layer PDFs)
        const pdfText = await extractPdfText(file);
        setAttachment({ type: 'pdf', name: file.name, pdfText, base64, mimeType: 'application/pdf' });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileChange = async (e: any) => {
    const file: File = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Clipboard paste support (Ctrl+V image paste)
  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) await processFile(file);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [open]);

  const send = useCallback(async (text: string, att?: Attachment | null) => {
    const hasContent = text.trim() || att;
    if (!hasContent || loading) return;

    const userMsg: Msg = {
      role: 'user',
      text: text.trim() || (att?.type === 'image' ? 'Analyse this image' : 'Analyse this PDF'),
      attachment: att || undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachment(null);
    setLoading(true);

    try {
      const body: any = {
        question: userMsg.text,
        classSummary,
        teacherEmail: user?.email || '',
      };
      if (att?.type === 'image') {
        body.imageBase64 = att.base64;
        body.imageType = att.mimeType;
      } else if (att?.type === 'pdf') {
        body.pdfText = att.pdfText;
        // Send raw base64 so server can parse scanned PDFs server-side
        if (att.base64) {
          body.pdfBase64 = att.base64;
          body.pdfName = att.name;
        }
      }

      const res = await fetch(`${SERVER_URL}/ask/teacher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.answer || 'No response.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Could not reach AI server.' }]);
    } finally {
      setLoading(false);
    }
  }, [loading, classSummary, user?.email]);

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      send(input, attachment);
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
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: P.slate, marginTop: 8, flexShrink: 0 }} />
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}>
            <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: P.slate + '25', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="cpu" size={15} color={P.slate} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.textMain }}>AI Assistant</Text>
              <Text style={{ fontSize: 10, color: colors.textDim }}>{students.length} students · Groq Vision</Text>
            </View>
            {messages.length > 0 && (
              <TouchableOpacity onPress={() => setMessages([])} activeOpacity={0.7}>
                <Feather name="trash-2" size={14} color={colors.textDim} />
              </TouchableOpacity>
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
                <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600', marginBottom: 2 }}>Quick actions</Text>
                {QUICK_PROMPTS.map((q, i) => (
                  <TouchableOpacity key={i} onPress={() => send(q, null)} activeOpacity={0.75}
                    style={{ backgroundColor: P.slate + '12', borderWidth: 1, borderColor: P.slate + '30', borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ fontSize: 11, color: P.slate, fontWeight: '600' }}>{q}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ marginTop: 8, padding: spacing.sm, backgroundColor: colors.cardDark, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Text style={{ fontSize: 10, color: colors.textDim, lineHeight: 16 }}>
                    You can also attach images or PDFs (assignments, worksheets) for AI grading and feedback.
                  </Text>
                </View>
              </View>
            ) : (
              messages.map((msg, i) => (
                <View key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', gap: 4 }}>
                  {/* Attachment preview */}
                  {msg.attachment?.type === 'image' && msg.attachment.preview && (
                    <Image
                      source={{ uri: msg.attachment.preview }}
                      style={{ width: 180, height: 120, borderRadius: radius.md, alignSelf: 'flex-end' }}
                      resizeMode="cover"
                    />
                  )}
                  {msg.attachment?.type === 'pdf' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: P.peach + '20', borderRadius: radius.md, padding: 8, alignSelf: 'flex-end', borderWidth: 1, borderColor: P.peach + '40' }}>
                      <Feather name="file-text" size={14} color={P.peach} />
                      <Text style={{ fontSize: 11, color: P.peach, fontWeight: '600' }} numberOfLines={1}>{msg.attachment.name}</Text>
                    </View>
                  )}
                  {/* Message bubble */}
                  <View style={{
                    backgroundColor: msg.role === 'user' ? P.slate + '22' : colors.cardDark,
                    borderWidth: 1,
                    borderColor: msg.role === 'user' ? P.slate + '45' : colors.borderColor,
                    borderRadius: radius.lg, padding: spacing.md, gap: 4,
                  }}>
                    {msg.role === 'ai' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: P.slate + '30', alignItems: 'center', justifyContent: 'center' }}>
                          <Feather name="cpu" size={8} color={P.slate} />
                        </View>
                        <Text style={{ fontSize: 9, color: P.slate, fontWeight: '700', letterSpacing: 0.5 }}>AI ASSISTANT</Text>
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
                <ActivityIndicator size="small" color={P.slate} />
                <Text style={{ fontSize: 11, color: colors.textDim }}>Analysing...</Text>
              </View>
            )}
          </ScrollView>

          {/* Attachment preview bar */}
          {attachment && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 8, backgroundColor: colors.cardDark, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
              {attachment.type === 'image' && attachment.preview ? (
                <Image source={{ uri: attachment.preview }} style={{ width: 36, height: 36, borderRadius: radius.sm }} resizeMode="cover" />
              ) : (
                <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: P.peach + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="file-text" size={16} color={P.peach} />
                </View>
              )}
              <Text style={{ flex: 1, fontSize: 11, color: colors.textMuted, fontWeight: '600' }} numberOfLines={1}>{attachment.name}</Text>
              <TouchableOpacity onPress={() => setAttachment(null)}>
                <Feather name="x" size={14} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          )}

          {/* Input area */}
          <View style={{ borderTopWidth: 1, borderTopColor: colors.borderColor, padding: spacing.md, gap: 8 }}>
            {/* Action row: attach + mic */}
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              {/* Hidden file input */}
              {Platform.OS === 'web' && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              )}
              <TouchableOpacity
                onPress={() => fileInputRef.current?.click()}
                activeOpacity={0.75}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Feather name="paperclip" size={13} color={colors.textDim} />
                <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600' }}>Image / PDF</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={toggleMic}
                activeOpacity={0.75}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: listening ? P.rose + '20' : colors.cardDark, borderWidth: 1, borderColor: listening ? P.rose : colors.borderColor, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Feather name="mic" size={13} color={listening ? P.rose : colors.textDim} />
                <Text style={{ fontSize: 11, color: listening ? P.rose : colors.textDim, fontWeight: '600' }}>
                  {listening ? 'Listening...' : 'Mic'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Text input + send */}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <TextInput
                style={{
                  flex: 1, backgroundColor: colors.bgDark, borderWidth: 1,
                  borderColor: colors.borderColor, borderRadius: radius.md,
                  paddingHorizontal: 10, paddingVertical: 8,
                  color: colors.textMain, fontSize: 12, maxHeight: 80,
                }}
                placeholder="Ask about students, assignments... (Enter to send)"
                placeholderTextColor={colors.textDim}
                value={input}
                onChangeText={setInput}
                onKeyPress={handleKeyPress}
                returnKeyType="send"
                multiline
                blurOnSubmit={false}
              />
              <TouchableOpacity
                onPress={() => send(input, attachment)}
                disabled={(!input.trim() && !attachment) || loading}
                activeOpacity={0.8}
                style={{
                  backgroundColor: (input.trim() || attachment) && !loading ? P.slate : colors.borderColor,
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
          backgroundColor: P.slate,
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
