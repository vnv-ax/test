
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileUp,
  MoreVertical,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

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

const menuItem =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--hover-bg)]';
const menuItemSep = <div className="mx-1 my-1 h-px shrink-0" style={{ background: 'var(--panel-border)' }} />;

function BoardRowMenu({
  b,
  onRename,
  onDelete,
}: {
  b: { id: string; title: string };
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const item = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger = false
  ) => (
    <button
      className={menuItem}
      style={{ color: danger ? 'var(--danger, #D25454)' : 'var(--text-secondary)' }}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Меню листа"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-secondary)]"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[190px] p-1.5"
        style={{ fontFamily: 'var(--font-literata), Georgia, serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        {item('Открыть', null, () => useAppStore.getState().openBoardRoot(b.id))}
        {item('Переименовать', null, onRename)}
        {item('Дублировать', null, () => {
          const st = useAppStore.getState();
          if (st.duplicateBoardTree(b.id)) toast({ title: 'Лист продублирован' });
        })}
        {item('Выгрузить JSON', null, () =>
          exportBoards(
            useAppStore.getState().boards,
            [b.id],
            b.title.replace(/[^\wа-яёА-ЯЁ\- ]/gi, '').trim() || 'list'
          )
        )}
        {menuItemSep}
        {item('Удалить', null, onDelete, true)}
      </PopoverContent>
    </Popover>
  );
}

export function HomeView() {
  const boards = useAppStore((s) => s.boards);
  const query = useAppStore((s) => s.searchDraft);
  const setQuery = useAppStore((s) => s.setSearchDraft);
  const backupOn = useAppStore((s) => s.backupOnExit);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  // кегль ленты копируем с листов: после первого захода в лист масштаб запоминается
  const [menuZoom, setMenuZoom] = useState(0.5);
  useEffect(() => {
    try {
      const v = parseFloat(localStorage.getItem('klaster-menu-zoom') || '1');
      if (v >= 1 && v <= 1.6) setMenuZoom(v);
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
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        const ok = useAppStore.getState().importBoards(json);
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
                className="group flex items-baseline gap-3 py-2.5"
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
                    className="min-w-0 flex-1 cursor-pointer truncate text-[17px]"
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
                <BoardRowMenu
                  b={b}
                  onRename={() => {
                    setRenameId(b.id);
                    setRenameValue(b.title);
                  }}
                  onDelete={() => setDeleteId(b.id)}
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
            className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[var(--panel-border)] bg-[var(--panel-bg)]/60 py-20 text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
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
            height: Math.round(48 * Math.max(menuZoom, 0.5)),
          }}
        >
          <div className="flex min-w-0 flex-1 items-center" style={{ zoom: menuZoom }}>
          <button
            className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em]"
            style={{ color: backupOn ? 'var(--accent-strong)' : 'var(--text-secondary)', cursor: 'pointer', background: 'transparent' }}
            aria-label="Резервное копирование data при выходе"
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

          <div className="ml-auto flex items-center gap-1.5 pl-3">
            <span className="select-none text-[12.5px] font-medium leading-none tracking-[0.06em] text-[var(--text-secondary)]">
              ИЩЕМ:
            </span>
            <input
              value={query}
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
              Лист «{deleteId ? boards[deleteId]?.title : ''}» и все вложенные в неё листы будут удалены
              безвозвратно.
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
