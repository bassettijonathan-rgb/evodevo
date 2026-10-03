/** Panel showing JSON to copy or download (genomes, lineages). */
import { signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { offered, tryDownload } from './files';

const copied = signal(false);

export function ExportPanel() {
  const item = offered.value;
  const ref = useRef<HTMLTextAreaElement>(null);
  if (!item) return null;
  const close = () => { offered.value = null; copied.value = false; };
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="export-title" onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div class="panel export">
        <div class="row">
          <h2 id="export-title">{item.name}</h2>
          <span class="muted small">{(item.text.length / 1024).toFixed(1)} kB of JSON</span>
        </div>
        <textarea id="export-text" ref={ref} readOnly value={item.text} spellcheck={false} />
        <div class="row">
          <button class="primary" onClick={async () => {
            try {
              await navigator.clipboard.writeText(item.text);
              copied.value = true;
            } catch {
              ref.current?.select(); // clipboard refused: select it so Ctrl/Cmd+C works
            }
          }}>{copied.value ? 'Copied' : 'Copy'}</button>
          <button onClick={() => tryDownload(item.name, item.text)}>Download file</button>
          <button onClick={close}>Close</button>
          <span class="muted small">To load it again, use “Load genome” in the Lab and pick the file or paste the text.</span>
        </div>
      </div>
    </div>
  );
}
