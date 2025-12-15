// server.js - CÓDIGO FINAL COM REFRESH TOKEN E BATCHING
require('dotenv').config(); 
const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');

// Variáveis de Ambiente (Serão lidas do .env local ou do Render)
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

// Função utilitária para gerar um estado aleatório (segurança CSRF)
const generateRandomString = (length) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// Rota para a página inicial
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// ---------------------------------
// 1. Rota de Login (Inicia o fluxo OAuth)
// ---------------------------------
app.get('/login', (req, res) => {
    const state = generateRandomString(16);
    res.cookie('spotify_auth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

    // Scopes necessários
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

// ---------------------------------
// 2. Rota de Callback (Recebe o código e troca por tokens) - ATUALIZADA
// ---------------------------------
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies.spotify_auth_state : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' + querystring.stringify({ error: 'state_mismatch' }));
    } else {
        res.clearCookie('spotify_auth_state');
        
        try {
            const response = await axios({
                method: 'post',
                url: 'https://accounts.spotify.com/api/token',
                data: querystring.stringify({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: REDIRECT_URI
                }),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'))
                }
            });

            const { access_token, refresh_token } = response.data;
            
            // Redireciona para o frontend, passando os tokens na URL hash
            res.redirect('/#' + querystring.stringify({
                access_token: access_token,
                refresh_token: refresh_token // ENVIANDO O REFRESH TOKEN
            }));

        } catch (error) {
            console.error('Erro ao obter tokens:', error.response ? error.response.data : error.message);
            res.redirect('/#' + querystring.stringify({ error: 'invalid_token' }));
        }
    }
});

// ---------------------------------
// 3. Rota para Renovação do Token (USADA PELO FRONTEND QUANDO DÁ 401)
// ---------------------------------
app.get('/refresh-token', async (req, res) => {
    const refresh_token = req.query.refresh_token;

    if (!refresh_token) {
        return res.status(400).json({ error: 'Refresh Token não fornecido.' });
    }

    try {
        const response = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            data: querystring.stringify({
                grant_type: 'refresh_token',
                refresh_token: refresh_token
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'))
            }
        });

        // Retorna o NOVO access_token e, se houver, um novo refresh_token
        res.json(response.data);

    } catch (error) {
        console.error('Erro ao renovar token:', error.response ? error.response.data : error.message);
        res.status(error.response ? error.response.status : 500).json({ 
            error: 'Falha ao renovar o Access Token.',
            details: error.response ? error.response.data : 'Erro interno.'
        });
    }
});


// -----------------------------------------------------
// 4. Rota de API para Pesquisar Artista (COM FILTRO DE EXCLUSÃO)
// -----------------------------------------------------
app.post('/api/search-artist', async (req, res) => {
    const { artistName, accessToken, excludedIds = [] } = req.body; 

    if (!accessToken || !artistName) {
        return res.status(400).json({ error: 'Token de acesso e nome do artista são necessários.' });
    }
    
    try {
        // Busca alguns artistas para permitir a filtragem de excluídos
        const response = await axios.get('https://api.spotify.com/v1/search', {
            params: {
                q: artistName,
                type: 'artist',
                limit: 5 
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        // Filtra o primeiro artista que NÃO esteja na lista de exclusão
        const artist = response.data.artists.items.find(item => !excludedIds.includes(item.id));
        
        if (!artist) {
             return res.status(404).json({ error: 'Nenhum artista encontrado com esse nome que não tenha sido rejeitado.' });
        }

        res.json({
            artist: {
                id: artist.id,
                name: artist.name,
                image: artist.images.length > 0 ? artist.images[0].url : null,
                followers: artist.followers.total
            }
        });

    } catch (error) {
        console.error('Erro na pesquisa do artista:', error.response ? error.response.data : error.message);
        res.status(error.response ? error.response.status : 500).json({ error: 'Falha ao buscar artista. O token pode ter expirado.' });
    }
});


// -----------------------------------------------------
// 5. Rota de API para Detalhes (Busca Músicas e Playlists) - CORRIGIDA (com delay de 50ms)
// -----------------------------------------------------
app.post('/api/search-artist-details', async (req, res) => {
    const { accessToken, artistId, artistName } = req.body;

    if (!accessToken || !artistId) {
        return res.status(400).json({ error: 'Token de acesso e ID do artista são necessários.' });
    }

    try {
        let allTracksMap = new Map();

        // A. Buscar Top Tracks
        const topTracksResponse = await axios.get(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?country=BR`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        topTracksResponse.data.tracks.forEach(track => {
            allTracksMap.set(track.id, track);
        });

        // B. Buscar Álbuns e Singles
        const albumsResponse = await axios.get(`https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single,compilation&country=BR&limit=50`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const albumIds = albumsResponse.data.items.map(album => album.id);
        
        // C. Buscar as faixas de CADA álbum
        for (const albumId of albumIds) {
            try {
                const tracksResponse = await axios.get(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                
                tracksResponse.data.items.forEach(track => {
                    const fullTrack = {
                        id: track.id,
                        uri: track.uri,
                        name: track.name,
                        album: {
                            name: albumsResponse.data.items.find(a => a.id === albumId)?.name || 'Álbum Desconhecido'
                        },
                        artists: track.artists
                    };
                    allTracksMap.set(track.id, fullTrack);
                });

                // >>> CÓDIGO DE ATRASO (50ms) ADICIONADO AQUI PARA EVITAR O ERRO 429
                await new Promise(resolve => setTimeout(resolve, 50)); 
                
            } catch (albumError) {
                console.warn(`Aviso: Não foi possível obter faixas do álbum ${albumId}.`, albumError.message);
                // Adiciona um atraso maior em caso de erro de álbum
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // D. Buscar Participações (Busca pelo nome do artista)
        const searchCollabResponse = await axios.get('https://api.spotify.com/v1/search', {
            params: { 
                q: `artist:"${artistName}"`, 
                type: 'track', 
                limit: 50 
            },
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        searchCollabResponse.data.tracks.items.forEach(track => {
            allTracksMap.set(track.id, track);
        });
        
        const uniqueTracks = Array.from(allTracksMap.values());

        // E. Buscar as Playlists do Usuário
        const userPlaylistsResponse = await axios.get('https://api.spotify.com/v1/me/playlists?limit=50', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        res.json({
            tracks: uniqueTracks, 
            playlists: userPlaylistsResponse.data.items
        });

    } catch (error) {
        console.error('Erro na busca de detalhes do artista:', error.response ? error.response.data : error.message);
        res.status(error.response ? error.response.status : 500).json({ 
            error: 'Falha ao buscar detalhes do artista no Spotify.', 
            details: error.response ? error.response.data : 'Erro interno.'
        });
    }
});


// ---------------------------------
// 6. Rota de API para Criar Playlist (MODIFICADA: Batching 413)
// ---------------------------------
app.post('/api/create-playlist', async (req, res) => {
    // NOVO: Adicionado newPlaylistName
    const { accessToken, artistName, trackUris, playlistOption, targetPlaylistId, newPlaylistName } = req.body; 

    if (!accessToken || !trackUris || trackUris.length === 0) {
        return res.status(400).json({ error: 'Dados incompletos para criar/adicionar playlist.' });
    }

    try {
        let playlistId;
        
        // 1. Obter o ID do usuário
        const userResponse = await axios.get('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const userId = userResponse.data.id;

        // 2. Criar nova playlist OU usar playlist existente
        if (playlistOption === 'new') {
            // Usa o nome enviado pelo frontend, ou um fallback se estiver vazio
            const finalPlaylistName = newPlaylistName || `SPFC - Músicas de ${artistName}`; 

            const playlistResponse = await axios.post(`https://www.google.com/search?q=https://api.spotify.com/v1/artists/%24{userId}/playlists`, {
                name: finalPlaylistName, // <--- USA O NOME FINAL E PERSONALIZADO
                public: false, // Criar como privada por padrão
                description: `Playlist gerada automaticamente para o artista ${artistName} via App SPFC.`
            }, {
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            playlistId = playlistResponse.data.id;
        } else if (playlistOption === 'existing' && targetPlaylistId) {
            playlistId = targetPlaylistId;
        } else {
            return res.status(400).json({ error: 'Opção de playlist inválida.' });
        }

        // 3. Adicionar as faixas (músicas) à playlist (LÓGICA DE LOTES)
        const batchSize = 100; // Máximo permitido pelo Spotify para POST /tracks
        const totalTracks = trackUris.length;

        for (let i = 0; i < totalTracks; i += batchSize) {
            const batchUris = trackUris.slice(i, i + batchSize);
            
            await axios.post(`https://www.google.com/url?sa=E&source=gmail&q=https://api.spotify.com/v1/me/playlists?limit=50{playlistId}/tracks`, {
                uris: batchUris // Envia apenas um lote
            }, {
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            // Pequeno delay entre lotes para evitar 429 (Embora menos comum aqui, é boa prática)
            await new Promise(resolve => setTimeout(resolve, 750)); 
        }

 res.json({ message: 'Playlist criada/atualizada com sucesso!', playlistId: playlistId });

    } catch (error) {
        console.error('Erro ao criar/adicionar playlist:', error.response ? error.response.data : error.message);
        res.status(error.response ? error.response.status : 500).json({ 
            error: 'Falha ao criar ou adicionar músicas à playlist.', 
            details: error.response ? error.response.data : 'Erro interno.'
        });
    }
});


app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});