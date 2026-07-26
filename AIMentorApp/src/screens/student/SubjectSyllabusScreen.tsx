/**
 * SubjectSyllabusScreen.tsx
 * Textbook-first syllabus view: Subject → collapsible chapters → topics.
 * Step 3 of the redesigned Learning Path flow:
 *   Learning Path → Curriculum → Subject → Syllabus (this screen) → Lesson
 *
 * Currently backed by a curated, verified dataset for CBSE Grade 6 English
 * (see src/data/cbseG6EnglishSyllabus.ts). Falls back to the existing flat
 * topic list (SubjectTopicsScreen) for any subject/grade/curriculum that
 * doesn't have curated chapter data yet.
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  StyleSheet, LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { g6EnglishStats, type SyllabusChapter } from '../../data/cbseG6EnglishSyllabus';
import { getSubjectSyllabus } from '../../data/syllabusRegistry';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Curated (chapter-accurate) syllabi, shared with LessonScreen via
// syllabusRegistry.ts. This is the pre-pipeline fallback for subjects that
// were hand-built/generated before the teacher upload pipeline existed —
// real teacher uploads (below) always take priority once they exist for a scope.
function getCuratedSyllabus(curriculum: string, grade: string, subject: string): SyllabusChapter[] | null {
  const chapters = getSubjectSyllabus(curriculum, grade, subject);
  return chapters.length > 0 ? chapters : null;
}

// Real syllabus a teacher published via Manage Syllabus (server/routes/syllabusImport.js
// POST /publish) — this is what closes the "teacher uploads a book -> students
// get a learning path" loop. Each topic carries a real DB `id` used to fetch
// its resolved Read/Listen/Practice content from topic_resources.
type DbTopic = { id: string; name: string; kind: string; page: string };
type DbUnit = { unitNo: number; title: string; topics: DbTopic[] };
async function fetchPublishedSyllabus(curriculum: string, grade: string, subject: string): Promise<DbUnit[]> {
  const res = await fetch(`${SERVER_URL}/teacher/syllabus/current?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}&curriculum=${encodeURIComponent(curriculum)}`);
  if (!res.ok) return [];
  const data = await res.json();
  // Keep chapters that have no lessons yet. The server now returns the book's
  // FULL chapter list (empty ones flagged `pending`), and dropping those here
  // put Class 11 Maths straight from Ch 1 Sets to Ch 3 Trigonometric Functions —
  // Ch 2 Relations and Functions, Ch 5 and Ch 11 simply vanished, which reads as
  // a missing syllabus rather than "not written yet".
  const units = (data.units || []);
  // If the server sent nothing usable at all, treat the subject as unpublished
  // so the caller still falls back to the curated syllabus.
  return units.some((u: DbUnit) => u.topics?.length > 0) ? units : [];
}

export default function SubjectSyllabusScreen({ navigation, route }: any) {
  const subject    = (route?.params?.subject    ?? 'English')     as string;
  const curriculum = (route?.params?.curriculum ?? 'CBSE')        as string;
  const grade      = (route?.params?.grade      ?? 'Grade 6')     as string;

  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { stats: studentStats } = useStudentData();
  const completedSet = useMemo(() => new Set(studentStats.completedTopics ?? []), [studentStats.completedTopics]);

  const [dbChapters, setDbChapters] = useState<SyllabusChapter[] | null>(null);
  const [loadingDb, setLoadingDb] = useState(true);

  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingDb(true);
    setLoadError(false);
    fetchPublishedSyllabus(curriculum, grade, subject).then((units) => {
      if (cancelled) return;
      // Real teacher-published content takes priority over the pre-pipeline
      // curated fallback — this is what makes the upload -> student loop real.
      setDbChapters(units.length > 0 ? (units as unknown as SyllabusChapter[]) : null);
      setLoadingDb(false);
    }).catch(() => {
      // A 404, a null body or a network failure must not leave the student on a
      // blank screen — fall through to the "being prepared" state below.
      if (cancelled) return;
      setLoadError(true);
      setLoadingDb(false);
    });
    return () => { cancelled = true; };
  }, [curriculum, grade, subject]);

  const chapters = dbChapters ?? getCuratedSyllabus(curriculum, grade, subject) ?? [];
  const isDbBacked = !!dbChapters;
  // Grade 1-2 NCERT books are genuinely two levels — a Unit (e.g. "My Family
  // and Me") directly containing individual poems/stories, with no chapter
  // tier between them. The database still stores one row per Unit with the
  // real poems/stories as its "topics" (no schema change was available to add
  // a proper Unit column), so here we only relabel: the row becomes "Unit N"
  // and its topics become "Chapter N" instead of "Topic N", matching what the
  // printed textbook page itself shows. Every other grade keeps the real
  // Chapter -> Topic labels unchanged.
  const isUnitShaped = curriculum === 'CBSE' && (grade === 'Grade 1' || grade === 'Grade 2');

  // A subject with no syllabus used to be auto-forwarded to the flat topic list.
  // When that list was empty too — Hindi, and any subject whose book has not been
  // parsed yet — the student landed on a blank screen with no explanation. Show
  // an explicit "being prepared" state instead, and keep the topic list as an
  // option the student can choose rather than an invisible redirect.
  const stats = g6EnglishStats(completedSet);

  const [openChapters, setOpenChapters] = useState<Set<number>>(new Set([0]));
  const [query, setQuery] = useState('');

  // Deep-link support: the Dashboard's Learning Path list links straight to a
  // specific chapter (e.g. tapping "Fables and Folk Tales" there should land
  // here with THAT chapter already expanded, not always chapter 1).
  const wantChapterTitle = route?.params?.chapterTitle as string | undefined;
  useEffect(() => {
    if (!wantChapterTitle || chapters.length === 0) return;
    const idx = chapters.findIndex(c => c.title === wantChapterTitle);
    if (idx !== -1) setOpenChapters(new Set([idx]));
  }, [wantChapterTitle, chapters]);

  function toggleChapter(idx: number) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenChapters(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function openLesson(chapter: SyllabusChapter, chapterIndex: number, topicIndex: number) {
    const topic = chapter.topics[topicIndex] as any;
    navigation.navigate('LessonScreen', {
      subject, curriculum, grade,
      chapterTitle: chapter.title,
      chapterIndex,
      topicIndex,
      // Real teacher-published topic — LessonScreen fetches its resolved
      // resources from the DB instead of the static curated dataset.
      topicId: isDbBacked ? topic?.id : undefined,
      topicName: isDbBacked ? topic?.name : undefined,
    });
  }

  const q = query.trim().toLowerCase();
  const filteredChapters = chapters
    .map((ch, ci) => {
      const chapterMatches = ch.title.toLowerCase().includes(q);
      const topics = ch.topics.filter(t => !q || chapterMatches || t.name.toLowerCase().includes(q));
      return { chapter: ch, ci, topics, chapterMatches };
    })
    .filter(x => !q || x.chapterMatches || x.topics.length > 0);

  // If a chapter or topic matches the search, force it open.
  const effectiveOpen = q ? new Set(filteredChapters.map(x => x.ci)) : openChapters;

  const overallPct = chapters.length
    ? Math.round((chapters.reduce((s, c) => s + c.topics.filter(t => completedSet.has(t.name)).length, 0) /
                   chapters.reduce((s, c) => s + c.topics.length, 0)) * 100)
    : 0;
  const startedChapters = chapters.filter(c => c.topics.some(t => completedSet.has(t.name))).length;

  if (loadingDb) {
    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title={subject} subtitle={`${curriculum} · ${grade}`} showBack onMenuPress={() => navigation.openDrawer()} />
          <View style={styles.emptyWrap}><ActivityIndicator color={colors.primary} /></View>
        </View>
      </ScreenLayout>
    );
  }

  if (chapters.length === 0) {
    // No curated syllabus for this subject/grade/curriculum yet — send to the
    // existing flat topic list so nothing regresses for other subjects.
    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title={subject} subtitle={`${curriculum} · ${grade}`} showBack onMenuPress={() => navigation.openDrawer()} />
          <View style={styles.emptyWrap}>
            <Feather name={loadError ? 'alert-circle' : 'book'} size={36} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              {loadError
                ? `We couldn't load the ${subject} syllabus just now. Please try again in a moment.`
                : `Syllabus content for ${subject} (${grade}) is currently being processed. Check back soon!`}
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              onPress={() => navigation.navigate('SubjectTopics', { subject, curriculum, grade })}
            >
              <Text style={styles.emptyBtnText}>View topic list instead</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={subject}
          subtitle={`${curriculum} · ${grade} · Full syllabus`}
          showBack
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Search */}
          <View style={[styles.searchBar, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
            <Feather name="search" size={15} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.textMain }]}
              placeholder="Search chapters or topics…"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
            />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Feather name="x" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Overall progress */}
          <View style={[styles.progressCard, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
            <View style={[styles.ring, { borderColor: colors.borderColor }]}>
              <Text style={[styles.ringPct, { color: colors.textMain }]}>{overallPct}%</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.progressLine, { color: colors.textMain }]}>
                {startedChapters} of {chapters.length} {isUnitShaped ? 'units' : 'chapters'} started
              </Text>
              <Text style={[styles.progressSub, { color: colors.textMuted }]}>
                {grade} {subject} · {chapters.length} {isUnitShaped ? 'units' : 'chapters'} · {stats.totalTopics} {isUnitShaped ? 'chapters' : 'topics'} total
              </Text>
            </View>
          </View>

          {/* Chapters — single column: a 2-column grid left an awkward gap
              next to whichever card was expanded to show its topics. */}
          {filteredChapters.map(({ chapter, ci, topics }) => {
            const isOpen = effectiveOpen.has(ci);
            const doneCount = chapter.topics.filter(t => completedSet.has(t.name)).length;
            const pct = chapter.topics.length ? Math.round((doneCount / chapter.topics.length) * 100) : 0;
            const complete = pct === 100;
            // `unitNo` is the textbook's chapter number, supplied by
            // /teacher/syllabus/current. Fall back to position only for the
            // older curated datasets that carry no number.
            const chapterNo = (chapter as any).unitNo ?? (ci + 1);
            // A chapter the book has but no lesson has been written for yet.
            const isPending = !!(chapter as any).pending || chapter.topics.length === 0;
            const subtopicNames: string[] = (chapter as any).subtopics || [];

            return (
              <View key={chapter.title} style={[styles.chapterCard, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
                <TouchableOpacity style={styles.chapterHead} activeOpacity={0.7} onPress={() => toggleChapter(ci)}>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={isOpen ? colors.primary : colors.textMuted}
                    style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}
                  />
                  <View style={[styles.chapterNum, { backgroundColor: complete ? colors.primary + '22' : colors.borderColor + '55' }]}>
                    <Text style={[styles.chapterNumText, { color: complete ? colors.primary : colors.textMuted }]}>{chapterNo}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {/* The book's own chapter number, never the array index —
                          a syllabus with any chapter still unwritten used to
                          renumber every chapter after it, so Chapter 3 appeared
                          as "Unit 2". */}
                      {/* Where the book gave no readable heading the title is
                          already "Chapter 7", so prefixing it produced
                          "Chapter 7: Chapter 7". Show the number once. */}
                      <Text style={[styles.chapterTitle, { color: colors.textMain }]}>
                        {/^chapter\s*\d+$/i.test(String(chapter.title || '').trim())
                          ? `${isUnitShaped ? 'Unit' : 'Chapter'} ${chapterNo}`
                          : `${isUnitShaped ? 'Unit' : 'Chapter'} ${chapterNo}: ${chapter.title}`}
                      </Text>
                      {(chapter.comingSoon || isPending) && (
                        <View style={[styles.comingSoonBadge, { borderColor: colors.borderColor, backgroundColor: colors.borderColor + '55' }]}>
                          <Text style={[styles.comingSoonText, { color: colors.textMuted }]}>Coming soon</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.chapterSub, { color: colors.textMuted }]}>
                      {isPending
                        ? `${subtopicNames.length || 0} sub-topic${subtopicNames.length === 1 ? '' : 's'} in the textbook`
                        : isUnitShaped
                          ? `${chapter.topics.length} chapter${chapter.topics.length === 1 ? '' : 's'}`
                          : `${chapter.topics.length} topic${chapter.topics.length === 1 ? '' : 's'}`}
                    </Text>
                  </View>
                  <View style={styles.chapterProgress}>
                    <View style={[styles.progBarTrack, { backgroundColor: colors.borderColor }]}>
                      <View style={[styles.progBarFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
                    </View>
                    <Text style={[styles.progPctText, { color: colors.textMuted }]}>{pct}%</Text>
                  </View>
                </TouchableOpacity>

                {isOpen && isPending && (
                  <View style={styles.topicGrid}>
                    {/* The chapter exists in the textbook but has no lesson yet.
                        Listing its real sub-topics tells the student what the
                        chapter covers instead of opening onto nothing. */}
                    {subtopicNames.length === 0 ? (
                      <Text style={[styles.chapterSub, { color: colors.textMuted, paddingHorizontal: 4, paddingVertical: 8 }]}>
                        Lessons for this chapter are being prepared.
                      </Text>
                    ) : subtopicNames.map((name, si) => (
                      <View
                        key={name}
                        style={[styles.topicItem, { backgroundColor: colors.bgDark, borderColor: colors.borderColor, opacity: 0.6 }]}
                      >
                        <View style={[styles.topicDot, { backgroundColor: colors.borderColor }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.topicLabel, { color: colors.textMain }]} numberOfLines={1}>
                            Sub-topic {si + 1}: {name}
                          </Text>
                          <Text style={[styles.topicKind, { color: colors.textMuted }]}>Being prepared</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {isOpen && !isPending && (
                  <View style={styles.topicGrid}>
                    {topics.map((t) => {
                      const ti = chapter.topics.indexOf(t);
                      // A topic's own comingSoon flag wins when set; otherwise
                      // it inherits the chapter's — lets one topic in an
                      // otherwise-unready chapter go live on its own.
                      const topicComingSoon = t.comingSoon ?? chapter.comingSoon;
                      return (
                        <TouchableOpacity
                          key={t.name}
                          style={[styles.topicItem, { backgroundColor: colors.bgDark, borderColor: colors.borderColor, opacity: topicComingSoon ? 0.6 : 1 }]}
                          activeOpacity={topicComingSoon ? 1 : 0.7}
                          disabled={!!topicComingSoon}
                          onPress={() => openLesson(chapter, ci, ti)}
                        >
                          <View style={[styles.topicDot, { backgroundColor: completedSet.has(t.name) ? colors.primary : colors.borderColor }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.topicLabel, { color: colors.textMain }]} numberOfLines={1}>
                              {/^chapter\s*\d+$/i.test(String(t.name || '').trim())
                                ? `${isUnitShaped ? 'Chapter' : 'Topic'} ${ti + 1}`
                                : `${isUnitShaped ? 'Chapter' : 'Topic'} ${ti + 1}: ${t.name}`}
                            </Text>
                            {/* Only the "Coming soon" state is worth a second
                                line. The `kind` field said "Chapter" on older
                                rows and "Topic" on newer ones, so every item
                                carried a stray, inconsistent word under a label
                                that already reads "Topic 3: ...". */}
                            {!!topicComingSoon && (
                              <Text style={[styles.topicKind, { color: colors.textMuted }]}>Coming soon</Text>
                            )}
                          </View>
                          {!topicComingSoon && <Feather name="chevron-right" size={14} color={colors.textMuted} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  content: { padding: spacing.xl, paddingBottom: 40, gap: spacing.lg },

  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-start', minWidth: 260, maxWidth: 360 },
  searchInput: { flex: 1, fontSize: 13, outlineStyle: 'none' } as any,

  progressCard:  { flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  ring:          { width: 52, height: 52, borderRadius: 26, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  ringPct:       { fontSize: 13, fontWeight: '700' },
  progressLine:  { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700' },
  progressSub:   { fontSize: 12, marginTop: 2 },

  chapterCard: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  chapterHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  chapterNum:  { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chapterNumText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700' },
  chapterTitle:   { fontFamily: fonts.serif, fontSize: 15.5, fontWeight: '700' },
  chapterSub:     { fontSize: 11.5, marginTop: 2 },
  comingSoonBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  comingSoonText:  { fontSize: 10, fontWeight: '600' },
  chapterProgress: { alignItems: 'flex-end', gap: 4, width: 60 },
  progBarTrack: { width: 56, height: 4, borderRadius: 3, overflow: 'hidden' },
  progBarFill:  { height: '100%', borderRadius: 3 },
  progPctText:  { fontSize: 10.5, fontFamily: fonts.serif },

  topicGrid: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  topicItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  topicDot:  { width: 8, height: 8, borderRadius: 4 },
  topicLabel: { fontSize: 13.5, fontWeight: '600' },
  topicKind:  { fontSize: 11, marginTop: 1 },

  emptyWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  emptyText:   { fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  emptyBtn:    { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.lg },
  emptyBtnText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
});
