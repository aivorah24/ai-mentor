/**
 * ChannelThreadView — the conversation view for one group channel (messages +
 * roster + composer / read-only bar). Rendered by the shared MessagesScreen in
 * the parallel-path `activeChannel` slot, so 1:1 DM code is never touched.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import {
  fetchChannelMessages, sendChannelMessage, fetchChannelMembers, markChannelRead, addChannelMembers, searchPeople,
  ChannelMessage, ChannelMember, Person, fmtChannelTime,
} from '../api/channelsApi';
import { initials, pastelBg, pastelText } from '../utils/avatar';
import { isGroupIcon } from '../utils/icons';

export default function ChannelThreadView({ channel, onBack }: {
  channel: { id: string; name: string; iconLabel?: string; memberCount?: number };
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';

  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [memberQ, setMemberQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<Person[]>([]);
  const [addPicked, setAddPicked] = useState<Person[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchChannelMessages(email, channel.id);
      setMessages(data.messages); setCanPost(data.canPost);
      markChannelRead(email, channel.id);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 60);
    } catch {} finally { setLoading(false); }
  }, [email, channel.id]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = draft.trim(); if (!body) return;
    setSending(true);
    try {
      await sendChannelMessage(email, channel.id, body);
      setDraft('');
      const data = await fetchChannelMessages(email, channel.id);
      setMessages(data.messages);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    } catch {} finally { setSending(false); }
  };

  const openMembers = async () => {
    setShowMembers(true);
    try { setMembers(await fetchChannelMembers(email, channel.id)); } catch {}
  };
  const memberList = members.filter((m) => !memberQ || m.name.toLowerCase().includes(memberQ.toLowerCase()));
  const iAmManager = members.some((m) => m.you && m.isManager);

  // WhatsApp-style: search students/parents by name and tap to pick, instead
  // of typing raw email addresses.
  useEffect(() => {
    if (!showAdd || !addQuery.trim()) { setAddResults([]); return; }
    const memberEmails = new Set(members.map((m) => m.email));
    const t = setTimeout(() => {
      searchPeople(email, { q: addQuery.trim() })
        .then((res) => setAddResults(res.filter((p) => !memberEmails.has(p.email))))
        .catch(() => setAddResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [addQuery, showAdd]);

  const togglePick = (p: Person) => {
    setAddPicked((prev) => prev.some((x) => x.email === p.email) ? prev.filter((x) => x.email !== p.email) : [...prev, p]);
  };

  const submitAdd = async () => {
    if (!addPicked.length) return;
    setAdding(true); setAddError('');
    try {
      // roleLabel varies per pick (Student vs Family member of X), so add
      // one at a time to preserve each person's real label.
      for (const p of addPicked) {
        await addChannelMembers(email, channel.id, [p.email], p.roleLabel);
      }
      setMembers(await fetchChannelMembers(email, channel.id));
      setAddQuery(''); setAddResults([]); setAddPicked([]); setShowAdd(false);
    } catch (e: any) { setAddError(e?.message || 'Failed to add members'); }
    finally { setAdding(false); }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={{ marginRight: 4 }}><Feather name="chevron-left" size={22} color={colors.textMuted} /></TouchableOpacity>
        <View style={[styles.groupBadge, { backgroundColor: pastelBg(channel.name) }]}><Feather name={isGroupIcon(channel.iconLabel) ? channel.iconLabel : 'users'} size={16} color={pastelText(channel.name)} /></View>
        <Text style={styles.title} numberOfLines={1}>{channel.name}</Text>
        <TouchableOpacity style={styles.membersBtn} onPress={openMembers}><Feather name="users" size={15} color={colors.textMuted} /><Text style={styles.membersBtnText}>{channel.memberCount ?? ''}</Text></TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.msgList}>
        {loading ? (
          <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 30 }} />
        ) : messages.length === 0 ? (
          <View style={styles.welcome}><Text style={styles.welcomeText}>This is the beginning of</Text><Text style={styles.welcomeName}>{channel.name}</Text></View>
        ) : messages.map((m) => (
          <View key={m.id} style={[styles.msgRow, m.mine && { alignSelf: 'flex-end', alignItems: 'flex-end' }]}>
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
          <TextInput style={styles.composerInput} value={draft} onChangeText={setDraft} placeholder="Write a message…" placeholderTextColor={colors.textDim} multiline />
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

      <Modal visible={showMembers} transparent animationType="fade" onRequestClose={() => setShowMembers(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Members ({members.length})</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {iAmManager && (
                  <TouchableOpacity onPress={() => setShowAdd((v) => !v)}><Feather name="user-plus" size={18} color={colors.textMuted} /></TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowMembers(false)}><Feather name="x" size={18} color={colors.textMuted} /></TouchableOpacity>
              </View>
            </View>
            {showAdd && (
              <View style={styles.addBox}>
                <View style={styles.searchBar}>
                  <Feather name="search" size={14} color={colors.textDim} />
                  <TextInput
                    style={styles.searchInput} value={addQuery} onChangeText={setAddQuery}
                    placeholder="Search students or parents by name…" placeholderTextColor={colors.textDim}
                  />
                </View>
                {!!addResults.length && (
                  <ScrollView style={styles.addResultsList} nestedScrollEnabled>
                    {addResults.map((p) => {
                      const picked = addPicked.some((x) => x.email === p.email);
                      return (
                        <TouchableOpacity key={p.email} style={styles.addResultRow} onPress={() => togglePick(p)}>
                          <View style={[styles.badge, { backgroundColor: pastelBg(p.name), width: 30, height: 30 }]}><Text style={[styles.badgeText, { color: pastelText(p.name) }]}>{initials(p.name)}</Text></View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.memberName} numberOfLines={1}>{p.name}</Text>
                            <Text style={styles.memberRole} numberOfLines={1}>{p.roleLabel}</Text>
                          </View>
                          <Feather name={picked ? 'check-circle' : 'circle'} size={17} color={picked ? colors.accentYellow : colors.borderColor} />
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
                {!!addPicked.length && (
                  <View style={styles.chipsWrap}>
                    {addPicked.map((p) => (
                      <TouchableOpacity key={p.email} style={styles.chip} onPress={() => togglePick(p)}>
                        <Text style={styles.chipText} numberOfLines={1}>{p.name}</Text>
                        <Feather name="x" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {!!addError && <Text style={styles.error}>{addError}</Text>}
                <TouchableOpacity style={[styles.addBtn, (!addPicked.length || adding) && { opacity: 0.6 }]} disabled={!addPicked.length || adding} onPress={submitAdd}>
                  {adding ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addBtnText}>Add {addPicked.length ? `(${addPicked.length}) ` : ''}to channel</Text>}
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.searchBar}><Feather name="search" size={14} color={colors.textDim} /><TextInput style={styles.searchInput} value={memberQ} onChangeText={setMemberQ} placeholder="Search…" placeholderTextColor={colors.textDim} /></View>
            <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
              {memberList.map((m) => (
                <View key={m.email} style={styles.memberRow}>
                  <View style={[styles.badge, { backgroundColor: pastelBg(m.name), width: 34, height: 34 }]}><Text style={[styles.badgeText, { color: pastelText(m.name) }]}>{initials(m.name)}</Text></View>
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
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: c.bgDark },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderColor },
    badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    badgeText: { fontSize: 11, fontWeight: '800' },
    groupBadge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    title: { flex: 1, fontFamily: fonts.serif, fontSize: 15, fontWeight: '800', color: c.textHeading },
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
    composerInput: { flex: 1, maxHeight: 100, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.serif, fontSize: 13.5, color: c.textHeading, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
    sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
    readonlyBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: c.borderColor, backgroundColor: c.cardDark },
    readonlyText: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textMuted },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { backgroundColor: c.cardDark, borderRadius: 16, borderWidth: 1, borderColor: c.borderColor, padding: 20, width: '100%', maxWidth: 420, gap: 10 },
    modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    modalTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: c.textHeading },
    searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
    searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: c.textHeading, padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    memberName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: c.textHeading },
    memberRole: { fontFamily: fonts.serif, fontSize: 11.5, color: c.textMuted, marginTop: 1 },
    addBox: { gap: 8, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, padding: 10, marginTop: 6 },
    addResultsList: { maxHeight: 180, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, backgroundColor: c.cardDark },
    addResultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderColor },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 150, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    chipText: { flexShrink: 1, fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: c.textHeading },
    addBtn: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
    addBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '800', color: '#fff' },
    error: { fontFamily: fonts.serif, fontSize: 12, color: c.accentRed },
  });
}
