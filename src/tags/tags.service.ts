import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateTagDto } from './dto/create-tag.dto';
import { Tag, TagDocument } from './schemas/tag.schema';
import { type TagScope } from './tag-scopes';

type SerializedTag = {
  id: string;
  scope: TagScope;
  name: string;
  color: string;
  created_at: string | null;
  updated_at: string | null;
};

@Injectable()
export class TagsService {
  constructor(
    @InjectModel(Tag.name)
    private readonly tagModel: Model<TagDocument>,
  ) {}

  async findAll(scope: TagScope): Promise<SerializedTag[]> {
    const tags = await this.tagModel
      .find({ scope })
      .sort({ name: 1, _id: 1 })
      .exec();
    return tags.map((tag) => this.serializeTag(tag));
  }

  async create(payload: CreateTagDto): Promise<SerializedTag> {
    const normalizedName = this.normalizeTagName(payload.name);
    const existing = await this.tagModel
      .findOne({ scope: payload.scope, normalized_name: normalizedName })
      .exec();

    if (existing) {
      throw new ConflictException({
        code: 'DUPLICATE_TAG_NAME',
        message: 'A reusable tag with this name already exists.',
        duplicate_tag: this.serializeTag(existing),
      });
    }

    const created = await this.tagModel.create({
      scope: payload.scope,
      name: payload.name.trim(),
      normalized_name: normalizedName,
      color: payload.color,
    });

    return this.serializeTag(created);
  }

  private normalizeTagName(name: string) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private serializeTag(tag: TagDocument): SerializedTag {
    const raw = tag.toObject() as {
      _id: unknown;
      created_at?: Date | string | null;
      updated_at?: Date | string | null;
    };

    return {
      id: String(raw._id),
      scope: tag.scope,
      name: tag.name,
      color: tag.color,
      created_at: this.toIsoString(raw.created_at),
      updated_at: this.toIsoString(raw.updated_at),
    };
  }

  private toIsoString(value?: Date | string | null) {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
