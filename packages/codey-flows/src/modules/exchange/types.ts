export interface ExchangeFolder {
  id: string;
  changeKey?: string;
  displayName: string;
  childFolderCount?: number;
  unreadCount?: number;
  totalCount?: number;
}

export interface ExchangeMessage {
  id: string;
  changeKey?: string;
  subject: string;
  from?: string;
  to?: string[];
  bodyPreview?: string;
  isRead?: boolean;
  receivedAt?: string;
}

export interface ExchangeMessageDetail extends ExchangeMessage {
  body?: string;
  bodyContentType?: string;
}

export interface ExchangeListMessagesOptions {
  folderId?: string;
  maxItems?: number;
  unreadOnly?: boolean;
}

export interface ExchangeFindMessagesOptions extends ExchangeListMessagesOptions {
  fromIncludes?: string;
  toIncludes?: string;
  subjectIncludes?: string;
  receivedAfter?: string;
}

export interface ExchangeVerificationResult {
  ok: boolean;
  mailbox: string;
  tokenAcquired: boolean;
  folderAccess: boolean;
  inboxAccess: boolean;
  mailboxAccess: boolean;
  folderCount?: number;
  folders?: Array<{
    displayName: string;
    totalCount?: number;
    unreadCount?: number;
  }>;
  inboxSampleSubjects?: string[];
  mailboxSampleSubjects?: string[];
  mailboxSampleRecipients?: string[][];
}
