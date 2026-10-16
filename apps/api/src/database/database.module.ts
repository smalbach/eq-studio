import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { DataSource } from "typeorm";
import type { AppConfig } from "../config.ts";
import { APP_CONFIG, DATA_SOURCE } from "../shared/tokens.ts";
import { openDatabase } from "./data-source.ts";

@Global()
@Module({
  providers: [{ provide: DATA_SOURCE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => openDatabase(config.database) }],
  exports: [DATA_SOURCE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATA_SOURCE) private readonly source: DataSource) {}

  async onApplicationShutdown() {
    if (this.source.isInitialized) await this.source.destroy();
  }
}
