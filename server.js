// server.js - CÓDIGO FINAL COM FAIL-SAFE DE TOKEN (NOMES LIMPOS)
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

// ⚠️ Criação do app ANTES das rotas
const app = express();
const port = process.env.PORT || 8888;

app.use(express.static('public'))
   .use(cookieParser())
   .use(express.json());

// ---------------------------------
// Rota inicial
// ---------------------------------
// Rota de login com Spotify
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
    })
  );
});

// Rota de callback do Spotify
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies.spotify_auth_state : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' + querystring.stringify({ error: 'state_mismatch' }));
  } else {
    res.clearCookie('spotify_auth_state');
    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
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

      // Redireciona para o frontend com os tokens na URL hash
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

// ---------------------------------
// 6. Rota de API para Criar Playlist (ENDPOINT ROBUSTO)
// ---------------------------------
app.post('/api/create-playlist', async (req, res) => {
  const { accessToken, artistName, trackUris, playlistOption, targetPlaylistId, newPlaylistName } = req.body;

  if (!accessToken || !trackUris || trackUris.length === 0) {
    return res.status(400).json({ error: 'Dados incompletos para criar/adicionar playlist.' });
  }

  let userId;
  try {
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    userId = userResponse.data.id;
  } catch (tokenError) {
    console.error('Falha ao obter ID do usuário (Token expirado/inválido):', tokenError.message);
    return res.status(401).json({
      error: 'Sessão expirada. Seu token não é mais válido.',
      details: 'Por favor, saia da conta e faça login novamente para renovar sua sessão.'
    });
  }

  try {
    let playlistId;

    if (playlistOption === 'new') {
      const finalPlaylistName = newPlaylistName || `Músicas de ${artistName}`;
      try {
        const playlistResponse = await axios.post(
          `https://api.spotify.com/v1/users/${userId}/playlists`,
          {
            name: finalPlaylistName,
            public: false,
            description: `Playlist gerada automaticamente para o artista ${artistName} via Playlist Studio.`
          },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        playlistId = playlistResponse.data.id;
      } catch (createError) {
        console.error('Erro ao criar nova playlist:', createError.response ? createError.response.data : createError.message);
        const spotifyError = createError.response ? createError.response.data.error : { status: 500, message: 'Erro desconhecido.' };
        throw new Error(`Falha ao criar nova playlist. Status: ${spotifyError.status}. Verifique as permissões do seu token.`);
      }
    } else if (playlistOption === 'existing' && targetPlaylistId) {
      playlistId = targetPlaylistId;
    } else {
      return res.status(400).json({ error: 'Opção de playlist inválida.' });
    }

    const batchSize = 100;
    const totalTracks = trackUris.length;
    const addTracksUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;

    for (let i = 0; i < totalTracks; i += batchSize) {
      const batchUris = trackUris.slice(i, i + batchSize);
      const body = { uris: batchUris };

      try {
        await axios.post(addTracksUrl, body, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (error) {
        console.error(`Erro ao adicionar lote ${i / batchSize + 1} de músicas à playlist:`, error.response ? error.response.data : error.message);
        const spotifyError = error.response ? error.response.data.error : { status: 500, message: 'Erro desconhecido ao adicionar faixas.' };
        throw new Error(`Falha ao adicionar músicas (Lote ${i / batchSize + 1}). Status: ${spotifyError.status}. Verifique se você tem permissão total para editar esta playlist.`);
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    res.json({ message: 'Playlist criada/atualizada com sucesso!', playlistId });
  } catch (error) {
    console.error('Erro fatal ao criar/adicionar playlist:', error.message);
    const errorMessage = error.message.startsWith('Falha ao adicionar músicas') || error.message.startsWith('Falha ao criar nova playlist')
      ? error.message
      : 'Falha grave e inesperada ao criar/adicionar playlist. Verifique o console do servidor para mais detalhes.';
    res.status(error.response ? error.response.status : 500).json({
      error: errorMessage,
      details: error.response ? error.response.data : 'Erro interno.'
    });
  }
});

// ---------------------------------
// Inicialização do servidor
// ---------------------------------
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
