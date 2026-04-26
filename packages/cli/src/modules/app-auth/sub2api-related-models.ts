// Keep this list aligned with sub2api's OpenAI whitelist presets so
// "auto-fill related models" behaves like the native Sub2API account form.
const sub2ApiOpenAiRelatedModels = [
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-0125',
  'gpt-3.5-turbo-1106',
  'gpt-3.5-turbo-16k',
  'gpt-4',
  'gpt-4-turbo',
  'gpt-4-turbo-preview',
  'gpt-4o',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-11-20',
  'gpt-4o-mini',
  'gpt-4o-mini-2024-07-18',
  'gpt-4.5-preview',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o1',
  'o1-preview',
  'o1-mini',
  'o1-pro',
  'o3',
  'o3-mini',
  'o3-pro',
  'o4-mini',
  'gpt-5.2',
  'gpt-5.2-2025-12-11',
  'gpt-5.2-chat-latest',
  'gpt-5.2-pro',
  'gpt-5.2-pro-2025-12-11',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-2026-03-05',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'chatgpt-4o-latest',
  'gpt-4o-audio-preview',
  'gpt-4o-realtime-preview',
  'gpt-image-1',
  'gpt-image-1.5',
  'gpt-image-2',
] as const

export function buildSub2ApiOpenAiRelatedModelMapping(): Record<
  string,
  string
> {
  return Object.fromEntries(
    Array.from(new Set(sub2ApiOpenAiRelatedModels)).map((model) => [
      model,
      model,
    ]),
  )
}
