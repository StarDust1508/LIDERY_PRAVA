import '../test-env.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, MEDIA_GRANT_TTL_SECONDS } from '../config.js';
import { signExpertSession, verifyExpertSession } from './expert-session.js';
import { signMediaGrant, verifyMediaGrant } from './signed-links.js';
import { readCookie, signTeamSession, verifyTeamSession } from './team-session.js';

// Сессии и краткосрочные ссылки (ТЗ 11, п. 5.8; ТЗ 07, п. 2.5).
//
// Главное, что проверяется: контуры доступа не пересекаются. Токен команды не
// должен открывать рабочее место эксперта, ссылка эксперта — кабинет команды,
// а подписанная ссылка на файл — другой файл.

test('сессия команды подписывается и проверяется', () => {
  const token = signTeamSession(42, 7, 2);
  const session = verifyTeamSession(token);
  assert.equal(session?.teamId, 42);
  assert.equal(session?.accessTokenId, 7);
  assert.equal(session?.epoch, 2);
});

test('сессия эксперта подписывается и проверяется', () => {
  const token = signExpertSession({ expertId: 5, stage: 'selection', tokenId: 3 });
  const session = verifyExpertSession(token);
  assert.equal(session?.expertId, 5);
  assert.equal(session?.stage, 'selection');
  assert.equal(session?.tokenId, 3);
});

test('контуры доступа не пересекаются', () => {
  const teamToken = signTeamSession(1, null, 0);
  const expertToken = signExpertSession({ expertId: 1, stage: 'selection', tokenId: 1 });

  // Токен команды не открывает контур эксперта и наоборот.
  assert.equal(verifyExpertSession(teamToken), null);
  assert.equal(verifyTeamSession(expertToken), null);
});

test('подделанная подпись и чужой секрет отклоняются', () => {
  const token = signTeamSession(1, null, 0);
  const tampered = `${token.slice(0, -3)}abc`;
  assert.equal(verifyTeamSession(tampered), null);
  assert.equal(verifyTeamSession(undefined), null);
  assert.equal(verifyTeamSession(''), null);

  const foreign = jwt.sign({ scope: 'team:session', teamId: 1 }, 'другой-секрет-длиной-достаточной', {
    expiresIn: '1h',
  });
  assert.equal(verifyTeamSession(foreign), null);
});

test('истёкшая сессия не принимается', () => {
  const expired = jwt.sign({ scope: 'team:session', teamId: 1, accessTokenId: null, epoch: 0 }, JWT_SECRET, {
    expiresIn: -10,
  });
  assert.equal(verifyTeamSession(expired), null);

  const expiredExpert = jwt.sign(
    { scope: 'expert:session', expertId: 1, stage: 'selection', tokenId: 1 },
    JWT_SECRET,
    { expiresIn: -10 }
  );
  assert.equal(verifyExpertSession(expiredExpert), null);
});

test('сессия без обязательных полей отклоняется', () => {
  const noScope = jwt.sign({ teamId: 1 }, JWT_SECRET, { expiresIn: '1h' });
  assert.equal(verifyTeamSession(noScope), null);

  const noStage = jwt.sign({ scope: 'expert:session', expertId: 1 }, JWT_SECRET, { expiresIn: '1h' });
  assert.equal(verifyExpertSession(noStage), null);
});

test('краткосрочная ссылка на файл привязана к этому файлу', () => {
  const mediaId = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';
  const grant = signMediaGrant(mediaId, null);

  assert.ok(grant.token.length > 20);
  assert.ok(verifyMediaGrant(grant.token, mediaId));
  // Та же ссылка не открывает другой файл.
  assert.equal(verifyMediaGrant(grant.token, other), null);
  assert.equal(verifyMediaGrant(undefined, mediaId), null);
  assert.equal(verifyMediaGrant('подделка', mediaId), null);
});

test('срок ссылки на файл короткий и ограничен параметром', () => {
  const mediaId = '33333333-3333-3333-3333-333333333333';
  const grant = signMediaGrant(mediaId, null);
  assert.equal(grant.expiresIn, MEDIA_GRANT_TTL_SECONDS);
  // ТЗ 11, п. 5.8: ссылка живёт минуты, а не дни.
  assert.ok(grant.expiresIn <= 3600, `слишком долгий срок: ${grant.expiresIn}`);

  const custom = signMediaGrant(mediaId, null, 60);
  assert.equal(custom.expiresIn, 60);

  const issued = new Date(grant.expiresAt).getTime() - Date.now();
  assert.ok(issued > 0 && issued <= MEDIA_GRANT_TTL_SECONDS * 1000 + 1000);
});

test('cookie читается по имени и не ломается на некорректном значении', () => {
  const request = (cookie?: string) =>
    ({ headers: cookie === undefined ? {} : { cookie } }) as unknown as Parameters<typeof readCookie>[0];

  assert.equal(readCookie(request('other=1; liders_team_session=abc%20def; last=2'), 'liders_team_session'), 'abc def');
  assert.equal(readCookie(request('other=1'), 'liders_team_session'), undefined);
  assert.equal(readCookie(request(), 'liders_team_session'), undefined);
  assert.equal(readCookie(request(''), 'liders_team_session'), undefined);
  // Битое процентное кодирование возвращается как есть, а не выбрасывает ошибку.
  assert.equal(readCookie(request('liders_team_session=%E0%A4%A'), 'liders_team_session'), '%E0%A4%A');
});
