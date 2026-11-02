import { Global, Module, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { connections } from '@/integrations';
import { UnitOfWork } from './database/unit-of-work';
import { AuditService } from './logging/audit.service';
import { AuthGuard, PaystackSignatureGuard, RolesGuard } from './guards';

@Global()
@Module({
  providers: [UnitOfWork, AuditService, AuthGuard, RolesGuard, PaystackSignatureGuard],
  exports: [UnitOfWork, AuditService, AuthGuard, RolesGuard, PaystackSignatureGuard],
})
export class CommonModule implements OnModuleInit {
  constructor(private readonly ds: DataSource) {}
  onModuleInit() { connections.init(this.ds); }
}
