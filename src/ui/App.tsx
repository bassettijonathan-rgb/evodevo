import { Breed } from './Breed';
import { ExportPanel } from './ExportPanel';
import { Lab } from './Lab';
import { Phylogeny } from './Phylogeny';
import { page, type Page } from './state';

const TABS: [Page, string][] = [['breed', 'Breed'], ['lab', 'Lab'], ['phylogeny', 'Phylogeny']];

export function App() {
  return (
    <>
      <header>
        <h1>EvoDevo</h1>
        <nav role="tablist">
          {TABS.map(([id, label]) => (
            <button role="tab" aria-selected={page.value === id} class={page.value === id ? 'active' : ''} onClick={() => { page.value = id; }}>{label}</button>
          ))}
        </nav>
        <span class="muted small tagline">Bodies are never designed: they grow from one cell, a gene network and diffusing morphogens.</span>
      </header>
      <main>
        {page.value === 'breed' && <Breed />}
        {page.value === 'lab' && <Lab />}
        {page.value === 'phylogeny' && <Phylogeny />}
      </main>
      <ExportPanel />
    </>
  );
}
