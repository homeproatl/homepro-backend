export const TAG_COLOR_VALUES = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'emerald',
  'blue',
  'violet',
] as const;

export type TagColor = (typeof TAG_COLOR_VALUES)[number];
