/** First-party Seline paths. Script POSTs to `{apiHost}/ennui/blase` and `{apiHost}/ennui/su`. */
export const SELINE = {
  token: '3d5e8c67a801c30',
  scriptSrc: '/sl/seline.js',
  scriptOrigin: 'https://cdn.seline.com/seline.js',
  apiHost: '/sl/api',
} as const;

export function selineEvent(
  name: string,
  properties: Record<string, string> = {},
): Record<string, string> {
  const attrs: Record<string, string> = { 'data-sln-event': name };
  for (const [key, value] of Object.entries(properties)) {
    if (!value) continue;
    attrs[`data-sln-event-${key}`] = value;
  }
  return attrs;
}
