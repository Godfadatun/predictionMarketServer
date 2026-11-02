import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

// One DB transaction per business operation; repositories receive the manager so every write commits together.
@Injectable()
export class UnitOfWork {
  constructor(private readonly ds: DataSource) {}

  run<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.ds.transaction('READ COMMITTED', fn);
  }
}
