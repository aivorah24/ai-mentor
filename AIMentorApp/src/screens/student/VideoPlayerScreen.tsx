import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

import SERVER_URL from '../../config/serverUrl';

interface Video {
  id: string;
  title: string;
  topic: string;
  grade: string;
  embedUrl: string;
  url: string;
  description: string;
  source: string;
}

// ── Web-only iframe component ────────────────────────────────
// On web: render iframe. On native: show open-in-browser button.

function VideoEmbed({ embedUrl, title }: { embedUrl: string; title: string }) {
  const { colors } = useTheme();

  if (Platform.OS === 'web') {
    // Use dangerouslySetInnerHTML via a div ref for web
    return (
      <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
        {/* @ts-ignore — iframe is valid on web */}
        <iframe
          src={embedUrl}
          title={title}
          width="100%"
          height="100%"
          frameBorder="0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          style={{ border: 'none', borderRadius: 12 }}
        />
      </View>
    );
  }

  // Native fallback — open in browser
  return (
    <TouchableOpacity
      style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: colors.cardDark, alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1, borderColor: colors.borderColor }}
      onPress={() => Linking.openURL(embedUrl)}
      activeOpacity={0.8}
    >
      <Feather name="play-circle" size={48} color={colors.accentYellow} />
      <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 15 }}>{title}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>Tap to open in browser</Text>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────

export default function VideoPlayerScreen({ navigation, route }: any) {
  const { topic = '', grade = 'Grade 3' } = route?.params ?? {};
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER_URL}/videos?topic=${encodeURIComponent(topic)}&grade=${encodeURIComponent(grade)}`)
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setVideos(list);
        if (list.length > 0) setSelected(list[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [topic, grade]);

  const sourceColor: Record<string, string> = {
    vyond:   '#BAA467',
    youtube: '#ef4444',
    vimeo:   '#9FB2A4',
    custom:  '#BAA467',
  };

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={topic}
          subtitle={`${grade} · IB PYP · Video Library`}
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />
        <View style={styles.content}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.accentYellow} />
              <Text style={styles.loadingText}>Loading videos…</Text>
            </View>
          ) : videos.length === 0 ? (
            <View style={styles.center}>
              <Feather name="film" size={48} color={colors.textDim} />
              <Text style={styles.emptyTitle}>No videos yet</Text>
              <Text style={styles.emptyText}>
                Your teacher hasn't added a video for "{topic}" yet.{'\n'}
                Try the AI Video Lesson instead!
              </Text>
              <TouchableOpacity
                style={[styles.aiBtn, { backgroundColor: colors.accentYellow }]}
                onPress={() => navigation.navigate('VideoLesson', { topic, grade })}
                activeOpacity={0.8}
              >
                <Feather name="play-circle" size={16} color="white" />
                <Text style={styles.aiBtnText}>Open AI Lesson</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.layout}>
              {/* Main player */}
              <View style={styles.playerCol}>
                {selected && (
                  <>
                    <VideoEmbed embedUrl={selected.embedUrl || selected.url} title={selected.title} />
                    <View style={styles.videoInfo}>
                      <View style={styles.videoInfoTop}>
                        <View>
                          <Text style={styles.videoTitle}>{selected.title}</Text>
                          <Text style={styles.videoMeta}>{selected.topic} · {selected.grade}</Text>
                        </View>
                        <View style={[styles.sourceBadge, { backgroundColor: (sourceColor[selected.source] ?? colors.accentYellow) + '18', borderColor: (sourceColor[selected.source] ?? colors.accentYellow) + '40' }]}>
                          <Text style={[styles.sourceBadgeText, { color: sourceColor[selected.source] ?? colors.accentYellow }]}>{selected.source.toUpperCase()}</Text>
                        </View>
                      </View>
                      {selected.description ? <Text style={styles.videoDesc}>{selected.description}</Text> : null}
                    </View>
                    {/* After watching — AI lesson option */}
                    <TouchableOpacity
                      style={styles.aiCard}
                      onPress={() => navigation.navigate('VideoLesson', { topic, grade })}
                      activeOpacity={0.8}
                    >
                      <Feather name="cpu" size={18} color={colors.accentYellow} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.aiCardTitle}>Want more practice?</Text>
                        <Text style={styles.aiCardSub}>Open the AI interactive lesson with quiz</Text>
                      </View>
                      <Feather name="arrow-right" size={16} color={colors.accentYellow} />
                    </TouchableOpacity>
                  </>
                )}
              </View>

              {/* Sidebar — video list if multiple */}
              {videos.length > 1 && (
                <View style={styles.sideCol}>
                  <Text style={styles.sideTitle}>More Videos</Text>
                  {videos.map(v => (
                    <TouchableOpacity
                      key={v.id}
                      style={[styles.sideCard, selected?.id === v.id && styles.sideCardActive]}
                      onPress={() => setSelected(v)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.sideIcon, { backgroundColor: (sourceColor[v.source] ?? colors.accentYellow) + '18' }]}>
                        <Feather name="play" size={14} color={sourceColor[v.source] ?? colors.accentYellow} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sideCardTitle} numberOfLines={2}>{v.title}</Text>
                        <Text style={styles.sideCardMeta}>{v.source.toUpperCase()}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  content: { flex: 1, padding: spacing.xl },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: c.textMuted, fontSize: 13 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: c.textMain },
  emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, marginTop: 8 },
  aiBtnText: { color: 'white', fontWeight: '700', fontSize: 14 },

  layout: { flex: 1, flexDirection: 'row', gap: spacing.xl },
  playerCol: { flex: 2, gap: spacing.lg },
  sideCol: { flex: 1, gap: spacing.md },

  videoInfo: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.lg, gap: 6,
  },
  videoInfoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  videoTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  videoMeta: { fontSize: 12, color: c.textMuted },
  sourceBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  sourceBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  videoDesc: { fontSize: 13, color: c.textMuted, lineHeight: 18 },

  aiCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    backgroundColor: c.accentYellow + '10', borderWidth: 1, borderColor: c.accentYellow + '25',
    borderRadius: radius.lg, padding: spacing.lg,
  },
  aiCardTitle: { fontSize: 13, fontWeight: '700', color: c.textMain },
  aiCardSub: { fontSize: 12, color: c.textMuted },

  sideTitle: { fontSize: 14, fontWeight: '700', color: c.textMain },
  sideCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.md,
  },
  sideCardActive: { borderColor: c.accentYellow, backgroundColor: 'rgba(186,164,103,0.08)' },
  sideIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sideCardTitle: { fontSize: 12, fontWeight: '600', color: c.textMain },
  sideCardMeta: { fontSize: 10, color: c.textMuted, marginTop: 2 },
});
