/**
 * MarkdownText — a small, dependency-free renderer for AI-generated chat
 * replies (Claude/ChatGPT-style): **bold**, numbered/bulleted lists, and
 * paragraph spacing. Deliberately minimal — this is for short assistant
 * replies, not full documents, so no tables/code blocks/headings.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

function renderInline(line: string, baseStyle: any, boldStyle: any, keyPrefix: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    return (
      <Text key={`${keyPrefix}-${i}`} style={boldMatch ? [baseStyle, boldStyle] : baseStyle}>
        {boldMatch ? boldMatch[1] : part}
      </Text>
    );
  });
}

export default function MarkdownText({ text, style, boldStyle }: { text: string; style?: any; boldStyle?: any }) {
  const lines = text.split('\n');
  const blocks: { type: 'list' | 'para'; lines: string[] }[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isListItem = /^(-|\*|\d+\.)\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (isListItem && last?.type === 'list') last.lines.push(line);
    else if (isListItem) blocks.push({ type: 'list', lines: [line] });
    else if (last?.type === 'para') last.lines.push(line);
    else blocks.push({ type: 'para', lines: [line] });
  }

  if (!blocks.length) return <Text style={style}>{text}</Text>;

  return (
    <View>
      {blocks.map((block, bi) => block.type === 'list' ? (
        <View key={bi} style={styles.list}>
          {block.lines.map((l, li) => {
            const m = l.match(/^(-|\*|\d+\.)\s+(.*)$/);
            const marker = m ? m[1].replace(/^\d+\./, (x) => x) : '-';
            const content = m ? m[2] : l;
            return (
              <View key={li} style={styles.listRow}>
                <Text style={style}>{/^\d+\.$/.test(marker) ? marker : '•'}</Text>
                <Text style={[style, styles.listText]}>{renderInline(content, style, boldStyle, `${bi}-${li}`)}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text key={bi} style={[style, bi > 0 && styles.paraSpacing]}>
          {block.lines.map((l, li) => renderInline(l + (li < block.lines.length - 1 ? ' ' : ''), style, boldStyle, `${bi}-${li}`))}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 3 },
  listRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  listText: { flex: 1 },
  paraSpacing: { marginTop: 8 },
});
