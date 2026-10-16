import { Module, type DynamicModule } from "@nestjs/common";
import { RateLimiter } from "../../shared/rate-limit.ts";
import { CollectDeviceTokenHandler, DecideDeviceHandler, DescribeDeviceHandler, ForgetDeviceHandler, StartDeviceHandler } from "./application/devices.ts";
import { SyncClient } from "./application/sync-client.ts";
import { GetKeyCheckHandler, ListConflictsHandler, PullChangesHandler, PushChangesHandler, ResolveConflictHandler, SetKeyCheckHandler } from "./application/sync-server.ts";
import { SyncStore } from "./infrastructure/sync.store.ts";
import { DevicesController } from "./presentation/devices.controller.ts";
import { SyncClientController } from "./presentation/sync-client.controller.ts";
import { SyncServerController } from "./presentation/sync-server.controller.ts";

/**
 * Sync, on the side this installation plays: a local one syncs *with* a cloud workspace; a
 * cloud deployment is what devices sync with.
 */
@Module({})
export class SyncModule {
  static forMode(mode: "local" | "cloud"): DynamicModule {
    if (mode === "local") return { module: SyncModule, controllers: [SyncClientController], providers: [SyncStore, SyncClient] };
    return {
      module: SyncModule,
      controllers: [SyncServerController, DevicesController],
      providers: [SyncStore, RateLimiter, PullChangesHandler, PushChangesHandler, ListConflictsHandler, ResolveConflictHandler, GetKeyCheckHandler, SetKeyCheckHandler, StartDeviceHandler, CollectDeviceTokenHandler, DescribeDeviceHandler, DecideDeviceHandler, ForgetDeviceHandler],
    };
  }
}
