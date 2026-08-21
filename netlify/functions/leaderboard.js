import { getStore } from '@netlify/blobs';

const VALID_GAMES = ['neondrop', 'liquidrush', 'clickrush'];
const MAX_ENTRIES = 100;
const MAX_PSEUDO_LEN = 14;

// Bornes de plausibilité par jeu (anti-triche basique : refuse les scores irréalistes).
// Ce n'est pas une protection anti-triche complète (le score part du navigateur du
// joueur), juste un garde-fou contre les valeurs absurdes envoyées via l'inspecteur.
const SCORE_CAPS = {
    neondrop: 5000,
    liquidrush: 25000,
    clickrush: 3000
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
};

function todayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function sanitizePseudo(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw
        .replace(/[^\p{L}\p{N}_\- ]/gu, '')
        .trim()
        .slice(0, MAX_PSEUDO_LEN);
    return cleaned.length > 0 ? cleaned : null;
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

export default async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('', { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const game = url.searchParams.get('game');

    if (!VALID_GAMES.includes(game)) {
        return json({ error: 'invalid game' }, 400);
    }

    const allTimeStore = getStore('leaderboard-alltime');
    const dailyStore = getStore('leaderboard-daily');
    const dayKey = todayKey();

    if (req.method === 'GET') {
        const [allTimeRaw, dailyRaw] = await Promise.all([
            allTimeStore.get(game, { type: 'json' }),
            dailyStore.get(`${game}-${dayKey}`, { type: 'json' })
        ]);
        return json({
            allTime: (allTimeRaw || []).slice(0, 10),
            daily: (dailyRaw || []).slice(0, 10),
            date: dayKey
        });
    }

    if (req.method === 'POST') {
        let payload;
        try {
            payload = await req.json();
        } catch (e) {
            return json({ error: 'invalid body' }, 400);
        }

        const pseudo = sanitizePseudo(payload.pseudo);
        const score = Number(payload.score);
        const cap = SCORE_CAPS[game] || 999999;

        if (!pseudo || !Number.isFinite(score) || score <= 0 || score > cap) {
            return json({ error: 'invalid entry' }, 400);
        }

        const entry = { pseudo, score: Math.floor(score), date: dayKey };

        // Classement de tous les temps
        const currentAllTime = (await allTimeStore.get(game, { type: 'json' })) || [];
        currentAllTime.push(entry);
        currentAllTime.sort((a, b) => b.score - a.score);
        const trimmedAllTime = currentAllTime.slice(0, MAX_ENTRIES);
        await allTimeStore.setJSON(game, trimmedAllTime);

        // Classement du jour
        const dailyKeyFull = `${game}-${dayKey}`;
        const currentDaily = (await dailyStore.get(dailyKeyFull, { type: 'json' })) || [];
        currentDaily.push(entry);
        currentDaily.sort((a, b) => b.score - a.score);
        const trimmedDaily = currentDaily.slice(0, MAX_ENTRIES);
        await dailyStore.setJSON(dailyKeyFull, trimmedDaily);

        const rankAllTime = trimmedAllTime.findIndex((e) => e === entry);
        const rankDaily = trimmedDaily.findIndex((e) => e === entry);

        return json({
            allTime: trimmedAllTime.slice(0, 10),
            daily: trimmedDaily.slice(0, 10),
            rankAllTime: rankAllTime >= 0 ? rankAllTime + 1 : null,
            rankDaily: rankDaily >= 0 ? rankDaily + 1 : null
        });
    }

    return json({ error: 'method not allowed' }, 405);
};

export const config = {
    path: '/api/leaderboard'
};
