/**
 * Group / class chat channels (Toddle-style). Left list with All / Unread /
 * Staff / Public tabs; right conversation with a members roster and a composer
 * that's replaced by a read-only notice in broadcast (staff-only) channels.
 * Teachers/admins can create channels (with a one-click "add all parents of a
 * grade" helper). B2B only. Separate from 1:1 direct messages.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  TextInput, Modal, useWindowDimensions, Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import {
  fetchChannels, fetchChannelMessages, sendChannelMessage, fetchChannelMembers,
  markChannelRead, createChannel, Channel, ChannelMessage, ChannelMember, fmtChannelTime,
} from '../api/channelsApi';

type Tab = 'all' | 'unread' | 'staff' | 'public';

function badgeColor(name: string): string {
  const palette = ['#2E5C8A', '#8A2E5C', '#2E8A5C', '#8A6A2E', '#5C2E8A', '#2E8A8A'];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function ChannelsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';
  const { width } = useWindowDimensions();
  const twoPane = width >= 900;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const msgScrollRef = useRef<ScrollView>(null);

  const canManage = user?.role === 'teacher' || user?.role === 'school_admin' || user?.role === 'super_admin';

  const loadList = useCallback(async () => {
    if (!email) return;
    try { setChannels(await fetchChannels(email)); } catch {} finally { setLoading(false); }
  }, [email]);

  useFocusEffect(useCallback(() => { loadList(); }, [loadList]));

  const openChannel = useCallback(async (c: Channel) => {
    setSelected(c); setLoadingMsgs(true); setMessages([]);
    try {
      const data = await fetchChannelMessages(email, c.id);
      setMessages(data.messages); setCanPost(data.canPost);
      markChannelRead(email, c.id);
      setChannels((prev) => prev.map((x) => x.id === c.id ? { ...x, unread: 0 } : x));
      setTimeout(() => msgScrollRef.current?.scrollToEnd({ animated: false }), 60);
    } catch {} finally { setLoadingMsgs(false); }
  }, [email]);

  const send = async () => {
    const body = draft.trim(); if (!body || !selected) return;
    setSending(true);
    try {
      await sendChannelMessage(email, selected.id, body);
      setDraft('');
      const data = await fetchChannelMessages(email, selected.id);
      setMessages(data.messages);
      setTimeout(() => msgScrollRef.current?.scrollToEnd({ animated: true }), 60);
    } catch {} finally { setSending(false); }
  };

  const openMembers = async () => {
    if (!selected) return;
    setShowMembers(true);
    try { setMembers(await fetchChannelMembers(email, selected.id)); } catch {}
  };

  const q = search.trim().toLowerCase();
  const visible = channels.filter((c) => {
    if (tab === 'unread' && c.unread === 0) return false;
    if (tab === 'staff' && c.category !== 'staff') return false;
    if (tab === 'public' && c.category !== 'public') return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const unreadTotal = channels.reduce((n, c) => n + c.unread, 0);

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', badge: unreadTotal },
    { key: 'staff', label: 'Staff' },
    { key: 'public', label: 'Public channels' },
  ];

  const List = (
    <View style={[styles.listCol, twoPane && styles.listColWide]}>
      <View style={styles.listTop}>
        <View style={styles.searchBar}>
          <Feather name="search" size={14} color={colors.textDim} />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search for a chat or channel" placeholderTextColor={colors.textDim} />
        </View>
        {canManage && (
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowCreate(true)} accessibilityRole="button">
            <Feather name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={styles.tabBtn} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            {!!t.badge && t.badge > 0 && <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{t.badge}</Text></View>}
            {tab === t.key && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 30 }} />
        ) : visible.length === 0 ? (
          <Text style={styles.emptyText}>{q ? `Nothing matches "${search}"` : 'No channels yet.'}</Text>
        ) : visible.map((c) => {
          const active = selected?.id === c.id;
          return (
            <TouchableOpacity key={c.id} style={[styles.row, active && styles.rowActive]} onPress={() => openChannel(c)} activeOpacity={0.75}>
              <View style={[styles.badge, { backgroundColor: badgeColor(c.name) }]}><Text style={styles.badgeText}>{(c.iconLabel || c.name).slice(0, 4)}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.rowTime}>{c.lastMessage ? fmtChannelTime(c.lastMessage.at) : ''}</Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {c.memberCount} members{c.posting === 'staff_only' ? '  ·  broadcast' : ''}
                    {c.lastMessage ? `  ·  ${c.lastMessage.body}` : ''}
                  </Text>
                  {c.unread > 0 && <View style={styles.unreadDot}><Text style={styles.unreadText}>{c.unread}</Text></View>}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const Conversation = (
    <View style={styles.convCol}>
      {!selected ? (
        <View style={styles.convEmpty}>
          <Feather name="message-circle" size={30} color={colors.textDim} />
          <Text style={styles.convEmptyText}>Select a channel to view messages</Text>
        </View>
      ) : (
        <>
          <View style={styles.convHeader}>
            {!twoPane && (
              <TouchableOpacity onPress={() => setSelected(null)} style={{ marginRight: 6 }}><Feather name="chevron-left" size={22} color={colors.textMuted} /></TouchableOpacity>
            )}
            <View style={[styles.badge, { backgroundColor: badgeColor(selected.name), width: 32, height: 32 }]}><Text style={styles.badgeText}>{(selected.iconLabel || selected.name).slice(0, 4)}</Text></View>
            <Text style={styles.convTitle} numberOfLines={1}>{selected.name}</Text>
            <TouchableOpacity style={styles.membersBtn} onPress={openMembers}><Feather name="users" size={15} color={colors.textMuted} /><Text style={styles.membersBtnText}>{selected.memberCount}</Text></TouchableOpacity>
          </View>
          <ScrollView ref={msgScrollRef} style={{ flex: 1 }} contentContainerStyle={styles.msgList}>
            {loadingMsgs ? (
              <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 30 }} />
            ) : messages.length === 0 ? (
              <View style={styles.welcome}>
                <Text style={styles.welcomeText}>This is the beginning of</Text>
                <Text style={styles.welcomeName}>{selected.name}</Text>
              </View>
            ) : messages.map((m) => (
              <View key={m.id} style={[styles.msgRow, m.mine && { alignItems: 'flex-end' }]}>
                {!m.mine && <Text style={styles.msgSender}>{m.senderName}</Text>}
                <View style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleOther]}>
                  <Text style={[styles.bubbleText, m.mine && { color: '#fff' }]}>{m.body}</Text>
                </View>
                <Text style={styles.msgTime}>{fmtChannelTime(m.at)}</Text>
              </View>
            ))}
          </ScrollView>
          {canPost ? (
            <View style={styles.composer}>
              <TextInput style={styles.composerInput} value={draft} onChangeText={setDraft} placeholder="Write a message…" placeholderTextColor={colors.textDim} multiline onSubmitEditing={send} />
              <TouchableOpacity style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.5 }]} disabled={!draft.trim() || sending} onPress={send}>
                {sending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.readonlyBar}>
              <Feather name="lock" size={13} color={colors.textDim} />
              <Text style={styles.readonlyText}>Only admins and teachers can send messages in this channel</Text>
            </View>
          )}
        </>
      )}
    </View>
  );

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Channels" subtitle="Class & school group chats" onMenuPress={() => navigation?.openDrawer?.()} />
        <View style={styles.body}>
          {twoPane ? (<>{List}{Conversation}</>) : (selected ? Conversation : List)}
        </View>

        <MembersModal visible={showMembers} onClose={() => setShowMembers(false)} channelName={selected?.name || ''} members={members} styles={styles} colors={colors} />
        <CreateModal visible={showCreate} onClose={() => setShowCreate(false)} email={email} onCreated={() => { setShowCreate(false); loadList(); }} styles={styles} colors={colors} />
      </View>
    </ScreenLayout>
  );
}

function MembersModal({ visible, onClose, channelName, members, styles, colors }: any) {
  const [q, setQ] = useState('');
  const list = members.filter((m: ChannelMember) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle} numberOfLines={1}>Members ({members.length})</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={18} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <View style={styles.searchBar}><Feather name="search" size={14} color={colors.textDim} /><TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.textDim} /></View>
          <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
            {list.map((m: ChannelMember) => (
              <View key={m.email} style={styles.memberRow}>
                <View style={[styles.badge, { backgroundColor: badgeColor(m.name), width: 34, height: 34 }]}><Text style={styles.badgeText}>{m.name.slice(0, 2).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.name}{m.you ? ' (You)' : ''}</Text>
                  {!!m.roleLabel && <Text style={styles.memberRole}>{m.roleLabel}</Text>}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CreateModal({ visible, onClose, email, onCreated, styles, colors }: any) {
  const [name, setName] = useState('');
  const [staffOnly, setStaffOnly] = useState(true);
  const [autoGrade, setAutoGrade] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  React.useEffect(() => { if (visible) { setName(''); setStaffOnly(true); setAutoGrade(''); setError(''); } }, [visible]);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      await createChannel({ email, name: name.trim(), posting: staffOnly ? 'staff_only' : 'members', autoAddParentsOfGrade: autoGrade.trim() || undefined, iconLabel: name.trim().slice(0, 4) });
      onCreated();
    } catch (e: any) { setError(e?.message || 'Failed to create channel'); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}><Text style={styles.modalTitle}>New channel</Text><TouchableOpacity onPress={onClose}><Feather name="x" size={18} color={colors.textMuted} /></TouchableOpacity></View>
          <Text style={styles.fieldLabel}>Channel name</Text>
          <TextInput style={styles.modalInput} value={name} onChangeText={setName} placeholder="e.g. PYP 5 Parents - 2026-27" placeholderTextColor={colors.textDim} />
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Broadcast (staff-only posting)</Text>
              <Text style={styles.switchHint}>Parents can read but only teachers/admins post.</Text>
            </View>
            <Switch value={staffOnly} onValueChange={setStaffOnly} />
          </View>
          <Text style={styles.fieldLabel}>Auto-add all parents of grade (optional)</Text>
          <TextInput style={styles.modalInput} value={autoGrade} onChangeText={setAutoGrade} placeholder="e.g. Grade 5" placeholderTextColor={colors.textDim} />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={[styles.createBtn, (!name.trim() || busy) && { opacity: 0.6 }]} disabled={!name.trim() || busy} onPress={submit}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create channel</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bgDark },
    body: { flex: 1, flexDirection: 'row' },
    listCol: { flex: 1, borderRightWidth: 1, borderRightColor: c.borderColor },
    listColWide: { maxWidth: 340 },
    listTop: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md },
    searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
    searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: c.textHeading, padding: 0 },
    newBtn: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
    tabs: { gap: 16, paddingHorizontal: spacing.md, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.borderColor },
    tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, position: 'relative' },
    tabText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: c.textMuted },
    tabTextActive: { color: c.textHeading, fontWeight: '800' },
    tabBadge: { backgroundColor: c.accentRed, borderRadius: 9, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
    tabUnderline: { position: 'absolute', bottom: -8, left: 0, right: 0, height: 2, backgroundColor: c.accentYellow, borderRadius: 2 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: c.textDim, textAlign: 'center', marginTop: 30 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderColor },
    rowActive: { backgroundColor: c.accentYellow + '12' },
    badge: { width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowName: { flex: 1, fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: c.textHeading },
    rowTime: { fontFamily: fonts.serif, fontSize: 10.5, color: c.textDim },
    rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    rowSub: { flex: 1, fontFamily: fonts.serif, fontSize: 11.5, color: c.textMuted },
    unreadDot: { backgroundColor: c.accentRed, borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    unreadText: { color: '#fff', fontSize: 10, fontWeight: '800' },
    convCol: { flex: 1, backgroundColor: c.bgDark },
    convEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    convEmptyText: { fontFamily: fonts.serif, fontSize: 13, color: c.textDim },
    convHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderColor },
    convTitle: { flex: 1, fontFamily: fonts.serif, fontSize: 15, fontWeight: '800', color: c.textHeading },
    membersBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: c.borderColor, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    membersBtnText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: c.textMuted },
    msgList: { padding: spacing.lg, gap: 12, flexGrow: 1, justifyContent: 'flex-end' },
    welcome: { alignItems: 'center', paddingVertical: 40, gap: 4 },
    welcomeText: { fontFamily: fonts.serif, fontSize: 13, color: c.textDim },
    welcomeName: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '800', color: c.textHeading, textAlign: 'center' },
    msgRow: { gap: 3, maxWidth: '78%' },
    msgSender: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textMuted, marginLeft: 4 },
    bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
    bubbleOther: { backgroundColor: c.cardDark, borderTopLeftRadius: 4 },
    bubbleMine: { backgroundColor: c.accentYellow, borderTopRightRadius: 4 },
    bubbleText: { fontFamily: fonts.serif, fontSize: 13.5, color: c.textHeading, lineHeight: 19 },
    msgTime: { fontFamily: fonts.serif, fontSize: 9.5, color: c.textDim, marginHorizontal: 4 },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor },
    composerInput: { flex: 1, maxHeight: 100, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.serif, fontSize: 13.5, color: c.textHeading },
    sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
    readonlyBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: c.borderColor, backgroundColor: c.cardDark },
    readonlyText: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textMuted },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { backgroundColor: c.cardDark, borderRadius: 16, borderWidth: 1, borderColor: c.borderColor, padding: 20, width: '100%', maxWidth: 420, gap: 10 },
    modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    modalTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: c.textHeading },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    memberName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: c.textHeading },
    memberRole: { fontFamily: fonts.serif, fontSize: 11.5, color: c.textMuted, marginTop: 1 },
    fieldLabel: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
    modalInput: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.serif, fontSize: 14, color: c.textHeading, backgroundColor: c.bgDark },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
    switchHint: { fontFamily: fonts.serif, fontSize: 11.5, color: c.textDim, marginTop: 2 },
    error: { fontFamily: fonts.serif, fontSize: 12.5, color: c.accentRed },
    createBtn: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
    createBtnText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
