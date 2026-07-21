/**
 * In-app document viewer — full-screen modal that previews a PDF/image without
 * leaving the app. Web renders an <iframe> (same pattern as LandingScreen);
 * native renders react-native-webview (same as AssignmentsScreen), routing PDFs
 * through the Google Docs viewer so Android renders them reliably.
 */
import React, { useMemo } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Platform, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { fonts } from '../../../theme';
import type { AppColors } from '../../../theme';

export interface ViewerDoc { title: string; fileUrl: string; fileType: string | null; }

export default function PdfViewerModal({ visible, doc, onClose }: { visible: boolean; doc: ViewerDoc | null; onClose: () => void; }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!doc) return null;

  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes((doc.fileType || '').toLowerCase());
  const download = () => { if (Platform.OS === 'web') window.open(doc.fileUrl, '_blank'); else Linking.openURL(doc.fileUrl); };

  let body: React.ReactNode = null;
  if (Platform.OS === 'web') {
    body = isImage
      ? React.createElement('img', { src: doc.fileUrl, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', margin: '0 auto' } })
      : React.createElement('iframe', { src: doc.fileUrl, title: doc.title, style: { width: '100%', height: '100%', border: 'none', background: '#fff' } });
  } else {
    // Lazy-require so web bundles don't pull the native module.
    const { WebView } = require('react-native-webview');
    const uri = isImage ? doc.fileUrl : `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(doc.fileUrl)}`;
    body = <WebView source={{ uri }} style={{ flex: 1 }} startInLoadingState />;
  }

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          <Feather name={isImage ? 'image' : 'file-text'} size={16} color={isImage ? colors.primary : '#C0392B'} />
          <Text style={styles.title} numberOfLines={1}>{doc.title}</Text>
          <TouchableOpacity style={styles.iconBtn} onPress={download} accessibilityLabel="Download">
            <Feather name="download" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={onClose} accessibilityLabel="Close">
            <Feather name="x" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.body}>{body}</View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bgDark },
    bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderColor, backgroundColor: c.cardDark },
    title: { flex: 1, fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: c.textHeading },
    iconBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, backgroundColor: c.bgDark },
  });
}
