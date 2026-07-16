export type AnnouncementSeverity = 'info' | 'warning' | 'critical';
export type AnnouncementDisplayType = 'banner' | 'inbox' | 'both';
export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export interface AnnouncementAttachment {
  id?: string;
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  displayType: AnnouncementDisplayType;
  status: AnnouncementStatus;
  isDismissible: boolean;
  contentVersion: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  startsAt: string | null;
  expiresAt: string | null;
  audienceRoles: string[];
  audienceSchoolId: string | null;
  audienceSchoolName: string | null;
  attachments: AnnouncementAttachment[];
  isSeen: boolean;
  isDismissed: boolean;
}
