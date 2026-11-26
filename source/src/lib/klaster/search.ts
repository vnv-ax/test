import { CATALOG_CATEGORIES } from './types';

/** Достаёт чистый текст из содержимого карточки: JSON-док tiptap, HTML или простой текст. */
function plainText(raw: string): string {
  const s = String(raw ?? '');
  if (s.trimStart().startsWith('{')) {
    try {
      const out: string[] = [];
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === 'text' && typeof v === 'string') out.push(v);
          else if (k === 'content' && Array.isArray(v)) v.forEach(walk);
        }
      };
      walk(JSON.parse(s));
      if (out.length) return out.join(' ');
    } catch {
      /* не JSON — идём дальше */
    }
  }
  // HTML или прочая разметка — срезаем теги
  return s.replace(/<[^>]*>/g, ' ');
}

/** Фрагмент вокруг найденного слова, а не начало текста. */
function snippetAround(text: string, q: string): string {
  const plain = plainText(text).replace(/\s+/g, ' ').trim();
  const idx = plain.toLowerCase().indexOf(q);
  if (idx === -1) return plain.slice(0, 80);
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + q.length + 40);
  return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
}

type BoardLike = {
  id: string;
  title: string;
  cards: { id: string; data: Record<string, unknown> & { kind: string } }[];
};

/** Полнотекстовый поиск по листам и карточкам — общий для фильтра на главной и окна поиска. */
export function searchAll(
  boards: Record<string, BoardLike>,
  query: string
): { boards: { id: string; title: string }[]; cards: { boardId: string; cardId: string; snippet: string }[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { boards: [], cards: [] };
  const boardHits: { id: string; title: string }[] = [];
  const cardHits: { boardId: string; cardId: string; snippet: string }[] = [];
  for (const b of Object.values(boards)) {
    if (b.title.toLowerCase().includes(q)) boardHits.push({ id: b.id, title: b.title });
    for (const c of b.cards) {
      const d = c.data as unknown as Record<string, unknown>;
      if (c.data.kind === 'note' || c.data.kind === 'text') {
        const plain = plainText(String(d.text ?? ''));
        if (plain.toLowerCase().includes(q)) {
          cardHits.push({ boardId: b.id, cardId: c.id, snippet: snippetAround(String(d.text), q) });
        }
      } else if (c.data.kind === 'todo') {
        const items = (d.items as { text: string }[]) ?? [];
        const titleHit = String(d.title ?? '').toLowerCase().includes(q);
        const hit = items.find((i) => i.text.toLowerCase().includes(q));
        if (titleHit || hit) {
          cardHits.push({
            boardId: b.id,
            cardId: c.id,
            snippet: titleHit ? snippetAround(String(d.title || 'Список'), q) : snippetAround(hit!.text, q),
          });
        }
      } else if (c.data.kind === 'link') {
        const hay = `${d.title} ${d.description ?? ''} ${d.url}`.toLowerCase();
        if (hay.includes(q)) {
          cardHits.push({ boardId: b.id, cardId: c.id, snippet: snippetAround(String(d.title || d.url), q) });
        }
      } else if (c.data.kind === 'column') {
        if (String(d.title ?? '').toLowerCase().includes(q)) {
          cardHits.push({ boardId: b.id, cardId: c.id, snippet: snippetAround(`Колонка «${String(d.title)}»`, q) });
        }
      } else if (c.data.kind === 'catalog') {
        const cat = CATALOG_CATEGORIES[String(d.category)] ?? '';
        const links = (d.links as { title: string; url: string }[]) ?? [];
        const linkHit = links.find(
          (l) => l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q)
        );
        const hay = `${d.title} ${cat}`.toLowerCase();
        if (hay.includes(q) || linkHit) {
          const rawSnippet = linkHit
            ? (linkHit.title || linkHit.url)
            : `Каталог «${String(d.title || cat)}»`;
          cardHits.push({ boardId: b.id, cardId: c.id, snippet: snippetAround(rawSnippet, q) });
        }
      } else if (c.data.kind === 'subject' || c.data.kind === 'organization' || c.data.kind === 'object') {
        const hay = [d.name, d.role, d.contacts, d.about, d.orgType, d.sphere, d.address, d.objType, d.status]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (hay.includes(q)) {
          const label = c.data.kind === 'subject' ? 'Субъект' : c.data.kind === 'organization' ? 'Организация' : 'Объект';
          cardHits.push({ boardId: b.id, cardId: c.id, snippet: snippetAround(`${label} «${String(d.name || 'Без названия')}»`, q) });
        }
      }
    }
  }
  return { boards: boardHits.slice(0, 8), cards: cardHits.slice(0, 12) };
}
