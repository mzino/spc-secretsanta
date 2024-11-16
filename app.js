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
const { getUserGames } = require('./steamFetcher');
require('dotenv').config();

const app = express();
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
        store: new RedisStore(
            { client: redisClient }
        ),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            // secure: true,
            httpOnly: true,
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


// ------------- GET ROUTES -------------- //

// Autenticazione Steam e relativo callback
app.get('/auth/steam', passport.authenticate('steam'));
app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => res.redirect('/'));

// Home page
app.get('/', async (req, res) => {
    if (req.isAuthenticated()) {
        const [rows] = await pool.query('SELECT * FROM users WHERE steam_id = ?', [req.user.steam_id]);
        const user = rows[0];
        res.render('profile', { user });
    } else {
        res.render('profile', { user: null });
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

// Pannello admin
app.get('/admin', async (req, res) => {
    if (!req.isAuthenticated() || req.user.steam_id !== process.env.ADMIN_STEAM_ID) {
        return res.status(403).render('error403');
    }
    try {
        // Recupera utenti e abbinamenti dal database
        const [users] = await pool.query('SELECT id, steam_id, steam_name, is_participating FROM users');
        const [pairings] = await pool.query('SELECT id, user_id, recipient_id FROM santa_pairings');
        const message = req.session.message;
        delete req.session.message;
        res.render('admin', {
            user: req.user,
            users,
            pairings,
            message
        });
    } catch (error) {
        console.error("/admin: Errore.", error);
        res.status(500).render('error500', { errorMessage: 'Sono cazzi mi sa.' });
    }
});


// ------------- POST ROUTES ------------- //

// Logout
app.post('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
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


// --------------- ERRORI ---------------- //

// 404
app.use((req, res) => {
    res.status(404).render('error404');
});

// Errore 500 assurdo
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error500', { errorMessage: 'Errore non documentato. Contatta oniZM.' });
});

module.exports = app;
