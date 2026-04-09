import type { ExchangeConfig } from '../../config';
import type {
  ExchangeFindMessagesOptions,
  ExchangeFolder,
  ExchangeListMessagesOptions,
  ExchangeMessage,
  ExchangeMessageDetail,
  ExchangeVerificationResult,
} from './types';

interface GraphMailFolder {
  id: string;
  displayName: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
}

interface GraphEmailAddress {
  address?: string;
  name?: string;
}

interface GraphRecipient {
  emailAddress?: GraphEmailAddress;
}

interface GraphItemBody {
  contentType?: string;
  content?: string;
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isRead?: boolean;
  receivedDateTime?: string;
  from?: {
    emailAddress?: GraphEmailAddress;
  };
  toRecipients?: GraphRecipient[];
  body?: GraphItemBody;
}

function normalizeAddressList(recipients?: GraphRecipient[]): string[] | undefined {
  const values = (recipients || [])
    .map((item) => item.emailAddress?.address || item.emailAddress?.name)
    .filter((value): value is string => Boolean(value));
  return values.length ? values : undefined;
}

function mapMessage(message: GraphMessage): ExchangeMessage {
  return {
    id: message.id,
    subject: message.subject || '',
    from: message.from?.emailAddress?.address || message.from?.emailAddress?.name,
    to: normalizeAddressList(message.toRecipients),
    bodyPreview: message.bodyPreview,
    isRead: message.isRead,
    receivedAt: message.receivedDateTime,
  };
}

function uniqueMessages(messages: ExchangeMessage[]): ExchangeMessage[] {
  const seen = new Set<string>();
  const output: ExchangeMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    output.push(message);
  }
  return output.sort((a, b) => {
    const aTime = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bTime = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bTime - aTime;
  });
}

export class ExchangeClient {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: ExchangeConfig) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.config.auth.clientId,
      client_secret: this.config.auth.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const tokenUrl = `https://login.microsoftonline.com/${this.config.auth.tenantId}/oauth2/v2.0/token`;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !json.access_token) {
      throw new Error(
        `Failed to acquire Microsoft Graph token: ${json.error || response.status} ${json.error_description || ''}`.trim(),
      );
    }

    this.accessToken = json.access_token;
    this.accessTokenExpiresAt = now + (json.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  private getMailboxPath(): string {
    if (!this.config.mailbox) {
      throw new Error('Exchange mailbox is required for Microsoft Graph application permissions.');
    }
    return `/users/${this.config.mailbox}`;
  }

  private async graphGet<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(`https://graph.microsoft.com/v1.0${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    const json = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(json.error?.message || `Microsoft Graph request failed: ${response.status}`);
    }
    return json as T;
  }

  private async listMessagesAtPath(path: string, options: ExchangeListMessagesOptions = {}): Promise<ExchangeMessage[]> {
    const maxItems = options.maxItems ?? 20;
    const filter = options.unreadOnly ? 'isRead eq false' : undefined;
    const result = await this.graphGet<{ value?: GraphMessage[] }>(path, {
      '$top': maxItems,
      '$select': 'id,subject,bodyPreview,isRead,receivedDateTime,from,toRecipients',
      '$orderby': 'receivedDateTime desc',
      '$filter': filter,
    });

    return (result.value || []).map(mapMessage);
  }

  async verifyAccess(): Promise<ExchangeVerificationResult> {
    const mailbox = this.config.mailbox || '';
    let tokenAcquired = false;
    let folderAccess = false;
    let inboxAccess = false;
    let mailboxAccess = false;
    let folderCount: number | undefined;
    let folders: Array<{ displayName: string; totalCount?: number; unreadCount?: number }> | undefined;
    let inboxSampleSubjects: string[] | undefined;
    let mailboxSampleSubjects: string[] | undefined;
    let mailboxSampleRecipients: string[][] | undefined;

    await this.getAccessToken();
    tokenAcquired = true;

    const folderList = await this.listFolders();
    folderAccess = true;
    folderCount = folderList.length;
    folders = folderList.map((folder) => ({
      displayName: folder.displayName,
      totalCount: folder.totalCount,
      unreadCount: folder.unreadCount,
    }));

    const inboxMessages = await this.listMessages({ maxItems: 10, unreadOnly: false });
    inboxAccess = true;
    inboxSampleSubjects = inboxMessages.map((message) => message.subject).filter(Boolean).slice(0, 10);

    const mailboxMessages = await this.listMailboxMessages({ maxItems: 10, unreadOnly: false });
    mailboxAccess = true;
    mailboxSampleSubjects = mailboxMessages.map((message) => message.subject).filter(Boolean).slice(0, 10);
    mailboxSampleRecipients = mailboxMessages.map((message) => message.to || []).slice(0, 10);

    return {
      ok: true,
      mailbox,
      tokenAcquired,
      folderAccess,
      inboxAccess,
      mailboxAccess,
      folderCount,
      folders,
      inboxSampleSubjects,
      mailboxSampleSubjects,
      mailboxSampleRecipients,
    };
  }

  async listFolders(): Promise<ExchangeFolder[]> {
    const mailboxPath = this.getMailboxPath();
    const result = await this.graphGet<{ value?: GraphMailFolder[] }>(`${mailboxPath}/mailFolders`, {
      '$select': 'id,displayName,childFolderCount,unreadItemCount,totalItemCount',
    });

    return (result.value || []).map((folder) => ({
      id: folder.id,
      displayName: folder.displayName,
      childFolderCount: folder.childFolderCount,
      unreadCount: folder.unreadItemCount,
      totalCount: folder.totalItemCount,
    }));
  }

  async listMessages(options: ExchangeListMessagesOptions = {}): Promise<ExchangeMessage[]> {
    const mailboxPath = this.getMailboxPath();
    const folderPath = options.folderId
      ? `${mailboxPath}/mailFolders/${options.folderId}/messages`
      : `${mailboxPath}/mailFolders/inbox/messages`;

    return this.listMessagesAtPath(folderPath, options);
  }

  async listMailboxMessages(options: ExchangeListMessagesOptions = {}): Promise<ExchangeMessage[]> {
    const mailboxPath = this.getMailboxPath();
    return this.listMessagesAtPath(`${mailboxPath}/messages`, options);
  }

  async getMessage(messageId: string): Promise<ExchangeMessageDetail> {
    const mailboxPath = this.getMailboxPath();
    const result = await this.graphGet<GraphMessage>(`${mailboxPath}/messages/${messageId}`, {
      '$select': 'id,subject,bodyPreview,isRead,receivedDateTime,from,toRecipients,body',
    });

    const mapped = mapMessage(result);
    return {
      ...mapped,
      body: result.body?.content,
      bodyContentType: result.body?.contentType,
    };
  }

  async findMessages(options: ExchangeFindMessagesOptions = {}): Promise<ExchangeMessage[]> {
    const inboxMessages = await this.listMessages(options);
    const mailboxMessages = await this.listMailboxMessages({
      maxItems: Math.max(options.maxItems ?? 20, 50),
      unreadOnly: options.unreadOnly,
    });

    const messages = uniqueMessages([...inboxMessages, ...mailboxMessages]);
    return messages.filter((message) => {
      if (options.fromIncludes && !(message.from || '').toLowerCase().includes(options.fromIncludes.toLowerCase())) {
        return false;
      }
      if (
        options.toIncludes &&
        !(message.to || []).some((entry) => entry.toLowerCase().includes(options.toIncludes!.toLowerCase()))
      ) {
        return false;
      }
      if (
        options.subjectIncludes &&
        !(message.subject || '').toLowerCase().includes(options.subjectIncludes.toLowerCase())
      ) {
        return false;
      }
      if (
        options.receivedAfter &&
        message.receivedAt &&
        new Date(message.receivedAt).getTime() < new Date(options.receivedAfter).getTime()
      ) {
        return false;
      }
      return true;
    });
  }
}
