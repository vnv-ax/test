
import type { Board } from './types';
import { restoreImagesForExport } from './imageVault';

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Экспорт листов в JSON. Перед выгрузкой расшифрованные картинки возвращаются
 * из хранилища в data:-URL — файл самодостаточен: на другом устройстве его
 * можно открыть через «Импорт» без доступа к этому хранилищу.
 */
export async function exportBoards(boards: Record<string, Board>, ids: string[], name = 'doski') {
  const payload: Record<string, Board> = {};
  for (const id of ids) {
    if (boards[id]) payload[id] = boards[id];
  }
  // Копия обязательна: restoreImagesForExport подставляет data:-URL прямо в
  // карточки, и делать это в живом состоянии нельзя — иначе расшифрованные
  // мегабайты вернулись бы в JSON и поехали на диск при следующем сохранении.
  const copy = (typeof structuredClone === 'function' ? structuredClone(payload) : JSON.parse(JSON.stringify(payload))) as Record<
    string,
    { cards: Record<string, unknown>[] }
  > & Record<string, Board>;
  await restoreImagesForExport(copy as unknown as Record<string, { cards: Record<string, unknown>[] }>);
  downloadJson({ app: 'klaster', version: 1, boards: copy }, `${name}.json`);
}
