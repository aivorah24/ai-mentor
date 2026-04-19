import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface StoryState {
  segment: string;
  choices: string[];
  isEnd:   boolean;
}

export default function AIStorytellerScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const { topic, chapterId, unit } = route.params ?? {};

  const [loading,      setLoading]      = useState(false);
  const [ttsLoading,   setTtsLoading]   = useState(false);
  const [story,        setStory]        = useState<StoryState | null>(null);
  const [storyHistory, setStoryHistory] = useState<string[]>([]);
  const [partCount,    setPartCount]    = useState(0);
  const [error,        setError]        = useState('');

  const startStory = useCallback(async () => {
    setLoading(true);
    setStory(null);
    setStoryHistory([]);
    setPartCount(0);
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/modules/storyteller`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic, unit, storyHistory: [] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStory(data);
      setStoryHistory([data.segment]);
      setPartCount(1);
      if (data.segment) playTTS(data.segment);
    } catch {
      setError('Could not start the story. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [topic]);

  const makeChoice = useCallback(async (choice: string) => {
    if (!story) return;
    setLoading(true);
    setError('');
    try {
      const newHistory = [...storyHistory];
      const res = await fetch(`${SERVER_URL}/modules/storyteller`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic, unit, choice, storyHistory: newHistory }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStory(data);
      setStoryHistory(prev => [...prev, data.segment]);
      setPartCount(prev => prev + 1);
      if (data.segment) playTTS(data.segment);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [topic, story, storyHistory]);

  const playTTS = async (text: string) => {
    setTtsLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/lesson/tts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.audioUrl) {
        const audio = new Audio(`${SERVER_URL}${data.audioUrl}`);
        audio.play();
      } else if (data.audio) {
        const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
        audio.play();
      }
    } catch (_) {}
    finally { setTtsLoading(false); }
  };

  const s = makeStyles(colors);

  return (
    <ScreenLayout>
      <View style={[s.screen, { backgroundColor: colors.bgDark }]}>
        <Header
          title="AI Storyteller"
          subtitle={`Chapter ${chapterId}: ${topic}`}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Label */}
          <View style={s.row}>
            <View style={[s.badge, { backgroundColor: colors.accentPurple + '20' }]}>
              <Feather name="book-open" size={13} color={colors.accentPurple} />
              <Text style={[s.badgeText, { color: colors.accentPurple }]}>Story Time</Text>
            </View>
            <Text style={[s.chapterLabel, { color: colors.textMuted }]}>{topic}</Text>
          </View>

          {/* Progress dots */}
          {partCount > 0 && (
            <View style={s.progressRow}>
              {[1, 2, 3, 4].map(i => (
                <View
                  key={i}
                  style={[
                    s.dot,
                    {
                      backgroundColor: i <= partCount
                        ? colors.accentPurple
                        : colors.borderColor,
                    },
                  ]}
                />
              ))}
              <Text style={[s.progressLabel, { color: colors.textMuted }]}>
                Part {partCount} of 4
              </Text>
            </View>
          )}

          {/* Start screen */}
          {!story && !loading && (
            <View style={[s.startCard, { backgroundColor: colors.cardDark, borderColor: colors.accentPurple + '40' }]}>
              <View style={[s.storyIcon, { backgroundColor: colors.accentPurple + '20' }]}>
                <Feather name="book-open" size={40} color={colors.accentPurple} />
              </View>
              <Text style={[s.startTitle, { color: colors.textMain }]}>
                A story about {topic}!
              </Text>
              <Text style={[s.startSub, { color: colors.textMuted }]}>
                Go on an adventure where maths saves the day. You choose what happens next!
              </Text>
              <TouchableOpacity
                style={[s.startBtn, { backgroundColor: colors.accentPurple }]}
                onPress={startStory}
              >
                <Feather name="play" size={16} color="#fff" />
                <Text style={s.startBtnText}>Begin the Story</Text>
              </TouchableOpacity>
            </View>
          )}

          {loading && (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.accentPurple} />
              <Text style={[s.hint, { color: colors.textMuted, marginTop: 12 }]}>
                Writing the next part of the story…
              </Text>
            </View>
          )}

          {error ? (
            <View style={s.center}>
              <Feather name="alert-circle" size={28} color={colors.accentRed} />
              <Text style={[s.hint, { color: colors.textMuted, marginTop: 8 }]}>{error}</Text>
            </View>
          ) : null}

          {story && !loading && (
            <>
              {/* Story segment */}
              <View style={[s.storyCard, { backgroundColor: colors.cardDark, borderColor: colors.accentPurple + '30' }]}>
                <View style={s.cardHeader}>
                  <Feather name="feather" size={16} color={colors.accentPurple} />
                  <Text style={[s.cardTitle, { color: colors.accentPurple }]}>
                    {story.isEnd ? 'The End' : `Part ${partCount}`}
                  </Text>
                  <TouchableOpacity
                    style={s.speakBtn}
                    onPress={() => playTTS(story.segment)}
                    disabled={ttsLoading}
                  >
                    {ttsLoading
                      ? <ActivityIndicator size="small" color={colors.textMuted} />
                      : <Feather name="volume-2" size={16} color={colors.textMuted} />
                    }
                  </TouchableOpacity>
                </View>
                <Text style={[s.storyText, { color: colors.textMain }]}>{story.segment}</Text>
              </View>

              {/* Choices */}
              {!story.isEnd && story.choices.length > 0 && (
                <View style={s.choicesBlock}>
                  <Text style={[s.choicesLabel, { color: colors.textMuted }]}>
                    What happens next? You decide!
                  </Text>
                  {story.choices.map((choice, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[s.choiceBtn, { backgroundColor: colors.cardDark, borderColor: colors.accentPurple + '50' }]}
                      onPress={() => makeChoice(choice)}
                      activeOpacity={0.75}
                    >
                      <View style={[s.choiceLetter, { backgroundColor: colors.accentPurple }]}>
                        <Text style={s.choiceLetterText}>{String.fromCharCode(65 + i)}</Text>
                      </View>
                      <Text style={[s.choiceText, { color: colors.textMain }]}>
                        {choice.replace(/^Choice [ABC]:\s*/i, '')}
                      </Text>
                      <Feather name="chevron-right" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* End screen */}
              {story.isEnd && (
                <View style={[s.endCard, { backgroundColor: colors.accentYellow + '10', borderColor: colors.accentYellow + '30' }]}>
                  <Feather name="star" size={28} color={colors.accentYellow} />
                  <Text style={[s.endTitle, { color: colors.textMain }]}>Amazing! You finished the story!</Text>
                  <Text style={[s.endSub, { color: colors.textMuted }]}>
                    The hero used {topic} to save the day — just like you will!
                  </Text>
                  <View style={s.endBtns}>
                    <TouchableOpacity
                      style={[s.btn, { backgroundColor: colors.accentPurple, flex: 1 }]}
                      onPress={startStory}
                    >
                      <Feather name="refresh-cw" size={14} color="#fff" />
                      <Text style={s.btnText}>New Story</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.btn, { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, flex: 1 }]}
                      onPress={() => navigation.navigate('NCERTChapters')}
                    >
                      <Feather name="grid" size={14} color={colors.textMuted} />
                      <Text style={[s.btnText, { color: colors.textMuted }]}>All Chapters</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    screen:          { flex: 1 },
    content:         { padding: spacing.xl, paddingBottom: 48, gap: spacing.md },
    center:          { alignItems: 'center', paddingVertical: 40 },
    row:             { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge:           { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    badgeText:       { fontSize: 12, fontWeight: '700' },
    chapterLabel:    { fontSize: 12 },
    progressRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot:             { width: 10, height: 10, borderRadius: 5 },
    progressLabel:   { fontSize: 12, marginLeft: 4 },
    startCard:       { borderRadius: radius.lg, borderWidth: 1, padding: 28, alignItems: 'center', gap: 14 },
    storyIcon:       { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
    startTitle:      { fontSize: 18, fontWeight: '700', textAlign: 'center' },
    startSub:        { fontSize: 14, textAlign: 'center', lineHeight: 20 },
    startBtn:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: radius.md, marginTop: 8 },
    startBtnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
    storyCard:       { borderRadius: radius.lg, borderWidth: 1, padding: 18, gap: 12 },
    cardHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle:       { fontSize: 14, fontWeight: '700', flex: 1 },
    speakBtn:        { padding: 4 },
    storyText:       { fontSize: 16, lineHeight: 26, fontWeight: '400' },
    choicesBlock:    { gap: 10 },
    choicesLabel:    { fontSize: 13, fontWeight: '600', marginBottom: 2 },
    choiceBtn:       { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, borderWidth: 1, padding: 14 },
    choiceLetter:    { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    choiceLetterText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
    choiceText:      { fontSize: 14, lineHeight: 20, flex: 1 },
    endCard:         { borderRadius: radius.lg, borderWidth: 1, padding: 24, alignItems: 'center', gap: 10 },
    endTitle:        { fontSize: 17, fontWeight: '700', textAlign: 'center' },
    endSub:          { fontSize: 13, textAlign: 'center', lineHeight: 19 },
    endBtns:         { flexDirection: 'row', gap: spacing.md, marginTop: 8, width: '100%' },
    btn:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md },
    btnText:         { color: '#fff', fontWeight: '700', fontSize: 13 },
    hint:            { fontSize: 13, textAlign: 'center' },
  });
}
