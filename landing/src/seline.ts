/** Official Seline first-party proxy. Script POSTs to `{apiHost}/ennui/blase` and `{apiHost}/ennui/su`. */
export const SELINE = {
  token: '3d5e8c67a801c30',
  scriptSrc: 'https://sln.getdrophunter.com/ennui.js',
  apiHost: 'https://sln.getdrophunter.com',
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
