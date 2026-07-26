/**
 * ImageZoomModal.tsx
 * Minimal full-screen image viewer — tap a figure, see it large, tap the
 * backdrop or close button to dismiss. Used wherever a small textbook figure
 * needs to be readable at full size (e.g. LessonScreen's illustration box).
 */
import React from 'react';
import { Modal, View, Image, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

export default function ImageZoomModal({
  visible, uri, caption, onClose,
}: { visible: boolean; uri: string; caption?: string; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Feather name="x" size={22} color="#fff" />
        </TouchableOpacity>
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        {!!caption && <Text style={styles.caption}>{caption}</Text>}
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  closeBtn: { position: 'absolute', top: 40, right: 24, zIndex: 1, padding: 8 },
  image: { width: '100%', height: '80%' },
  caption: { color: '#fff', textAlign: 'center', marginTop: 12, fontSize: 13, paddingHorizontal: 24 },
});
