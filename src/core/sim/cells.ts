/**
 * Cell state as a structure of arrays (DESIGN.md §4.3).
 *
 * Live cells occupy indices [0, n). Removing a cell moves the last cell into its
 * slot, so an INDEX is not a stable identity — use `id` for anything that has to
 * survive a step (lineage, recording, UI selection).
 *
 * Per-gene arrays are row-major: the value of gene i in cell c is at [c*G + i].
 */
export class CellStore {
  readonly capacity: number;
  /** Number of genes (row width of x and input). */
  readonly G: number;
  n = 0;
  private nextId = 0;

  // identity and lineage
  readonly id: Int32Array;
  readonly parentId: Int32Array;
  /** Ancestor at the "founder" stage (for clonal fate maps); set by the developer loop. */
  readonly founderId: Int32Array;
  readonly generation: Int32Array;
  readonly birthTime: Float64Array;

  // geometry
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly radius: Float64Array;
  /** Polarity vector: unit length, or (0,0) when unpolarized. */
  readonly polX: Float64Array;
  readonly polY: Float64Array;

  // effector accumulators (integrate-to-threshold, DESIGN.md D5)
  readonly cycle: Float64Array;
  readonly death: Float64Array;
  readonly diff: Float64Array;
  readonly postmitotic: Uint8Array;

  /** Gene product concentrations x[c*G + i]. */
  readonly x: Float64Array;
  /**
   * Regulatory input y[c*G + j] that gene j presents to the GRN of cell c:
   * x for transcription factors, the sensed field for morphogens, the summed
   * neighbour level for contact ligands. Filled by the sensing step / GRN step.
   */
  readonly input: Float64Array;

  constructor(capacity: number, G: number) {
    this.capacity = capacity;
    this.G = G;
    const i32 = () => new Int32Array(capacity);
    const f64 = () => new Float64Array(capacity);
    this.id = i32();
    this.parentId = i32();
    this.founderId = i32();
    this.generation = i32();
    this.birthTime = f64();
    this.px = f64();
    this.py = f64();
    this.radius = f64();
    this.polX = f64();
    this.polY = f64();
    this.cycle = f64();
    this.death = f64();
    this.diff = f64();
    this.postmitotic = new Uint8Array(capacity);
    this.x = new Float64Array(capacity * G);
    this.input = new Float64Array(capacity * G);
  }

  get full(): boolean {
    return this.n >= this.capacity;
  }

  /** Allocate a fresh unique cell id. */
  newId(): number {
    return this.nextId++;
  }

  /** Append a fresh cell with zeroed state. Returns its index. */
  add(px: number, py: number, radius: number, parentId = -1, birthTime = 0): number {
    if (this.full) throw new Error('CellStore is full');
    const c = this.n++;
    this.id[c] = this.nextId++;
    this.parentId[c] = parentId;
    this.founderId[c] = this.id[c];
    this.generation[c] = 0;
    this.birthTime[c] = birthTime;
    this.px[c] = px;
    this.py[c] = py;
    this.radius[c] = radius;
    this.polX[c] = 0;
    this.polY[c] = 0;
    this.cycle[c] = 0;
    this.death[c] = 0;
    this.diff[c] = 0;
    this.postmitotic[c] = 0;
    this.x.fill(0, c * this.G, (c + 1) * this.G);
    this.input.fill(0, c * this.G, (c + 1) * this.G);
    return c;
  }

  /** Remove cell at index c by moving the last cell into its slot. */
  remove(c: number): void {
    const last = --this.n;
    if (c === last) return;
    this.copyCell(last, c);
  }

  /** Copy every per-cell field from index `from` to index `to`. */
  private copyCell(from: number, to: number): void {
    this.id[to] = this.id[from];
    this.parentId[to] = this.parentId[from];
    this.founderId[to] = this.founderId[from];
    this.generation[to] = this.generation[from];
    this.birthTime[to] = this.birthTime[from];
    this.px[to] = this.px[from];
    this.py[to] = this.py[from];
    this.radius[to] = this.radius[from];
    this.polX[to] = this.polX[from];
    this.polY[to] = this.polY[from];
    this.cycle[to] = this.cycle[from];
    this.death[to] = this.death[from];
    this.diff[to] = this.diff[from];
    this.postmitotic[to] = this.postmitotic[from];
    const G = this.G;
    this.x.copyWithin(to * G, from * G, (from + 1) * G);
    this.input.copyWithin(to * G, from * G, (from + 1) * G);
  }

  /** Index of the live cell with the given id, or −1. O(n). */
  indexOfId(id: number): number {
    for (let c = 0; c < this.n; c++) if (this.id[c] === id) return c;
    return -1;
  }
}
