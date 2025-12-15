// script.js
// IMPORTANTE: Este script usa `axios` que é definido no backend. 
// Para que a comunicação com o backend funcione, estamos usando `fetch` ou `axios` 
// que são nativos no navegador, mas o servidor Express deve estar rodando!

// Variáveis de estado global
let accessToken = null;
let currentArtistId = null;   // NOVO: ID do artista atualmente exibido
let artistName = null;
let currentSearchQuery = ''; // NOVO: Armazena o termo de pesquisa
let excludedArtistIds = []; // NOVO: Lista de IDs de artistas rejeitados
// Variável para a URL do servidor (necessário para o axios no frontend)
const BASE_URL = window.location.origin;

// Elementos DOM (Mantidos para fins de clareza)
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

// NOVOS ELEMENTOS DOM PARA CONFIRMAÇÃO
const confirmArtistBtn = document.getElementById('confirm-artist-btn'); 
const refineSearchBtn = document.getElementById('refine-search-btn');   
const artistConfirmationButtons = document.getElementById('artist-confirmation-buttons'); 


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


// Lógica para mostrar/esconder a seleção de playlists existentes
playlistDestinationSelect.addEventListener('change', (e) => {
    if (e.target.value === 'existing') {
        existingPlaylistSelect.classList.remove('hidden');
        checkCreationButtonState(); 
    } else {
        existingPlaylistSelect.classList.add('hidden');
        checkCreationButtonState(); 
    }
});

// Habilita/Desabilita o botão Criar Playlist
const checkCreationButtonState = () => {
    const selectedTracks = tracksList.querySelectorAll('input[type="checkbox"]:checked').length;
    const isExistingMode = playlistDestinationSelect.value === 'existing';
    // O botão deve ser desabilitado se estiver no modo 'existing' e nenhuma playlist foi selecionada
    const isPlaylistSelected = existingPlaylistSelect.value !== ''; 

    if (selectedTracks > 0 && 
       (!isExistingMode || (isExistingMode && isPlaylistSelected))) {
        createPlaylistBtn.disabled = false;
    } else {
        createPlaylistBtn.disabled = true;
    }
};

// Adiciona listener para a seleção de playlists (para habilitar o botão)
existingPlaylistSelect.addEventListener('change', checkCreationButtonState);
// Adiciona listener para as músicas selecionadas (a lista de músicas é populada depois)

// ---------------------------------
// Funções de Autenticação
// ---------------------------------

// Função que processa o retorno do /callback (tokens na URL)
const getTokensFromHash = () => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    const token = params.get('access_token');
    const error = params.get('error');

    if (error) {
        document.getElementById('login-error').textContent = `Erro de Login: ${error}. Tente novamente.`;
        return null;
    }

    if (token) {
        // Armazenar o token temporariamente
        localStorage.setItem('spotify_access_token', token);
        // Limpar a URL (para segurança e estética)
        window.history.pushState("", document.title, window.location.pathname + window.location.search);
        return token;
    }
    return null;
};

// Inicialização: Verifica se o usuário está logado
const initAuth = () => {
    // 1. Tenta pegar token da URL hash (vindo do /callback)
    accessToken = getTokensFromHash();

    // 2. Se não estiver na URL, tenta pegar do localStorage
    if (!accessToken) {
        accessToken = localStorage.getItem('spotify_access_token');
    }
    
    if (accessToken) {
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        fetchUserProfile(accessToken);
    } else {
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
        const response = await fetch('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        userInfoEl.textContent = data.display_name || data.id;
    } catch (error) {
        console.error('Erro ao buscar perfil:', error);
        // Se falhar, o token provavelmente expirou. Limpar e forçar novo login.
        localStorage.removeItem('spotify_access_token');
        // Não chame initAuth, apenas redirecione para o login
        window.location.href = '/login'; 
    }
};

// -----------------------------------------------------
// FUNÇÕES DE PESQUISA (NOVAS: 1. Busca Artista, 2. Confirma, 3. Busca Detalhes)
// -----------------------------------------------------

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
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro desconhecido na pesquisa.');
        }

        const data = await response.json();
        
        currentArtistId = data.artist.id; // Salva o ID do artista encontrado
        artistName = data.artist.name;

        // 1. Mostrar informações do artista
        artistImage.src = data.artist.image || 'https://via.placeholder.com/80?text=SPFC';
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
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro desconhecido ao obter detalhes.');
        }

        const data = await response.json();

        // 1. Preencher lista de playlists (opções)
        populatePlaylistSelect(data.playlists);

        // 2. Preencher lista de músicas (com checkbox)
        populateTracksList(data.tracks);
        
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
// Função para preencher a lista de faixas
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
        checkbox.value = track.uri; // URI é o identificador do Spotify
        checkbox.checked = true; // Por padrão, todas vêm marcadas
        checkbox.addEventListener('change', checkCreationButtonState); 

        // Formata a lista de artistas para mostrar quem participou
        const artistNames = track.artists ? track.artists.map(a => a.name).join(', ') : 'Artista Desconhecido';
        
        // Nome da faixa + Artistas + Nome do Álbum
        const trackText = document.createTextNode(`${track.name} - Artistas: ${artistNames} (Álbum: ${track.album?.name || 'N/A'})`);
        
        label.appendChild(checkbox);
        label.appendChild(trackText);
        item.appendChild(label);
        tracksList.appendChild(item);
    });
    checkCreationButtonState(); // Verifica o estado do botão ao carregar a lista
};

// ---------------------------------
// Funções de Criação de Playlist
// ---------------------------------

const createPlaylist = async () => {
    creationStatus.textContent = ''; // Limpa status anterior
    
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
                targetPlaylistId: targetPlaylistId
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro desconhecido na criação.');
        }
        
        const data = await response.json();
        
        creationStatus.className = 'status-message success-message';
        const action = playlistOption === 'new' ? 'Criada' : 'Atualizada';
        creationStatus.innerHTML = `${action} com sucesso! ID: ${data.playlistId}.<br>Abra seu Spotify para conferir!`;
        
        // Se a playlist foi criada, recarregar as playlists do usuário
        if (playlistOption === 'new') {
             // O ideal seria chamar performArtistSearch, mas para simplificar,
             // vamos apenas buscar o artista novamente para atualizar as playlists
             searchArtist(); 
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

// Inicializar a autenticação ao carregar a página
document.addEventListener('DOMContentLoaded', initAuth);

// Listener do botão de pesquisa
searchButton.addEventListener('click', searchArtist);
artistSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchArtist();
    }
});

// Listener do botão de criação de playlist
createPlaylistBtn.addEventListener('click', createPlaylist);

// NOVO: Listeners para o fluxo de confirmação
confirmArtistBtn.addEventListener('click', async () => {
    // 1. Esconde os botões de confirmação
    artistConfirmationButtons.classList.add('hidden');
    searchStatus.className = 'status-message info-message';
    searchStatus.textContent = `Buscando todas as músicas de ${artistName}...`;
    
    // 2. Chama a busca de músicas
    await fetchTracksAndPlaylists();
});

refineSearchBtn.addEventListener('click', async () => {
    // 1. Adiciona o ID do artista rejeitado à lista de exclusão
    if (currentArtistId) {
        excludedArtistIds.push(currentArtistId);
    }
    
    // 2. Volta para o estado inicial para buscar o próximo artista
    artistInfoContainer.classList.add('hidden');
    artistConfirmationButtons.classList.add('hidden');
    playlistCreatorSection.classList.add('hidden'); // Esconde a seção de músicas
    searchStatus.className = 'status-message info-message';
    searchStatus.textContent = `Artista ${artistName} rejeitado. Buscando o próximo artista...`;

    // 3. Tenta a busca novamente com a nova lista de exclusão
    await performArtistSearch(currentSearchQuery, excludedArtistIds);
});