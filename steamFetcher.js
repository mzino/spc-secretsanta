const axios = require('axios');
const STEAM_API_KEY = process.env.STEAM_API_KEY;

// Chiedi a Steam gli ultimi 5 giochi giocati da uno SteamID
async function getRecentlyPlayedGames(steamId, count = 5) {
    const url = 'https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/';
    try {
        const response = await axios.get(url, {
            params: {
                key: STEAM_API_KEY,
                steamid: steamId,
                count: count
            }
        });
        return response.data.response.games || [];
    } catch (error) {
        console.error('Errore nel recuperare i giochi recenti:', error);
        return [];
    }
}

// Chiedi a Steam i 5 giochi più giocati da uno SteamID
async function getMostPlayedGames(steamId, limit = 5) {
    // Chiedi l'elenco dei giochi posseduti
    const url = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';
    try {
        const response = await axios.get(url, {
            params: {
                key: STEAM_API_KEY,
                steamid: steamId,
                include_appinfo: true,
                include_played_free_games: true
            }
        });
        const games = response.data.response.games || [];
        // Ordina i risultati per ore giocate discendenti e limita ai primi 5 risultati
        const sortedGames = games
            .sort((a, b) => b.playtime_forever - a.playtime_forever)
            .slice(0, limit);
        return sortedGames;
    } catch (error) {
        console.error('Errore nel recuperare i giochi più giocati:', error);
        return [];
    }
}

// Funzione da passare all'app
async function getUserGames(steamId) {
    const [recentlyPlayedGames, mostPlayedGames] = await Promise.all([
        getRecentlyPlayedGames(steamId),
        getMostPlayedGames(steamId)
    ]);
    return {
        recentlyPlayedGames,
        mostPlayedGames
    };
}

module.exports = { getUserGames };
