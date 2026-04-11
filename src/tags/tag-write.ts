import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { type TagColor } from './tag-colors';
import { type TagScope } from './tag-scopes';
import { TagDocument } from './schemas/tag.schema';

export type LineTagWriteInput = {
  id?: string | null;
  scope: TagScope;
  name: string;
  color: TagColor;
};

export type PreparedLineTag = {
  tag_id: Types.ObjectId | null;
  scope: TagScope;
  name: string;
  color: TagColor;
};

function normalizeTagIdentityName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function prepareEmbeddedTags(
  tagModel: Model<TagDocument>,
  input: LineTagWriteInput[] | undefined,
  expectedScope: TagScope,
) {
  const requestedTags = input ?? [];
  if (requestedTags.length === 0) {
    return [] as PreparedLineTag[];
  }

  const reusableTagIds = Array.from(
    new Set(
      requestedTags
        .map((tag) => tag.id?.trim() ?? '')
        .filter((value) => value.length > 0),
    ),
  );

  const reusableTags = reusableTagIds.length
    ? await tagModel
        .find({ _id: { $in: reusableTagIds.map((id) => asObjectId(id, 'tag id')) } })
        .exec()
    : [];

  const reusableTagsById = new Map(
    reusableTags.map((tag) => [String(tag._id), tag]),
  );
  const preparedTags: PreparedLineTag[] = [];
  const seen = new Set<string>();

  for (const requestedTag of requestedTags) {
    const requestedId = requestedTag.id?.trim() ?? '';
    const reusableTag = requestedId ? reusableTagsById.get(requestedId) : null;

    if (requestedId && !reusableTag) {
      throw new NotFoundException('Tag not found');
    }

    if (requestedTag.scope !== expectedScope) {
      throw new BadRequestException('Tag scope does not match the target line type.');
    }

    if (reusableTag && reusableTag.scope !== expectedScope) {
      throw new BadRequestException('Reusable tag scope does not match the target line type.');
    }

    const preparedTag: PreparedLineTag = reusableTag
      ? {
          tag_id: reusableTag._id,
          scope: reusableTag.scope,
          name: reusableTag.name,
          color: reusableTag.color,
        }
      : {
          tag_id: null,
          scope: expectedScope,
          name: requestedTag.name.trim(),
          color: requestedTag.color,
        };

    const dedupeKey = `${preparedTag.scope}::${normalizeTagIdentityName(
      preparedTag.name,
    )}::${preparedTag.color}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    preparedTags.push(preparedTag);
  }

  return preparedTags;
}
