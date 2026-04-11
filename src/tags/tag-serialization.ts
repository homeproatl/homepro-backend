import { InternalServerErrorException } from '@nestjs/common';

export function serializeEmbeddedTags(
  tags: Array<Record<string, unknown>> | undefined,
  expectedScope: 'LABOR' | 'PART',
  serializeId: (value: unknown, context: string) => string,
) {
  return (tags ?? []).map((tag) => ({
    id:
      tag.tag_id === null || tag.tag_id === undefined
        ? null
        : serializeId(tag.tag_id, 'tag id'),
    scope: serializeTagScope(tag.scope, expectedScope),
    name: typeof tag.name === 'string' ? tag.name : '',
    color: typeof tag.color === 'string' ? tag.color : 'slate',
  }));
}

export function serializeTagScope(
  value: unknown,
  expectedScope: 'LABOR' | 'PART',
) {
  if (value !== expectedScope) {
    throw new InternalServerErrorException(
      `Stored tag scope mismatch: expected ${expectedScope}.`,
    );
  }

  return expectedScope;
}
