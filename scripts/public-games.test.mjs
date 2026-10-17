import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicGamesService } from '../server/publicGames.mjs';

function fixture() {
  let timestamp = Date.parse('2026-10-17T14:00:00Z');
  let failed = false;
  let status = 'Scheduled';
  const calls = [];
  const game = () => ({ id: 358, x_name: 'PBO-2026-FINAL-8-I-17-1030', x_studio_status: status, x_studio_datetime: '2026-10-17 14:30:00', x_studio_away_team: [64, 'Away'], x_studio_home_team: [46, 'Home'], x_studio_away_score: status === 'Scheduled' ? 0 : 15, x_studio_home_score: 12, x_studio_period: 2, x_studio_game_clock_seconds: 240, private_notes: 'never public' });
  const service = createPublicGamesService({ now: () => timestamp, call: async (model, method, body) => {
    calls.push({ model, method, body });
    assert.ok(['read', 'search_read', 'fields_get'].includes(method), 'Public service must never mutate Odoo');
    if (failed) throw new Error('offline');
    if (method === 'fields_get') return Object.fromEntries((model === 'x_game' ? Object.keys(game()) : model === 'x_game_event' ? ['id', 'x_studio_action_type', 'x_studio_player', 'x_studio_team', 'x_studio_period', 'x_studio_clock_seconds', 'x_studio_points', 'x_studio_score_after'] : ['id', 'x_studio_player', 'x_studio_related_field_7hr_1jf0tn6sg', 'x_studio_q1', 'x_studio_q2', 'x_studio_q3', 'x_studio_q4', 'x_studio_ot', 'x_studio_total_points']).map(key => [key, {}]));
    if (model === 'x_game') return [game()];
    if (model === 'x_team') return [{ id: 64, x_name: 'Club A - 8U - Masculino', x_studio_categoria: '8u' }, { id: 46, x_name: 'Club B', x_studio_categoria: '8u' }];
    if (model === 'x_player_game_stat') return [{ id: 1, x_studio_player: [7, 'Jugador público'], x_studio_related_field_7hr_1jf0tn6sg: [64, 'Club A'], x_studio_q1: 2, x_studio_total_points: 2, private_contact: 'never public' }];
    if (model === 'x_game_event') return [{ id: 9, x_studio_action_type: 'made 2pt', x_studio_player: [7, 'Jugador público'], x_studio_team: [64, 'Club A'], x_studio_period: 1, x_studio_clock_seconds: 50, x_studio_points: 2, x_studio_score_after: '2-0', x_studio_note: 'never public' }];
    throw new Error('Unexpected model');
  } });
  return { service, calls, advance: () => { timestamp += 13000; }, fail: () => { failed = true; }, setStatus: value => { status = value; } };
}

test('coalesces audience reads and projects only public championship data', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.service.list(), f.service.list()]);
  assert.deepEqual(a, b);
  assert.equal(f.calls.filter(c => c.model === 'x_game' && c.method === 'search_read').length, 1);
  assert.equal(a.games[0].away.name, 'Club A');
  assert.equal(a.games[0].datetime, '2026-10-17T14:30:00Z');
  assert.equal(a.games[0].publicUrl, '/model/games/pbo-2026-final-8-i-17-1030-358');
  assert.ok(!JSON.stringify(a).includes('never public'));
  const query = f.calls.find(c => c.model === 'x_game' && c.method === 'search_read');
  assert.ok(JSON.stringify(query.body.domain).includes('PBO-2026-FINAL-%'));
  assert.ok(JSON.stringify(query.body.domain).includes('PBO-2026-SF-%'));
  assert.ok(!query.body.fields.includes('private_notes'));
});

test('polling sees Scheduled → Live → Played and current scoreboard values', async () => {
  const f = fixture();
  assert.equal((await f.service.list()).games[0].status, 'Scheduled');
  f.advance(); f.setStatus('Live');
  const live = await f.service.list();
  assert.equal(live.games[0].status, 'Live');
  assert.equal(live.games[0].awayScore, 15);
  assert.equal(live.games[0].clock, 240);
  f.advance(); f.setStatus('Played');
  assert.equal((await f.service.list()).games[0].status, 'Played');
});

test('retains last confirmed data with a stale flag and shared retry cooldown', async () => {
  const f = fixture();
  const first = await f.service.list();
  f.advance(); f.fail();
  const stale = await f.service.list();
  assert.equal(stale.stale, true);
  assert.equal(stale.updatedAt, first.updatedAt);
  const count = f.calls.length;
  assert.equal((await f.service.list()).stale, true);
  assert.equal(f.calls.length, count);
});

test('rejects non-championship ids and limits public detail to the requested game', async () => {
  const f = fixture();
  assert.equal(await f.service.detail(9999), null);
  assert.equal(f.calls.some(c => c.model === 'x_player_game_stat'), false);
  const detail = await f.service.detail(358);
  assert.equal(detail.players[0].points, 2);
  assert.equal(detail.players[0].teamId, 64);
  assert.equal(detail.events[0].points, 2);
  assert.ok(!JSON.stringify(detail).includes('never public'));
  for (const c of f.calls.filter(c => c.method === 'search_read' && ['x_game_event', 'x_player_game_stat'].includes(c.model))) assert.ok(c.body.domain.some(d => d[0] === 'x_studio_game' && d[2] === 358));
});
