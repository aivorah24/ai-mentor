/**
 * LessonVisuals.tsx
 * Small reusable "visual vocabulary" for step-by-step lesson cards —
 * Number Line, Venn Circles, Bar Model (fractions), and Conversion Chart.
 */
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Line, Circle, Path, Text as SvgText, Ellipse } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';

// ── Number Line ──────────────────────────────────────────────────────────
// Shows hops along a number line, highlighting a set of values (e.g. multiples).
// `answer` (if given) is drawn larger and labelled.
type NumberLineProps = {
  min: number;
  max: number;
  highlights: number[];
  answer?: number;
  accent: string;
  label?: string;
};

export function NumberLineVisual({ min, max, highlights, answer, accent, label }: NumberLineProps) {
  const W = 320, H = 120;
  const padX = 18;
  const lineY = 78;
  const span = max - min;
  const x = (v: number) => padX + ((v - min) / span) * (W - padX * 2);

  const sorted = [...highlights].sort((a, b) => a - b);

  return (
    <View style={{ alignItems: 'center', marginVertical: 6 }}>
      {!!label && <Text style={{ fontSize: 12, fontWeight: '700', color: accent, marginBottom: 4 }}>{label}</Text>}
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* base line */}
        <Line x1={padX} y1={lineY} x2={W - padX} y2={lineY} stroke={accent} strokeWidth={2} strokeOpacity={0.35} />

        {/* hop arcs between consecutive highlights */}
        {sorted.slice(0, -1).map((v, i) => {
          const x1 = x(v), x2 = x(sorted[i + 1]);
          const midX = (x1 + x2) / 2;
          const arcH = 22;
          return (
            <Path
              key={`hop-${i}`}
              d={`M ${x1} ${lineY} Q ${midX} ${lineY - arcH * 2} ${x2} ${lineY}`}
              stroke={accent}
              strokeWidth={2}
              strokeOpacity={0.5}
              fill="none"
            />
          );
        })}

        {/* tick marks + number labels for every integer */}
        {Array.from({ length: span + 1 }, (_, i) => min + i).map(v => {
          const isHighlight = highlights.includes(v);
          const isAnswer = v === answer;
          return (
            <React.Fragment key={`tick-${v}`}>
              <Line x1={x(v)} y1={lineY - 4} x2={x(v)} y2={lineY + 4} stroke={accent} strokeOpacity={0.3} strokeWidth={1} />
              {isHighlight && (
                <Circle
                  cx={x(v)}
                  cy={lineY}
                  r={isAnswer ? 11 : 7}
                  fill={isAnswer ? accent : accent + '99'}
                  stroke="#fff"
                  strokeWidth={isAnswer ? 2 : 0}
                />
              )}
              <SvgText
                x={x(v)}
                y={lineY + 22}
                fontSize={isAnswer ? 13 : 11}
                fontWeight={isHighlight ? '800' : '400'}
                fill={isHighlight ? accent : '#94a3b8'}
                textAnchor="middle"
              >
                {v}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

// ── Venn Circles ─────────────────────────────────────────────────────────
// Shows two overlapping sets with numbers placed in left-only, overlap,
// and right-only regions — the overlap is the LCM/shared answer.
type VennProps = {
  leftLabel: string;
  rightLabel: string;
  leftOnly: (number | string)[];
  rightOnly: (number | string)[];
  overlap: (number | string)[];
  accent: string;
  leftColor?: string;
  rightColor?: string;
};

export function VennCirclesVisual({ leftLabel, rightLabel, leftOnly, rightOnly, overlap, accent, leftColor, rightColor }: VennProps) {
  const W = 320, H = 200;
  const cyTop = 36;
  const r = 78;
  const leftCx = W / 2 - 48;
  const rightCx = W / 2 + 48;
  const cy = cyTop + r;
  const colL = leftColor || accent;
  const colR = rightColor || '#a78bfa';

  return (
    <View style={{ alignItems: 'center', marginVertical: 6 }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Ellipse cx={leftCx} cy={cy} rx={r} ry={r} fill={colL + '18'} stroke={colL} strokeWidth={2} />
        <Ellipse cx={rightCx} cy={cy} rx={r} ry={r} fill={colR + '18'} stroke={colR} strokeWidth={2} />

        {/* set labels */}
        <SvgText x={leftCx - 38} y={cyTop - 8} fontSize={12} fontWeight="800" fill={colL} textAnchor="middle">{leftLabel}</SvgText>
        <SvgText x={rightCx + 38} y={cyTop - 8} fontSize={12} fontWeight="800" fill={colR} textAnchor="middle">{rightLabel}</SvgText>

        {/* left-only values */}
        {leftOnly.map((v, i) => (
          <SvgText key={`l-${i}`} x={leftCx - 36} y={cy - 16 + i * 22} fontSize={14} fontWeight="700" fill={colL} textAnchor="middle">{v}</SvgText>
        ))}

        {/* right-only values */}
        {rightOnly.map((v, i) => (
          <SvgText key={`r-${i}`} x={rightCx + 36} y={cy - 16 + i * 22} fontSize={14} fontWeight="700" fill={colR} textAnchor="middle">{v}</SvgText>
        ))}

        {/* overlap values — the shared / answer numbers */}
        {overlap.map((v, i) => (
          <React.Fragment key={`o-${i}`}>
            <Circle cx={W / 2} cy={cy - 14 + i * 26} r={13} fill={accent} stroke="#fff" strokeWidth={2} />
            <SvgText x={W / 2} y={cy - 9 + i * 26} fontSize={13} fontWeight="800" fill="#fff" textAnchor="middle">{v}</SvgText>
          </React.Fragment>
        ))}
      </Svg>
      <Text style={{ fontSize: 11, color: accent, fontWeight: '700', marginTop: 2 }}>
        Shared in the middle = the LCM!
      </Text>
    </View>
  );
}

// ── Bar Model ────────────────────────────────────────────────────────────
// Shows a fraction as equal parts of a bar, with `filled` parts shaded —
// e.g. total=4, filled=3 visualises 3/4.
type BarModelProps = {
  total: number;
  filled: number;
  accent: string;
  label?: string;
};

export function BarModelVisual({ total, filled, accent, label }: BarModelProps) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 6 }}>
      {!!label && <Text style={{ fontSize: 12, fontWeight: '700', color: accent, marginBottom: 6 }}>{label}</Text>}
      <View style={{ flexDirection: 'row', width: 280, height: 44, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: accent }}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              backgroundColor: i < filled ? accent : accent + '12',
              borderRightWidth: i < total - 1 ? 2 : 0,
              borderRightColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '800', color: i < filled ? '#fff' : accent }}>
              {`1/${total}`}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 13, fontWeight: '800', color: accent, marginTop: 6 }}>
        {filled} of {total} parts = {filled}/{total}
      </Text>
    </View>
  );
}

// ── Conversion Chart ─────────────────────────────────────────────────────
// Shows a vertical chain of units connected by "× factor" / "÷ factor" arrows —
// e.g. km → m → cm → mm.
type ConversionChartProps = {
  items: string[];
  factors: string[];
  accent: string;
};

export function ConversionChartVisual({ items, factors, accent }: ConversionChartProps) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 6, width: '100%' }}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          <View style={{
            paddingVertical: 8, paddingHorizontal: 24, borderRadius: 10,
            backgroundColor: accent + '18', borderWidth: 1.5, borderColor: accent + '50',
            minWidth: 160, alignItems: 'center',
          }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: accent }}>{item}</Text>
          </View>
          {i < factors.length && (
            <View style={{ alignItems: 'center', marginVertical: 2 }}>
              <Feather name="arrow-down" size={16} color={accent} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: accent }}>{factors[i]}</Text>
            </View>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}
