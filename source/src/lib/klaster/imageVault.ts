// Отдельное зашифрованное хранилище картинок.
//
// Раньше картинки жили прямо в JSON состояния (data:-URL): каждый скриншот —
// это ~100 КБ base64 внутри общего файла. Такой JSON медленно парсится,
// медленно сериализуется и целиком пишется на диск при каждом сохранении.
// Теперь картинки лежат отдельно — в IndexedDB (в обёртке это своя папка
// внутри runtime-data, в браузере — хранилище браузера), — и каждая
// зашифрована AES-GCM ключом, выведенным из пароля хранилища (PBKDF2).
// В состоянии остаётся только короткая ссылка вида «vkv1:<id>».
//
// Без пароля ключ не выводится, поэтому файлы картинок сами по себе —
// просто шифрованный бинарный мусор. Экспорт по-прежнему собирает
// самодостаточный JSON: картинки расшифровываются и вшиваются в него.

import { useEffect, useState } from 'react';

export const IMAGE_REF_PREFIX = 'vkv1:';

const DB_NAME = 'klaster-images';
const DB_VERSION = 1;
const STORE_IMAGES = 'images';
const STORE_META = 'meta';
const KEY_SALT = 'key-salt';

const PBKDF2_ROUNDS = 210_000;
const CACHE_LIMIT = 120; // расшифрованных картинок в памяти (штук)
const THUMB_SUFFIX = '.t';
const THUMB_SIDE = 512;

type ImageRecord = { id: string; iv: number[]; data: ArrayBuffer; mime: string; createdAt: number };

let dbPromise: Promise<IDBDatabase> | null = null;
let cryptoKey: CryptoKey | null = null;

/** Расшифрованные картинки: ссылка → data:-URL. */
const cache = new Map<string, string>();
/** Миниатюры: ссылка → data:-URL (дешёвые, свой лимит не нужен). */
const thumbCache = new Map<string, string>();
const thumbPending = new Map<string, Promise<string | null>>();
const pending = new Map<string, Promise<string | null>>();
const listeners = new Set<(ref: string) => void>();

function isRef(src: unknown): src is string {
  return typeof src === 'string' && src.startsWith(IMAGE_REF_PREFIX) && src.length > IMAGE_REF_PREFIX.length;
}

function refId(ref: string): string {
  return ref.slice(IMAGE_REF_PREFIX.length);
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB недоступен'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Ошибка хранилища картинок'));
      })
  );
}

/**
 * Выводит ключ шифрования из пароля хранилища. Вызывается один раз при вводе
 * пароля (до разблокировки). До этого хранилище неактивно: картинки не
 * выносятся из JSON и не шифруются — приложение работает как раньше.
 */
export async function setImageKeyFromPassword(pass: string): Promise<void> {
  if (typeof crypto?.subtle === 'undefined' || typeof indexedDB === 'undefined') return;
  const raw = new TextEncoder().encode(pass);
  const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  let salt: number[] | undefined;
  try {
    salt = (await tx<number[]>(STORE_META, 'readonly', (s) => s.get(KEY_SALT))) as number[] | undefined;
  } catch {
    salt = undefined;
  }
  if (!salt || !salt.length) {
    salt = [...crypto.getRandomValues(new Uint8Array(16))];
    try {
      await tx(STORE_META, 'readwrite', (s) => s.put(salt, KEY_SALT));
    } catch {
      /* без соли в базе ключ не переживёт перезапуск — но и картинок тогда нет */
    }
  }
  cryptoKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  // новый ключ — старые расшифровки в памяти неактуальны
  cache.clear();
  thumbCache.clear();
  pending.clear();
}

/** Хранилище активно: ключ выведен, картинки можно выносить и расшифровывать. */
export function imageVaultActive(): boolean {
  return cryptoKey !== null;
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Кладёт картинку в зашифрованное хранилище, возвращает короткую ссылку.
 * Идентификатор — SHA-256 содержимого: одинаковые картинки не дублируются.
 * Если хранилище неактивно, возвращает исходный data:-URL как есть.
 */
export async function putImage(dataUrl: string): Promise<string> {
  if (!imageVaultActive() || !dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const mime = header.slice(5, header.indexOf(';')) || 'image/png';
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const ref = IMAGE_REF_PREFIX + id;

    const existing = await tx<ImageRecord | undefined>(STORE_IMAGES, 'readonly', (s) => s.get(id));
    if (existing) {
      cache.set(ref, dataUrl);
      return ref;
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey!, bytes);
    const rec: ImageRecord = { id, iv: [...iv], data: enc, mime, createdAt: Date.now() };
    await tx(STORE_IMAGES, 'readwrite', (s) => s.put(rec));
    cache.set(ref, dataUrl);
    // миниатюра — фоновая задача: её отсутствие не мешает основному потоку
    void generateThumb(id, dataUrl);
    return ref;
  } catch {
    // хранилище недоступно — оставляем картинку внутри JSON, как раньше
    return dataUrl;
  }
}

/**
 * Миниатюра для карточки: уменьшает картинку до THUMB_SIDE и кладёт в
 * хранилище рядом с оригиналом (id с суффиксом THUMB_SUFFIX). Не бросает
 * исключений — миниатюра необязательна, отрисовка переживёт её отсутствие.
 */
async function generateThumb(id: string, dataUrl: string): Promise<void> {
  try {
    if (thumbCache.has(IMAGE_REF_PREFIX + id)) return;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      el.src = dataUrl;
    });
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    if (!nw || !nh) return;
    const scale = Math.min(1, THUMB_SIDE / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/webp', 0.8);
    const comma = out.indexOf(',');
    const mime = out.slice(5, out.indexOf(';')) || 'image/png';
    const bin = atob(out.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey!, bytes);
    const rec: ImageRecord = { id: id + THUMB_SUFFIX, iv: [...iv], data: enc, mime, createdAt: Date.now() };
    await tx(STORE_IMAGES, 'readwrite', (s) => s.put(rec));
    thumbCache.set(IMAGE_REF_PREFIX + id, out);
  } catch {
    /* без миниатюры карта рисуется из полного битмапа */
  }
}

/**
 * Миниатюра по ссылке на картинку. Для картинок, положенных в хранилище до
 * появления миниатюр, генерируется на лету при первом обращении.
 * Обычная строка (data:-URL) проходит насквозь; null — ничего не вышло.
 */
export async function getThumb(ref: string): Promise<string | null> {
  const hit = thumbCache.get(ref);
  if (hit) return hit;
  if (!isRef(ref) || !imageVaultActive()) return null;
  const id = refId(ref);
  const inflight = thumbPending.get(id);
  if (inflight) return inflight;
  const job = (async () => {
    try {
      const rec = await tx<ImageRecord | undefined>(STORE_IMAGES, 'readonly', (s) => s.get(id + THUMB_SUFFIX));
      if (rec) {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(rec.iv) }, cryptoKey!, rec.data);
        const url = bytesToDataUrl(new Uint8Array(plain), rec.mime || 'image/png');
        thumbCache.set(ref, url);
        return url;
      }
      // старая картинка без миниатюры — расшифровываем оригинал и делаем
      const full = await getImage(ref);
      if (!full) return null;
      await generateThumb(id, full);
      return thumbCache.get(ref) ?? null;
    } catch {
      return null;
    } finally {
      thumbPending.delete(id);
    }
  })();
  thumbPending.set(id, job);
  return job;
}

/**
 * src для <img> на дальнем зуме: сначала миниатюра, пока не готова — полный
 * битмап (чтобы карточка не мигала пустотой). Обычные строки — насквозь.
 */
export function useVaultThumb(src: string | undefined | null): string | undefined {
  const full = useVaultImage(src);
  const isThumbable = isRef(src ?? '');
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!isThumbable) return;
    let alive = true;
    void getThumb(src as string).then((url) => {
      if (alive) setThumb(url);
    });
    return () => {
      alive = false;
    };
  }, [isThumbable, src]);
  if (!isThumbable) return full;
  return thumb ?? full;
}

/**
 * Достаёт картинку по ссылке (расшифровывает, кеширует).
 * Обычная строка (data:-URL из браузерной версии / legacy) проходит насквозь.
 * null — только для битых/отсутствующих ссылок на хранилище.
 */
export async function getImage(ref: string): Promise<string | null> {
  if (!isRef(ref)) return ref || null;
  const hit = cache.get(ref);
  if (hit) return hit;
  if (!imageVaultActive()) return null;
  const id = refId(ref);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const job = (async () => {
    try {
      const rec = await tx<ImageRecord | undefined>(STORE_IMAGES, 'readonly', (s) => s.get(id));
      if (!rec) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(rec.iv) }, cryptoKey!, rec.data);
      const url = bytesToDataUrl(new Uint8Array(plain), rec.mime || 'image/png');
      cache.set(ref, url);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined && oldest !== ref) cache.delete(oldest);
      }
      for (const fn of listeners) fn(ref);
      return url;
    } catch {
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, job);
  return job;
}

/** Подписка на «картинка расшифровалась» — для React-хуков. */
export function onImageResolved(fn: (ref: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Карточка может быть объектом разного вида — нас интересует только её data. */
type AnyCard = { data?: Record<string, unknown> };

function imageDataFields(card: unknown): Record<string, unknown> | null {
  const d = (card as AnyCard | undefined)?.data;
  if (!d || typeof d !== 'object') return null;
  if (d.kind !== 'image' && d.kind !== 'subject' && d.kind !== 'object') return null;
  return d;
}

/**
 * Превращает все data:-картинки внутри листов в ссылки на хранилище
 * (при активном хранилище). Возвращает true, если что-то изменилось.
 */
export async function extractImagesToVault(boards: Record<string, { cards?: unknown[] }>): Promise<boolean> {
  if (!imageVaultActive()) return false;
  let changed = false;
  for (const b of Object.values(boards)) {
    for (const c of b.cards ?? []) {
      const d = imageDataFields(c);
      if (!d) continue;
      for (const field of ['src', 'srcOriginal', 'photo'] as const) {
        const v = d[field];
        if (typeof v === 'string' && v.startsWith('data:image/')) {
          d[field] = await putImage(v);
          if (d[field] !== v) changed = true;
        }
      }
    }
  }
  return changed;
}

/**
 * Возвращает все data:-картинки на место (для экспорта): ссылка → data:-URL.
 * Работает по тем же полям; возвращает true, если расшифровалась хоть одна.
 */
export async function restoreImagesForExport(boards: Record<string, { cards?: unknown[] }>): Promise<boolean> {
  let restored = false;
  for (const b of Object.values(boards)) {
    for (const c of b.cards ?? []) {
      const d = imageDataFields(c);
      if (!d) continue;
      for (const field of ['src', 'srcOriginal', 'photo'] as const) {
        const v = d[field];
        if (typeof v === 'string' && isRef(v)) {
          const url = await getImage(v);
          if (url) {
            d[field] = url;
            restored = true;
          } else {
            // картинка не расшифровалась — не тащим битую ссылку в экспорт
            delete d[field];
          }
        }
      }
    }
  }
  return restored;
}

/** Убирает из хранилища картинки, на которые больше нет ссылок (после загрузки). */
export async function pruneImages(referenced: Set<string>): Promise<void> {
  if (!imageVaultActive()) return;
  try {
    const db = await openDb();
    const all = await new Promise<ImageRecord[]>((resolve, reject) => {
      const t = db.transaction(STORE_IMAGES, 'readonly');
      const req = t.objectStore(STORE_IMAGES).getAll();
      req.onsuccess = () => resolve(req.result as ImageRecord[]);
      req.onerror = () => reject(req.error ?? new Error('Ошибка хранилища картинок'));
    });
    // миниатюры (id с суффиксом) живут, пока жива их базовая картинка
    const stale = all.filter(
      (r) => !referenced.has(IMAGE_REF_PREFIX + r.id) && !referenced.has(IMAGE_REF_PREFIX + r.id.replace(/\.t$/, ''))
    );
    if (!stale.length) return;
    const t = db.transaction(STORE_IMAGES, 'readwrite');
    const store = t.objectStore(STORE_IMAGES);
    for (const r of stale) store.delete(r.id);
  } catch {
    /* уборка необязательна */
  }
}

/**
 * src для <img>: обычная строка проходит насквозь, ссылка на хранилище —
 * расшифровывается (с кешем). Пока картинка читается, возвращает undefined.
 */
export function useVaultImage(src: string | undefined | null): string | undefined {
  const ref = isRef(src) ? src : null;
  const resolved = ref ? cache.get(ref) : (src ?? undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    const off = onImageResolved((r) => {
      if (alive && r === ref) setTick((t) => t + 1);
    });
    void getImage(ref);
    return () => {
      alive = false;
      off();
    };
  }, [ref]);
  void tick;
  return resolved;
}
