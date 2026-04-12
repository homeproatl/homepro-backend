import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Estimate, EstimateDocument } from '../estimates/schemas/estimate.schema';
import {
  ServiceCatalog,
  ServiceCatalogDocument,
} from '../service-catalog/schemas/service-catalog.schema';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
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
    @InjectModel(Estimate.name)
    private readonly estimateModel: Model<EstimateDocument>,
    @InjectModel(ServiceCatalog.name)
    private readonly serviceCatalogModel: Model<ServiceCatalogDocument>,
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

  async update(id: string, payload: UpdateTagDto): Promise<SerializedTag> {
    const tag = await this.tagModel.findById(id).exec();
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    const normalizedName = this.normalizeTagName(payload.name);
    const existing = await this.tagModel
      .findOne({
        _id: { $ne: tag._id },
        scope: tag.scope,
        normalized_name: normalizedName,
      })
      .exec();

    if (existing) {
      throw new ConflictException({
        code: 'DUPLICATE_TAG_NAME',
        message: 'A reusable tag with this name already exists.',
        duplicate_tag: this.serializeTag(existing),
      });
    }

    tag.name = payload.name.trim();
    tag.normalized_name = normalizedName;
    tag.color = payload.color;
    await tag.save();
    await this.propagateTagUpdate(tag);

    return this.serializeTag(tag);
  }

  async remove(id: string): Promise<void> {
    const tag = await this.tagModel.findById(id).exec();
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    await Promise.all([
      this.detachTagFromServices(tag._id),
      this.detachTagFromEstimates(tag._id),
    ]);
    await tag.deleteOne();
  }

  private normalizeTagName(name: string) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private async propagateTagUpdate(tag: TagDocument) {
    await Promise.all([
      this.updateServiceCatalogEmbeddedTags(tag),
      this.updateEstimateEmbeddedTags(tag),
    ]);
  }

  private async updateServiceCatalogEmbeddedTags(tag: TagDocument) {
    const services = await this.serviceCatalogModel
      .find({
        $or: [
          { 'labor_lines.tags.tag_id': tag._id },
          { 'part_lines.tags.tag_id': tag._id },
        ],
      })
      .exec();

    for (const service of services) {
      let changed = false;

      for (const laborLine of service.labor_lines) {
        for (const embeddedTag of laborLine.tags) {
          if (this.matchesTagId(embeddedTag.tag_id, tag._id)) {
            embeddedTag.name = tag.name;
            embeddedTag.color = tag.color;
            embeddedTag.scope = tag.scope;
            changed = true;
          }
        }
      }

      for (const partLine of service.part_lines) {
        for (const embeddedTag of partLine.tags) {
          if (this.matchesTagId(embeddedTag.tag_id, tag._id)) {
            embeddedTag.name = tag.name;
            embeddedTag.color = tag.color;
            embeddedTag.scope = tag.scope;
            changed = true;
          }
        }
      }

      if (changed) {
        await service.save();
      }
    }
  }

  private async updateEstimateEmbeddedTags(tag: TagDocument) {
    const estimates = await this.estimateModel
      .find({
        $or: [
          { 'services.labor_lines.tags.tag_id': tag._id },
          { 'services.part_lines.tags.tag_id': tag._id },
        ],
      })
      .exec();

    for (const estimate of estimates) {
      let changed = false;

      for (const service of estimate.services) {
        for (const laborLine of service.labor_lines) {
          for (const embeddedTag of laborLine.tags) {
            if (this.matchesTagId(embeddedTag.tag_id, tag._id)) {
              embeddedTag.name = tag.name;
              embeddedTag.color = tag.color;
              embeddedTag.scope = tag.scope;
              changed = true;
            }
          }
        }

        for (const partLine of service.part_lines) {
          for (const embeddedTag of partLine.tags) {
            if (this.matchesTagId(embeddedTag.tag_id, tag._id)) {
              embeddedTag.name = tag.name;
              embeddedTag.color = tag.color;
              embeddedTag.scope = tag.scope;
              changed = true;
            }
          }
        }
      }

      if (changed) {
        await estimate.save();
      }
    }
  }

  private async detachTagFromServices(tagId: Types.ObjectId) {
    const services = await this.serviceCatalogModel
      .find({
        $or: [
          { 'labor_lines.tags.tag_id': tagId },
          { 'part_lines.tags.tag_id': tagId },
        ],
      })
      .exec();

    for (const service of services) {
      let changed = false;

      for (const laborLine of service.labor_lines) {
        const nextTags = laborLine.tags.filter(
          (embeddedTag) => !this.matchesTagId(embeddedTag.tag_id, tagId),
        );
        if (nextTags.length !== laborLine.tags.length) {
          laborLine.tags = nextTags;
          changed = true;
        }
      }

      for (const partLine of service.part_lines) {
        const nextTags = partLine.tags.filter(
          (embeddedTag) => !this.matchesTagId(embeddedTag.tag_id, tagId),
        );
        if (nextTags.length !== partLine.tags.length) {
          partLine.tags = nextTags;
          changed = true;
        }
      }

      if (changed) {
        await service.save();
      }
    }
  }

  private async detachTagFromEstimates(tagId: Types.ObjectId) {
    const estimates = await this.estimateModel
      .find({
        $or: [
          { 'services.labor_lines.tags.tag_id': tagId },
          { 'services.part_lines.tags.tag_id': tagId },
        ],
      })
      .exec();

    for (const estimate of estimates) {
      let changed = false;

      for (const service of estimate.services) {
        for (const laborLine of service.labor_lines) {
          const nextTags = laborLine.tags.filter(
            (embeddedTag) => !this.matchesTagId(embeddedTag.tag_id, tagId),
          );
          if (nextTags.length !== laborLine.tags.length) {
            laborLine.tags = nextTags;
            changed = true;
          }
        }

        for (const partLine of service.part_lines) {
          const nextTags = partLine.tags.filter(
            (embeddedTag) => !this.matchesTagId(embeddedTag.tag_id, tagId),
          );
          if (nextTags.length !== partLine.tags.length) {
            partLine.tags = nextTags;
            changed = true;
          }
        }
      }

      if (changed) {
        await estimate.save();
      }
    }
  }

  private matchesTagId(
    embeddedTagId: Types.ObjectId | null | undefined,
    tagId: Types.ObjectId,
  ) {
    return Boolean(embeddedTagId) && String(embeddedTagId) === String(tagId);
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
