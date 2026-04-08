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
  isRead?: boolean;
  receivedAt?: string;
}

export interface ExchangeListMessagesOptions {
  folderId?: string;
  maxItems?: number;
  unreadOnly?: boolean;
}
