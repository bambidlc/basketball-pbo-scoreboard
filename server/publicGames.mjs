// Public spectator data: a fixed, read-only projection of the championship.
const GAME_FIELDS = ['id', 'x_name', 'x_studio_datetime', 'x_studio_status', 'x_studio_away_team', 'x_studio_home_team', 'x_studio_away_score', 'x_studio_home_score', 'x_studio_location', 'x_studio_period', 'x_studio_game_clock_seconds'];
const STAT_FIELDS = ['id', 'x_studio_player', 'x_studio_related_field_7hr_1jf0tn6sg', 'x_studio_q1', 'x_studio_q2', 'x_studio_q3', 'x_studio_q4', 'x_studio_ot', 'x_studio_total_points', 'x_studio_fouls'];
const EVENT_FIELDS = ['id', 'x_studio_action_type', 'x_studio_player', 'x_studio_team', 'x_studio_period', 'x_studio_clock_seconds', 'x_studio_points', 'x_studio_score_after'];
const relationId = value => Array.isArray(value) ? value[0] : 0;
const relationName = value => Array.isArray(value) ? value[1] : '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;

export function createPublicGamesService({ call, now = Date.now, cacheMs = 12000 }) {
  const cache = new Map();
  const schemas = new Map();
  async function fields(model, wanted) {
    if (!schemas.has(model)) {
      schemas.set(model, call(model, 'fields_get', { attributes: ['type'] }).catch(error => { schemas.delete(model); throw error; }));
    }
    const schema = await schemas.get(model);
    return wanted.filter(field => schema[field]);
  }
  async function cached(key, load) {
    const entry = cache.get(key);
    if (entry?.data && entry.retryAt > now()) return { ...entry.data, stale: true };
    if (entry?.data && now() - entry.savedAt < cacheMs) return entry.data;
    if (entry?.pending) return entry.pending;
    const next = entry || {};
    next.pending = load().then(data => {
      next.data = { ...data, updatedAt: new Date(now()).toISOString(), stale: false };
      next.savedAt = now();
      next.retryAt = 0;
      return next.data;
    }).catch(error => {
      if (next.data) { next.retryAt = now() + cacheMs; return { ...next.data, stale: true }; }
      throw error;
    }).finally(() => { next.pending = undefined; });
    cache.set(key, next);
    return next.pending;
  }
  async function list() {
    return cached('list', async () => {
      const games = await call('x_game', 'search_read', {
        domain: [['x_active', '=', true], '|', ['x_name', '=like', 'PBO-2026-FINAL-%'], ['x_name', '=like', 'PBO-2026-SF-%']],
        fields: await fields('x_game', GAME_FIELDS), order: 'x_studio_datetime, id', limit: 100,
      });
      const ids = [...new Set(games.flatMap(g => [relationId(g.x_studio_away_team), relationId(g.x_studio_home_team)]).filter(Boolean))];
      const teams = ids.length ? await call('x_team', 'read', { ids, fields: ['x_name', 'x_studio_categoria', 'x_studio_club_id'], context: { active_test: false } }) : [];
      const byId = new Map(teams.map(t => [t.id, t]));
      function team(value) {
        const t = byId.get(relationId(value));
        const full = t?.x_name || relationName(value) || 'Por definir';
        return { id: relationId(value), name: full.replace(/\s*-\s*(?:\d+U|Masculino|Femenino)\b/gi, '').replace(/\s*-\s*Equipo\s+/gi, ' ').trim(), category: (t?.x_studio_categoria || '').toUpperCase(), logo: relationId(t?.x_studio_club_id) ? `${process.env.ODOO_URL || process.env.VITE_ODOO_URL || 'https://www.pbopr.com'}/web/image/x_club/${relationId(t.x_studio_club_id)}/x_studio_image/64x64` : '' };
      }
      return { games: games.map(g => ({ id: g.id, publicUrl: `/model/games/${g.x_name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${g.id}`, stage: g.x_name.includes('-SF-') ? 'Semifinal' : 'Final', division: g.x_name.match(/-(?:FINAL|SF)-\d+-(I{1,2})-/)?.[1] || '', datetime: g.x_studio_datetime ? g.x_studio_datetime.replace(' ', 'T') + 'Z' : null, status: g.x_studio_status, away: team(g.x_studio_away_team), home: team(g.x_studio_home_team), awayScore: number(g.x_studio_away_score), homeScore: number(g.x_studio_home_score), location: relationName(g.x_studio_location), period: number(g.x_studio_period), clock: typeof g.x_studio_game_clock_seconds === 'number' ? g.x_studio_game_clock_seconds : null })) };
    });
  }
  async function detail(id) {
    const schedule = await list();
    const game = schedule.games.find(g => g.id === id);
    if (!game) return null;
    const result = await cached(`game:${id}`, async () => {
      const [stats, events] = await Promise.all([
        call('x_player_game_stat', 'search_read', { domain: [['x_studio_game', '=', id], ['x_active', '=', true]], fields: await fields('x_player_game_stat', STAT_FIELDS), order: 'id', limit: 100 }),
        call('x_game_event', 'search_read', { domain: [['x_studio_game', '=', id], ['x_active', '=', true]], fields: await fields('x_game_event', EVENT_FIELDS), order: 'id desc', limit: 30 }),
      ]);
      return {
        players: stats.map(s => ({ id: s.id, name: relationName(s.x_studio_player) || 'Jugador', teamId: relationId(s.x_studio_related_field_7hr_1jf0tn6sg), points: number(s.x_studio_total_points), quarters: [s.x_studio_q1, s.x_studio_q2, s.x_studio_q3, s.x_studio_q4, s.x_studio_ot].map(number), fouls: number(s.x_studio_fouls) })),
        events: events.map(e => ({ id: e.id, action: e.x_studio_action_type || '', player: relationName(e.x_studio_player), teamId: relationId(e.x_studio_team), period: number(e.x_studio_period), clock: typeof e.x_studio_clock_seconds === 'number' ? e.x_studio_clock_seconds : null, points: number(e.x_studio_points), score: typeof e.x_studio_score_after === 'string' ? e.x_studio_score_after : '' })),
      };
    });
    return { ...result, game, stale: result.stale || schedule.stale, updatedAt: result.updatedAt < schedule.updatedAt ? result.updatedAt : schedule.updatedAt };
  }
  return { list, detail };
}
