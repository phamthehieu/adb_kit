/** Figma design data, reduced to what the measuring tool needs. Units: Figma px (≈ dp). */

export interface FNode {
  id: string
  name: string
  type: string
  /** Bounds relative to the screen frame's top-left corner. */
  x: number
  y: number
  w: number
  h: number
  /** Index of the parent in FScreen.nodes (-1 for the screen itself). */
  parent: number
  text?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  /** Auto layout of this frame. */
  layout?: { dir: 'H' | 'V'; gap: number; pad: [number, number, number, number] }
  /** Auto layout sizing of this node inside its parent: FIXED / FILL / HUG. */
  sizeH?: string
  sizeV?: string
  /** First visible solid fill, #rrggbb (text color for TEXT nodes). */
  fill?: string
  radius?: number
}

export interface FScreen {
  id: string
  name: string
  /** Section path inside the page ("Đăng nhập với OTP"). */
  section: string
  w: number
  h: number
  /** nodes[0] is the screen frame. */
  nodes: FNode[]
}

export interface FPage {
  fileKey: string
  fileName: string
  nodeId: string
  pageName: string
  lastModified: string
  fetchedAt: number
  screens: FScreen[]
}

export interface FPageRef {
  id: string
  name: string
}

/** fileKey + node id from a figma.com/design (or /file, branch) link. */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } | null {
  const m = /figma\.com\/(?:design|file|proto)\/([0-9a-zA-Z]{10,})(?:\/branch\/([0-9a-zA-Z]{10,}))?/.exec(url)
  if (!m) return null
  const node = /[?&]node-id=([0-9]+[-:][0-9]+)/.exec(url)
  return { fileKey: m[2] ?? m[1], nodeId: node ? node[1].replace('-', ':') : null }
}
