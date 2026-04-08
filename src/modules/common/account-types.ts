export const ACCOUNT_TYPES = {
  PARENT: 'parent',
  CHILD: 'child',
} as const;

export type AccountType = (typeof ACCOUNT_TYPES)[keyof typeof ACCOUNT_TYPES];

export function normalizeAccountType(type?: string): AccountType {
  if (!type) return ACCOUNT_TYPES.CHILD;
  const value = String(type).toLowerCase();
  if (['parent', 'master', 'mother', '母号'].includes(value)) return ACCOUNT_TYPES.PARENT;
  if (['child', 'sub', 'subaccount', '子号'].includes(value)) return ACCOUNT_TYPES.CHILD;
  throw new Error(`Unsupported account type: ${type}`);
}
