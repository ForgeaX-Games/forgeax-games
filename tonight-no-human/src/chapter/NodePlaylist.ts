import type { ChapterDef, NodeDef } from '../shared/types';
import {
  CHAPTER_CATALOG,
  CHAPTER_MX,
  CHAPTER_RU,
  demoNodePlaylist,
  getChapter,
} from './chapters/chapter_mx';

export class NodePlaylist {
  readonly nodes: NodeDef[];

  constructor(chapter: ChapterDef, useDemoSlice = true) {
    this.nodes = useDemoSlice ? demoNodePlaylist(chapter) : chapter.nodes.slice();
  }

  static fromChapterId(id: string, useDemoSlice = true): NodePlaylist {
    const ch = getChapter(id);
    if (!ch) throw new Error(`unknown chapter: ${id}`);
    return new NodePlaylist(ch, useDemoSlice);
  }

  at(index: number): NodeDef | null {
    return this.nodes[index] ?? null;
  }

  has(index: number): boolean {
    return index >= 0 && index < this.nodes.length;
  }

  get length(): number {
    return this.nodes.length;
  }
}

export { getChapter, CHAPTER_CATALOG, CHAPTER_MX, CHAPTER_RU, demoNodePlaylist };
