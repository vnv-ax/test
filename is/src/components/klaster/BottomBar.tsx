

'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAppStore } from '@/lib/klaster/store';
import type { CardStatus, CardType } from '@/lib/klaster/types';
import { zoomTo } from './Canvas';
import { SettingsDialog } from './SettingsMenu';
import { BailOutDialog } from './Dialogs';
import { OrbitMenu, type OrbitItem } from './OrbitMenu';

/** Инструменты: пунктуация внутри слова. Порядок как в нижнем баре. */
const TOOLS: { type: CardType; label: string; aria: string }[] = [
  { type: 'note', label: 'СТИКЕР,', aria: 'Стикер' },
  { type: 'text', label: 'ТЕКСТ,', aria: 'Текст' },
  { type: 'todo', label: 'СПИСОК,', aria: 'Список' },
  { type: 'image', label: 'ИЗОБРАЖЕНИЕ,', aria: 'Изображение' },
  { type: 'catalog', label: 'ССЫЛКИ,', aria: 'Каталог ссылок' },
  { type: 'object', label: 'ОБЪЕКТ,', aria: 'Объект' },
  { type: 'subject', label: 'СУБЪЕКТ,', aria: 'Субъект' },
  { type: 'organization', label: 'ОРГАНИЗАЦИЯ;', aria: 'Организация' },
  { type: 'board', label: 'ЛИСТ.', aria: 'Вложенный лист' },
];

/** Слово-инструмент: наведение и нажатие ничего не меняют; под курсором
 *  моментально появляется «ТЯНИ», а при начале тяги оно исчезает
 *  (вместо него курсор сопровождает иконка того, что тащится). */
function TachtsiWord({
  label,
  ariaLabel,
  dragging,
  onPointerDown,
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  dragging?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="relative inline-flex items-center"
      style={{ cursor: 'default' }}
      onPointerEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onPointerMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => setPos(null)}
    >
      <button
        type="button"
        aria-label={ariaLabel ?? label}
        data-nodrag
        className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em]"
        style={{
          color: 'var(--text-secondary)',
          cursor: 'default',
          background: 'transparent',
        }}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {label}
      </button>
      {pos && !dragging
        ? createPortal(
            <span
              className="select-none"
              style={{
                position: 'fixed',
                left: pos.x + 8,
                top: pos.y - 20,
                zIndex: 90,
                pointerEvents: 'none',
                fontSize: 10,
                lineHeight: 1,
                padding: '1px 2px 2px',
                color: 'var(--text-muted)',
                borderBottom: '1px dashed var(--text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              ТЯНИ
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

/** Слово-кнопка функций: тоже без каких-либо реакций. */
function WordButton({
  label,
  onClick,
  disabled,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em]"
      style={{
        color: disabled ? 'var(--text-faint)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        background: 'transparent',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function AddressMenu() {
  const breadcrumb = useAppStore((s) => s.breadcrumb);
  const boards = useAppStore((s) => s.boards);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const st = useAppStore.getState();

  // адрес листа — орбита по центру экрана, пункты цепочкой:
  // Главная → родитель → … → текущий (лист в листе — линия от родителя)
  const openOrbit = () => {
    setAnchor({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) });
    setOpen(true);
  };

  const items: OrbitItem[] = [
    { label: 'Главная страница', action: () => st.setView('home') },
    ...breadcrumb.map((bid, i) => {
      const isCurrent = i === breadcrumb.length - 1;
      const title = boards[bid]?.title || 'Без названия';
      return {
        label: title,
        title,
        active: isCurrent,
        action: () => {
          if (!isCurrent) st.navigateTo(i);
        },
      };
    }),
  ];

  return (
    <>
      <button
        className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em]"
        style={{ color: 'var(--text-secondary)', cursor: 'pointer', background: 'transparent' }}
        aria-label="Адрес листа"
        aria-expanded={open}
        onClick={openOrbit}
      >
        ...
      </button>
      {open ? (
        <OrbitMenu
          x={anchor.x}
          y={anchor.y}
          chain
          ariaLabel="Адрес листа"
          onClose={() => setOpen(false)}
          items={items}
        />
      ) : null}
    </>
  );
}

function StatusFilterMenu() {
  const statusFilter = useAppStore((s) => s.statusFilter);
  const tagFilter = useAppStore((s) => s.tagFilter);
  const setStatusFilter = useAppStore((s) => s.setStatusFilter);
  const setTagFilter = useAppStore((s) => s.setTagFilter);
  const [tagDraft, setTagDraft] = useState(tagFilter ?? '');
  const [open, setOpen] = useState(false);
  const active = statusFilter !== null || tagFilter !== null;
  const statuses: { id: CardStatus; label: string }[] = [
    { id: 'urgent', label: 'Срочно' },
    { id: 'actual', label: 'Актуально' },
    { id: 'done', label: 'Выполнено' },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Фильтр"
          className="word-btn select-none px-0.5 text-[12.5px] font-medium leading-none tracking-[0.06em]"
          style={{
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            background: 'transparent',
          }}
        >
          ФИЛЬТР,
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-3">
        <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Состояние
        </div>
        <div className="flex flex-col gap-0.5">
          {statuses.map((st) => (
            <button
              key={st.id}
              className={
                'flex items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors ' +
                (statusFilter === st.id
                  ? 'bg-[var(--accent-soft)] text-[var(--text-main)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]')
              }
              onClick={() => setStatusFilter(statusFilter === st.id ? null : st.id)}
            >
              {st.id === 'urgent' ? <span className="state-badge status-urgent">!</span> : null}
              {st.id === 'actual' ? (
                <span className="state-badge status-actual"><span className="diode diode-glow" /></span>
              ) : null}
              {st.id === 'done' ? (
                <span className="state-badge status-done"><span className="diode" /></span>
              ) : null}
              {st.label}
            </button>
          ))}
        </div>
        <div className="mt-2 mb-1 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Тег (можно вложенный #цитаты/Сталин)
        </div>
        <div className="flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[12.5px] text-[var(--text-main)] outline-none focus:border-[var(--accent)]"
            placeholder="#цитаты…"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                const t = tagDraft.trim().replace(/^#/, '');
                setTagFilter(t || null);
                setOpen(false);
              }
            }}
          />
          {tagFilter ? (
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
              aria-label="Сбросить тег"
              onClick={() => {
                setTagFilter(null);
                setTagDraft('');
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
        {tagFilter ? (
          <div className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">
            Фильтр: <span style={{ color: 'var(--accent)' }}>#{tagFilter}</span> — включая вложенные
          </div>
        ) : null}
        {active ? (
          <button
            className="mt-2 w-full rounded-md border border-[var(--panel-border)] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
            onClick={() => {
              setStatusFilter(null);
              setTagFilter(null);
              setTagDraft('');
            }}
          >
            Сбросить фильтр
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function BottomBar({ boardId }: { boardId: string }) {
  const pastLen = useAppStore((s) => s.past.length);
  const futureLen = useAppStore((s) => s.future.length);
  const dragNewType = useAppStore((s) => s.dragNewType);
  const drawMode = useAppStore((s) => s.drawMode);
  const zoom = useAppStore((s) => s.viewports[boardId]?.zoom ?? 1);
  const percent = Math.round(zoom * 100);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bailOut, setBailOut] = useState(false);
  const fitZoomRef = useRef(1);

  const st = useAppStore.getState();

  // авто-подгон: меряем ширину строки контента и ужимаем панель со шрифтом
  // (zoom) так, чтобы всё ровно влезло в экран; zoom у Chromium входит в
  // getBoundingClientRect, поэтому база = ширина / текущий зум
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [fitZoom, setFitZoom] = useState(1);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const recompute = () => {
      const scaled = content.getBoundingClientRect().width;
      const base = scaled / (fitZoomRef.current || 1);
      if (base <= 0) return;
      const next = Math.min(1, Math.max(0.55, (window.innerWidth - 8) / base));
      // масштаб пишем всегда, не только при изменении: его берут меню
      // форматирования и главная — у всех одна высота и кегль
      try {
        localStorage.setItem('klaster-menu-zoom', String(next));
      } catch {
        /* приватный режим — просто без запоминания */
      }
      if (Math.abs(next - fitZoomRef.current) > 0.005) {
        fitZoomRef.current = next;
        setFitZoom(next);
      }
    };
    recompute();
    // шрифты мог ещё не подгрузить — пересчитать после загрузки
    if (typeof document !== 'undefined' && (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready) {
      void (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(recompute);
    }
  });

  useEffect(() => {
    const onResize = () => setFitZoom((z) => z); // перезапуск layout-эффекта
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center">
      <div
        ref={panelRef}
        className="bottombar-panel pointer-events-auto flex w-full items-center overflow-hidden px-3 py-1.5"
        style={{
          fontFamily: 'var(--font-plex), system-ui, sans-serif',
          zoom: fitZoom,
        }}
      >
        <div ref={contentRef} className="inline-flex items-center gap-[6px] whitespace-nowrap">
            <AddressMenu />


            {TOOLS.map((t) => (
              <TachtsiWord
                key={t.type}
                label={t.label}
                ariaLabel={t.aria}
                dragging={dragNewType === t.type}
                onPointerDown={(e) => {
                  e.preventDefault();
                  useAppStore.getState().setDragNewType(t.type);
                }}
              />
            ))}


            <span className="inline-flex items-center" style={{ color: drawMode ? 'var(--accent-strong)' : undefined }}>
              <WordButton
                label="РИСОВАНИЕ."
                ariaLabel="Рисование"
                onClick={() => {
                const store = useAppStore.getState();
                store.setDragNewType(null);
                store.setDrawMode(!store.drawMode);
              }}
              />
            </span>


            <WordButton
              label="ВЕРНУТЬ,"
              ariaLabel="Вернуть (отменить)"
              disabled={!pastLen}
              onClick={() => st.undo()}
            />
            <WordButton
              label="ПОВТОРИТЬ?"
              ariaLabel="Повторить"
              disabled={!futureLen}
              onClick={() => st.redo()}
            />


            <WordButton label="ВИД;" ariaLabel="Оформление" onClick={() => setSettingsOpen(true)} />


            <StatusFilterMenu />
            <WordButton label="ПОИСК;" ariaLabel="Поиск" onClick={() => st.setSearchOpen(true)} />



            <WordButton
              label={percent + '%'}
              ariaLabel="Сбросить масштаб"
              onClick={() => zoomTo(boardId, 1)}
            />



            <WordButton label="ПОДМОГНУТЬ." ariaLabel="Связаться с автором" onClick={() => setBailOut(true)} />

        </div>
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <BailOutDialog open={bailOut} onClose={() => setBailOut(false)} />
      </div>
    </div>
  );
}
