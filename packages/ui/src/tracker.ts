/**
 * The tracker view.
 *
 * Builds its DOM once and then patches it on every state change. A full
 * re-render would be simpler, but this view runs inside an OBS browser source
 * alongside a game capture — churning hundreds of nodes per click is exactly
 * the kind of thing that shows up as a dropped frame on stream.
 */

import {
  canEnterLevel9,
  dungeonItems,
  safeStorage,
  COAST_ITEM_REQUIRES,
  COAST_SPOT_ID,
  DUNGEON_BLOCKS,
  DUNGEON_BLOCKS_BY_ID,
  DUNGEONS,
  OVERWORLD_LOCATIONS,
  MARKS,
  MARKS_BY_KIND,
  OVERWORLD_COLUMNS,
  OVERWORLD_ROWS,
  POOL_BY_ID,
  REGIONS_BY_ID,
  regionForScreen,
  SHOP_STOCK,
  SHOP_STOCK_BY_ID,
  RUPY_TYPES,
  RUPY_TYPES_BY_ID,
  SHUFFLE_POOL,
  OVERWORLD_POOL,
  ITEMS,
  labelFor,
  maxValue,
  screenId,
  spriteFor,
  type ItemDef,
  type MarkKind,
  type ScreenNote,
  type SpriteResolver,
  type Store,
  type TrackerState,
} from '@z1r/core';
import { createSprite } from './sprite.js';
import { memoise, runPatches, type Patch } from './patch.js';
import { buildSeedPanel } from './seed-panel.js';
import { buildLocations } from './locations.js';
import { buildHintTracker } from './hints.js';
import { buildTriforce } from './triforce.js';

export type TrackerSection =
  | 'seed'
  | 'items'
  | 'dungeons'
  | 'locations'
  | 'hintlog'
  | 'map';

export interface MountOptions {
  readonly store: Store;
  readonly resolver: SpriteResolver;
  /** `overlay` drops padding and chrome for use as an OBS browser source. */
  readonly mode?: 'full' | 'overlay';
  /** false renders a read-only display — the browser source should not be clickable. */
  readonly interactive?: boolean;
  readonly sections?: readonly TrackerSection[];
  /** Item cell edge length in CSS pixels. */
  readonly itemSize?: number;
  /**
   * Dense layout for narrow contexts — the OBS dock and overlay. Panels that
   * have a compact form use it; the rest are unaffected.
   */
  readonly compact?: boolean;
}

const DEFAULT_SECTIONS: readonly TrackerSection[] = [
  'seed',
  'items',
  'dungeons',
  'locations',
  'hintlog',
  'map',
];

interface ArmedDef {
  mark: MarkKind | '';
  level: number;
  blocks: string[];
  shop: string[];
  rupy: string;
  spot: string;
  item: string;
  warp: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Two letters for a cell label.
 *
 * A cell is under 90px and already carries an icon, so anything longer than
 * this wraps or clips. Two letters is enough to tell "RA" from "BO" when you
 * know which handful of items are still missing.
 */
function shortCode(name: string | undefined): string {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  // Initials for a two-word name — "White Sword" reads better as WS than WH.
  if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function section(title: string, bodyClass: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'z1r-panel');
  root.append(el('h2', 'z1r-panel-title', title));
  const body = el('div', bodyClass);
  root.append(body);
  return { root, body };
}

/** Which panels are folded away. A view preference, not run data. */
const COLLAPSE_KEY = 'z1r-tracker:collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = safeStorage()?.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    // Blocked storage, or a hand-edited value. Everything open is a fine
    // fallback — this only decides what is folded, never what is tracked.
    return new Set();
  }
}

/**
 * Let every panel fold away by its heading.
 *
 * Wired here by walking the panels rather than built into each one, so the six
 * existing panels and any later one get it without being touched.
 *
 * Kept out of the tracker state deliberately. State is broadcast to the overlay
 * and written into exported saves, and neither should care which panels someone
 * folded up on the other monitor — this is a property of the window you are
 * looking at, so it lives in its own storage key.
 */
function wireCollapsing(root: HTMLElement): void {
  const collapsed = readCollapsed();

  const persist = () => {
    try {
      safeStorage()?.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Folding still works for this session; it just will not be remembered.
    }
  };

  for (const panel of root.querySelectorAll<HTMLElement>('.z1r-panel')) {
    const title = panel.querySelector<HTMLElement>('.z1r-panel-title');
    if (!title) continue;

    // The heading's own text, before the counters and buttons appended after
    // it. Stable across renames of the CSS classes, and readable in storage.
    const name = title.childNodes[0]?.nodeValue?.trim();
    if (!name) continue;
    panel.dataset.section = name;

    const toggle = el('button', 'z1r-panel-toggle');
    toggle.type = 'button';
    const setState = (folded: boolean) => {
      panel.dataset.collapsed = String(folded);
      toggle.setAttribute('aria-expanded', String(!folded));
      // Both a glyph and a label, so the state is not carried by rotation alone.
      toggle.textContent = folded ? '▸' : '▾';
      toggle.title = folded ? `Show ${name}` : `Hide ${name}`;
      toggle.setAttribute('aria-label', toggle.title);
    };

    const flip = () => {
      const folded = panel.dataset.collapsed !== 'true';
      if (folded) collapsed.add(name);
      else collapsed.delete(name);
      setState(folded);
      persist();
    };

    toggle.addEventListener('click', flip);
    title.prepend(toggle);

    /*
     * The whole heading is a hit target, not just the caret — a caret alone is
     * a fiddly thing to hit mid-run. Clicks that land on a control inside the
     * heading are left alone, though: several headings carry buttons and
     * counters of their own, and folding the panel out from under one would be
     * a nasty surprise.
     */
    title.addEventListener('click', (event) => {
      const control = (event.target as HTMLElement | null)?.closest('button, select, input, label, a');
      // The caret has its own handler, and anything else in the heading is
      // there to be clicked on its own terms.
      if (control) return;
      flip();
    });

    setState(collapsed.has(name));
  }
}

/*
 * Give the map whole-pixel cells.
 *
 * `1fr` columns share out the remainder, so sixteen of them in a panel that
 * is not a multiple of sixteen produce fractional widths — 54.4px, say. The
 * terrain image is then positioned as a percentage of that and lands on
 * half-pixel boundaries, which the renderer resolves by blending. That is
 * soft however the image is sampled, and it is why the map still looked
 * blurry after switching to nearest-neighbour.
 *
 * Rounding the cell down to a whole number and centring the grid costs at
 * most fifteen pixels of width and puts every screen on an exact boundary.
 */
const minMapWidth = 1080;
const maxMapWidth = 6000;
function applyMapScale(map: HTMLElement, delta: number = 0, clientX: number = -1, clientY: number = -1) {
  if (!map) return;
  const gap = Number.parseFloat(getComputedStyle(map).columnGap) || 0;
  // `clientWidth` excludes the border and includes padding, which is the box
  // the columns are actually laid out in.
  // map.clientWidth
  let mapWidth = parseFloat(map.dataset.mapwidth);
  const originalScale = mapWidth / minMapWidth;
  mapWidth += delta;
  if (mapWidth < minMapWidth) mapWidth = minMapWidth;
  if (mapWidth > maxMapWidth) mapWidth = maxMapWidth;
  map.dataset.mapwidth = mapWidth;
  document.querySelector('.z1r-map-zoom').value = mapWidth;
  const scale = mapWidth / minMapWidth;

  const cell = Math.floor((mapWidth - gap * (OVERWORLD_COLUMNS - 1)) / OVERWORLD_COLUMNS);
  if (cell < 8) return;
  // Height rounded independently rather than left to `aspect-ratio`, which
  // would reintroduce a fraction on the other axis.
  const height = Math.max(6, Math.round((cell * 11) / 16));

  // Compare before writing, or this re-enters the observer that calls it.
  if (map.style.getPropertyValue('--map-cell') !== `${cell}px`) {
    map.style.setProperty('--map-cell', `${cell}px`);
    map.style.setProperty('--map-cell-height', `${height}px`);
    map.style.setProperty('--scale-factor', `${scale}`);
  }

  if (clientX >= 0 && clientY >= 0) {
    const wrap = map.parentElement;
    const rect = wrap.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const contentX = (mouseX + wrap.scrollLeft) / originalScale;
    const contentY = (mouseY + wrap.scrollTop) / originalScale;
    wrap.scrollLeft = contentX * scale - mouseX;
    wrap.scrollTop = contentY * scale - mouseY;
  }
}

export function mountTracker(root: HTMLElement, options: MountOptions): () => void {
  const {
    store,
    resolver,
    mode = 'full',
    interactive = true,
    sections = DEFAULT_SECTIONS,
    itemSize = 40,
    compact = false,
  } = options;

  // Spectrum scopes its tokens to these classes, so the mount root carries them
  // rather than requiring each app's HTML to opt in. `medium` is the desktop
  // scale; `large` is for touch and would inflate every control.
  root.classList.add('z1r-tracker', 'spectrum', 'spectrum--dark', 'spectrum--medium');
  root.dataset.mode = mode;
  root.dataset.compact = String(compact);
  root.dataset.interactive = String(interactive);
  root.replaceChildren();

  const patches: Patch[] = [];
  const builders: Record<TrackerSection, () => HTMLElement> = {
    seed: () => buildSeedPanel(store, patches, interactive),
    items: () => buildItems(store, resolver, patches, { interactive, itemSize }),
    dungeons: () => buildTriforce(store, resolver, patches, interactive),
    locations: () => buildLocations(store, resolver, patches, interactive, compact),
    hintlog: () => buildHintTracker(store, patches, interactive),
    map: () => buildMap(store, resolver, patches, interactive),
  };

  // Items and the Triforce share a row when both are shown — the triangle is
  // narrow and was leaving most of its own panel empty.
  const built = new Map<TrackerSection, HTMLElement>();
  for (const name of sections) {
    // An unknown `?sections=` value must not take the whole overlay down.
    const build = builders[name];
    if (build) built.set(name, build());
  }
  const items = built.get('items');
  const triforce = built.get('dungeons');
  if (items && triforce) items.classList.add('z1r-items-panel');
  for (const [name, node] of built) {
    if (name === 'dungeons' && items && triforce) continue;
    if (name === 'items' && items && triforce) {
      const pair = el('div', 'z1r-pair');
      pair.append(items, triforce);
      root.append(pair);
      continue;
    }
    root.append(node);
  }

  // Isolated per panel: the store has already committed this state, so a throw
  // here would otherwise leave every later panel showing the previous one.
  const apply = (state: TrackerState) => runPatches(patches, state);

  /*
   * Publish the tracker's own width as a band.
   *
   * Layout rules key off this rather than a media query, because the OBS
   * overlay lays out at a fixed composition width inside a Browser Source of
   * some other size — so the viewport describes the wrong box entirely.
   */
  const applyWidthBand = () => {
    const width = root.offsetWidth;
    root.dataset.width = width < 640 ? 'xs' : width < 720 ? 'sm' : 'md';
  };

  /*
   * Balance each item grid so the last row is never a stray remainder.
   *
   * `repeat(auto-fill, ...)` packs as many columns as fit and lets the
   * remainder fall where it may — ten B-slot items in eight columns render as
   * eight and then a lonely two. Choosing the column count from the row count
   * instead gives five and five, which is also how the game's own inventory
   * reads: one row of always-active items, then the equipable ones below.
   *
   * The cell size stays keyed to the *maximum* columns that fit, not the
   * balanced count, so every group draws at one size. Sprites snap to integer
   * scale factors, so a group with wider cells would land on a different
   * multiple and visibly disagree with its neighbour.
   */
  const balanceItemGrids = () => {
    for (const grid of root.querySelectorAll<HTMLElement>('.z1r-item-grid')) {
      /*
       * Overlay only. The web and desktop panels have room to let cells stretch
       * to fill, which is what `auto-fill` with a `1fr` track already does well;
       * balancing there would shrink every cell to its minimum and centre the
       * block, which is a change to those apps that nobody asked for.
       */
      if (mode !== 'overlay') {
        if (grid.style.gridTemplateColumns) grid.style.removeProperty('grid-template-columns');
        continue;
      }

      const count = grid.childElementCount;
      if (count === 0) continue;

      const styles = getComputedStyle(grid);
      const gap = Number.parseFloat(styles.columnGap) || 0;
      const inner =
        grid.clientWidth -
        (Number.parseFloat(styles.paddingLeft) || 0) -
        (Number.parseFloat(styles.paddingRight) || 0);
      // Mid-teardown, or display:none — leave the stylesheet's rule in place
      // rather than committing a column count derived from a zero width.
      if (inner <= 0) continue;

      const minCell = Number.parseFloat(styles.getPropertyValue('--z1r-item-min')) || 44;
      const maxColumns = Math.max(1, Math.floor((inner + gap) / (minCell + gap)));
      const rows = Math.ceil(count / maxColumns);
      const columns = Math.ceil(count / rows);
      const cell = Math.max(minCell, Math.floor((inner + gap) / maxColumns - gap));

      const next = `repeat(${columns}, ${cell}px)`;
      // Writing unconditionally would re-enter this observer on every pass.
      if (grid.style.gridTemplateColumns !== next) grid.style.gridTemplateColumns = next;
    }
  };

  const applyLayout = () => {
    applyWidthBand();
    balanceItemGrids();
    applyMapScale(root.querySelector<HTMLElement>('.z1r-map'));
  };
  /*
   * Folding is for the dock and the page, never the overlay: a browser source
   * takes no clicks, so a caret there would be furniture that cannot be used.
   */
  if (interactive) wireCollapsing(root);

  applyLayout();
  const widthObserver = new ResizeObserver(applyLayout);
  widthObserver.observe(root);

  apply(store.getState());
  const unsubscribe = store.subscribe(apply);

  return () => {
    unsubscribe();
    widthObserver.disconnect();
    root.replaceChildren();
    root.classList.remove('z1r-tracker');
  };
}

/* -------------------------------------------------------------------- items */

function buildItems(
  store: Store,
  resolver: SpriteResolver,
  patches: Patch[],
  opts: { interactive: boolean; itemSize: number },
): HTMLElement {
  const { root, body } = section('Items', 'z1r-item-groups');
  const cellPatches: Patch[] = [];

  // Two groups, in the game's own order: always-active items on top, then the
  // boxed B-slot items, mirroring the inventory screen.
  for (const [group, caption] of [
    ['passive', 'Always active'],
    ['bslot', 'B slot'],
  ] as const) {
    const wrap = el('div', 'z1r-item-group');
    wrap.dataset.group = group;
    wrap.append(el('span', 'z1r-item-group-label', caption));
    const grid = el('div', 'z1r-item-grid');
    for (const def of ITEMS.filter((item) => item.group === group)) {
      grid.append(buildItemCell(store, resolver, def, cellPatches, opts));
    }
    wrap.append(grid);
    body.append(wrap);
  }

  // Per cell, not per panel: these eighteen shared one registered patch, so a
  // throw in one dropped every cell after it.
  patches.push((state) => runPatches(cellPatches, state));

  return root;
}

function buildItemCell(
  store: Store,
  resolver: SpriteResolver,
  def: ItemDef,
  patches: Patch[],
  opts: { interactive: boolean; itemSize: number },
): HTMLElement {
  const cell = el('button', 'z1r-item');
  cell.type = 'button';
  cell.dataset.itemId = def.id;
  cell.dataset.group = def.group;
  if (!opts.interactive) cell.disabled = true;

  // The sprite is swapped wholesale on stage change, so keep a slot to swap in.
  const slot = el('span', 'z1r-item-sprite');
  const badge = el('span', 'z1r-item-badge');
  cell.append(slot, badge);

  if (opts.interactive) {
    const step = (direction: 1 | -1) =>
      store.dispatch({ type: 'cycleItem', id: def.id, direction });
    cell.addEventListener('click', (event) => step(event.shiftKey ? -1 : 1));
    cell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      step(-1);
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        step(-1);
      }
    });
  }

  let renderedSprite: string | null = null;

  patches.push((state) => {
    const value = state.items[def.id] ?? 0;
    const key = spriteFor(def, value);
    renderedSprite = memoise(renderedSprite, key, () => {
      slot.replaceChildren(createSprite(resolver, key, { size: opts.itemSize }));
    });
    cell.dataset.owned = String(value > 0);
    cell.title = def.note ? `${labelFor(def, value)} — ${def.note}` : labelFor(def, value);
    cell.setAttribute('aria-pressed', String(value > 0));
    cell.setAttribute('aria-label', `${labelFor(def, value)} — ${value > 0 ? 'held' : 'not held'}`);

    if (def.kind === 'progressive' && value > 0 && maxValue(def) > 1) {
      badge.textContent = String(value);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  });

  return cell;
}

/* ---------------------------------------------------------------- overworld */

function buildMap(
  store: Store,
  resolver: SpriteResolver,
  patches: Patch[],
  interactive: boolean,
): HTMLElement {
  const { root, body } = section('Overworld', 'z1r-map');
  body.dataset.mapwidth = minMapWidth;

  /*
   * A marker can also be *armed*, which turns the toolbar into a palette.
   *
   * Two ways of working, because a run needs both. Sweeping a region and
   * writing off a dozen dead ends wants a palette: arm the marker once, then
   * click tiles. Coming back to one screen to say which level it was and what
   * turned you back wants the opposite — pick the screen, then edit it.
   *
   * Arming does not take the editor away. A stamped tile is also selected, so
   * the detail rows are already pointing at the tile you just marked and the
   * level and blockers are right there. That is what makes the two modes one
   * flow rather than a switch: stamp, refine, stamp the next.
   */
  const armed: ArmedDef = {
    mark: '',
    level: 0,
    blocks: [],
    shop: [],
    rupy: '',
    spot: '',
    item: '',
    warp: 0,
  };

  // The palette is positioned against this panel.
  root.classList.add('z1r-map-panel');
  body.style.setProperty('--map-columns', String(OVERWORLD_COLUMNS));
  const heading = root.querySelector('.z1r-panel-title');

  // Hint regions are baked into the grid rather than left in a reference
  // image: a hint names a region, so the map should be able to answer "which
  // screens is that?" directly.
  const regionToggle = el('button', 'z1r-chip-button z1r-regions-toggle', 'Regions');
  regionToggle.type = 'button';
  regionToggle.dataset.open = 'false';
  regionToggle.title = 'Label every screen with its hint region code';
  regionToggle.addEventListener('click', () => {
    const on = regionToggle.dataset.open !== 'true';
    regionToggle.dataset.open = String(on);
    body.dataset.regions = String(on);
  });
  body.dataset.regions = 'false';
  heading?.append(regionToggle);

  const hideToggle = el('button', 'z1r-chip-button z1r-hide-toggle', 'Hide');
  hideToggle.type = 'button';
  hideToggle.dataset.open = 'false';
  hideToggle.title = 'Hide screen marks on map';
  hideToggle.addEventListener('click', () => {
    const on = hideToggle.dataset.open !== 'true';
    hideToggle.dataset.open = String(on);
    body.dataset.hidemarks = String(on);
  });
  body.dataset.hidemarks = 'false';
  heading?.append(hideToggle);

  /*
   * Clear every mark in one go.
   *
   * A finished run leaves most of 128 screens marked and none of it carries
   * into the next seed. Unmarking them by hand is a chore nobody does, so the
   * map ends up starting a seed with the last one still on it.
   *
   * Confirmed, because it is a lot of work to lose to a misclick, and scoped to
   * the map alone — items and the Triforce have their own controls, and wiping
   * those here would make this a second Reset wearing a friendlier label.
   */
  if (interactive) {
    const doneButton = el('button', 'z1r-chip-button z1r-done-button', 'Done');
    doneButton.type = 'button';
    doneButton.title = 'Cancel current map operation and screen selection';
    doneButton.addEventListener('click', () => {
      setArmed('');
      selectScreen('');
    });
    heading?.append(doneButton);

    const clear = el('button', 'z1r-chip-button z1r-map-clear', 'Clear');
    clear.type = 'button';
    clear.title = 'Remove every mark from the map. Items and Triforce are untouched.';
    clear.addEventListener('click', () => {
      const state = store.getState();
      const marked = Object.keys(state.marks).length;
      if (marked === 0) return;
      const ok = globalThis.confirm?.(
        `Clear all ${marked} marked screens? Items and Triforce are not affected.`,
      );
      if (ok !== false) store.dispatch({ type: 'clearMap' });
    });
    heading?.append(clear);
  }

  /*
   * Each cell shows its own screen from the real overworld map.
   *
   * The map is 1280x468 with a legend strip below y=440, so the map proper is
   * exactly 16x8 screens of 80x55 — which is the NES screen aspect (1.4545)
   * and the grid's existing 16/11 cell ratio. One image is positioned inside
   * every cell rather than sliced into 128 files.
   */
  const MAP_COLUMNS_PERCENT = 16 * 100;
  const MAP_ROWS_PERCENT = (468 / 440) * 8 * 100;
  const mapKey = () =>
    store.getState().seed.mirroredOverworld ? 'ref.overworld.mirrored' : 'ref.overworld';

  /*
   * Marker toolbar, fixed above the map.
   *
   * This was a popover anchored to whichever cell you clicked. In play that was
   * the wrong shape entirely: it covered a big piece of the map, it could not be
   * dismissed without picking something, and choosing a screen in the lower half
   * scrolled the page to fit the popover on screen — mid-run, one-handed.
   *
   * It works like a brush now. Pick what you are placing here, then click
   * screens to place it, as many as you like. Marking a row of dead ends takes
   * one selection and a few clicks rather than a popover each.
   */
  const toolbar = el('div', 'z1r-map-tools');
  // Into the panel, ahead of the grid — *not* into `body`, which is the grid
  // itself. Appending it there made it a grid item one column wide, so every
  // button stacked vertically and the first row of screens filled in beside it.
  root.insertBefore(toolbar, body);

  /*
   * Select a screen, then edit it.
   *
   * This was a brush — you set what you were placing, then clicked screens to
   * place it. That reads well for painting a run of dead ends and badly for
   * everything else, because it asks you to choose a dungeon's number before
   * you have said which screen the dungeon is on. Editing a screen you had
   * already marked meant re-setting every property and stamping over it.
   *
   * So: click a screen to select it, then work left to right along the toolbar
   * — Dungeon, then which level, then what blocked you. Each control writes to
   * the selected screen the moment you touch it, and the toolbar shows what
   * that screen already holds rather than what you are about to stamp.
   *
   * The toolbar stays fixed above the map, which is the half of the old popover
   * that was worth keeping: it never covers the map and never scrolls the page.
   */
  let selected = '';
  let selectedCell = null;

  const highlightSelection = () => {
    for (const cell of body.querySelectorAll<HTMLElement>('.z1r-screen')) {
      cell.dataset.selected = String(cell.dataset.screen === selected);
    }
  };

  const selectScreen = (screen: string, force: boolean = false) => {
    // Clicking the selected screen again lets go of it, so there is a way out
    // that is not "find somewhere harmless to click".
    if (force) {
      selected = screen;
    } else {
      selected = selected === screen ? '' : screen;
    }
    selectedCell = selected ? body.querySelector<HTMLElement>(`.z1r-screen[data-screen="${selected}"]`) : null;
    highlightSelection();
    syncToolbar(store.getState());
  };

  /** A tile click: stamp the armed marker if there is one, and edit the tile. */
  const touchScreen = (screen: string) => {
    if (!armed.mark) {
      selectScreen(screen);
      return;
    }
    // A dungeon needs its number first. You learn which level it is by walking
    // into it, so by the time you are marking one you know — and an unnumbered
    // dungeon marker is a note to yourself that says nothing useful.
    if (armed.mark === 'dungeon' && !armed.level) return;
    if (armed.mark === 'warp' && !armed.warp) return;

    switch (armed.mark) {
      case 'dungeon':
        store.dispatch({ type: 'placeDungeon', screen, level: armed.level, blocks: [...armed.blocks] });
        break;
      case 'rupy':
        store.dispatch({ type: 'placeRupy', screen, rupy: armed.rupy });
        break;
      case 'warp':
        store.dispatch({ type: 'placeWarp', screen, warp: armed.warp });
        break;
      case 'start':
        store.dispatch({ type: 'placeStart', screen });
        break;
      case 'shop':
        store.dispatch({ type: 'placeShop', screen, shop: [...armed.shop] });
        break;
      case 'item':
        store.dispatch({ type: 'placeItem', screen, item: armed.item, spot: armed.spot });
        break;
      default:
        store.dispatch({ type: 'setMark', screen, mark: armed.mark });
    }

    // Selected, not toggled — clicking an already-selected tile while armed
    // should re-stamp it, not drop the selection out from under the detail rows.
    selectScreen(screen, true);
  };

  const setArmed = (kind: MarkKind | '') => {
    const state = store.getState();
    const mark = selected ? (state.marks[selected] ?? 'none') : 'none';
    const note = selected ? state.screenNotes[selected] : undefined;

    armed.mark = kind;
    if (kind === 'dungeon' && note) {
      armed.level = note.dungeon;
      armed.blocks = note.blocks;
    } else {
      armed.level = 0;
      armed.blocks = [];
    }
    armed.shop = kind === 'shop' && mark === 'shop' && note ? note.shop : [];
    armed.rupy = kind === 'rupy' && mark === 'rupy' && note ? note.rupy : '';
    armed.spot = kind === 'spot' && mark === 'spot' && note ? note.spot : '';
    armed.item = kind === 'item' && mark === 'item' && note ? note.item : '';
    armed.warp = kind === 'warp' && mark === 'warp' && note ? note.warp : 0;
    body.dataset.armed = String(!!armed.mark);
    if (armed.mark) selectScreen('');
    syncToolbar(state);
  };

  const patchSelected = (patch: Partial<ScreenNote>) => {
    if (!selected) return;
    store.dispatch({ type: 'setScreenNote', screen: selected, patch });
  };

  const kindRow = el('div', 'z1r-tool-row z1r-tool-kinds');
  toolbar.append(kindRow);
  const kindButtons: HTMLButtonElement[] = [];

  /** Detail rows appear only for the mark the selected screen carries. */
  const detailRows: { row: HTMLElement; forKind: MarkKind }[] = [];
  const detailRow = (forKind: MarkKind, label: string) => {
    const row = el('div', 'z1r-tool-row z1r-tool-detail');
    // Labelled for screen readers rather than on screen. Only one detail row is
    // ever visible, and which one is already answered by the mark.
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    toolbar.append(row);
    detailRows.push({ row, forKind });
    return row;
  };

  const syncToolbar = (state: TrackerState) => {
    const mark = selected ? (state.marks[selected] ?? 'none') : 'none';
    const note = selected ? state.screenNotes[selected] : undefined;

    toolbar.dataset.active = String(!!selected || !!armed.mark);
    const armedName = armed.mark ? MARKS_BY_KIND.get(armed.mark)?.name : '';
    const needsNumber = 
      (armed.mark === 'dungeon' && !armed.level)
      || (armed.mark === 'warp' && !armed.warp);
    // Says what the next click does, in the order the toolbar reads: pick the
    // marker, pick the level, then place it.
    let armedNumberType = null;
    let armedNumber = 0;
    if (armed.mark === 'dungeon') {
      armedNumberType = 'Level';
      armedNumber = armed.level;
    } else if (armed.mark === 'warp') {
      armedNumberType = 'Warp';
      armedNumber = armed.warp;
    }
    target.textContent = needsNumber
      ? `Pick a ${armedNumberType}`
      : armed.mark
        ? `Placing ${armedNumberType ? `${armedNumberType} ${armedNumber}` : armedName}`
        : selectedCell?.title || 'Pick a screen';
    toolbar.dataset.waiting = String(needsNumber);

    for (const button of kindButtons) {
      const kind = button.dataset.mark as MarkKind;
      const isStart = state.start && state.start === selected;
      /*
       * Two states, kept apart on purpose. `active` is "the selected tile is
       * already this", `armed` is "the next tile you click becomes this".
       * Conflating them would make the toolbar unable to say whether a click
       * is about to change anything.
       */
      const active = !!selected && (kind === mark || (kind === 'start' && isStart));
      button.dataset.active = String(active);
      button.dataset.armed = String(armed.mark === kind);
      button.setAttribute('aria-pressed', String(armed.mark === kind || active));
      // Never disabled now: with nothing selected the buttons still arm, which
      // is how a palette is supposed to work.
      button.disabled = false;
    }
    // Shown for whichever the toolbar is describing: the marker being armed, or
    // the tile being edited.
    const showing = armed.mark;
    for (const { row, forKind } of detailRows) row.hidden = forKind !== showing;
    for (const control of [spotSelect, itemSelect]) control.disabled = armed.mark !== 'item' ;

    for (const button of levelButtons) {
      // While arming, the buttons show what is about to be placed; otherwise
      // they show what the selected tile already is.
      const shown = armed.mark === 'dungeon' ? armed.level : (note?.dungeon ?? 0);
      button.dataset.active = String(Number(button.dataset.level) === shown);
    }
    for (const button of stockButtons) {
      const shown = armed.mark === 'shop' ? armed.shop : (note?.shop ?? []);
      button.dataset.active = String(!!shown.includes(button.dataset.stock ?? ''));
    }
    for (const button of rupyButtons) {
      const shown = armed.mark === 'rupy' ? armed.rupy : (note?.rupy ?? '');
      button.dataset.active = String(shown == button.dataset.rupy ?? '');
    }
    for (const button of warpButtons) {
      const shown = armed.mark === 'warp' ? armed.warp : (note?.warp ?? 0);
      button.dataset.active = String(Number(button.dataset.warp) === shown);
    }
    for (const button of blockButtons) {
      const shown = armed.mark === 'dungeon' ? armed.blocks : (note?.blocks ?? []);
      button.dataset.active = String(!!shown.includes(button.dataset.block ?? ''));
    }
    if (document.activeElement !== spotSelect) spotSelect.value = note?.spot ?? '';
    if (document.activeElement !== itemSelect) itemSelect.value = note?.item ?? '';
  };

  for (const mark of MARKS) {
    const button = el('button', 'z1r-tool-mark');
    button.type = 'button';
    button.dataset.mark = mark.kind;
    button.style.setProperty('--mark-color', mark.color);
    if (mark.sprite) {
      button.append(createSprite(resolver, mark.sprite, { size: 18, label: mark.name }));
    } else {
      button.append(el('span', 'z1r-tool-mark-clear', '◯'));
    }
    /*
     * Icon only. The name rides on `title` and `aria-label` instead — the row
     * is seven buttons that never change, so it is learned in one glance and
     * then only costs space. Selection is still shown by fill *and* by an
     * outline, so it is not carried by colour.
     */
    button.title =
      mark.kind === 'none'
        ? 'Clear screens. Click again to stop.'
        : `Place ${mark.name}. Click again to stop.`;
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => {
      /*
       * Arming only. This used to also stamp the selected tile, which made the
       * button do two different things depending on invisible state and was
       * impossible to explain. One job: choose what you are about to place.
       */
      setArmed(armed.mark === mark.kind ? '' : mark.kind);
    });
    kindButtons.push(button);
    kindRow.append(button);
  }

    /** Names the screen being edited, so the toolbar is never ambiguous. */
  const target = el('span', 'z1r-tool-target');
  target.setAttribute('aria-live', 'polite');
  kindRow.append(target);

  /*
   * Which level this is. 1-9 only.
   *
   * There used to be a `?` for "found but not identified". There is no such
   * state in practice: the level number is painted on the wall of the entrance,
   * so anyone marking a dungeon already knows which one it is.
   */
  const levelRow = detailRow('dungeon', 'Level');
  const levelButtons: HTMLButtonElement[] = [];
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const button = el('button', 'z1r-mark-level', String(level));
    button.type = 'button';
    button.dataset.level = String(level);
    button.title = `Level ${level}`;
    button.addEventListener('click', () => {
      if (armed.mark === 'dungeon') {
        // Arming half of the flow: marker, then number, then click the map.
        armed.level = armed.level === level ? 0 : level;
        syncToolbar(store.getState());
        return;
      }
      // Editing a tile already on the map. Goes through `placeDungeon` too, so
      // renumbering one still moves the level off wherever it used to be.
      if (selected) store.dispatch({ type: 'placeDungeon', screen: selected, level, blocks: [...armed.blocks] });
    });
    levelButtons.push(button);
    levelRow.append(button);
  }

  /*
   * What turned you back last time.
   *
   * The question this answers is "can I finish that one yet?", asked from the
   * overworld with a new item in hand — and without it the only way to find out
   * is to walk back in. Same row as the level, because you learn both on the
   * same trip.
   */
  const blockRow = detailRow('dungeon', 'Blocked by');
  const blockButtons: HTMLButtonElement[] = [];
  for (const block of DUNGEON_BLOCKS) {
    const button = el('button', 'z1r-mark-stock-option');
    button.type = 'button';
    button.dataset.block = block.id;
    button.title = block.name;
    button.setAttribute('aria-label', block.name);
    button.append(createSprite(resolver, block.sprite, { size: 18, label: block.name }));
    button.addEventListener('click', () => {
      if (armed.mark === 'dungeon') {
        const armedIndex = armed.blocks.indexOf(block.id);
        if (armedIndex === -1) {
          armed.blocks.push(block.id);
        } else {
          armed.blocks.splice(armedIndex, 1);
        }
        syncToolbar(store.getState());
        return;
      }
      if (selected) store.dispatch({ type: 'toggleDungeonBlock', screen: selected, block: block.id });
    });
    blockButtons.push(button);
    blockRow.append(button);
  }

  /* What the shop sells. Multi-select, since most sell more than one thing. */
  const stockRow = detailRow('shop', 'Sells');
  const stockButtons: HTMLButtonElement[] = [];
  for (const stock of SHOP_STOCK) {
    const button = el('button', 'z1r-mark-stock-option');
    button.type = 'button';
    button.dataset.stock = stock.id;
    button.title = stock.name;
    button.setAttribute('aria-label', stock.name);
    button.append(createSprite(resolver, stock.sprite, { size: 18, label: stock.name }));
    button.addEventListener('click', () => {
      if (armed.mark === 'shop') {
        const armedIndex = armed.shop.indexOf(stock.id);
        if (armedIndex === -1) {
          armed.shop.push(stock.id);
        } else {
          armed.shop.slice(armedIndex, 1);
        }
        syncToolbar(store.getState());
        return;
      }
      if (selected) store.dispatch({ type: 'toggleShopStock', screen: selected, stock: stock.id });
    });
    stockButtons.push(button);
    stockRow.append(button);
  }

  /*
   * Item screens: which spot it is, and what is sitting in it.
   *
   * Two questions, because they are answered at different times. You find the
   * White Sword cave long before you can afford the hearts to open it, and the
   * Coast is visible from the first lap and unreachable until the Ladder.
   */
  const itemRow = detailRow('item', 'Item spot');
  const spotSelect = document.createElement('select');
  spotSelect.className = 'z1r-input z1r-tool-select';
  spotSelect.title = 'Which named overworld spot this screen is';
  const anySpot = document.createElement('option');
  anySpot.value = '';
  anySpot.textContent = 'Unnamed spot';
  spotSelect.append(anySpot);
  for (const location of OVERWORLD_LOCATIONS) {
    const option = document.createElement('option');
    option.value = location.id;
    option.textContent = location.label;
    spotSelect.append(option);
  }
  spotSelect.addEventListener('change', () => {
    if (armed.mark === 'item') {
      armed.spot = spotSelect.value;
      syncToolbar(store.getState());
      return;
    }
    patchSelected({ spot: spotSelect.value });
  });

  const itemSelect = document.createElement('select');
  itemSelect.className = 'z1r-input z1r-tool-select';
  itemSelect.title = 'Which item is in it';
  const unknownItem = document.createElement('option');
  unknownItem.value = '';
  unknownItem.textContent = 'Item unknown';
  itemSelect.append(unknownItem);
  itemSelect.append(document.createElement('hr'));
  for (const entry of OVERWORLD_POOL) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    itemSelect.append(option);
  }
  itemSelect.append(document.createElement('hr'));
  for (const entry of SHUFFLE_POOL) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    itemSelect.append(option);
  }
  itemSelect.addEventListener('change', () => {
    if (armed.mark === 'item') {
      armed.item = itemSelect.value;
      syncToolbar(store.getState());
      return;
    }
    patchSelected({ item: itemSelect.value });
  });
  itemRow.append(spotSelect, itemSelect);

  /* Type of rupy screen. Single Select */
  const rupyRow = detailRow('rupy', 'Rupy type');
  const rupyButtons: HTMLButtonElement[] = [];
  for (const type of RUPY_TYPES) {
    const button = el('button', 'z1r-mark-rupy-option');
    button.type = 'button';
    button.dataset.rupy = type.id;
    button.title = type.name;
    button.setAttribute('aria-label', type.name);
    button.append(createSprite(resolver, type.sprite, { size: 18, label: type.name }));
    button.addEventListener('click', () => {
      if (armed.mark === 'rupy') {
        armed.rupy = armed.rupy === type.id ? '' : type.id;
        syncToolbar(store.getState());
        return;
      }
      patchSelected({ rupy: type.id });
    });
    rupyButtons.push(button);
    rupyRow.append(button);
  }

  /* Warp hall number. Single select. */
  const warpRow = detailRow('warp', 'Warp number');
  const warpButtons: HTMLButtonElement[] = [];
  for (const warp of [1, 2, 3, 4]) {
    const button = el('button', 'z1r-mark-warp-option');
    button.type = 'button';
    button.dataset.warp = warp;
    button.textContent = warp;
    button.addEventListener('click', () => {
      if (armed.mark === 'warp') {
        armed.warp = armed.warp === warp ? 0 : warp;
        syncToolbar(store.getState());
        return;
      }
      if (selected) store.dispatch({ type: 'placeWarp', screen: selected, warp });
    });
    warpButtons.push(button);
    warpRow.append(button);
  }

  // Escape lets go of the screen without having to find somewhere safe to click.
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // The armed marker first: it is the state that changes what a click does,
    // so it is the one you most urgently want a way out of.
    if (armed.mark) {
      setArmed('');
      return;
    }
    if (!selected) return;
    const cell = body.querySelector<HTMLElement>(`[data-screen="${selected}"]`);
    selectScreen(selected);
    cell?.focus();
  });

  patches.push(syncToolbar);

  const focusNote = el('span', 'z1r-map-focus');
  heading?.append(focusNote);
  patches.push((state) => {
    const def = state.focusRegion ? REGIONS_BY_ID.get(state.focusRegion) : undefined;
    focusNote.textContent = def ? `showing ${def.code} · ${def.name}` : '';
    focusNote.hidden = !def;
  });

  for (let row = 1; row <= OVERWORLD_ROWS; row++) {
    for (let col = 1; col <= OVERWORLD_COLUMNS; col++) {
      const id = screenId(col, row);
      const cell = el('button', 'z1r-screen');
      cell.type = 'button';
      cell.dataset.screen = id;
      cell.title = id;
      if (!interactive) cell.disabled = true;
      else {
        cell.addEventListener('click', () => touchScreen(id));
        // Right-click clears outright — the common correction, and faster than
        // opening the palette to pick "Unmarked".
        cell.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          setArmed('');
          store.dispatch({ type: 'setMark', screen: id, mark: 'none' });
        });
      }

      const terrain = el('span', 'z1r-screen-terrain');
      const terrainImage = el('img');
      terrainImage.alt = '';
      /*
       * Eager, not lazy.
       *
       * All 128 share one URL, so this is a single request however it is
       * scheduled — lazy loading saves nothing and adds a way to fail. It was
       * observed leaving images pending indefinitely even with the cell in
       * view, which presents as a half-drawn map with no error anywhere.
       */
      terrainImage.loading = 'eager';
      terrainImage.decoding = 'async';
      // The wiki hosting this map serves a 200x73 thumbnail rather than the
      // 1280x468 original when a request carries a Referer, which is what made
      // the map blurry in OBS and sharp in a browser that sent none.
      terrainImage.referrerPolicy = 'no-referrer';
      terrainImage.style.width = `${MAP_COLUMNS_PERCENT}%`;
      terrainImage.style.height = `${MAP_ROWS_PERCENT}%`;
      terrainImage.style.insetInlineStart = `${-(col - 1) * 100}%`;
      terrainImage.style.insetBlockStart = `${-(row - 1) * 100}%`;
      terrain.append(terrainImage);

      // The region code is the non-colour channel: two letters, always legible,
      // where a tint alone would be unreadable to a colour-blind viewer.
      const code = el('span', 'z1r-screen-region');
      const slot = el('span', 'z1r-screen-mark');
      // Detail drawn over the mark: the dungeon's number, or the shop's stock
      // as two-letter tags. Both are text, so they survive being shrunk into a
      // dock and read without depending on colour.
      const detail = el('span', 'z1r-screen-detail');
      // What is known to be inside, from the location slots — see `dungeonItems`.
      const badge1 = el('span', 'z1r-screen-badge left');
      const badge2 = el('span', 'z1r-screen-badge right');
      cell.append(terrain, code, slot, badge1, badge2, detail);

      let renderedMap: string | null = null;
      patches.push(() => {
        const key = mapKey();
        renderedMap = memoise(renderedMap, key, () => {
          const resolved = resolver.resolve(key);
          // A missing or unreachable map just leaves the cell blank; the codes
          // and marks carry the tracker's own information regardless.
          terrainImage.src = resolved.kind === 'image' ? resolved.url : '';
        });
      });

      let renderedMark: string | null = null;
      let renderedRegion: string | null = null;
      let renderedDetail: string | null = null;

      patches.push((state) => {
        const mark = state.marks[id] ?? 'none';
        const def = MARKS_BY_KIND.get(mark);
        const note = state.screenNotes[id];

        /*
         * An item screen draws the item, not a generic star.
         *
         * Once you know what is sitting there, the star is telling you nothing
         * you did not already know from the screen being marked at all — and
         * the map is read at a glance, where a sword reads faster than "SW".
         */
        const held = mark === 'item' && note?.item ? POOL_BY_ID.get(note.item) : undefined;
        /*
         * Whatever the location slots say is in this level. Learned from a hint
         * before the dungeon is found, or from walking in without one — either
         * way it shows here, because the two are joined by level number rather
         * than by which was recorded first.
         */
        const inside =
          mark === 'dungeon' && note?.dungeon
            ? dungeonItems(state, note.dungeon).map((id) => POOL_BY_ID.get(id)).filter(Boolean)
            : [];

        const stockItem = (mark === 'shop' && note?.shop.length)
          ? SHOP_STOCK_BY_ID.get(note.shop[0])
          : null;

        const rupyType = (mark === 'rupy' && note?.rupy)
          ? RUPY_TYPES_BY_ID.get(note.rupy)
          : null;

        const warpNumber = (mark === 'warp' && note?.warp)
          ? parseInt(note.warp)
          : 0;

        const isStart = state.start === id;
        cell.dataset.start = String(isStart);

        const markKey = `${mark}|${held?.sprite ?? ''}|${inside.map((e) => e!.sprite).join(',')}|${note?.dungeon ?? 0}|${stockItem?.sprite ?? ''}|${rupyType?.id ?? ''}|${warpNumber}`;
        renderedMark = memoise(renderedMark, markKey, () => {
          cell.dataset.mark = mark;
          cell.style.setProperty('--mark-color', def?.color ?? 'transparent');

          // A dungeon is its number; every other mark is its icon.
          const dungeonNumber = mark === 'dungeon' && note?.dungeon ? String(note.dungeon) : null;
          const sprite = mark === 'dungeon' ? undefined : (held?.sprite ?? def?.sprite);
          if (dungeonNumber) {
            slot.innerHTML = `<span>${dungeonNumber}</span>`;
          } else if (!sprite) {
            slot.replaceChildren();
          } else {
            slot.replaceChildren(
              createSprite(resolver, sprite, { size: 18, label: held?.name ?? def?.name }),
            );
          }

          // Only the first two item icons
          if (inside.length == 0 && !stockItem) {
            badge1.replaceChildren();
            badge2.replaceChildren();
          }
          if (stockItem) {
            badge2.replaceChildren(
              createSprite(resolver, stockItem.sprite, { size: 16, label: stockItem.name })
            );
          }
          if (rupyType) {
            badge2.replaceChildren(
              createSprite(resolver, rupyType.sprite, { size: 16, label: rupyType.name })
            );
          }
          if (warpNumber) {
            badge2.innerHTML = `<span class="z1r-warp-type">${warpNumber}</span>`;;
          }
          if (inside.length >= 1) {
            badge1.replaceChildren(
              createSprite(resolver, inside[0].sprite, { size: 16, label: inside[0].name })
            );
          }
          if (inside.length > 1) {
            badge2.replaceChildren(
              createSprite(resolver, inside[1].sprite, { size: 16, label: inside[1].name })
            );
          }
        });
        const isCoast = note?.spot === COAST_SPOT_ID;
        // The coast ledge is reachable the moment the Ladder is in hand — and
        // that is exactly when you have forgotten it is there.
        const coastReady = isCoast && (state.items[COAST_ITEM_REQUIRES] ?? 0) >= 1;
        // Level 9 is the one dungeon you cannot enter on sight, so its marker
        // is worth calling out the moment the last piece lands.
        const level9Ready = note?.dungeon === 9 && canEnterLevel9(state);

        const detailKey = [
          mark,
          note?.dungeon ?? 0,
          inside.map((entry) => entry!.id).join(','),
          note?.shop.join('') ?? '',
          // Every field the label is built from has to be in this key. Leaving
          // `blocks` out meant a dungeon's tags showed up in the tooltip and
          // never on the cell, because the memo saw no reason to redraw.
          note?.blocks.join('') ?? '',
          note?.rupy ?? '',
          note?.spot ?? '',
          note?.warp ?? 0,
          note?.item ?? '',
          isCoast,
          coastReady,
          level9Ready,
          isStart,
        ].join('|');
        renderedDetail = memoise(renderedDetail, detailKey, () => {
          cell.dataset.coast = String(isCoast);
          cell.dataset.coastReady = String(coastReady);
          cell.dataset.ready = String(level9Ready);

          if (mark === 'dungeon') {
            // Just the blockers now — the numeral carries the level, so
            // repeating it here would cost the width the codes need.
            detail.textContent = (note?.blocks ?? [])
              .map((id) => DUNGEON_BLOCKS_BY_ID.get(id)?.code ?? '')
              .filter(Boolean)
              .join(' ');
          } else if (mark === 'shop' && note?.shop.length) {
            detail.textContent = note.shop
              .map((stock) => SHOP_STOCK_BY_ID.get(stock)?.code ?? '')
              .join(' ');
          } else if (mark === 'item') {
            const spot = note?.spot
              ? OVERWORLD_LOCATIONS.find((l) => l.id === note.spot)?.label
              : '';
            detail.textContent = shortCode(spot);
          } else {
            detail.textContent = '';
          }
          detail.hidden = detail.textContent === '';
        });

        const region = regionForScreen(id, state.seed.mirroredOverworld);
        const regionKey = `${region?.id ?? ''}:${state.focusRegion}`;
        renderedRegion = memoise(renderedRegion, regionKey, () => {
          code.textContent = region?.code ?? '';
          cell.dataset.region = region?.id ?? '';
          cell.style.setProperty('--region-color', region?.color ?? 'transparent');
          cell.dataset.focused = String(!!region && region.id === state.focusRegion);
        });

        const parts = [id];
        if (region) parts.push(region.name);
        if (isStart) parts.push('Start');
        if (mark === 'dungeon') {
          parts.push(note?.dungeon ? `Level ${note.dungeon}` : 'Dungeon (unidentified)');
          if (inside.length) parts.push(`holds ${inside.map((entry) => entry!.name).join(', ')}`);
          const blocked = (note?.blocks ?? [])
            .map((blockId) => DUNGEON_BLOCKS_BY_ID.get(blockId)?.name ?? blockId);
          if (blocked.length) parts.push(`blocked by ${blocked.join(', ')}`);
          if (level9Ready) parts.push('every Triforce piece held — Level 9 is open');
        } else if (mark === 'shop') {
          const stock = note?.shop.map((s) => SHOP_STOCK_BY_ID.get(s)?.name ?? s) ?? [];
          parts.push(stock.length ? `Shop: ${stock.join(', ')}` : 'Shop');
        } else if (mark === 'item') {
          const spot = note?.spot
            ? OVERWORLD_LOCATIONS.find((l) => l.id === note.spot)?.label
            : '';
          parts.push(spot || 'Item');
          parts.push(note?.item ? (POOL_BY_ID.get(note.item)?.name ?? '') : 'contents unknown');
          if (isCoast) {
            parts.push(coastReady ? 'Ladder held — reachable now' : 'needs the Ladder');
          }
        } else if (mark === 'rupy') {
          parts.push('Rupy');
          const rupyType = RUPY_TYPES_BY_ID.get(note?.rupy);
          if (rupyType) parts.push(rupyType.name);
        } else if (mark === 'warp') {
          const warpNumber = parseInt(note?.warp ?? 0);
          parts.push(warpNumber > 0 ? `Warp ${warpNumber}` : 'Warp');
        } else if (mark === 'start') {
          parts.push('Start');
        } else if (def && mark !== 'none') {
          parts.push(def.name);
        }
        cell.title = parts.join(' - ');
      });

      body.append(cell);
    }
  }

  const mapWrap = el('div', 'z1r-map-wrap');
  root.append(mapWrap);
  mapWrap.appendChild(body);

  const zoomSlider = el('input', 'z1r-map-zoom');
  zoomSlider.type = 'range';
  zoomSlider.min = minMapWidth;
  zoomSlider.max = maxMapWidth;
  zoomSlider.value = body.dataset.mapwidth;
  zoomSlider.setAttribute('aria-label', 'Map zoom');
  zoomSlider.addEventListener('change', () => {
    body.dataset.mapwidth = zoomSlider.value;
    applyMapScale(body, 0);
  });
  zoomSlider.addEventListener('input', () => {
    body.dataset.mapwidth = zoomSlider.value;
    applyMapScale(body, 0);
  });
  const zoomWrapper = el('div', 'z1r-map-zoom-wrap');
  zoomWrapper.append(zoomSlider);
  document.querySelector('footer').prepend(zoomWrapper);

  let initialDistance = 0;

  const PIXELS_PER_LINE = 16;
  const PIXELS_PER_PAGE = 800;
  const PIXEL_SCALE_FACTOR = 10;

  mapWrap.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        initialDistance = getDistance(e.touches[0], e.touches[1]);
      }
  });

  mapWrap.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const clientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const clientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const scale = (currentDistance - initialDistance) * PIXEL_SCALE_FACTOR;
        initialDistance = currentDistance;
        applyMapScale(body, scale, clientX, clientY);
      }
  });

  function getDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  mapWrap.addEventListener('wheel', (event) => {
    if (event.ctrlKey) {
      event.preventDefault();

      let scale = 0;
      switch (event.deltaMode) {
        case WheelEvent.DOM_DELTA_LINE:
          scale = event.deltaY * PIXELS_PER_LINE;
          break;
        case WheelEvent.DOM_DELTA_PAGE:
          scale = event.deltaY * PIXELS_PER_PAGE;
          break;
        case WheelEvent.DOM_DELTA_PIXEL:
        default:
          scale = event.deltaY;
          break;
      }
      scale = -(scale * PIXEL_SCALE_FACTOR);
      if (scale != 0) {
        applyMapScale(body, scale, event.clientX, event.clientY);
      }
    }
  }, { passive: false });

  store.subscribe((state, action) => {
    if (action?.type == 'reset') {
      setArmed('');
    }
  });

  return root;
}

