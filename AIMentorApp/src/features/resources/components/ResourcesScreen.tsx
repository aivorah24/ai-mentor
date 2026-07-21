/**
 * School Policies & Resources — a browsable folder/file library (Toddle-style).
 * Parents browse read-only; teachers/admins get New folder + Upload. Students
 * are never routed here. Reuses the /messages/upload Cloudinary endpoint.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  TextInput, Modal, Platform, Linking, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import SERVER_URL from '../../../config/serverUrl';
import {
  fetchResources, createFolder, addFile, deleteFolder, deleteFile,
  ResourcesResponse, ResourceFolder, ResourceFile, fmtSize, fmtWhen,
} from '../api/resourcesApi';
import PdfViewerModal, { ViewerDoc } from './PdfViewerModal';

function fileIcon(type: string | null): { name: any; color: string } {
  const t = (type || '').toLowerCase();
  if (t === 'pdf') return { name: 'file-text', color: '#C0392B' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(t)) return { name: 'image', color: '#2E7D5B' };
  return { name: 'file', color: '#6E6A60' };
}

export default function ResourcesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';

  const [folderId, setFolderId] = useState<string | null>(null);
  const [data, setData] = useState<ResourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<ViewerDoc | null>(null);

  const load = useCallback(async (fid: string | null) => {
    if (!email) return;
    setLoading(true); setError('');
    try {
      setData(await fetchResources(email, fid));
    } catch (e: any) {
      setError(e?.message || 'Failed to load resources'); setData(null);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useFocusEffect(useCallback(() => { load(folderId); }, [load, folderId]));

  const openFolder = (id: string) => { setSearch(''); setFolderId(id); };
  const goCrumb = (id: string | null) => { setSearch(''); setFolderId(id); };
  // Open in the in-app viewer modal (PDF/image) instead of leaving the app.
  const openFile = (f: ResourceFile) => { if (f.fileUrl) setViewerDoc({ title: f.title, fileUrl: f.fileUrl, fileType: f.fileType }); };

  const canManage = !!data?.canManage;
  const q = search.trim().toLowerCase();
  const folders = (data?.folders || []).filter((f) => !q || f.name.toLowerCase().includes(q));
  const files = (data?.files || []).filter((f) => !q || f.title.toLowerCase().includes(q));

  const submitNewFolder = async () => {
    if (!newFolderName.trim()) return;
    setBusy(true);
    try {
      await createFolder({ email, name: newFolderName.trim(), parentFolderId: folderId, scope: 'school' });
      setShowNewFolder(false); setNewFolderName('');
      await load(folderId);
    } catch (e: any) { setError(e?.message || 'Failed to create folder'); }
    finally { setBusy(false); }
  };

  const uploadFile = () => {
    if (Platform.OS !== 'web') { Alert.alert('Upload', 'Please upload files from the web app.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.gif,.webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { setError('Files must be under 25 MB.'); return; }
      setBusy(true); setError('');
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${SERVER_URL}/messages/upload`, { method: 'POST', body: form });
        const up = await res.json().catch(() => ({}));
        if (!res.ok || !up.url) throw new Error(up?.error || 'Upload failed');
        await addFile({ email, folderId, title: up.name || file.name, fileUrl: up.url, fileType: up.type, fileSize: up.size || file.size, scope: 'school' });
        await load(folderId);
      } catch (e: any) { setError(e?.message || 'Upload failed'); }
      finally { setBusy(false); }
    };
    input.click();
  };

  const confirmDeleteFolder = (f: ResourceFolder) => {
    const go = async () => { setBusy(true); try { await deleteFolder(email, f.id); await load(folderId); } catch (e: any) { setError(e?.message || 'Failed'); } finally { setBusy(false); } };
    if (Platform.OS === 'web') { if (window.confirm(`Delete folder "${f.name}" and everything inside it?`)) go(); }
    else Alert.alert('Delete folder', `Delete "${f.name}" and its contents?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: go }]);
  };
  const confirmDeleteFile = (f: ResourceFile) => {
    const go = async () => { setBusy(true); try { await deleteFile(email, f.id); await load(folderId); } catch (e: any) { setError(e?.message || 'Failed'); } finally { setBusy(false); } };
    if (Platform.OS === 'web') { if (window.confirm(`Delete "${f.title}"?`)) go(); }
    else Alert.alert('Delete file', `Delete "${f.title}"?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: go }]);
  };

  const subtitle = data?.scopeLabel ? `${data.scopeLabel} · handbooks, policies & documents` : 'Handbooks, policies & documents';

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="School Policies & Resources" subtitle={subtitle} onMenuPress={() => navigation?.openDrawer?.()} />

        {/* Centered, max-width column (Google-Drive style) so the list stays
            compact instead of stretching edge-to-edge — same with or without
            the app sidebar. */}
        <View style={styles.centerWrap}>
        {/* Toolbar: breadcrumb + search + view toggle + manager actions */}
        <View style={styles.toolbar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={styles.crumbs}>
            <TouchableOpacity onPress={() => goCrumb(null)}><Text style={[styles.crumb, !folderId && styles.crumbActive]}>Library</Text></TouchableOpacity>
            {(data?.breadcrumb || []).map((c, i, arr) => (
              <View key={c.id} style={styles.crumbRow}>
                <Feather name="chevron-right" size={13} color={colors.textDim} />
                <TouchableOpacity onPress={() => goCrumb(c.id)}><Text style={[styles.crumb, i === arr.length - 1 && styles.crumbActive]} numberOfLines={1}>{c.name}</Text></TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <View style={styles.toolRight}>
            <TouchableOpacity style={styles.viewToggle} onPress={() => setView(view === 'list' ? 'grid' : 'list')} accessibilityRole="button">
              <Feather name={view === 'list' ? 'grid' : 'list'} size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBar}>
          <Feather name="search" size={15} color={colors.textDim} />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search for a folder or file" placeholderTextColor={colors.textDim} />
          {canManage && (
            <View style={styles.mgrBtns}>
              <TouchableOpacity style={styles.mgrBtn} onPress={() => setShowNewFolder(true)} accessibilityRole="button"><Feather name="folder-plus" size={14} color={colors.accentYellow} /><Text style={styles.mgrBtnText}>New folder</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.mgrBtn, styles.mgrBtnPrimary]} onPress={uploadFile} disabled={busy} accessibilityRole="button">{busy ? <ActivityIndicator size="small" color="#fff" /> : <><Feather name="upload" size={14} color="#fff" /><Text style={[styles.mgrBtnText, { color: '#fff' }]}>Upload</Text></>}</TouchableOpacity>
            </View>
          )}
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : folders.length === 0 && files.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="folder" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>{q ? `Nothing matches "${search}"` : 'No resources here yet.'}</Text>
              {canManage && !q && <Text style={styles.emptySub}>Create a folder or upload a document to get started.</Text>}
            </View>
          ) : view === 'list' ? (
            <View>
              {/* Column header */}
              <View style={styles.listHead}>
                <Text style={[styles.colName, styles.headText]}>Name</Text>
                <Text style={[styles.colMeta, styles.headText]}>Last modified</Text>
                <Text style={[styles.colSize, styles.headText]}>Size</Text>
                {canManage && <View style={styles.colAct} />}
              </View>
              {folders.map((f) => (
                <TouchableOpacity key={f.id} style={styles.listRow} onPress={() => openFolder(f.id)} activeOpacity={0.7}>
                  <View style={styles.colName}><Feather name="folder" size={18} color={colors.accentYellow} /><Text style={styles.rowName} numberOfLines={1}>{f.name}</Text></View>
                  <Text style={styles.colMeta} numberOfLines={1}>{f.author} · {fmtWhen(f.updatedAt)}</Text>
                  <Text style={styles.colSize}>—</Text>
                  {canManage && <TouchableOpacity style={styles.colAct} onPress={() => confirmDeleteFolder(f)}><Feather name="trash-2" size={15} color={colors.accentRed} /></TouchableOpacity>}
                </TouchableOpacity>
              ))}
              {files.map((f) => { const ic = fileIcon(f.fileType); return (
                <TouchableOpacity key={f.id} style={styles.listRow} onPress={() => openFile(f)} activeOpacity={0.7}>
                  <View style={styles.colName}><Feather name={ic.name} size={18} color={ic.color} /><Text style={styles.rowName} numberOfLines={1}>{f.title}</Text></View>
                  <Text style={styles.colMeta} numberOfLines={1}>{f.author} · {fmtWhen(f.updatedAt)}</Text>
                  <Text style={styles.colSize}>{fmtSize(f.fileSize)}</Text>
                  {canManage && <TouchableOpacity style={styles.colAct} onPress={() => confirmDeleteFile(f)}><Feather name="trash-2" size={15} color={colors.accentRed} /></TouchableOpacity>}
                </TouchableOpacity>
              );})}
            </View>
          ) : (
            <View style={styles.grid}>
              {folders.map((f) => (
                <TouchableOpacity key={f.id} style={styles.gridCard} onPress={() => openFolder(f.id)} activeOpacity={0.75}>
                  <Feather name="folder" size={28} color={colors.accentYellow} />
                  <Text style={styles.gridName} numberOfLines={2}>{f.name}</Text>
                  <Text style={styles.gridMeta} numberOfLines={1}>{fmtWhen(f.updatedAt)}</Text>
                </TouchableOpacity>
              ))}
              {files.map((f) => { const ic = fileIcon(f.fileType); return (
                <TouchableOpacity key={f.id} style={styles.gridCard} onPress={() => openFile(f)} activeOpacity={0.75}>
                  <Feather name={ic.name} size={28} color={ic.color} />
                  <Text style={styles.gridName} numberOfLines={2}>{f.title}</Text>
                  <Text style={styles.gridMeta} numberOfLines={1}>{fmtSize(f.fileSize)}</Text>
                </TouchableOpacity>
              );})}
            </View>
          )}
        </ScrollView>
        </View>

        {/* New folder modal */}
        <Modal visible={showNewFolder} transparent animationType="fade" onRequestClose={() => setShowNewFolder(false)}>
          <View style={styles.overlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>New folder</Text>
              <TextInput style={styles.modalInput} value={newFolderName} onChangeText={setNewFolderName} placeholder="Folder name" placeholderTextColor={colors.textDim} autoFocus />
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => { setShowNewFolder(false); setNewFolderName(''); }}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.modalCreate, (!newFolderName.trim() || busy) && { opacity: 0.6 }]} disabled={!newFolderName.trim() || busy} onPress={submitNewFolder}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalCreateText}>Create</Text>}</TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <PdfViewerModal visible={!!viewerDoc} doc={viewerDoc} onClose={() => setViewerDoc(null)} />
      </View>
    </ScreenLayout>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bgDark },
    centerWrap: { flex: 1, width: '100%', maxWidth: 1000, alignSelf: 'center' },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 6 },
    crumbs: { alignItems: 'center', gap: 4 },
    crumbRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    crumb: { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, maxWidth: 180 },
    crumbActive: { color: c.textHeading, fontWeight: '800' },
    toolRight: { marginLeft: 'auto', flexDirection: 'row', gap: 8 },
    viewToggle: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
    searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
    searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13.5, color: c.textHeading, padding: 0 },
    mgrBtns: { flexDirection: 'row', gap: 6 },
    mgrBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor },
    mgrBtnPrimary: { backgroundColor: c.accentYellow, borderColor: c.accentYellow },
    mgrBtnText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: c.accentYellow },
    error: { fontFamily: fonts.serif, fontSize: 12.5, color: c.accentRed, marginHorizontal: spacing.lg, marginBottom: 4 },
    content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },
    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 8 },
    emptyText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: c.textMuted },
    emptySub: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textDim },
    listHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderColor },
    headText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '800', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },
    listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderColor },
    colName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
    rowName: { flex: 1, fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '600', color: c.textHeading },
    colMeta: { width: 210, fontFamily: fonts.serif, fontSize: 11.5, color: c.textMuted },
    colSize: { width: 70, fontFamily: fonts.serif, fontSize: 11.5, color: c.textMuted, textAlign: 'right', fontVariant: ['tabular-nums'] },
    colAct: { width: 36, alignItems: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 8 },
    gridCard: { width: 132, gap: 6, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark, alignItems: 'flex-start' },
    gridName: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: c.textHeading },
    gridMeta: { fontFamily: fonts.serif, fontSize: 10.5, color: c.textDim },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { backgroundColor: c.cardDark, borderRadius: 16, borderWidth: 1, borderColor: c.borderColor, padding: 20, width: '100%', maxWidth: 380, gap: 12 },
    modalTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: c.textHeading },
    modalInput: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.serif, fontSize: 14, color: c.textHeading, backgroundColor: c.bgDark },
    modalBtns: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
    modalCancel: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor },
    modalCancelText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.textMuted },
    modalCreate: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingHorizontal: 20, paddingVertical: 10 },
    modalCreateText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '800', color: '#fff' },
  });
}
