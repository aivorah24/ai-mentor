/**
 * Minimal markdown subset for announcement bodies — the documented storage
 * format for announcements.body (decided over HTML/JSON because it needs no
 * dependency, renders natively on web + mobile via RN <Text>, is XSS-safe by
 * construction, and is backward compatible: plain-text bodies contain no
 * markers and render exactly as before).
 *
 * Supported syntax:
 *   ## Heading            (also # and ###, all render as section headings)
 *   **bold**  _italic_
 *   - bullet item         (also "* item")
 *   1. numbered item
 *   [label](https://url)  and bare https:// URLs are tappable links
 *   Blank line separates paragraphs; single newlines are preserved as breaks.
 */
import React from 'react';
import { Text, View, Linking, StyleSheet, Platform } from 'react-native';
import type { AppColors } from '../../../theme';

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; text: string; marker: string }
  | { kind: 'paragraph'; text: string };

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = (body || '').replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,3}\s+(.*)$/);
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (heading) { flush(); blocks.push({ kind: 'heading', text: heading[1] }); }
    else if (bullet) { flush(); blocks.push({ kind: 'bullet', text: bullet[1] }); }
    else if (numbered) { flush(); blocks.push({ kind: 'numbered', marker: numbered[1], text: numbered[2] }); }
    else if (trimmed === '') flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

// Inline spans: links first (so **bold** inside a label still works), then bold/italic.
type Span = { text: string; bold?: boolean; italic?: boolean; url?: string };

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/g;

export function parseSpans(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push(...parseEmphasis(text.slice(last, m.index)));
    if (m[1] && m[2]) out.push({ text: m[1], url: m[2] });
    else if (m[3]) out.push({ text: m[3], url: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseEmphasis(text.slice(last)));
  return out;
}

function parseEmphasis(text: string): Span[] {
  const out: Span[] = [];
  // **bold** then _italic_ — simple non-nesting pass.
  const re = /\*\*([^*]+)\*\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

function openLink(url: string) {
  if (!/^https?:\/\//.test(url)) return; // only http(s) — never other schemes
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
  else Linking.openURL(url).catch(() => {});
}

function InlineSpans({ text, colors, baseStyle }: { text: string; colors: AppColors; baseStyle: any }) {
  return (
    <>
      {parseSpans(text).map((s, i) =>
        s.url ? (
          <Text
            key={i}
            style={[baseStyle, { color: colors.accentYellow, textDecorationLine: 'underline' }]}
            onPress={() => openLink(s.url!)}
            accessibilityRole="link"
          >
            {s.text}
          </Text>
        ) : (
          <Text key={i} style={[baseStyle, s.bold && { fontWeight: '700' }, s.italic && { fontStyle: 'italic' }]}>
            {s.text}
          </Text>
        )
      )}
    </>
  );
}

export function MarkdownBody({ body, colors }: { body: string; colors: AppColors }) {
  const blocks = parseBlocks(body);
  const base = { fontSize: 14.5, lineHeight: 23, color: colors.textMain } as const;
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return (
            <Text key={i} style={[md.heading, { color: colors.textHeading }]} accessibilityRole="header">
              <InlineSpans text={b.text} colors={colors} baseStyle={[md.heading, { color: colors.textHeading }]} />
            </Text>
          );
        }
        if (b.kind === 'bullet' || b.kind === 'numbered') {
          return (
            <View key={i} style={md.listRow}>
              <Text style={[md.marker, { color: colors.accentYellow }]}>
                {b.kind === 'bullet' ? '•' : `${(b as any).marker}.`}
              </Text>
              <Text style={[base, md.listText]}>
                <InlineSpans text={b.text} colors={colors} baseStyle={base} />
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[base, md.paragraph]}>
            <InlineSpans text={b.text} colors={colors} baseStyle={base} />
          </Text>
        );
      })}
    </View>
  );
}

const md = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: '700', lineHeight: 22, marginTop: 12, marginBottom: 6 },
  paragraph: { marginBottom: 12 },
  listRow: { flexDirection: 'row', marginBottom: 6, paddingLeft: 6 },
  marker: { width: 22, fontSize: 14.5, lineHeight: 23, fontWeight: '700' },
  listText: { flex: 1 },
});

/** Strip markdown tokens for clean plain-text previews (inbox rows, banner). */
export function plainPreview(body: string): string {
  return (body || '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
