// navigator.clipboard.writeText is refused inside the Android app's WebView
// ("Write permission denied", even on a real tap; found on the emulator), and
// needs focus and a secure context in browsers. The hidden-textarea copy still
// works in both, so try the modern API first and fall back to it.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall back below */
  }
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus(); // keep keyboard and screen-reader users on the button
  }
}
