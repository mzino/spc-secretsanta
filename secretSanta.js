const pool = require('./db');

async function assignSecretSantas() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        // Recupera tutti gli utenti che hanno confermato la partecipazione
        const [participants] = await connection.query('SELECT * FROM users WHERE is_participating = true');
        // Controlla che ci siano abbastanza partecipanti
        if (participants.length < 2) {
            throw new Error('Non ci sono abbastanza partecipanti.');
        }
        // Mischia i partecipanti
        const shuffled = shuffle(participants);
        // Crea le assegnazioni (a ogni utente il successivo)
        const pairings = [];
        for (let i = 0; i < shuffled.length; i++) {
            const user = shuffled[i];
            const recipient = shuffled[(i + 1) % shuffled.length];
            // Controlla che nessuno venga assegnato a sé stesso
            if (user.id === recipient.id) {
                throw new Error('Utente assegnato a sé stesso.');
            }
            pairings.push({
                user_id: user.steam_id,
                recipient_id: recipient.steam_id
            });
        }
        // Cancella tutte le assegnazioni esistenti prima di salvarne di nuove
        await connection.query('DELETE FROM santa_pairings');
        // Salva le assegnazioni nel database
        const insertQuery = 'INSERT INTO santa_pairings (user_id, recipient_id) VALUES (?, ?)';
        for (let pairing of pairings) {
            await connection.query(insertQuery, [pairing.user_id, pairing.recipient_id]);
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// Funzione per mischiare i partecipanti
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

module.exports = { assignSecretSantas };
