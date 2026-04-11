export const TAG_SCOPE_VALUES = ['LABOR', 'PART'] as const;

export type TagScope = (typeof TAG_SCOPE_VALUES)[number];
