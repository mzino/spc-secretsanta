// ---------- REQUISITI E SETUP ---------- //

const express = require('express');
const path = require('path');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const pool = require('./db');
const { assignSecretSantas } = require('./secretSanta');
const { getUserGames, getGameInfo } = require('./steamFetcher');
const gameAwardsCategories = require('./gameAwardsCategories');
const communityAwardsCategories = require('./communityAwardsCategories');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Usa cartella public per file statici
app.use(express.static(path.join(__dirname, 'public')));

// Configurazione client Redis
const redisClient = createClient({
    url: process.env.REDIS_URL
});
redisClient.connect().catch(console.error);

// Configurazione sessione Redis
app.use(
    session({
		name: 'secret_santa_session',
        store: new RedisStore(
            { client: redisClient }
        ),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
			secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
			sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 giorni
        },
    })
);

// Inizializza autenticazione con Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport Steam
passport.use(new SteamStrategy({
    returnURL: `${process.env.BASE_URL}/auth/steam/return`,
    realm: process.env.BASE_URL,
    apiKey: process.env.STEAM_API_KEY
}, async (identifier, profile, done) => {
    const steamId = profile.id;
    const displayName = profile.displayName;
    const avatar = profile.photos[2]?.value;
    try {
        // Utente esiste già nel database?
        let [user] = await pool.query('SELECT * FROM users WHERE steam_id = ?', [steamId]);
        if (user.length === 0) {
            // Se non c'è, aggiungilo
            await pool.query('INSERT INTO users (steam_name, steam_id, steam_avatar, is_participating) VALUES (?, ?, ?, ?)', [
                displayName,
                steamId,
                avatar,
                false
            ]);
            [user] = await pool.query('SELECT * FROM users WHERE steam_id = ?', [steamId]);
        } else {
            // Se c'è già, aggiornalo
            await pool.query('UPDATE users SET steam_name = ?, steam_avatar = ? WHERE steam_id = ?', [
                displayName,
                avatar,
                steamId
            ]);
        }
        done(null, user[0]);
    } catch (error) {
        done(error);
    }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
        if (rows.length > 0) {
            done(null, rows[0]);
        } else {
            done(new Error('Errore deserializeUser: utente non trovato.'));
        }
    } catch (error) {
        done(error);
    }
});

// Usa pug come template engine
app.set('view engine', 'pug');
app.set('views', './views');

// Trusta il piano
app.set('trust proxy', 1);

// Deadline per la votazione degli awards, tramite variabile ambiente
function isVotingOpen() {
    const end = process.env.AWARDS_VOTING_END ? new Date(process.env.AWARDS_VOTING_END) : null;
    return !end || new Date() < end;
}

// Anno per la votazione degli awards
const currentYear = new Date().getFullYear();


// ------------- GET ROUTES -------------- //

// Autenticazione Steam e relativo callback
app.get('/auth/steam', passport.authenticate('steam'));
app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => res.redirect('/'));

// Home page
app.get('/', async (req, res) => {
    const [usersCountRow] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE is_participating = 1');
    const usersCount = usersCountRow[0].count;
    if (req.isAuthenticated()) {
        const [rows] = await pool.query('SELECT * FROM users WHERE steam_id = ?', [req.user.steam_id]);
        const user = rows[0];
        res.render('profile', { user, usersCount });
    } else {
        res.render('profile', { user: null, usersCount });
    }
});

// FAQ
app.get('/faq', async (req, res) => {
    res.render('faq', {
        user: req.user
    });
});

// Profilo dell'utente assegnato con l'estrazione
app.get('/santa', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).render('error401');
    }
    try {
        const userSteamId = req.user.steam_id;
        // Risali ai dati dell'assegnatario a partire dall'utente loggato
        const [rows] = await pool.query(`
            SELECT u.steam_id, u.steam_name, u.steam_avatar
            FROM santa_pairings AS sp
            JOIN users AS u ON sp.recipient_id = u.steam_id
            WHERE sp.user_id = ?
        `, [userSteamId]);
        // Controlla se esiste l'assegnazione prima di caricare /santa
        if (rows.length) {
            const recipient = rows[0];
            // Chiedi a Steam i suoi ultimi 5 giochi giocati e i 5 giochi su cui ha più ore
            const { recentlyPlayedGames, mostPlayedGames } = await getUserGames(recipient.steam_id);
            res.render('santa', {
                recipient: recipient,
                user: req.user,
                recentlyPlayedGames: recentlyPlayedGames,
                mostPlayedGames: mostPlayedGames
            });
        } else { 
            // Se non esiste l'assegnazione carica la pagina senza variabili per non crashare
            res.render('santa', {
                recipient: null,
                user: req.user,
                recentlyPlayedGames: null,
                mostPlayedGames: null
            });
        }
    } catch (error) {
        res.status(500).render('error500', { errorMessage: 'Contatta oniZM e digli "Santa".' });
    }
});

// Game awards
app.get('/gameawards', async (req, res) => {
    const votingOpen = isVotingOpen();
    const categories = gameAwardsCategories;

    // Se la votazione è chiusa, mostra i risultati (anche per utenti non loggati)
    if (!votingOpen) {
        try {
            const [allVotes] = await pool.query(
                `SELECT category, appid, COUNT(*) AS votes
                 FROM game_awards
                 WHERE year = ?
                 GROUP BY category, appid`,
                [currentYear]
            );
            const results = {};

            // Raggruppa per categoria
            for (const row of allVotes) {
                if (!results[row.category]) results[row.category] = {};
                results[row.category][row.appid] = row.votes;
            }

            // Includi anche le nomination che non hanno ricevuto nessun voto
            for (const [category, data] of Object.entries(categories)) {
                const appids = data.nominations;
                if (!results[category]) results[category] = {};
                for (const appid of appids) {
                    if (!results[category][appid]) results[category][appid] = 0;
                }
            }

            // Converti in array e ordina per numero di voti discendente
            const finalResults = {};
            for (const [category, appidsVotes] of Object.entries(results)) {
                finalResults[category] = Object.entries(appidsVotes)
                    .map(([appid, votes]) => ({ appid, votes }))
                    .sort((a, b) => b.votes - a.votes);
            }

            // Recupera i dettagli dei giochi da Steam
            for (const cat in finalResults) {
                for (const entry of finalResults[cat]) {
                    try {
                        const gameData = await getGameInfo(entry.appid);
                        entry.name = gameData.name;
                        entry.image = gameData.capsule_image;
                    } catch {
                        entry.name = `AppID ${entry.appid}`;
                        entry.image = `https://cdn.cloudflare.steamstatic.com/steam/apps/${entry.appid}/header.jpg`;
                    }
                }
            }
            const message = req.session.message;
            delete req.session.message;
            return res.render('gameawards', {
                user: req.user,
                categories,
                userVotes: null,
                votingOpen,
                results: finalResults,
                message
            });
        } catch (error) {
            res.status(500).render('error500', { errorMessage: 'Contatta oniZM e digli "Game awards risultati".' });
        }

    // Se la votazione è aperta, controlla che l'utente sia loggato e prepara i sondaggi
    } else if (votingOpen && req.isAuthenticated()) {
        try {
            const userId = req.user.steam_id;
            const [rows] = await pool.query(
                'SELECT category, appid FROM game_awards WHERE user_id = ? AND year = ?',
                [userId, currentYear]
            );
            const userVotes = {};
            rows.forEach(r => userVotes[r.category] = r.appid);

            // Recupera i dettagli dei giochi da Steam
            const categoriesCopy = JSON.parse(JSON.stringify(categories));
            for (const cat of Object.keys(categoriesCopy)) {
                const promises = categoriesCopy[cat].nominations.map(async (game) => {
                    const appid = typeof game === 'object' ? game.appid : game;
                    try {
                        const gameData = await getGameInfo(appid);
                        return {
                            appid,
                            name: gameData.name,
                            image: gameData.capsule_image
                        };
                    } catch (err) {
                        return {
                            appid,
                            name: `AppID ${appid}`,
                            image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
                        };
                    }
                });
                categoriesCopy[cat].nominations = await Promise.all(promises);
            }

            // Mostra i sondaggi (array results vuoto)
            const message = req.session.message;
            delete req.session.message;
            return res.render('gameawards', {
                user: req.user,
                categories: categoriesCopy,
                userVotes,
                votingOpen,
                results: {},
                message
            });
        } catch (error) {
            res.status(500).render('error500', { errorMessage: 'Contatta oniZM e digli "Game awards voti".' });
        }

    // Se la votazione è aperta e l'utente non è loggato, rimandalo al login
    } else if (votingOpen && !req.isAuthenticated()) {
        res.render('awards-login');
    }
});

// Community awards
app.get('/communityawards', async (req, res) => {
    const votingOpen = isVotingOpen();
    const categories = communityAwardsCategories;

    // Se la votazione è chiusa, mostra i risultati (anche per utenti non loggati)
    if (!votingOpen) {
        try {
            const [allVotes] = await pool.query(
                `SELECT category, voted_option, COUNT(*) AS votes
                 FROM community_awards
                 WHERE year = ?
                 GROUP BY category, voted_option`,
                [currentYear]
            );
            const results = {};

            // Raggruppa per categoria
            for (const row of allVotes) {
                if (!results[row.category]) results[row.category] = {};
                results[row.category][row.voted_option] = row.votes;
            }

            // Includi anche le nomination che non hanno ricevuto nessun voto
            for (const [category, data] of Object.entries(categories)) {
                const opts = data.nominations;
                if (!results[category]) results[category] = {};
                for (const opt of opts) {
                    if (!results[category][opt]) results[category][opt] = 0;
                }
            }
            // Converti in array e ordina per numero di voti discendente
            const finalResults = {};
            for (const [category, optsVotes] of Object.entries(results)) {
                finalResults[category] = Object.entries(optsVotes)
                    .map(([name, votes]) => ({ name, votes }))
                    .sort((a, b) => b.votes - a.votes);
            }

            const message = req.session.message;
            delete req.session.message;
            return res.render('communityawards', {
                user: req.user,
                categories,
                userVotes: null,
                votingOpen,
                results: finalResults,
                message
            });
        } catch (error) {
            res.status(500).render('error500', { errorMessage: 'Contatta oniZM e digli "Community awards risultati".' });
        }

    // Se la votazione è aperta, controlla che l'utente sia loggato e prepara i sondaggi
    } else if (votingOpen && req.isAuthenticated()) {
        try {
            const userId = req.user.steam_id;
            const [rows] = await pool.query(
                'SELECT category, voted_option FROM community_awards WHERE user_id = ? AND year = ?',
                [userId, currentYear]
            );
            const userVotes = {};
            rows.forEach(r => userVotes[r.category] = r.voted_option);

            // Se la votazione è aperta, mostra i sondaggi (array results vuoto)
            const message = req.session.message;
            delete req.session.message;
            return res.render('communityawards', {
                user: req.user,
                categories,
                userVotes,
                votingOpen,
                results: {},
                message
            });
        } catch (error) {
            res.status(500).render('error500', { errorMessage: 'Contatta oniZM e digli "Community awards voti".' });
        }

    // Se la votazione è aperta e l'utente non è loggato, rimandalo al login
    } else if (votingOpen && !req.isAuthenticated()) {
        res.render('awards-login');
    }
});

// Pannello admin
app.get('/admin', async (req, res) => {
    if (!req.isAuthenticated() || req.user.steam_id !== process.env.ADMIN_STEAM_ID) {
        return res.status(403).render('error403');
    }
    try {
        // Recupera utenti, abbinamenti secret santa e votazioni awards dal database
        const [users] = await pool.query('SELECT id, steam_id, steam_name, is_participating FROM users');
        const [pairings] = await pool.query('SELECT id, user_id, recipient_id FROM santa_pairings');
        const [gameawards] = await pool.query('SELECT id, user_id, category, appid, year FROM game_awards');
        const [communityawards] = await pool.query('SELECT id, user_id, category, voted_option, year FROM community_awards');
        const message = req.session.message;
        delete req.session.message;
        res.render('admin', {
            user: req.user,
            users,
            pairings,
            gameawards,
            communityawards,
            message
        });
    } catch (error) {
        console.error("/admin: Errore.", error);
        res.status(500).render('error500', { errorMessage: 'Sono cazzi mi sa.' });
    }
});


// ------------- POST ROUTES ------------- //

// Logout
app.post('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        // Cancella la sessione
        req.session.destroy((err) => {
            if (err) {
                console.error('/logout: errore nel cancellare la sessione. ', err);
                res.status(500).render('error500', { errorMessage: 'Errore durante il logout. Contatta oniZM.' });
            }
            // Cancella il cookie e rimanda alla home
            res.clearCookie('secret_santa_session');
            res.redirect('/');
        });
    });
});

// Iscrizione
app.post('/participate', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).render('error401');
    }
    if (process.env.PARTICIPATION_OPEN !== 'true') {
        return res.status(403).render('error403');
    }
    const steamId = req.user.steam_id;
    await pool.query('UPDATE users SET is_participating = TRUE WHERE steam_id = ?', [steamId]);
    res.redirect('/');
});

// Avvia l'estrazione (admin)
app.post('/run-lottery', async (req, res) => {
    if (!req.isAuthenticated() || req.user.steam_id !== process.env.ADMIN_STEAM_ID) {
        return res.status(403).render('error403');
    }
    try {
        await assignSecretSantas();
        req.session.message = 'Abbinamenti creati con successo!';
        res.status(200).redirect('/admin');
    } catch (error) {
        req.session.message = error.toString();
        res.status(200).redirect('/admin');
    }
});

// Salva voti game awards
app.post('/gameawards', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).render('error401');
    }
    if (!isVotingOpen()) return res.status(403).render('error403', { errorMessage: 'Le votazioni sono chiuse!' });

    const userId = req.user.steam_id;

    try {
        for (const [category, appid] of Object.entries(req.body)) {
            if (!appid) continue;
            await pool.query(`
                INSERT INTO game_awards (user_id, category, appid, year)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE appid = VALUES(appid)
              `, [userId, category, appid, currentYear]);
        }
        req.session.message = 'Grazie per aver votato! Se non l\'hai già fatto, vota anche per i Community Awards!';
        res.status(200).redirect('/gameawards');
    } catch (error) {
        req.session.message = error.toString();
        res.status(200).redirect('/gameawards');
    }
});

// Salva voti community awards
app.post('/communityawards', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).render('error401');
    }
    if (!isVotingOpen()) return res.status(403).render('error403', { errorMessage: 'Le votazioni sono chiuse!' });

    const userId = req.user.steam_id;

    try {
        for (const [category, option] of Object.entries(req.body)) {
            if (!option) continue;
            await pool.query(`
                INSERT INTO community_awards (user_id, category, voted_option, year)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE voted_option = VALUES(voted_option)
             `, [userId, category, option, currentYear]);
        }
        req.session.message = 'Grazie per aver votato! Se non l\'hai già fatto, vota anche per i Game Awards!';
        res.status(200).redirect('/communityawards');
    } catch (error) {
        req.session.message = error.toString();
        res.status(200).redirect('/communityawards');
    }
});


// --------------- ERRORI ---------------- //

// 404
app.use((req, res) => {
    res.status(404).render('error404', {
        user: req.user
    });
});

// Errore 500 assurdo
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error500', {
        user: req.user,
        errorMessage: 'Errore non documentato. Contatta oniZM.'
    });
});

module.exports = app;
