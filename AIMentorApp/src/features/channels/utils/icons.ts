// Preset icon choices for a group/channel's "DP" — a small, curated set of
// Feather icons covering common school group types (class, activity, sport,
// arts...). Falls back to the generic people icon if nothing was picked.
export const GROUP_ICONS = ['users', 'book-open', 'music', 'star', 'award', 'heart', 'camera', 'globe'] as const;
export type GroupIconName = typeof GROUP_ICONS[number];

export function isGroupIcon(v?: string | null): v is GroupIconName {
  return !!v && (GROUP_ICONS as readonly string[]).includes(v);
}
