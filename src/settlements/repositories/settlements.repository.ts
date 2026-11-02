import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ResolutionEntity } from './resolution.entity';

@Injectable()
export class SettlementsRepository {
  constructor(@InjectRepository(ResolutionEntity) private readonly resolutions: Repository<ResolutionEntity>) {}

  findByMarket(marketId: string, m?: EntityManager) {
    return (m ?? this.resolutions.manager).getRepository(ResolutionEntity).findOne({ where: { marketId } });
  }
  create(m: EntityManager, data: Partial<ResolutionEntity>) {
    return m.getRepository(ResolutionEntity).save(m.getRepository(ResolutionEntity).create(data));
  }
  confirm(m: EntityManager, id: string, confirmedBy: string) {
    return m.getRepository(ResolutionEntity).update({ id }, { confirmedBy, confirmedAt: new Date() });
  }
}
