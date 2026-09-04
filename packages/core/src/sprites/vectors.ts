/**
 * Built-in vector sprites.
 *
 * A middle tier between "lettered glyph" and "remote NES art": shapes simple
 * enough to draw in code. A Triforce piece is three triangles; a bomb is a
 * circle with a fuse. Drawing them costs a few hundred bytes, needs no host,
 * survives being offline, and carries no attribution burden — so the tracker
 * looks finished out of the box.
 *
 * A manifest entry with a `url` or `sheet` always wins, so supplying real art
 * later overrides these without touching this file.
 *
 * Shapes are authored on a 16x16 grid to match NES sprite proportions.
 */

export interface VectorSprite {
  readonly viewBox: string;
  /** SVG child markup. No <svg> wrapper — the renderer supplies it. */
  readonly markup: string;
}

const V = (markup: string): VectorSprite => ({ viewBox: '0 0 16 16', markup });

/** One Triforce wedge — the per-dungeon toggle. */
const TRIANGLE = 'M8 2 L14.5 13.5 L1.5 13.5 Z';

export const VECTORS: Readonly<Record<string, VectorSprite>> = {
  'ui.triforce': V(
    `<path d="${TRIANGLE}" fill="#f4c542" stroke="#7a5a10" stroke-width="1" stroke-linejoin="round"/>`,
  ),

  'item.heart': V(
    `<path d="M8 14 C2.5 10 1 7.6 1 5.6 C1 3.4 2.6 2 4.4 2 C6 2 7.3 3 8 4.3 C8.7 3 10 2 11.6 2
              C13.4 2 15 3.4 15 5.6 C15 7.6 13.5 10 8 14 Z"
        fill="#e0405c" stroke="#7d1524" stroke-width="1" stroke-linejoin="round"/>`,
  ),

  'item.bomb': V(
    `<circle cx="7.5" cy="10" r="5" fill="#2f3550" stroke="#12151f" stroke-width="1"/>
     <path d="M10.6 5.6 L12.6 3.2" stroke="#8a6a3a" stroke-width="1.6" stroke-linecap="round" fill="none"/>
     <circle cx="13.2" cy="2.6" r="1.4" fill="#e8813a"/>`,
  ),

  'item.key.magical': V(
    `<circle cx="5" cy="5" r="3.2" fill="none" stroke="#c9a2e0" stroke-width="1.8"/>
     <path d="M7.2 7.2 L13.5 13.5 M11 13 L13 11 M12.4 14.4 L14.4 12.4"
        stroke="#c9a2e0" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
  ),

  /* --------------------------------------------------------- overworld marks */

  'mark.dungeon': V(
    `<path d="M2.5 14 L2.5 7 A5.5 5.5 0 0 1 13.5 7 L13.5 14 Z"
        fill="#c34a4a" stroke="#5e1d1d" stroke-width="1" stroke-linejoin="round"/>
     <rect x="6.5" y="9" width="3" height="5" fill="#2a1010"/>`,
  ),

  'mark.shop': V(
    `<path d="M2 6 L4 2.5 L12 2.5 L14 6 Z" fill="#3f8fd0" stroke="#1d3a5c" stroke-width="1" stroke-linejoin="round"/>
     <rect x="2.8" y="6" width="10.4" height="7.5" fill="#dfe7ee" stroke="#1d3a5c" stroke-width="1"/>
     <rect x="6.4" y="8.6" width="3.2" height="4.9" fill="#3f8fd0"/>`,
  ),

  'mark.heart': V(
    `<path d="M8 13.6 C3.2 10 2 7.9 2 6.2 C2 4.3 3.4 3.1 4.9 3.1 C6.3 3.1 7.4 4 8 5.1
              C8.6 4 9.7 3.1 11.1 3.1 C12.6 3.1 14 4.3 14 6.2 C14 7.9 12.8 10 8 13.6 Z"
        fill="#e05c7a" stroke="#7d1524" stroke-width="1" stroke-linejoin="round"/>`,
  ),

  'mark.item': V(
    `<path d="M8 1.5 L9.9 6.1 L14.8 6.4 L11 9.5 L12.2 14.3 L8 11.6 L3.8 14.3 L5 9.5 L1.2 6.4 L6.1 6.1 Z"
        fill="#d9a441" stroke="#6d4d10" stroke-width="1" stroke-linejoin="round"/>`,
  ),

  'mark.rupy': V(
    `<path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z"
        fill="#4bb572" stroke="#1d5433" stroke-width="1" stroke-linejoin="round"/>
     <path d="M8 4.4 L10.4 6.2 L10.4 9.8 L8 11.6 L5.6 9.8 L5.6 6.2 Z" fill="#a8e6c1"/>`,
  ),

  'mark.rupy.small': V(
    `<g transform="translate(8,8) scale(0.75) translate(-8,-8)">
       <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="#4bb572" stroke="#1d5433" stroke-width="1" stroke-linejoin="round"/>
       <path d="M8 4.4 L10.4 6.2 L10.4 9.8 L8 11.6 L5.6 9.8 L5.6 6.2 Z" fill="#a8e6c1"/>
     </g>`,
  ),

  'mark.rupy.medium': V(
    `<g transform="translate(5,8) scale(0.55) translate(-8,-8)">
       <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="#4bb572" stroke="#1d5433" stroke-width="1" stroke-linejoin="round"/>
       <path d="M8 4.4 L10.4 6.2 L10.4 9.8 L8 11.6 L5.6 9.8 L5.6 6.2 Z" fill="#a8e6c1"/>
     </g>
     <g transform="translate(11,8) scale(0.55) translate(-8,-8)">
       <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="#4bb572" stroke="#1d5433" stroke-width="1" stroke-linejoin="round"/>
       <path d="M8 4.4 L10.4 6.2 L10.4 9.8 L8 11.6 L5.6 9.8 L5.6 6.2 Z" fill="#a8e6c1"/>
     </g>`,
  ),

  'mark.rupy.large': V(
    `<g transform="translate(8,5.2) scale(0.5) translate(-8,-8)">
       <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="#4bb572" stroke="#1d5433" stroke-width="1" stroke-linejoin="round"/>
       <path d="M8 4.4 L10.4 6.2 L10.4 9.8 L8 11.6 L5.6 9.8 L5.6 6.2 Z" fill="#a8e6c1"/>
     </g>
     <g transform="translate(5.3,10.4) scale(0.5) translate(-8,-8)">
       <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="#4bb572" stroke="#1d5433" stroke-width="1" stroke-linejoin="round"/>
       <path d="M8 4.4 L10.4 6.2 L10.4 9.8 L8 11.6 L5.6 9.8 L5.6 6.2 Z" fill="#a8e6c1"/>
     </g>
     <g transform="translate(10.7,10.4) scale(0.5) translate(-8,-8)">
       <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="#4bb572" stroke="#1d5433" stroke-width="1" stroke-linejoin="round"/>
       <path d="M8 4.4 L10.4 6.2 L10.4 9.8 L8 11.6 L5.6 9.8 L5.6 6.2 Z" fill="#a8e6c1"/>
     </g>`,
  ),

  'mark.rupy.gamble': V(
    `<path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="none" stroke="#000000" stroke-width="1.8" stroke-linejoin="round"/>
     <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="none" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>
     <text x="8" y="9.6" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="#ffffff" stroke="#000000" stroke-width="0.9" paint-order="stroke fill" stroke-linejoin="round">?</text>`,
  ),

  'mark.rupy.door': V(
    `<path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="none" stroke="#000000" stroke-width="1.8" stroke-linejoin="round"/>
     <path d="M8 1.6 L12.6 5.2 L12.6 10.8 L8 14.4 L3.4 10.8 L3.4 5.2 Z" fill="none" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>
     <g stroke="#000000" stroke-width="2.2" stroke-linecap="round">
       <line x1="5.2" y1="5.2" x2="10.8" y2="10.8"/>
       <line x1="10.8" y1="5.2" x2="5.2" y2="10.8"/>
     </g>
     <g stroke="#ff6767" stroke-width="1.4" stroke-linecap="round">
       <line x1="5.2" y1="5.2" x2="10.8" y2="10.8"/>
       <line x1="10.8" y1="5.2" x2="5.2" y2="10.8"/>
     </g>`,
  ),

  'mark.hintroom': V(
    `<path d="M2 3 L14 3 L14 11 L8.6 11 L5.4 14 L5.4 11 L2 11 Z"
        fill="#9b7fd4" stroke="#3f2d63" stroke-width="1" stroke-linejoin="round"/>
     <rect x="4.4" y="5.6" width="7.2" height="1.2" fill="#efe8ff"/>
     <rect x="4.4" y="8" width="4.8" height="1.2" fill="#efe8ff"/>`,
  ),

  'mark.take': V(
    `<path d="M8,14.23 L7.03,13.35 C3.6,10.24 1.33,8.19 1.33,5.67 C1.33,3.61 2.95,2 5,2 C6.16,2 7.27,2.54 8,3.39 C8.73,2.54 9.84,2 11,2 C13.05,2 14.67,3.61 14.67,5.67 C14.67,8.19 12.4,10.24 8.97,13.35 Z" fill="#e5343e" stroke="#a10f18" stroke-width="0.4" stroke-linejoin="round"/>
     <text x="8" y="8.9" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#ffffff">?</text>`,
  ),

  'mark.bombable': V(
    `<circle cx="7.5" cy="10" r="4.6" fill="#8e8e8e" stroke="#3d3d3d" stroke-width="1"/>
     <path d="M10.4 6 L12.4 3.6" stroke="#6b5432" stroke-width="1.5" stroke-linecap="round" fill="none"/>
     <circle cx="13" cy="3" r="1.3" fill="#e8813a"/>`,
  ),

  'mark.burnable': V(
    `<path d="M8 1.5 C10.4 5 12.8 6.6 12.8 9.6 A4.8 4.8 0 0 1 3.2 9.6 C3.2 7.2 4.6 6.4 5.6 4.8
              C6.2 6.4 7 6.8 7.4 6.2 C7.9 5.4 7.4 3.6 8 1.5 Z"
        fill="#e2762f" stroke="#7a3608" stroke-width="1" stroke-linejoin="round"/>`,
  ),

  'mark.pushable': V(
    `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1"
        fill="#7a6a52" stroke="#3b3125" stroke-width="1"/>
     <path d="M2.2 8 L13.8 8 M8 2.2 L8 13.8" stroke="#3b3125" stroke-width=".9" fill="none"/>`,
  ),

  'mark.warp': V(
    `<g transform="translate(1,1) scale(0.875)">
       <rect x="0" y="0" width="16" height="16" fill="#c07000"/>
       <rect x="1" y="0" width="14" height="1" fill="#905400"/>
       <rect x="1" y="1" width="2" height="1" fill="#403628"/>
       <rect x="3" y="1" width="12" height="1" fill="#000000"/>
       <rect x="1" y="2" width="2" height="13" fill="#ffd8a0"/>
       <rect x="3" y="2" width="1" height="1" fill="#301c00"/>
       <rect x="4" y="2" width="11" height="1" fill="#000000"/>
       <rect x="4" y="3" width="11" height="1" fill="#000000"/>
       <rect x="4" y="4" width="3" height="11" fill="#ffd8a0"/>
       <rect x="7" y="4" width="8" height="1" fill="#000000"/>
       <rect x="8" y="5" width="7" height="1" fill="#000000"/>
       <rect x="8" y="6" width="3" height="9" fill="#ffd8a0"/>
       <rect x="11" y="6" width="4" height="1" fill="#000000"/>
       <rect x="12" y="7" width="3" height="1" fill="#000000"/>
       <rect x="12" y="8" width="3" height="7" fill="#ffd8a0"/>
     </g>`,
  ),

  'mark.empty': V(
    `<path d="M4 8 L12 8" stroke="#5a5a5a" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  ),
};
