// script.js - CÓDIGO FINAL E MAIS ROBUSTO (COM MÚSICA DE FUNDO)

// Variáveis de estado global
let accessToken = null;
let refreshToken = null; // NOVO: Para renovar o Access Token
let currentArtistId = null; 
let artistName = null;
let currentSearchQuery = ''; 
let excludedArtistIds = []; 
const BASE_URL = window.location.origin;

// Elementos DOM 
const loginScreen = document.getElementById('login-screen');
const mainApp = document.getElementById('main-app');
const artistSearchInput = document.getElementById('artist-search');
const searchButton = document.getElementById('search-btn');
const searchStatus = document.getElementById('search-status');
const artistInfoContainer = document.getElementById('artist-info-container');
const artistImage = document.getElementById('artist-image');
const artistNameEl = document.getElementById('artist-name');
const artistFollowersEl = document.getElementById('artist-followers');
const playlistCreatorSection = document.getElementById('playlist-creator-section');
const tracksList = document.getElementById('tracks-list');
const playlistDestinationSelect = document.getElementById('playlist-destination');
const existingPlaylistSelect = document.getElementById('existing-playlist-select');
const uniqueTracksCheckbox = document.getElementById('unique-tracks');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const creationStatus = document.getElementById('creation-status');
const userInfoEl = document.getElementById('user-info');
const themeToggle = document.getElementById('theme-toggle');

// Elementos de Fluxo
const confirmArtistBtn = document.getElementById('confirm-artist-btn'); 
const refineSearchBtn = document.getElementById('refine-search-btn');   
const artistConfirmationButtons = document.getElementById('artist-confirmation-buttons'); 
const newPlaylistNameInput = document.getElementById('new-playlist-name'); 
const newPlaylistNameContainer = document.getElementById('new-playlist-name-container');
const playlistNameSuggestion = document.getElementById('playlist-name-suggestion');
const logoutBtn = document.getElementById('logout-btn'); // Botão de Logout

// NOVOS ELEMENTOS DOM PARA MÚSICA
const audioPlayer = document.getElementById('background-music');
const musicToggleButton = document.getElementById('music-toggle-btn');


// Função para formatar números (ex: 1234567 -> 1.234.567)
const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// ---------------------------------
// Ações de Interface e Estado
// ---------------------------------

// Lógica para alternar Modo Claro/Escuro
const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
};

themeToggle.addEventListener('change', () => {
    const newTheme = themeToggle.checked ? 'light' : 'dark';
    applyTheme(newTheme);
});

// Inicializa o tema ao carregar
const savedTheme = localStorage.getItem('theme') || 'light';
themeToggle.checked = savedTheme === 'light';
applyTheme(savedTheme);


// Lógica para mostrar/esconder a seleção de playlists existentes E o campo de nome
playlistDestinationSelect.addEventListener('change', (e) => {
    if (e.target.value === 'existing') {
        existingPlaylistSelect.classList.remove('hidden');
        newPlaylistNameContainer.classList.add('hidden'); 
        checkCreationButtonState(); 
    } else {
        existingPlaylistSelect.classList.add('hidden');
        newPlaylistNameContainer.classList.remove('hidden'); 
        checkCreationButtonState(); 
    }
});

// Habilita/Desabilita o botão Criar Playlist
const checkCreationButtonState = () => {
    const selectedTracks = tracksList.querySelectorAll('input[type="checkbox"]:checked').length;
    const isExistingMode = playlistDestinationSelect.value === 'existing';
    const isNewMode = playlistDestinationSelect.value === 'new';
    
    const isPlaylistSelected = existingPlaylistSelect.value !== ''; 
    const isNewNameProvided = newPlaylistNameInput.value.trim().length > 0;

    if (selectedTracks > 0 && 
       ((isExistingMode && isPlaylistSelected) || (isNewMode && isNewNameProvided))) {
        createPlaylistBtn.disabled = false;
    } else {
        createPlaylistBtn.disabled = true;
    }
};

existingPlaylistSelect.addEventListener('change', checkCreationButtonState);
newPlaylistNameInput.addEventListener('input', checkCreationButtonState);

// LÓGICA DE CONTROLE DE MÚSICA
const updateMusicButton = () => {
    if (audioPlayer && musicToggleButton) {
        if (audioPlayer.muted) {
            musicToggleButton.innerHTML = '🔇 Mutado';
        } else {
            musicToggleButton.innerHTML = '🔊 Som';
        }
    }
};


// ---------------------------------
// Funções de Autenticação
// ---------------------------------

// Função que processa o retorno do /callback (tokens na URL)
const getTokensFromHash = () => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    const token = params.get('access_token');
    const refreshTokenFromHash = params.get('refresh_token'); // LÊ o refresh token
    const error = params.get('error');

    if (error) {
        document.getElementById('login-error').textContent = `Erro de Login: ${error}. Tente novamente.`;
        return null;
    }

    if (token) {
        // Armazenar tokens
        localStorage.setItem('spotify_access_token', token);
        if (refreshTokenFromHash) {
             localStorage.setItem('spotify_refresh_token', refreshTokenFromHash);
        }
        // Limpar a URL (para segurança e estética)
        window.history.pushState("", document.title, window.location.pathname + window.location.search);
        return token;
    }
    return null;
};

// NOVO: Função para desconectar o usuário (Logout)
const logout = () => {
    // 1. Remove os tokens do localStorage
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token'); 
    
    // 2. Redireciona para a raiz, forçando a tela de login
    window.location.href = '/'; 
};

// Inicialização: Verifica se o usuário está logado
const initAuth = () => {
    accessToken = getTokensFromHash();

    if (!accessToken) {
        accessToken = localStorage.getItem('spotify_access_token');
    }
    
    // Tenta obter o refresh token salvo
    refreshToken = localStorage.getItem('spotify_refresh_token'); 
    
    if (accessToken) {
        // USUÁRIO LOGADO: MOSTRA APP, ESCONDE LOGIN
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        fetchUserProfile(accessToken);
    } else {
        // USUÁRIO DESLOGADO: MOSTRA LOGIN, ESCONDE APP
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
};


// ---------------------------------
// Funções de API Spotify
// ---------------------------------

// Busca o perfil do usuário logado (para mostrar o nome)
const fetchUserProfile = async (token) => {
    try {
        const response = await fetch(`${BASE_URL}/api/user-profile`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        userInfoEl.textContent = data.display_name || data.id;
    } catch (error) {
        console.error('Erro ao buscar perfil:', error);
        // Se falhar, o token provavelmente expirou. 
        // Chama logout para forçar novo login e limpar tokens antigos
        logout(); 
    }
};

// -----------------------------------------------------
// FUNÇÕES DE PESQUISA 
// -----------------------------------------------------

// Funcao Auxiliar para renovar o token
const renewAccessToken = async () => {
    if (!refreshToken) {
        console.error("Refresh Token não disponível. Necessário novo login.");
        logout();
        return false;
    }
    
    try {
        searchStatus.className = 'status-message info-message';
        searchStatus.textContent = 'Token expirado. Renovando sessão...';

        const response = await fetch(`${BASE_URL}/refresh-token?refresh_token=${refreshToken}`);
        
        if (!response.ok) {
            throw new Error('Falha na renovação do token.');
        }

        const data = await response.json();
        
        // Salva o novo Access Token e, se houver, o novo Refresh Token
        localStorage.setItem('spotify_access_token', data.access_token);
        if (data.refresh_token) {
            localStorage.setItem('spotify_refresh_token', data.refresh_token);
            refreshToken = data.refresh_token; // Atualiza a variável global
        }
        accessToken = data.access_token; // Atualiza a variável global
        
        searchStatus.textContent = 'Sessão renovada com sucesso! Tente novamente.';
        return true;
        
    } catch (e) {
        console.error('Erro ao renovar token:', e);
        searchStatus.className = 'status-message error-message';
        searchStatus.textContent = 'Falha na renovação da sessão. Faça login novamente.';
        logout();
        return false;
    }
}


// 1. Inicia a busca (chamada pelo botão de pesquisa)
const searchArtist = async () => {
    const artistNameQuery = artistSearchInput.value.trim();
    if (!artistNameQuery) {
        searchStatus.className = 'status-message info-message';
        searchStatus.textContent = 'Digite o nome de um artista para buscar.';
        return;
    }

    currentSearchQuery = artistNameQuery; // Salva o termo de pesquisa
    excludedArtistIds = []; // Limpa exclusões ao iniciar uma NOVA busca
    
    // Inicia a busca real
    await performArtistSearch(artistNameQuery, excludedArtistIds);
};

// 2. Lógica central de busca e filtragem (chamada por searchArtist e refineSearchBtn)
const performArtistSearch = async (query, excludedIds) => {
    searchStatus.className = 'status-message info-message';
    searchStatus.textContent = 'Buscando artista e suas músicas...';
    
    // Limpar resultados e botões
    tracksList.innerHTML = '';
    artistInfoContainer.classList.add('hidden');
    artistConfirmationButtons.classList.add('hidden'); 
    playlistCreatorSection.classList.add('hidden');
    createPlaylistBtn.disabled = true;
    
    // Esconder a sugestão de nome ao iniciar a busca
    playlistNameSuggestion.classList.add('hidden');
    newPlaylistNameInput.value = ''; // Limpa o campo de nome

    try {
        // Faz a requisição para buscar o artista mais relevante (que não esteja excluído)
        const response = await fetch(`${BASE_URL}/api/search-artist`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                artistName: query,
                accessToken: accessToken,
                excludedIds: excludedIds // Envia a lista de exclusão
            })
        });

        if (!response.ok) {
            // Tenta renovar o token se for erro de autenticação (401)
            if (response.status === 401 && refreshToken && await renewAccessToken()) {
                // Tenta a busca novamente após a renovação
                return await performArtistSearch(query, excludedIds);
            }
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro desconhecido na pesquisa.');
        }

        const data = await response.json();
        
        currentArtistId = data.artist.id; // Salva o ID do artista encontrado
        artistName = data.artist.name;

        // 1. Mostrar informações do artista
        artistImage.src = data.artist.image || 'https://via.placeholder.com/80?text=PS'; // Placeholder limpo
        artistNameEl.textContent = artistName;
        artistFollowersEl.textContent = formatNumber(data.artist.followers);
        artistInfoContainer.classList.remove('hidden');

        // 2. Mostrar botões de confirmação/refino
        artistConfirmationButtons.classList.remove('hidden');
        searchStatus.className = 'status-message info-message';
        searchStatus.textContent = `Encontramos ${artistName}. É esse o artista que você procurava?`;


    } catch (error) {
        console.error('Erro na pesquisa:', error);
        searchStatus.className = 'status-message error-message';
        searchStatus.textContent = error.message || 'Erro ao buscar dados. Tente logar novamente.';
    }
};

// 3. Busca as músicas e playlists (chamada após a confirmação)
const fetchTracksAndPlaylists = async () => {
    try {
        const response = await fetch(`${BASE_URL}/api/search-artist-details`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                artistId: currentArtistId,
                accessToken: accessToken,
                artistName: artistName
            })
        });

        if (!response.ok) {
            // Tenta renovar o token se for erro de autenticação (401)
            if (response.status === 401 && refreshToken && await renewAccessToken()) {
                // Tenta a busca novamente após a renovação
                return await fetchTracksAndPlaylists();
            }
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro desconhecido ao obter detalhes.');
        }

        const data = await response.json();

        // 1. Preencher lista de playlists (opções)
        populatePlaylistSelect(data.playlists);

        // 2. Preencher lista de músicas (com checkbox)
        populateTracksList(data.tracks);
        
        // --- LÓGICA DE SUGESTÃO DE NOME ---
        const suggestedName = `Playlist de ${artistName}`; // Nome limpo
        
        playlistNameSuggestion.querySelector('.suggestion-name').textContent = `"${suggestedName}"`;
        playlistNameSuggestion.classList.remove('hidden');
        
        playlistNameSuggestion.dataset.suggestedName = suggestedName;
        
        if (playlistDestinationSelect.value === 'new') {
            newPlaylistNameContainer.classList.remove('hidden');
        }
        // --- FIM LÓGICA DE SUGESTÃO DE NOME ---

        playlistCreatorSection.classList.remove('hidden');
        searchStatus.className = 'status-message success-message';
        searchStatus.textContent = `Artista ${artistName} confirmado. Músicas e participações listadas abaixo.`;

    } catch (error) {
        console.error('Erro nos detalhes do artista:', error);
        searchStatus.className = 'status-message error-message';
        searchStatus.textContent = error.message || 'Erro ao buscar detalhes do artista.';
    }
}

// Função para preencher o SELECT de playlists existentes
const populatePlaylistSelect = (playlists) => {
    existingPlaylistSelect.innerHTML = '<option value="">-- Selecione uma Playlist Existente --</option>';
    playlists.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name} (${p.tracks.total} músicas)`;
        existingPlaylistSelect.appendChild(option);
    });
};

// public/script.js - Função Atualizada para mostrar todas as informações
const populateTracksList = (tracks) => {
    tracksList.innerHTML = '';
    if (tracks.length === 0) {
        tracksList.innerHTML = '<p class="placeholder-text">Nenhuma música encontrada para este artista e suas participações.</p>';
        return;
    }

    tracks.forEach(track => {
        const item = document.createElement('div');
        item.className = 'track-item';
        
        const label = document.createElement('label');
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = track.uri; 
        checkbox.checked = true; 
        checkbox.addEventListener('change', checkCreationButtonState); 

        const artistNames = track.artists ? track.artists.map(a => a.name).join(', ') : 'Artista Desconhecido';
        
        const trackText = document.createTextNode(`${track.name} - Artistas: ${artistNames} (Álbum: ${track.album?.name || 'N/A'})`);
        
        label.appendChild(checkbox);
        label.appendChild(trackText);
        item.appendChild(label);
        tracksList.appendChild(item);
    });
    checkCreationButtonState(); 
};

// ---------------------------------
// Funções de Criação de Playlist
// ---------------------------------

const createPlaylist = async () => {
    creationStatus.textContent = ''; 
    
    // 1. Coletar URIs das músicas selecionadas
    let selectedUris = Array.from(tracksList.querySelectorAll('input[type="checkbox"]:checked'))
                           .map(checkbox => checkbox.value);
    
    if (selectedUris.length === 0) {
        creationStatus.className = 'status-message error-message';
        creationStatus.textContent = 'Selecione pelo menos uma música para criar a playlist.';
        return;
    }

    // 2. Coletar opções
    const playlistOption = playlistDestinationSelect.value;
    const targetPlaylistId = existingPlaylistSelect.value;
    const newPlaylistName = newPlaylistNameInput.value.trim(); 

    // Validação do Nome da Nova Playlist
    if (playlistOption === 'new' && newPlaylistName.length === 0) {
        creationStatus.className = 'status-message error-message';
        creationStatus.textContent = 'Por favor, digite ou clique na sugestão para dar um nome para a nova playlist.';
        createPlaylistBtn.disabled = false;
        return;
    }

    if (playlistOption === 'existing' && !targetPlaylistId) {
        creationStatus.className = 'status-message error-message';
        creationStatus.textContent = 'Selecione uma playlist existente ou escolha a opção "Criar Nova Playlist".';
        return;
    }

    createPlaylistBtn.disabled = true;
    creationStatus.className = 'status-message info-message';
    creationStatus.textContent = 'Processando... Criando e adicionando músicas à sua playlist no Spotify.';

    try {
        const response = await fetch(`${BASE_URL}/api/create-playlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: accessToken,
                artistName: artistName, 
                trackUris: selectedUris,
                playlistOption: playlistOption,
                targetPlaylistId: targetPlaylistId,
                newPlaylistName: newPlaylistName 
            })
        });

        if (!response.ok) {
            // Tenta renovar o token se for erro de autenticação (401)
            if (response.status === 401 && refreshToken && await renewAccessToken()) {
                // Tenta a chamada novamente após a renovação
                return await createPlaylist();
            }
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro desconhecido na criação.');
        }
        
        const data = await response.json();
        
        creationStatus.className = 'status-message success-message';
        const action = playlistOption === 'new' ? 'Playlist Criada' : 'Atualizada';
        creationStatus.innerHTML = `${action} com sucesso! NOME: ${data.playlistName}.<br>Abra seu Spotify para conferir!`;
        
        if (playlistOption === 'new') {
             fetchTracksAndPlaylists(); 
        }

    } catch (error) {
        console.error('Erro ao criar playlist:', error);
        creationStatus.className = 'status-message error-message';
        creationStatus.textContent = error.message || 'Erro desconhecido ao processar playlist.';
    } finally {
        createPlaylistBtn.disabled = false;
    }
};

// ---------------------------------
// Adicionar Listeners e Inicializar
// ---------------------------------

// LÓGICA DE CONTROLE DE MÚSICA DE FUNDO
musicToggleButton.addEventListener('click', () => {
    if (audioPlayer) {
        audioPlayer.muted = !audioPlayer.muted;
        localStorage.setItem('music_muted', audioPlayer.muted);
        updateMusicButton();

        // Tenta dar play se desmutado (para superar bloqueio de autoplay)
        if (!audioPlayer.muted) {
            audioPlayer.play().catch(e => console.warn('Autoplay bloqueado. Clique necessário.'));
        }
    }
});

// Inicialização de áudio (chamada após DOMContentLoaded)
const initAudio = () => {
    if (audioPlayer) {
        audioPlayer.volume = 0.2; // Volume baixo
        
        // Carrega o estado de mute do Local Storage
        audioPlayer.muted = (localStorage.getItem('music_muted') === 'true');
        updateMusicButton();

        // Tenta dar play inicial (pode ser bloqueado pelo navegador)
        if (!audioPlayer.muted) {
            audioPlayer.play().catch(e => console.warn('Autoplay bloqueado.'));
        }
    }
};


// Inicializar a autenticação e Áudio ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initAudio();
});

// Listener do botão de pesquisa
searchButton.addEventListener('click', searchArtist);
artistSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchArtist();
    }
});

// Listener do botão de criação de playlist
createPlaylistBtn.addEventListener('click', createPlaylist);

// NOVO: Listener do botão de logout
logoutBtn.addEventListener('click', logout);

// NOVO: Listener para preenchimento da sugestão de nome
playlistNameSuggestion.addEventListener('click', () => {
    const suggestedName = playlistNameSuggestion.dataset.suggestedName;
    if (suggestedName) {
        newPlaylistNameInput.value = suggestedName;
        checkCreationButtonState(); 
    }
});


// NOVO: Listeners para o fluxo de confirmação
confirmArtistBtn.addEventListener('click', async () => {
    artistConfirmationButtons.classList.add('hidden');
    searchStatus.className = 'status-message info-message';
    searchStatus.textContent = `Buscando todas as músicas de ${artistName}...`;
    
    await fetchTracksAndPlaylists();
});

refineSearchBtn.addEventListener('click', async () => {
    if (currentArtistId) {
        excludedArtistIds.push(currentArtistId);
    }
    
    artistInfoContainer.classList.add('hidden');
    artistConfirmationButtons.classList.add('hidden');
    playlistCreatorSection.classList.add('hidden'); 
    searchStatus.className = 'status-message info-message';
    searchStatus.textContent = `Artista ${artistName} rejeitado. Buscando o próximo artista...`;

    await performArtistSearch(currentSearchQuery, excludedArtistIds);
});