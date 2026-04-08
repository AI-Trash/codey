import { Client } from '@microsoft/microsoft-graph-client';
import type { ExchangeConfig } from '../../config';
import type { ExchangeFolder, ExchangeListMessagesOptions, ExchangeMessage } from './types';

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

interface GraphMessage {
  id: string;
  subject?: string;
  isRead?: boolean;
  receivedDateTime?: string;
  from?: {
    emailAddress?: GraphEmailAddress;
  };
}

export class ExchangeClient {
  private graphClient?: Client;
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

  private async getClient(): Promise<Client> {
    if (this.graphClient) return this.graphClient;

    this.graphClient = Client.init({
      authProvider: {
        getAccessToken: async () => this.getAccessToken(),
      },
    });

    return this.graphClient;
  }

  private getMailboxPath(): string {
    if (!this.config.mailbox) {
      throw new Error('Exchange mailbox is required for Microsoft Graph application permissions.');
    }
    return `/users/${this.config.mailbox}`;
  }

  async listFolders(): Promise<ExchangeFolder[]> {
    const client = await this.getClient();
    const mailboxPath = this.getMailboxPath();
    const result = (await client
      .api(`${mailboxPath}/mailFolders`)
      .select(['id', 'displayName', 'childFolderCount', 'unreadItemCount', 'totalItemCount'])
      .get()) as { value?: GraphMailFolder[] };

    return (result.value || []).map((folder) => ({
      id: folder.id,
      displayName: folder.displayName,
      childFolderCount: folder.childFolderCount,
      unreadCount: folder.unreadItemCount,
      totalCount: folder.totalItemCount,
    }));
  }

  async listMessages(options: ExchangeListMessagesOptions = {}): Promise<ExchangeMessage[]> {
    const client = await this.getClient();
    const mailboxPath = this.getMailboxPath();
    const maxItems = options.maxItems ?? 20;
    const folderPath = options.folderId
      ? `${mailboxPath}/mailFolders/${options.folderId}/messages`
      : `${mailboxPath}/mailFolders/inbox/messages`;

    let request = client
      .api(folderPath)
      .top(maxItems)
      .select(['id', 'subject', 'isRead', 'receivedDateTime', 'from']);

    if (options.unreadOnly) {
      request = request.filter('isRead eq false');
    }

    const result = (await request.get()) as { value?: GraphMessage[] };

    return (result.value || []).map((message) => ({
      id: message.id,
      subject: message.subject || '',
      from: message.from?.emailAddress?.address || message.from?.emailAddress?.name,
      isRead: message.isRead,
      receivedAt: message.receivedDateTime,
    }));
  }
}
