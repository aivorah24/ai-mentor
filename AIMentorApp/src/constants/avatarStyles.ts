export type AvatarStyleId =
  | 'default'
  | 'casual'
  | 'gamer'
  | 'creator'
  | 'scholar'
  | 'champion';

export type AvatarStyle = {
  id: AvatarStyleId;
  label: string;
  icon: string;
  gradient: [string, string];
};

export const AVATAR_STYLES: AvatarStyle[] = [
  { id: 'default', label: 'Default', icon: 'user', gradient: ['#5F8A86', '#93B0AC'] },
  { id: 'casual', label: 'Casual', icon: 'smile', gradient: ['#93B0AC', '#C3DCD8'] },
  { id: 'gamer', label: 'Gamer', icon: 'zap', gradient: ['#8A8358', '#C5BD96'] },
  { id: 'creator', label: 'Creator', icon: 'edit-3', gradient: ['#B8797E', '#EFD1D4'] },
  { id: 'scholar', label: 'Scholar', icon: 'book-open', gradient: ['#5A8A70', '#93B0AC'] },
  { id: 'champion', label: 'Champion', icon: 'award', gradient: ['#D4A898', '#B8797E'] },
];

const FALLBACK_AVATAR = AVATAR_STYLES[0];

export function getAvatarGradient(style?: string | null): [string, string] {
  return AVATAR_STYLES.find((item) => item.id === style)?.gradient ?? FALLBACK_AVATAR.gradient;
}

export function getAvatarIcon(style?: string | null): string {
  return AVATAR_STYLES.find((item) => item.id === style)?.icon ?? FALLBACK_AVATAR.icon;
}
