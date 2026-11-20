/** Lucide icons, tree-shaken: only the icons imported here are bundled. */
import {
  Box, ChevronRight, Download, FileText, FolderOpen, Loader2, Moon, Plus, RotateCcw, Save, Scissors, Sun, Trash2, Undo2, Upload,
  createElement, type IconNode,
} from 'lucide';

const ICONS = { Box, ChevronRight, Download, FileText, FolderOpen, Loader2, Moon, Plus, RotateCcw, Save, Scissors, Sun, Trash2, Undo2, Upload } satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16, cls = ''): SVGElement {
  const el = createElement(ICONS[name], { width: size, height: size, 'stroke-width': 2 });
  el.setAttribute('class', `icon ${cls}`.trim());
  el.setAttribute('aria-hidden', 'true');
  return el;
}
