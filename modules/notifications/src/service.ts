/**
 * Domain Service & Utilities for In-App Notifications & Delivery Preferences
 *
 * Mapped to IMPLEMENTATION.md Sections 2.9, 8.3, and 11.
 */

import type {
  AppNotification,
  NotificationCategory,
  NotificationPreferences,
  NotificationPriority,
} from "@bizcontext/types";

export type {
  AppNotification,
  NotificationCategory,
  NotificationPreferences,
  NotificationPriority,
};

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "task",
  "ticket",
  "mention",
  "meeting",
  "approval",
  "system",
  "project",
  "document",
  "agent",
];

export const NOTIFICATION_PRIORITIES: NotificationPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];

/**
 * Generates default notification preferences for a user in an organisation.
 */
export function getDefaultPreferences(
  organisationId: string,
  userId: string
): NotificationPreferences {
  return {
    id: `pref-${userId}`,
    organisationId,
    userId,
    emailNotifications: true,
    inAppNotifications: true,
    taskAssigned: true,
    ticketUpdates: true,
    mentions: true,
    approvalRequests: true,
    systemAnnouncements: true,
    dailyDigest: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Checks if a notification should be delivered based on user category preferences and channel.
 */
export function shouldDeliverNotification(
  prefs: NotificationPreferences,
  category: NotificationCategory,
  channel: "email" | "in_app" = "in_app"
): boolean {
  if (channel === "in_app" && !prefs.inAppNotifications) {
    return false;
  }
  if (channel === "email" && !prefs.emailNotifications) {
    return false;
  }

  switch (category) {
    case "task":
      return prefs.taskAssigned;
    case "ticket":
      return prefs.ticketUpdates;
    case "mention":
      return prefs.mentions;
    case "approval":
      return prefs.approvalRequests;
    case "system":
      return prefs.systemAnnouncements;
    case "meeting":
    case "project":
    case "document":
    case "agent":
    default:
      return true;
  }
}

/**
 * Formats database row into AppNotification domain object.
 */
export function formatNotification(
  row: Record<string, unknown>,
  actorName?: string
): AppNotification {
  return {
    id: row.id as string,
    organisationId: row.organisation_id as string,
    recipientId: row.recipient_id as string,
    actorId: (row.actor_id as string) ?? null,
    actorName: actorName ?? null,
    category: (row.category as NotificationCategory) || "system",
    title: (row.title as string) || "Notification",
    body: (row.body as string) || "",
    linkUrl: (row.link_url as string) ?? null,
    resourceType: (row.resource_type as string) ?? null,
    resourceId: (row.resource_id as string) ?? null,
    priority: (row.priority as NotificationPriority) || "normal",
    isRead: Boolean(row.is_read),
    readAt: (row.read_at as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    createdAt: row.created_at as string,
  };
}
