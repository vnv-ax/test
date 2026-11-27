'use client';

import { useEffect, useState } from 'react';

/**
 * Прогрев графических пайплайнов меню во время загрузки и ввода пароля.
 *
 * Рендерит НАСТОЯЩИЕ элементы орбиты (те же классы и переходы) почти
 * невидимыми (opacity 0.001) поверх чёрного экрана загрузки: браузер
 * заранее компилирует шейдеры, создаёт композитные слои и прогоняет
 * анимации. Первый реальный вызов меню больше не платит за это —
 * ничего не тормозит. Размонтируется вместе с BootSplash.
 */
export function OrbitWarmup() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    // запускаем переходы на следующий кадр: начальные стили успевают примениться
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="orbit-warmup" aria-hidden>
      <div
        className={'orbit-backdrop' + (on ? ' open' : '')}
        style={{ '--cx': '50%', '--cy': '50%' } as React.CSSProperties}
      />
      <div className={'orbit-wrap' + (on ? ' open' : '')} role="presentation" style={{ left: '50%', top: '50%' }}>
        <span
          aria-hidden
          className="orbit-line"
          style={{ '--x': '0px', '--y': '0px', '--len': '110px', '--ang': '-38deg', '--i': 0 } as React.CSSProperties}
        />
        <span
          aria-hidden
          className="orbit-line"
          style={{ '--x': '0px', '--y': '0px', '--len': '110px', '--ang': '52deg', '--i': 1 } as React.CSSProperties}
        />
        <button tabIndex={-1} className="orbit-item" style={{ '--tx': '96px', '--ty': '-74px', '--i': 0 } as React.CSSProperties}>
          <span className="orbit-item-label">Стикер</span>
        </button>
        <button tabIndex={-1} className="orbit-item" style={{ '--tx': '68px', '--ty': '90px', '--i': 1 } as React.CSSProperties}>
          <span className="orbit-item-label">Центрировать</span>
        </button>
        <button tabIndex={-1} className="orbit-core">
          <span>+</span>
        </button>
      </div>
      {/* стекло панелей приложения — самый дорогой blur: греем заранее */}
      <div className="orbit-warmup-glass" />
    </div>
  );
}
