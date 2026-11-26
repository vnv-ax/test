// Стартовое состояние: никаких листов — приложение открывается пустым.
import type { Board } from './types';

export function createSeed(): { boards: Record<string, Board>; openBoardId: string | null } {
  return { boards: {}, openBoardId: null };
}
