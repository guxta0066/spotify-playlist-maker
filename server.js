// server.js - versão ajustada
require('dotenv').config(); 
const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; 

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.error("ERRO: CLIENT_ID, CLIENT_SECRET e REDIRECT_URI devem ser definidos no arquivo .env.");
    process.exit(1);
}

const app = express();
const port = process.env.PORT || 8888; 

app.use(express.static('public')) 
   .use(cookieParser())
   .use(express.json()); 

// rota inicial
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// login
app.get('/login', (req, res) => {
    const state = Math.random().toString(36).substring(2, 15);
    res.cookie('spotify_auth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

    const scope = 'user-read-private user-read-email playlist-modify-public playlist-modify-private user-library-read';

    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: CLIENT_ID,
            scope: scope,
            redirect_uri: REDIRECT_URI,
            state: state
        }));
});

// callback
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies.spotify_auth_state : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' + querystring.stringify({ error: 'state_mismatch' }));
    } else {
        res.clearCookie('spotify_auth_state');
        try {
            const response = await axios.post('https://accounts.spotify.com/api/token',
                querystring.stringify({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: REDIRECT_URI
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
                    }
                }
            );

            const { access_token, refresh_token } = response.data;
            res.redirect('/#' + querystring.stringify({
                access_token,
                refresh_token
            }));
        } catch (error) {
            console.error('Erro ao obter tokens:', error.response ? error.response.data : error.message);
            res.redirect('/#' + querystring.stringify({ error: 'invalid_token' }));
        }
    }
});

// refresh token
app.get('/refresh-token', async (req, res) => {
    const refresh_token = req.query.refresh_token;
    if (!refresh_token) return res.status(400).json({ error: 'Refresh Token não fornecido.' });

    try {
        const response = await axios.post('https://accounts.spotify.com/api/token',
            querystring.stringify({
                grant_type: 'refresh_token',
                refresh_token
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
                }
            }
        );
        res.json(response.data);
    } catch (error) {
        console.error('Erro ao renovar token:', error.response ? error.response.data : error.message);
        res.status(error.response ? error.response.status : 500).json({ 
            error: 'Falha ao renovar o Access Token.',
            details: error.response ? error.response.data : 'Erro interno.'
        });
    }
});

// criar playlist
app.post('/api/create-playlist', async (req, res) => {
    const { accessToken, artistName, trackUris, playlistOption, targetPlaylistId, newPlaylistName } = req.body; 
    if (!accessToken || !trackUris || trackUris.length === 0) {
        return res.status(400).json({ error: 'Dados incompletos para criar/adicionar playlist.' });
    }

    try {
        const userResponse = await axios.get('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const userId = userResponse.data.id;

        let playlistId;
        if (playlistOption === 'new') {
            const finalPlaylistName = newPlaylistName || `Playlists de ${artistName}`;
            const playlistResponse = await axios.post(
                `https://api.spotify.com/v1/users/${userId}/playlists`,
                {
                    name: finalPlaylistName,
                    public: false,
                    description: `Playlist gerada automaticamente para o artista ${artistName}.`
                },
                {
                    headers: { 
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            playlistId = playlistResponse.data.id;
        } else if (playlistOption === 'existing' && targetPlaylistId) {
            playlistId = targetPlaylistId;
        } else {
            return res.status(400).json({ error: 'Opção de playlist inválida.' });
        }

        const addTracksUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
        const batchSize = 100;
        for (let i = 0; i < trackUris.length; i += batchSize) {
            const batchUris = trackUris.slice(i, i + batchSize);
            await axios.post(addTracksUrl, { uris: batchUris }, {
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        res.json({ message: 'Playlist criada/atualizada com sucesso!', playlistId });
    } catch (error) {
        console.error('Erro fatal ao criar/adicionar playlist:', error.message);
        res.status(error.response ? error.response.status : 500).json({ 
            error: 'Falha grave e inesperada ao criar/adicionar playlist.',
            details: error.response ? error.response.data : 'Erro interno.'
        });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
