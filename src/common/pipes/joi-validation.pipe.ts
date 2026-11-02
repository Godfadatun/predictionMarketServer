import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import Joi from 'joi';
import { ValidationError } from '@/errors';

type Source = 'body' | 'query' | 'param';

// Validates one request source (default body) against a dto/ Joi schema; other params pass through untouched.
@Injectable()
export class JoiValidationPipe implements PipeTransform {
  constructor(private readonly schema: Joi.Schema, private readonly source: Source = 'body') {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== this.source) return value;
    const { error, value: clean } = this.schema.validate(value ?? {}, { abortEarly: false, stripUnknown: true, convert: true });
    if (error) throw new ValidationError(error.details.map((d) => d.message.replace(/"/g, '')).join('; '));
    return clean;
  }
}
