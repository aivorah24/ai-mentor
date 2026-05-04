import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

const GOLD = '#C5A56A';
const GOLD_BG = '#C5A56A18';
const GOLD_BORDER = '#C5A56A40';

const ICONS = [
  'check-circle','book-open','sun','moon','droplet',
  'activity','shield','smile','star','coffee',
  'edit-3','music','heart','zap','wind',
] as const;

const COIN_OPTIONS = ['5', '10', '15', '20'];

// Prepopulated task suggestions per icon
const TASK_SUGGESTIONS: Record<string, string[]> = {
  'check-circle': ['Complete homework', 'Tidy up your room', 'Pack school bag'],
  'book-open':    ['Read for 20 minutes', 'Read a storybook', 'Practice spellings'],
  'sun':          ['Morning exercise', 'Wake up on time', 'Drink water in the morning'],
  'moon':         ['Sleep by 9 PM', 'No screen time after 8 PM', 'Brush teeth before bed'],
  'droplet':      ['Drink 6 glasses of water', 'Water the plants', 'Wash hands before meals'],
  'activity':     ['30 min outdoor play', 'Skipping for 10 minutes', 'Yoga or stretching'],
  'shield':       ['No junk food today', 'Eat fruits and vegetables', 'Take vitamins'],
  'smile':        ['Help a family member', 'Say something kind to someone', 'Practice gratitude'],
  'star':         ['Complete Aivorah lesson', 'Practise maths for 15 mins', 'Revise today\'s chapters'],
  'coffee':       ['Eat breakfast on time', 'Finish lunch without distraction', 'No sugar today'],
  'edit-3':       ['Write in your journal', 'Practice handwriting', 'Draw or sketch for 10 mins'],
  'music':        ['Practice instrument for 15 mins', 'Listen to calm music', 'Sing along to a song'],
  'heart':        ['Call grandparents', 'Do something kind', 'Help with household chores'],
  'zap':          ['Study for 1 hour', 'Complete all assignments', 'Review notes from school'],
  'wind':         ['10 min meditation', 'Deep breathing exercise', 'Spend time outdoors'],
};

export default function ParentDailyTasksScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const parentEmail = user?.email || '';

  // Children
  const [children, setChildren] = useState<any[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [selectedChild, setSelectedChild] = useState<any>(null);

  // Tasks
  const [tasks, setTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // New task form
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState<string>('check-circle');
  const [coins, setCoins] = useState('5');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchChildren = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setChildren(list);
        if (list.length > 0 && !selectedChild) setSelectedChild(list[0]);
      }
    } catch {}
    finally { setLoadingChildren(false); setRefreshing(false); }
  }, [parentEmail]);

  const fetchTasks = useCallback(async (child: any) => {
    if (!child?.id) return;
    setLoadingTasks(true);
    try {
      const res = await fetch(`${SERVER_URL}/habits/parent-tasks?childId=${child.id}`);
      if (res.ok) setTasks(await res.json());
    } catch {}
    finally { setLoadingTasks(false); }
  }, []);

  useEffect(() => { fetchChildren(); }, [fetchChildren]);
  useEffect(() => { if (selectedChild) fetchTasks(selectedChild); }, [selectedChild, fetchTasks]);

  async function addTask() {
    if (!label.trim()) { setError('Please enter a task description.'); return; }
    if (!selectedChild?.id) { setError('Select a child first.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${SERVER_URL}/habits/parent-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentEmail,
          childId: selectedChild.id,
          label: label.trim(),
          icon,
          coins: parseInt(coins) || 5,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Could not save task.'); return; }
      const newTask = await res.json();
      setTasks(prev => [newTask, ...prev]);
      setLabel('');
      setIcon('check-circle');
      setCoins('5');
    } catch { setError('Network error. Check server is running.'); }
    finally { setSaving(false); }
  }

  async function deleteTask(taskId: string) {
    setTasks(prev => prev.filter(t => t.id !== taskId)); // optimistic
    try {
      await fetch(`${SERVER_URL}/habits/parent-tasks/${taskId}`, { method: 'DELETE' });
    } catch {
      fetchTasks(selectedChild); // revert on error
    }
  }

  function onRefresh() {
    setRefreshing(true);
    fetchChildren();
    if (selectedChild) fetchTasks(selectedChild);
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Daily Tasks"
          subtitle="Assign habits to your children"
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />}
        >
          {/* Page header */}
          <View style={styles.pageHeader}>
            <View style={styles.pageTitleRow}>
              <View style={styles.pageTitleIcon}>
                <Feather name="check-square" size={18} color={GOLD} />
              </View>
              <View>
                <Text style={styles.pageTitle}>Daily Tasks</Text>
                <Text style={styles.pageSubtitle}>Tasks you assign appear in your child's Daily Habits screen</Text>
              </View>
            </View>
          </View>

          {/* Child selector */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SELECT CHILD</Text>
            {loadingChildren ? (
              <ActivityIndicator color={GOLD} />
            ) : children.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="users" size={32} color={colors.textDim} />
                <Text style={styles.emptyText}>No children linked yet.</Text>
                <TouchableOpacity onPress={() => navigation.navigate('ParentMyKids')} activeOpacity={0.8}>
                  <Text style={[styles.emptyText, { color: GOLD, marginTop: 4 }]}>Go to My Kids to add one</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.childPills}>
                {children.map(child => {
                  const active = selectedChild?.id === child.id;
                  return (
                    <TouchableOpacity
                      key={child.id}
                      style={[styles.childPill, active && styles.childPillActive]}
                      onPress={() => setSelectedChild(child)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.pillAvatar, { backgroundColor: active ? GOLD_BG : colors.bgDark }]}>
                        <Text style={[styles.pillAvatarText, { color: active ? GOLD : colors.textMuted }]}>
                          {child.name?.[0]?.toUpperCase() ?? '?'}
                        </Text>
                      </View>
                      <View>
                        <Text style={[styles.pillName, active && { color: GOLD }]}>{child.name}</Text>
                        <Text style={styles.pillGrade}>{child.grade ?? ''}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {selectedChild && (
            <>
              {/* Existing tasks */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>ASSIGNED TASKS — {selectedChild.name?.toUpperCase()}</Text>
                {loadingTasks ? (
                  <ActivityIndicator color={GOLD} style={{ paddingVertical: 24 }} />
                ) : tasks.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Feather name="inbox" size={28} color={colors.textDim} />
                    <Text style={styles.emptyText}>No tasks assigned yet. Add one below.</Text>
                  </View>
                ) : (
                  <View style={styles.taskList}>
                    {tasks.map(task => (
                      <View key={task.id} style={styles.taskRow}>
                        <View style={styles.taskIconWrap}>
                          <Feather name={(task.icon as any) || 'check-circle'} size={15} color={GOLD} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.taskLabel}>{task.label}</Text>
                          <Text style={styles.taskCoins}>{task.coins} coins</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => deleteTask(task.id)}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          activeOpacity={0.7}
                        >
                          <Feather name="trash-2" size={15} color={colors.accentRed} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Add task form */}
              <View style={styles.formCard}>
                <View style={styles.formHeader}>
                  <Feather name="plus-circle" size={16} color={GOLD} />
                  <Text style={styles.formTitle}>Add New Task</Text>
                </View>

                {/* Label */}
                <TextInput
                  style={styles.input}
                  placeholder={`New task for ${selectedChild.name} (e.g. Read for 20 mins)`}
                  placeholderTextColor={colors.textMuted}
                  value={label}
                  onChangeText={t => { setLabel(t); setError(''); }}
                />

                {/* Icon picker */}
                <Text style={styles.fieldLabel}>Icon</Text>
                <View style={styles.iconGrid}>
                  {ICONS.map(ic => (
                    <TouchableOpacity
                      key={ic}
                      style={[styles.iconChip, icon === ic && styles.iconChipActive]}
                      onPress={() => setIcon(ic)}
                      activeOpacity={0.7}
                    >
                      <Feather name={ic as any} size={16} color={icon === ic ? GOLD : colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Suggestions for selected icon */}
                {TASK_SUGGESTIONS[icon] && (
                  <View style={styles.suggestionsRow}>
                    {TASK_SUGGESTIONS[icon].map(s => (
                      <TouchableOpacity
                        key={s}
                        style={styles.suggestionChip}
                        onPress={() => { setLabel(s); setError(''); }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.suggestionText}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Coins picker */}
                <Text style={styles.fieldLabel}>Coins Reward</Text>
                <View style={styles.coinsRow}>
                  {COIN_OPTIONS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.coinChip, coins === c && styles.coinChipActive]}
                      onPress={() => setCoins(c)}
                      activeOpacity={0.7}
                    >
                      <Feather name="circle" size={10} color={coins === c ? GOLD : colors.textMuted} />
                      <Text style={[styles.coinText, coins === c && { color: GOLD }]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {error ? (
                  <View style={styles.errorRow}>
                    <Feather name="alert-circle" size={13} color={colors.accentRed} />
                    <Text style={[styles.errorText, { color: colors.accentRed }]}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.addBtn, (!label.trim() || saving) && { opacity: 0.5 }]}
                  onPress={addTask}
                  disabled={!label.trim() || saving}
                  activeOpacity={0.8}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <>
                        <Feather name="plus" size={16} color="#fff" />
                        <Text style={styles.addBtnText}>Add Task</Text>
                      </>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 64, gap: spacing.xl },

  pageHeader: {
    backgroundColor: GOLD_BG,
    borderWidth: 1, borderColor: GOLD_BORDER,
    borderRadius: radius.xl, padding: spacing.xl,
  },
  pageTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pageTitleIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: GOLD_BG, borderWidth: 1, borderColor: GOLD_BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  pageTitle: { fontSize: 20, fontWeight: '700', color: c.textMain },
  pageSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 2 },

  section: { gap: spacing.md },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: c.textDim,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },

  childPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  childPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, paddingVertical: 10, paddingHorizontal: 14,
  },
  childPillActive: { borderColor: GOLD, backgroundColor: GOLD_BG },
  pillAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillAvatarText: { fontSize: 15, fontWeight: '700' },
  pillName: { fontSize: 14, fontWeight: '600', color: c.textMain },
  pillGrade: { fontSize: 11, color: c.textMuted },

  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center' },

  taskList: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden',
  },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  taskIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: GOLD_BG, alignItems: 'center', justifyContent: 'center',
  },
  taskLabel: { fontSize: 14, fontWeight: '600', color: c.textMain },
  taskCoins: { fontSize: 11, color: GOLD, marginTop: 2 },

  formCard: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl,
    padding: spacing.xl, gap: spacing.lg,
  },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  formTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted },

  input: {
    borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md,
    padding: spacing.md, fontSize: 14, color: c.textMain, backgroundColor: c.bgDark,
  },

  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChip: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  iconChipActive: { borderColor: GOLD, backgroundColor: GOLD_BG },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4 },
  suggestionChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: GOLD_BG, borderWidth: 1, borderColor: GOLD_BORDER,
  },
  suggestionText: { fontSize: 11, color: GOLD, fontWeight: '600' },

  coinsRow: { flexDirection: 'row', gap: 8 },
  coinChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  coinChipActive: { borderColor: GOLD, backgroundColor: GOLD_BG },
  coinText: { fontSize: 14, fontWeight: '700', color: c.textMuted },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { fontSize: 12, flex: 1 },

  addBtn: {
    backgroundColor: GOLD, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  addBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
