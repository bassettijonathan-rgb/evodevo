/**
 * Getting text in and out of the app.
 *
 * Saving offers the text in a panel with Copy and Download buttons, because some
 * hosts (an embedded viewer, for example) block downloads that a page starts.
 * Loading uses a file picker, or text pasted into the same kind of panel.
 */
import { signal } from '@preact/signals';

export interface OfferedText {
  name: string;
  text: string;
}

/** Text currently offered for copying/downloading (shown by <ExportPanel/>). */
export const offered = signal<OfferedText | null>(null);

export function offerText(name: string, text: string): void {
  offered.value = { name, text };
}

/** Try a browser download; returns false if the environment refused it. */
export function tryDownload(name: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.click();
  });
}
