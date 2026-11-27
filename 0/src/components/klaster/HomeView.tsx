
'use client';

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileUp,
  Plus,
} from 'lucide-react';
import { useAppStore, buildBreadcrumbPath } from '@/lib/klaster/store';
import { searchAll } from '@/lib/klaster/search';
import { focusCard } from './Canvas';
import { exportBoards } from '@/lib/klaster/download';
import { HomeCalendar } from './HomeCalendar';
import { SettingsDialog } from './SettingsMenu';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const ROMAN: [number, string][] = [  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
function romanize(n: number): string {
  let out = '';
  for (const [v, sym] of ROMAN) while (n >= v) { out += sym; n -= v; }
  return out;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const day = Math.floor(h / 24);
  if (day === 1) return 'вчера';
  if (day < 7) return `${day} дн назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function Logo() {
  return (
    <span className="text-[16px] font-semibold tracking-tight" style={{ color: 'var(--text-main)' }}>Замечательно</span>
  );
}

// Точка в строке листа: по нажатию внизу, на месте «РЕЗЕРВИРОВАНИЕ; ИМПОРТ…»,
// появляются словами действия с этим листом
function BoardRowDot({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <span className="shrink-0" data-board-dot="" onClick={(e) => e.stopPropagation()}>
      <button
        aria-label="Меню листа"
        aria-expanded={active}
        className="word-btn select-none bg-transparent px-1 text-[17px] font-bold leading-none"
        style={{ color: 'var(--text-main)', cursor: 'pointer' }}
        onClick={onClick}
      >
        .
      </button>
    </span>
  );
}

const BAR_BTN = 'word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em] text-[var(--text-secondary)]';

export function HomeView() {
  const boards = useAppStore((s) => s.boards);
  const rawQuery = useAppStore((s) => s.searchDraft);
  // поиск — тяжёлый линейный проход по всем карточкам; откладываем его в
  // низкоприоритетный кадр, чтобы ввод не дёргался на больших листах
  const query = useDeferredValue(rawQuery);
  const setQuery = useAppStore((s) => s.setSearchDraft);
  const backupOn = useAppStore((s) => s.backupOnExit);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuBoard = menuId ? boards[menuId] : undefined;
  // клик мимо меню листа закрывает его; нажатие на саму точку и на кнопки
  // самого меню не трогаем — иначе меню закрывается уже на pointerdown, кнопки
  // успевают размонтироваться до клика и действие (переименовать, удалить…)
  // не срабатывает вовсе
  useEffect(() => {
    if (!menuId) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-board-dot]') || t?.closest?.('[data-sheet-menu]')) return;
      setMenuId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuId]);
  const importRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  // кегль ленты копируем с листов: меню листа запоминает свой масштаб,
  // здесь берём его — высота меню на главной совпадает с высотой ленты листа
  const [menuZoom, setMenuZoom] = useState(1);
  useEffect(() => {
    try {
      const v = parseFloat(localStorage.getItem('klaster-menu-zoom') || '1');
      if (v >= 0.4 && v <= 1) setMenuZoom(v);
    } catch {
      /* нет доступа — показываем базовый кегль */
    }
  }, []);

  const rootBoards = useMemo(() => {
    const referenced = new Set<string>();
    for (const b of Object.values(boards)) {
      for (const c of b.cards) {
        if (c.data.kind === 'board') referenced.add(c.data.boardId);
      }
    }
    return Object.values(boards)
      .filter((b) => !referenced.has(b.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [boards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rootBoards;
    return searchAll(boards, q).boards
      .map((h) => boards[h.id])
      .filter(Boolean);
  }, [boards, rootBoards, query]);

  const cardHits = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return searchAll(boards, q).cards;
  }, [boards, query]);

  const openCard = (boardId: string, cardId: string) => {
    const st = useAppStore.getState();
    const path = buildBreadcrumbPath(st.boards, boardId);
    st.openBoardRoot(path[0]);
    for (let i = 1; i < path.length; i++) st.openSubBoard(path[i]);
    setTimeout(() => focusCard(boardId, cardId), 60);
  };

  const createBoard = () => {
    const st = useAppStore.getState();
    const id = st.createBoard('Новый лист');
    st.openBoardRoot(id);
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(String(reader.result));
        const ok = await useAppStore.getState().importBoards(json);
        toast(
          ok
            ? { title: 'Листы импортированы' }
            : { title: 'Не удалось прочитать файл', description: 'Ожидается JSON, выгруженный из «Замечательно».' }
        );
      } catch {
        toast({ title: 'Не удалось прочитать файл' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--page-bg)]"
      style={{
        backgroundImage: 'var(--page-image, none)',
        backgroundSize: 'var(--page-image-size, auto)',
        backgroundAttachment: 'fixed',
      }}
    >
      <header className="app-header sticky top-0 z-20 flex h-12 items-center border-b border-[var(--panel-border)] px-2 backdrop-blur">
        <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between gap-4">
          <Logo />
          <div className="flex items-center gap-2" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-12 lg:flex-row-reverse lg:items-start">
          <div className="w-full max-w-[320px] shrink-0 lg:sticky lg:top-20 lg:ml-auto">
            <HomeCalendar />
          </div>
          <div className="min-w-0 flex-1">
        {filtered.length || cardHits.length ? (
          <div className="flex flex-col">
            {filtered.map((b, idx) => (
              <div
                key={b.id}
                className="flex items-baseline gap-3 py-2.5"
                onClick={() => useAppStore.getState().openBoardRoot(b.id)}
              >
                <span
                  className="w-9 shrink-0 select-none text-right text-[15px] italic"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-literata), Georgia, serif' }}
                >
                  {romanize(idx + 1)}.
                </span>
                {renameId === b.id ? (
                  <input
                    autoFocus
                    defaultValue={b.title}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[17px] outline-none"
                    style={{ color: 'var(--text-main)', fontFamily: 'var(--font-literata), Georgia, serif' }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        useAppStore.getState().renameBoard(b.id, e.currentTarget.value.trim() || 'Без названия');
                        setRenameId(null);
                      } else if (e.key === 'Escape') setRenameId(null);
                    }}
                    onBlur={(e) => {
                      useAppStore.getState().renameBoard(b.id, e.target.value.trim() || 'Без названия');
                      setRenameId(null);
                    }}
                  />
                ) : (
                  <span
                    className="min-w-0 flex-1 cursor-pointer select-none truncate text-[17px]"
                    style={{ color: 'var(--text-main)', fontFamily: 'var(--font-literata), Georgia, serif' }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenameId(b.id);
                      setRenameValue(b.title);
                    }}
                  >
                    {b.title}
                  </span>
                )}
                <span className="shrink-0 select-none text-[12px] text-[var(--text-faint)]">{formatDate(b.updatedAt)}</span>
                <BoardRowDot
                  active={menuId === b.id}
                  onClick={() => setMenuId(menuId === b.id ? null : b.id)}
                />
              </div>
            ))}
          {cardHits.length ? (
            <div className="mt-6 mb-1 px-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Карточки
            </div>
          ) : null}
          {cardHits.map((h) => (
            <div
              key={h.cardId}
              className="flex cursor-pointer items-baseline gap-3 py-2.5"
              onClick={() => openCard(h.boardId, h.cardId)}
            >
              <span className="shrink-0 select-none text-[12px] text-[var(--text-faint)]">
                {boards[h.boardId]?.title || ''}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                {h.snippet}
              </span>
            </div>
          ))}
          </div>
        ) : query.trim() ? (
          <div className="py-16 text-center text-[14px] text-[var(--text-muted)]">
            По запросу «{query}» ничего не найдено
          </div>
        ) : (
          <button
            className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[var(--panel-border)] bg-[var(--panel-bg)]/60 py-20 text-[var(--text-muted)]"
            onClick={createBoard}
          >
            <Plus size={26} strokeWidth={1.6} />
            <span className="text-[14.5px] font-medium">Создайте первый лист</span>
            <span className="text-[12.5px]">Заметки, задачи, изображения и вложенные листы — на одном холсте</span>
          </button>
        )}
          </div>
        </div>
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex">
        <div
          className="pointer-events-auto flex w-full items-center overflow-hidden border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-2"
          style={{
            fontFamily: 'var(--font-plex), system-ui, sans-serif',
            height: Math.round(25.5 * Math.max(menuZoom, 0.4)),
          }}
        >
          <div
            data-sheet-menu=""
            className="flex min-w-0 flex-1 items-center"
            style={{ zoom: menuZoom }}
          >
          {menuBoard ? (
            <>
              {([
                ['ПЕРЕИМЕНОВАТЬ', () => { setRenameId(menuBoard.id); setRenameValue(menuBoard.title); }],
                ['ДУБЛИРОВАТЬ', () => {
                  const st = useAppStore.getState();
                  if (st.duplicateBoardTree(menuBoard.id)) toast({ title: 'Лист продублирован' });
                }],
                ['ВЫГРУЗИТЬ', () =>
                  exportBoards(
                    useAppStore.getState().boards,
                    [menuBoard.id],
                    menuBoard.title.replace(/[^\wа-яёА-ЯЁ\- ]/gi, '').trim() || 'list'
                  )
                ],
                ['УДАЛИТЬ', () => setDeleteId(menuBoard.id)],
              ] as [string, () => void][]).map(([label, run], i, all) => (
                <Fragment key={label}>
                  {i > 0 ? <span className="mr-[5px] inline-block w-[10px]" /> : null}
                  <button
                    className={BAR_BTN}
                    style={{ cursor: 'pointer', background: 'transparent' }}
                    onClick={() => {
                      setMenuId(null);
                      run();
                    }}
                  >
                    {label}
                    {i < all.length - 1 ? ',' : '.'}
                  </button>
                </Fragment>
              ))}
            </>
          ) : (
          <>
          <button
            className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em]"
            style={{ color: backupOn ? 'var(--accent-strong)' : 'var(--text-secondary)', cursor: 'pointer', background: 'transparent' }}
            aria-label="Резервная копия данных в папку rezerv рядом с приложением: записывается сразу при включении и при каждом выходе"
            title="Резервная копия data — в папку rezerv рядом с приложением, на всякий случай. Запись сразу при включении и при каждом выходе."
            onClick={() => useAppStore.getState().setBackupOnExit(!backupOn)}
          >
            РЕЗЕРВИРОВАНИЕ;
          </button>
          <span className="mr-[5px] inline-block w-[10px]" />
          <button
            className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em] text-[var(--text-secondary)]"
            style={{ cursor: 'pointer', background: 'transparent' }}
            onClick={() => importRef.current?.click()}
          >
            ИМПОРТ,
          </button>
          <span className="mr-[5px] inline-block w-[10px]" />
          <button
            className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em] text-[var(--text-secondary)]"
            style={{ cursor: 'pointer', background: 'transparent' }}
            onClick={() => {
              exportBoards(useAppStore.getState().boards, Object.keys(useAppStore.getState().boards), 'planshet-vse-listy');
              toast({ title: 'Все листы выгружены в файл' });
            }}
          >
            ЭКСПОРТ;
          </button>
          <span className="mr-[5px] inline-block w-[10px]" />
          <button
            className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em] text-[var(--text-secondary)]"
            style={{ cursor: 'pointer', background: 'transparent' }}
            onClick={() => setSettingsOpen(true)}
          >
            ВИД;
          </button>
          <span className="mr-[5px] inline-block w-[10px]" />
          <button
            className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em] text-[var(--text-secondary)]"
            style={{ cursor: 'pointer', background: 'transparent' }}
            onClick={createBoard}
          >
            ЧИСТЫЙ ЛИСТ.
          </button>
          </>
          )}

          <div className="ml-auto flex items-center gap-1.5 pl-3">
            <span className="select-none text-[12.5px] font-medium leading-none tracking-[0.06em] text-[var(--text-secondary)]">
              ИЩЕМ:
            </span>
            <input
              value={rawQuery}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="h-7 w-[180px] border-0 bg-transparent text-[12.5px] outline-none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{ color: 'var(--text-main)' }}
              aria-label="Поиск"
            />
          </div>
          </div>
        </div>
      </div>

      {}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить лист?</AlertDialogTitle>
            <AlertDialogDescription>
              Лист «{deleteId ? boards[deleteId]?.title : ''}» и все вложенные в неё листы будут удалены.
              До закрытия приложения удаление можно отменить: КОНТРОЛ+Z.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--danger, #D25454)] text-white hover:brightness-95"
              onClick={() => {
                if (deleteId) useAppStore.getState().deleteBoardTree(deleteId);
                setDeleteId(null);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
</div>
  );
}
