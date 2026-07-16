/**
 * WYSIWYG editor for the announcement body — bold actually looks bold,
 * headings actually look larger, bullets are real bullet points, exactly
 * like drafting in Gmail/Word — while still storing/round-tripping through
 * the same markdown subset documented in utils/markdown.tsx (## heading,
 * **bold**, - bullet, 1. numbered, [label](url)). That contract is what the
 * backend persists and what the Preview toggle / every recipient's inbox
 * already renders, so nothing downstream changes — this is purely a nicer
 * way to author the same string.
 *
 * Implementation: a native contentEditable <div> (web only — this composer
 * is a web/admin surface) driven with document.execCommand for the actual
 * formatting (still the simplest reliable way to get real bold/list/heading
 * behavior with correct cursor handling), with a markdown <-> HTML
 * converter at the boundary so the component's public value stays plain
 * markdown text.
 */
import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';

const STYLE_ID = 'aivorah-rich-body-editor-style';
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .aivorah-rich-editor { outline: none; }
    .aivorah-rich-editor:empty:before { content: attr(data-placeholder); opacity: 0.55; pointer-events: none; }
    .aivorah-rich-editor h2 { font-size: 17px; font-weight: 700; margin: 10px 0 6px; line-height: 1.3; }
    .aivorah-rich-editor ul, .aivorah-rich-editor ol { margin: 4px 0; padding-left: 22px; }
    .aivorah-rich-editor li { margin-bottom: 4px; }
    .aivorah-rich-editor a { text-decoration: underline; }
    .aivorah-rich-editor div { min-height: 1.4em; }
  `;
  document.head.appendChild(style);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>');
}

// markdown -> the HTML fragment the contentEditable renders.
function markdownToHtml(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const heading = trimmed.match(/^#{1,3}\s+(.*)$/);
    const bullet = /^[-*]\s+/.test(trimmed);
    const numbered = /^\d+[.)]\s+/.test(trimmed);
    if (heading) { out.push(`<h2>${inlineToHtml(heading[1])}</h2>`); i++; continue; }
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
      out.push(`<ul>${items.map((t) => `<li>${inlineToHtml(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (numbered) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++; }
      out.push(`<ol>${items.map((t) => `<li>${inlineToHtml(t)}</li>`).join('')}</ol>`);
      continue;
    }
    if (trimmed === '') { out.push('<div><br></div>'); i++; continue; }
    out.push(`<div>${inlineToHtml(lines[i])}</div>`);
    i++;
  }
  return out.join('');
}

// Rendered contentEditable DOM -> back to the markdown subset.
function inlineOfNode(el: Node): string {
  let out = '';
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) { out += child.textContent || ''; return; }
    const node = child as HTMLElement;
    const tag = node.tagName?.toLowerCase();
    if (tag === 'b' || tag === 'strong') out += `**${inlineOfNode(node)}**`;
    else if (tag === 'i' || tag === 'em') out += `_${inlineOfNode(node)}_`;
    else if (tag === 'a') { const label = inlineOfNode(node) || node.getAttribute('href') || ''; out += `[${label}](${node.getAttribute('href') || ''})`; }
    else if (tag === 'br') out += '\n';
    else out += inlineOfNode(node);
  });
  return out;
}

function htmlToMarkdown(root: HTMLElement): string {
  const lines: string[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || '';
      if (t.trim()) lines.push(t);
      return;
    }
    const el = node as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') { lines.push(`## ${inlineOfNode(el).trim()}`); return; }
    if (tag === 'ul') {
      el.querySelectorAll(':scope > li').forEach((li) => lines.push(`- ${inlineOfNode(li).trim()}`));
      return;
    }
    if (tag === 'ol') {
      Array.from(el.querySelectorAll(':scope > li')).forEach((li, idx) => lines.push(`${idx + 1}. ${inlineOfNode(li).trim()}`));
      return;
    }
    if (tag === 'br') { lines.push(''); return; }
    if (tag === 'div' || tag === 'p') {
      const text = inlineOfNode(el);
      lines.push(text);
      return;
    }
    const t = inlineOfNode(el);
    if (t.trim()) lines.push(t);
  });
  return lines.join('\n');
}

interface Props {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  colors: AppColors;
}

export default function RichBodyEditor({ value, onChange, placeholder, colors }: Props) {
  const hostRef = useRef<any>(null);
  const domRef = useRef<HTMLDivElement | null>(null);
  const lastEmitted = useRef<string>(value);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node: HTMLDivElement | null = hostRef.current;
    if (!node) return;
    domRef.current = node;
    node.contentEditable = 'true';
    node.classList.add('aivorah-rich-editor');
    if (placeholder) node.setAttribute('data-placeholder', placeholder);
    node.innerHTML = value ? markdownToHtml(value) : '';

    const handleInput = () => {
      const md = htmlToMarkdown(node);
      lastEmitted.current = md;
      onChange(md);
    };
    node.addEventListener('input', handleInput);
    return () => node.removeEventListener('input', handleInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync the DOM when `value` changes from OUTSIDE this editor (e.g.
  // opening a different draft to edit) — but not when it's just this
  // editor's own last emitted change echoing back, which would otherwise
  // reset the DOM (and the cursor) on every keystroke.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = domRef.current;
    if (!node || value === lastEmitted.current) return;
    node.innerHTML = value ? markdownToHtml(value) : '';
    lastEmitted.current = value;
  }, [value]);

  function withFocusAndSelection(run: () => void) {
    domRef.current?.focus();
    run();
  }

  function applyBold() { withFocusAndSelection(() => document.execCommand('bold')); }
  function applyHeading() {
    withFocusAndSelection(() => {
      const current = document.queryCommandValue('formatBlock');
      document.execCommand('formatBlock', false, /h2/i.test(current) ? 'DIV' : 'H2');
    });
  }
  function applyBullet() { withFocusAndSelection(() => document.execCommand('insertUnorderedList')); }
  function applyNumbered() { withFocusAndSelection(() => document.execCommand('insertOrderedList')); }
  function applyLink() {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    // window.prompt steals focus/selection — capture the range first and
    // restore it once the dialog closes, before running the command.
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    domRef.current?.focus();
    if (range) {
      const sel2 = window.getSelection();
      sel2?.removeAllRanges();
      sel2?.addRange(range);
    }
    if (range && !range.collapsed) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">label</a>`);
  }

  if (Platform.OS !== 'web') return null;

  return (
    <View style={rs.wrap}>
      <View style={[rs.toolbar, { backgroundColor: colors.cardHover, borderColor: colors.borderColor }]}>
        <ToolbarBtn onMouseDownPreventDefault icon="bold" label="Bold" onPress={applyBold} colors={colors} />
        <ToolbarBtn onMouseDownPreventDefault glyph="H" label="Heading" onPress={applyHeading} colors={colors} />
        <View style={[rs.divider, { backgroundColor: colors.borderColor }]} />
        <ToolbarBtn onMouseDownPreventDefault icon="list" label="Bullet list" onPress={applyBullet} colors={colors} />
        <ToolbarBtn onMouseDownPreventDefault glyph="1." label="Numbered list" onPress={applyNumbered} colors={colors} />
        <View style={[rs.divider, { backgroundColor: colors.borderColor }]} />
        <ToolbarBtn onMouseDownPreventDefault icon="link" label="Link" onPress={applyLink} colors={colors} />
      </View>
      <View
        ref={hostRef}
        // @ts-ignore — web-only contentEditable host; RN Web passes unknown
        // props straight through to the underlying DOM element.
        style={[rs.editor, { backgroundColor: colors.cardDark, borderColor: colors.borderColor, color: colors.textMain }]}
      />
    </View>
  );
}

function ToolbarBtn({ icon, glyph, label, onPress, colors, onMouseDownPreventDefault }: {
  icon?: string; glyph?: string; label: string; onPress: () => void; colors: AppColors; onMouseDownPreventDefault?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      // @ts-ignore — web-only: keeps the editor's selection from collapsing
      // when the button is clicked (mousedown normally steals focus first).
      onMouseDown={onMouseDownPreventDefault ? (e: any) => e.preventDefault?.() : undefined}
      style={ts.btn}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      {icon
        ? <Feather name={icon as any} size={14} color={colors.textMuted} />
        : <Text style={[ts.glyph, { color: colors.textMuted }]}>{glyph}</Text>}
    </TouchableOpacity>
  );
}

const ts = StyleSheet.create({
  btn: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 12.5, fontWeight: '800', fontFamily: fonts.serif },
});

const rs = StyleSheet.create({
  wrap: { width: '100%' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderBottomWidth: 0,
    borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 4,
  },
  divider: { width: 1, height: 18, marginHorizontal: 4 },
  editor: {
    minHeight: 180, borderWidth: 1,
    borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: fonts.serif, fontSize: 13.5, lineHeight: 20,
  } as any,
});
