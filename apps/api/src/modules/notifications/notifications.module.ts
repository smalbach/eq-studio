import { Module } from "@nestjs/common";
import { NotificationService, RunFinishedNotifier } from "./application/notifications.ts";
import { NotificationRepository } from "./infrastructure/notification.repository.ts";
import { NotificationsController } from "./presentation/notifications.controller.ts";

@Module({ controllers: [NotificationsController], providers: [NotificationRepository, NotificationService, RunFinishedNotifier] })
export class NotificationsModule {}
