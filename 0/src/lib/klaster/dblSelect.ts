/**
 * Двойной клик по тексту блока выделяет строку/абзац.
 *
 * Оболочки карточек — `user-select: none`, текст внутри — `text`. Chromium
 * при двойном клике не считает невыделяемые промежутки границей слова и
 * склеивает текст соседних блоков. Поэтому нативное выделение гасим
 * (`preventDefault` на втором mousedown) и выделяем блок под курсором сами.
 */

const BLOCK_SEL = 'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th';
const TEXT_SEL = '.rte-view, .rte-content, .ProseMirror, .note-body';
const SKIP_SEL = 'input, textarea, [contenteditable="true"]:not(.ProseMirror), [contenteditable=""]';

/** Последний двойной клик по тексту: блок и момент жеста. */
let dblBlock: { cardId: string; at: number; idx: number } | null = null;

/** Номер блока под курсором, если правку начали только что двойным кликом; иначе null */
export function dblBlockIndex(cardId: string): number | null {
  if (!dblBlock || dblBlock.cardId !== cardId || performance.now() - dblBlock.at >= 600) return null;
  return dblBlock.idx;
}

/**
 * Порядковый номер абзаца среди верхнеуровневых блоков текста. HTML может быть
 * обёрнут во вложенные div (.rte-view > div > p), поэтому считаем блоки-предшественники
 * на каждом уровне цепочки — это даёт тот же порядок, что у doc.children в редакторе.
 */
function topLevelIndex(root: Element, block: Element): number {
  let idx = 0;
  let el: Element | null = block;
  while (el && el !== root) {
    let prev = el.previousElementSibling;
    while (prev) {
      if (prev.matches(BLOCK_SEL)) idx++;
      prev = prev.previousElementSibling;
    }
    el = el.parentElement;
  }
  return idx;
}

export function installParagraphDblClick(): () => void {
  const down = (e: MouseEvent) => {
    if (e.detail !== 2 || e.button !== 0) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest(SKIP_SEL)) return;
    if (!t.closest(TEXT_SEL)) return;
    const block = t.closest(BLOCK_SEL);
    if (!block) return;

    // счётчик блоков живёт до конца жеста: его заберёт onDoubleClick карточки
    const root = t.closest('.rte-view, .rte-content, .ProseMirror');
    dblBlock = {
      cardId: t.closest('[data-card-id]')?.getAttribute('data-card-id') ?? '',
      at: performance.now(),
      idx: root ? topLevelIndex(root, block) : -1,
    };
    e.preventDefault();

    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  };
  document.addEventListener('mousedown', down, true);
  return () => {
    document.removeEventListener('mousedown', down, true);
    dblBlock = null;
  };
}
