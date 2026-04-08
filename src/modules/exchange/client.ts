import type { ExchangeConfig } from '../../config';
import type { ExchangeFolder, ExchangeListMessagesOptions, ExchangeMessage } from './types';

function xmlEscape(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)</[^:>]*:?${tag}>`, 'i'));
  return match?.[1]?.trim();
}

function extractItems(xml: string, itemTag: string): string[] {
  const regex = new RegExp(`<[^:>]*:?${itemTag}\\b[^>]*>([\\s\\S]*?)</[^:>]*:?${itemTag}>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    blocks.push(match[0]);
  }
  return blocks;
}

export class ExchangeClient {
  constructor(private readonly config: ExchangeConfig) {}

  private async call(action: string, body: string): Promise<string> {
    const auth = Buffer.from(
      `${this.config.auth.username}:${this.config.auth.password}`,
      'utf8',
    ).toString('base64');

    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"
  xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2016" />
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: action,
      },
      body: envelope,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Exchange request failed (${response.status}): ${text}`);
    }

    if (/<(?:\w+:)?ResponseCode>Error/i.test(text)) {
      throw new Error(`Exchange SOAP error: ${text}`);
    }

    return text;
  }

  async listFolders(): Promise<ExchangeFolder[]> {
    const xml = await this.call(
      'FindFolder',
      `<m:FindFolder Traversal="Shallow">
        <m:FolderShape>
          <t:BaseShape>Default</t:BaseShape>
        </m:FolderShape>
        <m:ParentFolderIds>
          <t:DistinguishedFolderId Id="msgfolderroot" />
        </m:ParentFolderIds>
      </m:FindFolder>`,
    );

    return extractItems(xml, 'Folder').map((block) => ({
      id: block.match(/Id="([^"]+)"/i)?.[1] || '',
      changeKey: block.match(/ChangeKey="([^"]+)"/i)?.[1],
      displayName: tagValue(block, 'DisplayName') || '',
      childFolderCount: Number(tagValue(block, 'ChildFolderCount') || 0),
      unreadCount: Number(tagValue(block, 'UnreadCount') || 0),
      totalCount: Number(tagValue(block, 'TotalCount') || 0),
    }));
  }

  async listMessages(options: ExchangeListMessagesOptions = {}): Promise<ExchangeMessage[]> {
    const maxItems = options.maxItems ?? 20;
    const folderTag = options.folderId
      ? `<t:FolderId Id="${xmlEscape(options.folderId)}" />`
      : `<t:DistinguishedFolderId Id="inbox" />`;
    const restriction = options.unreadOnly
      ? `<m:Restriction>
          <t:IsEqualTo>
            <t:FieldURI FieldURI="message:IsRead" />
            <t:FieldURIOrConstant>
              <t:Constant Value="false" />
            </t:FieldURIOrConstant>
          </t:IsEqualTo>
        </m:Restriction>`
      : '';

    const xml = await this.call(
      'FindItem',
      `<m:FindItem Traversal="Shallow">
        <m:ItemShape>
          <t:BaseShape>Default</t:BaseShape>
        </m:ItemShape>
        <m:IndexedPageItemView MaxEntriesReturned="${maxItems}" Offset="0" BasePoint="Beginning" />
        ${restriction}
        <m:ParentFolderIds>${folderTag}</m:ParentFolderIds>
      </m:FindItem>`,
    );

    return extractItems(xml, 'Message').map((block) => ({
      id: block.match(/Id="([^"]+)"/i)?.[1] || '',
      changeKey: block.match(/ChangeKey="([^"]+)"/i)?.[1],
      subject: tagValue(block, 'Subject') || '',
      from: tagValue(block, 'EmailAddress'),
      isRead: (tagValue(block, 'IsRead') || '').toLowerCase() === 'true',
      receivedAt: tagValue(block, 'DateTimeReceived'),
    }));
  }
}
