'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface OrbitItem {
  label: string;
  action: () => void;
  /** текущее положение (точка в адресе листа) — помечается точкой-акцентом */
  active?: boolean;
  /** полное название для усечённых пунктов */
  title?: string;
}

interface OrbitMenuProps {
  /** точка появления, client-координаты (для меню адресов — центр экрана) */
  x: number;
  y: number;
  items: OrbitItem[];
  onClose: () => void;
  /**
   * chain — линии-цепочка: пункт соединяется с ПРЕДЫДУЩИМ, первый — с ядром.
   * Адрес листа повторяет структуру «лист в листе»: Главная → родитель → … → текущий.
   * По умолчанию линии радиальные — от ядра к каждому пункту (меню листа).
   */
  chain?: boolean;
  /** подпись для скринридеров */
  ariaLabel?: string;
}

const CORE_R = 26; // радиус ядра (52px / 2)
const GAP = 10; // зазор между концом линии и текстом пункта

/**
 * Меню «орбита»: шарик-ядро в точке вызова, пункты — текст на окружности,
 * чёрные линии соединений (как основные связи на листе), затемнение фона
 * радиальным градиентом из точки вызова. Цвета привязаны к переменным темы
 * (см. блок «КОНТЕКСТНОЕ МЕНЮ ОРБИТА» в globals.css).
 */
export function OrbitMenu({ x, y, items, onClose, chain = false, ariaLabel = 'Меню' }: OrbitMenuProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // якорь может сдвинуться, чтобы орбита не вылезла за экран
  const [pos, setPos] = useState({ x, y });
  // реальные размеры пунктов — линии должны заканчиваться у края текста
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);

  const n = Math.max(1, items.length);

  // радиус орбиты: чуть растёт с числом пунктов, сжимается в маленьком окне
  const radius = useMemo(() => {
    const base = 150 + Math.max(0, n - 1) * 18;
    const cap = Math.min(window.innerWidth, window.innerHeight) / 2 - CORE_R - 70;
    return Math.max(105, Math.min(base, Math.max(cap, 105)));
  }, [n]);

  // углы пунктов: полный круг, начиная с верхней точки
  const angles = useMemo(() => {
    if (n === 1) return [-90];
    return items.map((_, i) => -90 + (360 / n) * i);
  }, [items, n]);

  const placed = useMemo(
    () =>
      items.map((item, i) => {
        const a = (angles[i] * Math.PI) / 180;
        return { item, tx: Math.cos(a) * radius, ty: Math.sin(a) * radius, ang: angles[i] };
      }),
    [items, angles, radius],
  );

  // держим всю орбиту в пределах экрана и меряем пункты после первого рендера
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>('.orbit-item')];
    const next = nodes.map((node) => ({ w: node.offsetWidth || 110, h: node.offsetHeight || 22 }));
    setSizes((prev) => {
      const same =
        prev.length === next.length && prev.every((p, i) => p.w === next[i].w && p.h === next[i].h);
      return same ? prev : next;
    });
    const pad = 8;
    let minX = -CORE_R;
    let maxX = CORE_R;
    let minY = -CORE_R;
    let maxY = CORE_R;
    next.forEach((s, i) => {
      const p = placed[i];
      if (!p) return;
      minX = Math.min(minX, p.tx - s.w / 2);
      maxX = Math.max(maxX, p.tx + s.w / 2);
      minY = Math.min(minY, p.ty - s.h / 2);
      maxY = Math.max(maxY, p.ty + s.h / 2);
    });
    let dx = 0;
    let dy = 0;
    if (x + minX < pad) dx = pad - (x + minX);
    if (x + maxX > window.innerWidth - pad) dx = window.innerWidth - pad - (x + maxX);
    if (y + minY < pad) dy = pad - (y + minY);
    if (y + maxY > window.innerHeight - pad) dy = window.innerHeight - pad - (y + maxY);
    if (dx || dy) setPos({ x: x + dx, y: y + dy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, x, y]);

  // открытие на следующий кадр: начальные стили успевают примениться
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    // ОРБИТА закрывается по Escape раньше глобальных обработчиков
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Геометрия линий. Каждая линия — отрезок «от A до B», описанный через
   * --x/--y (старт), --len (длина) и --ang (угол), с подрезкой под реальные
   * размеры текста на концах: линии чёткие и не забегают на слова.
   */
  const lines = useMemo(() => {
    if (!placed.length) return [];
    const sizeOf = (i: number) => sizes[i] ?? { w: 110, h: 22 };
    // проекция половины ширины/высоты текста на направление линии
    const halfAlong = (i: number, ux: number, uy: number) => {
      const s = sizeOf(i);
      return Math.abs(ux) * (s.w / 2) + Math.abs(uy) * (s.h / 2);
    };
    if (!chain) {
      // радиальный режим: от края ядра до края пункта
      return placed.map((p, i) => {
        const a = (p.ang * Math.PI) / 180;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const start = CORE_R + 4;
        const end = Math.max(start + 12, radius - halfAlong(i, ux, uy) - GAP);
        return { x: ux * start, y: uy * start, len: Math.max(12, end - start), ang: p.ang, i };
      });
    }
    // цепочка: пункт i соединяется с пунктом i-1, первый — с ядром
    return placed.map((p, i) => {
      if (i === 0) {
        // «Главная страница» — от ядра
        const a = (p.ang * Math.PI) / 180;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const start = CORE_R + 4;
        const end = Math.max(start + 12, radius - halfAlong(0, ux, uy) - GAP);
        return { x: ux * start, y: uy * start, len: Math.max(12, end - start), ang: p.ang, i };
      }
      const prev = placed[i - 1];
      const ax = prev.tx;
      const ay = prev.ty;
      const bx = p.tx;
      const by = p.ty;
      const dx = bx - ax;
      const dy = by - ay;
      const L = Math.hypot(dx, dy);
      if (L < 2) return null; // пункты наложились — линии нет
      const ux = dx / L;
      const uy = dy / L;
      const t0 = halfAlong(i - 1, ux, uy) + GAP;
      const t1 = L - halfAlong(i, ux, uy) - GAP;
      if (t1 - t0 < 10) return null; // соседние пункты слишком близко
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      return { x: ax + ux * t0, y: ay + uy * t0, len: t1 - t0, ang, i };
    });
  }, [chain, placed, radius, sizes]);

  return (
    <>
      <div
        className={'orbit-backdrop' + (open ? ' open' : '')}
        style={{ '--cx': `${pos.x}px`, '--cy': `${pos.y}px` } as React.CSSProperties}
        onPointerDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={wrapRef}
        className={'orbit-wrap' + (open ? ' open' : '')}
        role="menu"
        aria-label={ariaLabel}
        style={{ left: pos.x, top: pos.y }}
      >
        {lines.map((l, i) =>
          l ? (
            <span
              key={'l' + i}
              aria-hidden
              className="orbit-line"
              style={
                {
                  '--x': `${l.x}px`,
                  '--y': `${l.y}px`,
                  '--len': `${Math.max(0, l.len)}px`,
                  '--ang': `${l.ang}deg`,
                  '--i': i,
                } as React.CSSProperties
              }
            />
          ) : null,
        )}
        {placed.map((p, i) => (
          <button
            key={i}
            role="menuitem"
            className="orbit-item"
            title={p.item.title}
            style={{ '--tx': `${p.tx}px`, '--ty': `${p.ty}px`, '--i': i } as React.CSSProperties}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              p.item.action();
              onClose();
            }}
          >
            {p.item.active ? <span className="orbit-dot" aria-hidden /> : null}
            <span className="orbit-item-label">{p.item.label}</span>
          </button>
        ))}
        <button
          className="orbit-core"
          aria-label="Закрыть меню"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          <span>+</span>
        </button>
      </div>
    </>
  );
}
