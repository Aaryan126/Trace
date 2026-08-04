export function isCapturableUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) return false;
    const text = `${url.hostname}${url.pathname}`.toLowerCase();
    return !/(^|\.)(accounts|login|mail|outlook|proton|1password|bitwarden)\.|\/((sign|log)[-_]?in|auth|checkout|payment|bank|health|medical)(\/|$)/.test(text);
  } catch {
    return false;
  }
}
