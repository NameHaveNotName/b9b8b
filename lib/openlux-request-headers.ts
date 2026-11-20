/**
 * Build server-side OpenLux request headers without exposing the application
 * code to browser bundles or logs. The application code augments, but never
 * replaces, the API key.
 */
export function buildOpenLuxRequestHeaders(
  apiKey: string,
  appCode?: string,
  additional: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...additional,
  }
  const normalizedAppCode = appCode?.trim()
  if (normalizedAppCode) headers['APP-Code'] = normalizedAppCode
  return headers
}
