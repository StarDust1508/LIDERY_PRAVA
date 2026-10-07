import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config.js';

// Сессия эксперта: отдельный контур доступа (ТЗ 07, п. 2.5).
//
// Эксперт входит по разовой ссылке и получает короткую cookie-сессию на время
// работы с оценками. Сессия не даёт доступа ни к админке, ни к кабинету команд:
// область действия ограничена предметом `expert:session`, а маршруты оценок
// берут идентификатор эксперта только из неё — подставить чужой нельзя.

export const EXPERT_SESSION_COOKIE = 'liders_expert_session';
const EXPERT_SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface ExpertSessionPayload {
  scope: 'expert:session';
  expertId: number;
  stage: string;
  tokenId: number;
}

export function signExpertSession(payload: Omit<ExpertSessionPayload, 'scope'>): string {
  const full: ExpertSessionPayload = { scope: 'expert:session', ...payload };
  return jwt.sign(full, JWT_SECRET, { expiresIn: EXPERT_SESSION_TTL_SECONDS });
}

export function verifyExpertSession(token: string | undefined): ExpertSessionPayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<ExpertSessionPayload>;
    if (decoded.scope !== 'expert:session') return null;
    if (typeof decoded.expertId !== 'number' || typeof decoded.stage !== 'string') return null;
    return {
      scope: 'expert:session',
      expertId: decoded.expertId,
      stage: decoded.stage,
      tokenId: typeof decoded.tokenId === 'number' ? decoded.tokenId : 0,
    };
  } catch {
    return null;
  }
}
