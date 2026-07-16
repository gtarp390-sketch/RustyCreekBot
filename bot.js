const dgram = require('dgram');
const {
    Client,
    GatewayIntentBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// ===================== НАСТРОЙКИ =====================
const TOKEN = 'MTExMTIxNzkzNjE4Nzc5MzQ5OA.GlU2QQ.6D9OSfqSlLSkbrPH7Uts0fCGljiiw3OzbYOo2g';
const GUILD_ID = '1503811091933954189';

const RADIO_CHANNEL_ID = '1511031606209417358';
const STATUS_LOG_CHANNEL_ID = '1503814248009302166';

// ID каналов для автообновления статуса сервера
const ONLINE_CHANNEL_ID = '1510679770302513364';    // Канал "Онлайн"
const STATUS_SERVER_CHANNEL_ID = '1510679960530981075'; // Канал "Статус сервера" (🟢/🔴)

const DEFAULT_PUBLISH_CHANNEL = '1504118751769923594';

const SERVER_IP = '89.248.236.141';
const SERVER_PORT = 27416;
const MAX_PLAYERS = 40;
const STATUS_CHECK_INTERVAL_MS = 300000;
const OFFLINE_FAILURE_THRESHOLD = 3;

// Тикеты
const TICKET_CATEGORY_ID = '1503813967817216001';
const TICKET_STAFF_ROLES = [
    '1503818319575257149',
    '1503817714374934629',
    '1503816415600443493',
    '1503816740814061708'
];
const TICKET_PING_ROLE_ID = '1503819059337101332';
const TICKET_CLOSE_CONFIRM_MESSAGE = 'Вы точно хотите закрыть тикет?';
const TICKET_CLOSED_MESSAGE_PREFIX = 'Тикет закрыт ';

// Категории тикетов
const TICKET_CATEGORIES = [
    { id: 'support', name: 'Поддержка', description: 'Техническая поддержка и помощь' },
    { id: 'whitelist', name: 'Вайтлист', description: 'Заявка на вайтлист сервера' },
    { id: 'complaint', name: 'Жалоба', description: 'Подать жалобу на игрока' }
];

// ===================== STEAM QUERY =====================
function readString(buffer, offset) {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0x00) end++;
    return { value: buffer.toString('utf8', offset, end), offset: end + 1 };
}

function parseInfo(buffer) {
    let offset = 0;
    const header = buffer.readInt32LE(offset); offset += 4;
    if (header !== -1) throw new Error('Ответ разделён на части (нужен split handling)');
    const type = buffer.readUInt8(offset); offset += 1;
    if (type === 0x41) return { challenge: buffer.slice(offset, offset + 4) };
    if (type !== 0x49) throw new Error(`Неожиданный тип ответа: 0x${type.toString(16)}`);
    
    // A2S_INFO формат (Source engine, type 0x49):
    // Protocol(1) | ServerName(str) | Map(str) | Folder(str) | Game(str) | AppID(2) | Players(1) | MaxPlayers(1) ...
    offset += 1; // Protocol byte
    let r;
    r = readString(buffer, offset); offset = r.offset; // ServerName
    r = readString(buffer, offset); offset = r.offset; // Map
    r = readString(buffer, offset); offset = r.offset; // Folder
    r = readString(buffer, offset); offset = r.offset; // Game
    offset += 2; // SteamAppID (uint16 LE)
    const players = buffer.readUInt8(offset); offset += 1;
    const maxPlayers = buffer.readUInt8(offset); offset += 1;
    
    // Дополнительные поля (для логирования/debug)
    const bots = buffer.readUInt8(offset); offset += 1;
    const serverType = String.fromCharCode(buffer.readUInt8(offset)); offset += 1;
    const environment = String.fromCharCode(buffer.readUInt8(offset)); offset += 1;
    const visibility = buffer.readUInt8(offset); offset += 1;
    const vac = buffer.readUInt8(offset); offset += 1;
    
    // Версия сервера (string) — читаем для корректного смещения
    r = readString(buffer, offset); offset = r.offset;
    
    // EDF (Extra Data Flag) — может содержать дополнительные поля
    if (offset < buffer.length) {
        const edf = buffer.readUInt8(offset); offset += 1;
        // Port (если флаг 0x80)
        if (edf & 0x80 && offset + 2 <= buffer.length) {
            offset += 2; // gamePort
        }
        // SteamID (если флаг 0x10) — 8 байт
        if (edf & 0x10 && offset + 8 <= buffer.length) {
            offset += 8;
        }
        // Source TV port + name (если флаг 0x40)
        if (edf & 0x40 && offset < buffer.length) {
            offset += 2; // tvPort
            r = readString(buffer, offset); offset = r.offset; // tvName
        }
        // Keywords (если флаг 0x20)
        if (edf & 0x20 && offset < buffer.length) {
            r = readString(buffer, offset); offset = r.offset;
        }
        // GameID (если флаг 0x01) — 8 байт
        if (edf & 0x01 && offset + 8 <= buffer.length) {
            offset += 8;
        }
    }
    
    return { players, maxPlayers, bots, serverType, environment };
}

function sendQuery(socket, challenge = null) {
    const base = Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
        Buffer.from('Source Engine Query\0', 'ascii')
    ]);
    const packet = challenge ? Buffer.concat([base, challenge]) : base;
    socket.send(packet, 0, packet.length, SERVER_PORT, SERVER_IP);
}

function queryServer() {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        const timeout = setTimeout(() => { socket.close(); reject(new Error('Сервер не ответил')); }, 7000);
        socket.on('error', err => { clearTimeout(timeout); socket.close(); reject(err); });
        socket.on('message', msg => {
            try {
                const parsed = parseInfo(msg);
                if (parsed.challenge) { sendQuery(socket, parsed.challenge); return; }
                clearTimeout(timeout);
                socket.close();
                resolve(parsed);
            } catch (err) {
                clearTimeout(timeout);
                socket.close();
                reject(err);
            }
        });
        sendQuery(socket);
    });
}

// A2S_PLAYER — запрос списка игроков для точного онлайна
function queryPlayers() {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        const timeout = setTimeout(() => { socket.close(); reject(new Error('A2S_PLAYER таймаут')); }, 5000);
        
        // Сначала получаем challenge число через A2S_PLAYER запрос без challenge
        const requestChallenge = Buffer.concat([
            Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55]),
            Buffer.from([0xff, 0xff, 0xff, 0xff])
        ]);
        
        socket.on('error', err => { clearTimeout(timeout); socket.close(); reject(err); });
        socket.on('message', msg => {
            try {
                const header = msg.readInt32LE(0);
                const type = msg.readUInt8(4);
                
                if (type === 0x41) {
                    // Получили challenge — отправляем повторный запрос с challenge
                    const challengeNum = msg.slice(5, 9);
                    const requestWithChallenge = Buffer.concat([
                        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55]),
                        challengeNum
                    ]);
                    socket.send(requestWithChallenge, 0, requestWithChallenge.length, SERVER_PORT, SERVER_IP);
                    return;
                }
                
                if (type === 0x44) {
                    // A2S_PLAYER ответ
                    clearTimeout(timeout);
                    const playerCount = msg.readUInt8(5);
                    const players = [];
                    let offset = 6;
                    for (let i = 0; i < playerCount && offset < msg.length; i++) {
                        offset += 1; // index byte
                        // Имя игрока (null-terminated string)
                        let nameEnd = offset;
                        while (nameEnd < msg.length && msg[nameEnd] !== 0x00) nameEnd++;
                        const name = msg.toString('utf8', offset, nameEnd);
                        offset = nameEnd + 1;
                        // Score (int32 LE) и Duration (float32 LE)
                        if (offset + 8 <= msg.length) {
                            const score = msg.readInt32LE(offset); offset += 4;
                            const duration = msg.readFloatLE(offset); offset += 4;
                            players.push({ name, score, duration });
                        }
                    }
                    socket.close();
                    resolve({ playerCount, players });
                } else {
                    clearTimeout(timeout);
                    socket.close();
                    reject(new Error(`Неожиданный тип A2S_PLAYER: 0x${type.toString(16)}`));
                }
            } catch (err) {
                clearTimeout(timeout);
                socket.close();
                reject(err);
            }
        });
        
        socket.send(requestChallenge, 0, requestChallenge.length, SERVER_PORT, SERVER_IP);
    });
}

// ===================== ОБНОВЛЕНИЕ СТАТУСА СЕРВЕРА =====================
// Discord rate limit: 2 rename per channel per 10 min — обновляем только при изменении!
let lastOnlineName = '';
let lastStatusName = '';
let serverStatusMessageId = null;
let isStatusUpdateRunning = false;

const serverStatusState = {
    isOnline: null,
    failureCount: 0,
    lastSuccessAt: null,
    lastChangeAt: null,
    lastKnownOnline: 0,
    lastKnownMax: MAX_PLAYERS,
    lastInfoOnline: 0,
    lastSource: 'A2S_INFO',
    lastError: null
};

function formatDateTime(date) {
    if (!date) return '—';
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Asia/Tomsk',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(date);
}

function getStatusTextChannel(guild) {
    const channel = guild.channels.cache.get(STATUS_LOG_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel;
}

async function getOrCreateStatusMessage(channel) {
    if (serverStatusMessageId) {
        try {
            return await channel.messages.fetch(serverStatusMessageId);
        } catch (e) {
            serverStatusMessageId = null;
        }
    }

    try {
        const messages = await channel.messages.fetch({ limit: 20 });
        const existing = messages.find(msg =>
            msg.author?.id === client.user.id &&
            (msg.content?.includes('# Статистика сервера') || msg.embeds?.[0]?.data?.title === 'Статус сервера Rusty Creek')
        );

        if (existing) {
            serverStatusMessageId = existing.id;
            return existing;
        }
    } catch (e) {
        console.error('[Статус] Не удалось получить историю статус-канала:', e.message);
    }

    const created = await channel.send({
        content: '# Статистика сервера\n\n_Сейчас игроков онлайн:_ **0/30**\n\n_Последнее изменение: только что_'
    });

    serverStatusMessageId = created.id;
    return created;
}

function buildStatusMessageContent() {
    const onlineText = `${serverStatusState.lastKnownOnline}/${serverStatusState.lastKnownMax}`;
    const lastChangeUnix = serverStatusState.lastChangeAt
        ? Math.floor(serverStatusState.lastChangeAt.getTime() / 1000)
        : Math.floor(Date.now() / 1000);

    return `# Статистика сервера\n\n_Сейчас игроков онлайн:_ **${onlineText}**\n\n_Последнее изменение <t:${lastChangeUnix}:R>_`;
}

async function syncStatusMessage(guild) {
    const statusTextChannel = getStatusTextChannel(guild);
    if (!statusTextChannel) return;

    try {
        const statusMessage = await getOrCreateStatusMessage(statusTextChannel);
        await statusMessage.edit({ content: buildStatusMessageContent(), embeds: [] });
    } catch (e) {
        console.error('[Статус] Не удалось обновить статусное сообщение:', e.message);
    }
}

async function syncVoiceChannels(guild, online, max, isOnline) {
    const onlineChannel = guild.channels.cache.get(ONLINE_CHANNEL_ID);
    const statusChannel = guild.channels.cache.get(STATUS_SERVER_CHANNEL_ID);

    const newOnlineName = `👥 Онлайн: ${online}/${max}`;
    const newStatusName = isOnline ? '🟢 Сервер' : '🔴 Сервер';

    if (onlineChannel && onlineChannel.name !== newOnlineName) {
        try {
            await onlineChannel.setName(newOnlineName);
            lastOnlineName = newOnlineName;
        } catch (e) {
            console.error('[Статус] Rate limit на setName (онлайн):', e.message);
        }
    }

    if (statusChannel && statusChannel.name !== newStatusName) {
        try {
            await statusChannel.setName(newStatusName);
            lastStatusName = newStatusName;
        } catch (e) {
            console.error('[Статус] Rate limit на setName (статус):', e.message);
        }
    }
}

async function fetchServerStatusData() {
    const server = await queryServer();
    let online = server.players ?? 0;
    const max = server.maxPlayers || MAX_PLAYERS;
    let source = 'A2S_INFO';

    try {
        const playerData = await queryPlayers();
        if (playerData && playerData.playerCount !== undefined) {
            online = playerData.playerCount;
            source = 'A2S_PLAYER';
        }
    } catch (e) {
        console.log(`[Статус] A2S_PLAYER недоступен, используем A2S_INFO: ${online}`);
    }

    return {
        online,
        max,
        infoOnline: server.players ?? 0,
        source
    };
}

async function applyOnlineState(guild, data) {
    const wasOnline = serverStatusState.isOnline === true;

    serverStatusState.failureCount = 0;
    serverStatusState.lastSuccessAt = new Date();
    serverStatusState.lastKnownOnline = data.online;
    serverStatusState.lastKnownMax = data.max;
    serverStatusState.lastInfoOnline = data.infoOnline;
    serverStatusState.lastSource = data.source;
    serverStatusState.lastError = null;

    if (serverStatusState.isOnline !== true) {
        serverStatusState.isOnline = true;
        serverStatusState.lastChangeAt = new Date();
    }

    await syncVoiceChannels(guild, data.online, data.max, true);
    await syncStatusMessage(guild);

    if (!wasOnline) {
        console.log(`[Статус] Сервер снова онлайн: ${data.online}/${data.max}`);
    } else {
        console.log(`[Статус] Онлайн: ${data.online}/${data.max} (${data.source}, A2S_INFO: ${data.infoOnline}) | Сервер: 🟢`);
    }
}

async function applyOfflineState(guild, err) {
    const wasOnline = serverStatusState.isOnline === true;

    serverStatusState.failureCount += 1;
    serverStatusState.lastError = err.message || String(err);

    if (serverStatusState.failureCount < OFFLINE_FAILURE_THRESHOLD) {
        console.warn(`[Статус] Ошибка проверки ${serverStatusState.failureCount}/${OFFLINE_FAILURE_THRESHOLD}: ${serverStatusState.lastError}`);
        await syncStatusMessage(guild);
        return;
    }

    serverStatusState.lastKnownOnline = 0;
    serverStatusState.lastKnownMax = MAX_PLAYERS;
    serverStatusState.lastSource = 'Недоступно';

    if (serverStatusState.isOnline !== false) {
        serverStatusState.isOnline = false;
        serverStatusState.lastChangeAt = new Date();
    }

    await syncVoiceChannels(guild, 0, MAX_PLAYERS, false);
    await syncStatusMessage(guild);

    if (wasOnline || serverStatusState.failureCount === OFFLINE_FAILURE_THRESHOLD) {
        console.error(`[Статус] Сервер переведён в оффлайн после ${serverStatusState.failureCount} ошибок подряд: ${serverStatusState.lastError}`);
    }
}

async function updateServerStatus() {
    if (isStatusUpdateRunning) {
        console.log('[Статус] Пропуск проверки: предыдущая ещё выполняется.');
        return;
    }

    isStatusUpdateRunning = true;

    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return;

        const data = await fetchServerStatusData();
        await applyOnlineState(guild, data);
    } catch (err) {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
            await applyOfflineState(guild, err);
        } else {
            console.error('[Статус] Сервер недоступен, а guild не найден:', err.message);
        }
    } finally {
        isStatusUpdateRunning = false;
    }
}

async function hasRecentDuplicateRadioMessage(channel, title, description) {
    try {
        const messages = await channel.messages.fetch({ limit: 5 });
        const duplicate = messages.find(msg => {
            const embed = msg.embeds?.[0];
            const createdRecently = Date.now() - msg.createdTimestamp < 15000;

            return msg.author?.id === client.user.id &&
                createdRecently &&
                embed?.title === title &&
                embed?.description === description;
        });

        return Boolean(duplicate);
    } catch (e) {
        console.error('[Радио] Не удалось проверить дубли:', e.message);
        return false;
    }
}

// ===================== ОБРАБОТКА КОМАНД =====================
client.on('interactionCreate', async interaction => {

    // ───────────────────────────────────────────
    // /radio
    // ───────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'radio') {
        const modal = new ModalBuilder()
            .setCustomId('modal_radio')
            .setTitle('Радиосвязь');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('radio_freq')
                    .setLabel('Частота')
                    .setPlaceholder('Например: 89 mHz')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('radio_text')
                    .setLabel('Сообщение')
                    .setPlaceholder('Текст радиосообщения...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return;
    }

    // ───────────────────────────────────────────
    // /news
    // ───────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'news') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'У вас нет доступа к этой команде.', flags: 64 });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('modal_news')
            .setTitle('IC Новость');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('news_title').setLabel('Заголовок').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('news_text').setLabel('Текст новости').setStyle(TextInputStyle.Paragraph).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('news_channel').setLabel('ID канала').setPlaceholder('ПКМ → Копировать ID').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return;
    }

    // ───────────────────────────────────────────
    // /announce
    // ───────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'announce') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'У вас нет доступа к этой команде.', flags: 64 });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('modal_announce')
            .setTitle('Объявление сервера');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('announce_title').setLabel('Заголовок').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('announce_text').setLabel('Текст').setStyle(TextInputStyle.Paragraph).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('announce_channel').setLabel('ID канала').setPlaceholder('ПКМ → Копировать ID').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return;
    }

    // ───────────────────────────────────────────
    // /say
    // ───────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'say') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'У вас нет доступа к этой команде.', flags: 64 });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('modal_say')
            .setTitle('Сообщение от бота');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('say_title').setLabel('Заголовок').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('say_text').setLabel('Текст сообщения').setStyle(TextInputStyle.Paragraph).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('say_channel').setLabel('ID канала').setPlaceholder('ПКМ → Копировать ID').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return;
    }

    // ───────────────────────────────────────────
    // /status
    // ───────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'status') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'У вас нет доступа к этой команде.', flags: 64 });
            return;
        }
        const select = new StringSelectMenuBuilder()
            .setCustomId('select_status')
            .setPlaceholder('Выберите статус сервера...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Сервер запущен').setValue('online').setDescription('Сервер работает в штатном режиме'),
                new StringSelectMenuOptionBuilder().setLabel('Сервер перезапускается').setValue('restarting').setDescription('Идёт перезапуск'),
                new StringSelectMenuOptionBuilder().setLabel('Ежедневный рестарт').setValue('daily').setDescription('Плановый рестарт'),
                new StringSelectMenuOptionBuilder().setLabel('Сервер выключен').setValue('offline').setDescription('Сервер недоступен')
            );
        await interaction.reply({
            content: 'Выберите статус:',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: 64
        });
        return;
    }

    // ───────────────────────────────────────────
    // /tickets_admin — публикует панель тикетов
    // ───────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'tickets_admin') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'У вас нет доступа к этой команде.', flags: 64 });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('Система тикетов')
            .setDescription('Выберите категорию вашего обращения');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_category_select')
            .setPlaceholder('Выберите категорию...')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Поддержка')
                    .setValue('support')
                    .setDescription('Техническая поддержка и помощь'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Вайтлист')
                    .setValue('whitelist')
                    .setDescription('Заявка на вайтлист сервера'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Жалоба')
                    .setValue('complaint')
                    .setDescription('Подать жалобу на игрока')
            );

        await interaction.channel.send({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });

        await interaction.reply({ content: 'Панель тикетов опубликована.', flags: 64 });
        return;
    }

    // ───────────────────────────────────────────
    // /publish — красивая публикация
    // ───────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'publish') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'У вас нет доступа к этой команде.', flags: 64 });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('modal_publish')
            .setTitle('Публикация');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('publish_title')
                    .setLabel('Заголовок')
                    .setPlaceholder('Введите заголовок...')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('publish_description')
                    .setLabel('Описание')
                    .setPlaceholder('Текст сообщения (поддерживает **жирный**, *курсив*, переносы)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('publish_image')
                    .setLabel('URL картинки (необязательно)')
                    .setPlaceholder('https://example.com/image.png')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('publish_color')
                    .setLabel('Цвет (HEX, например: ff0000)')
                    .setPlaceholder('ff0000 — красный, 00ff00 — зелёный, 2b2d31 — тёмный')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('publish_channel')
                    .setLabel('ID канала')
                    .setPlaceholder(`По умолчанию: ${DEFAULT_PUBLISH_CHANNEL}`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return;
    }

    // ───────────────────────────────────────────
    // Выбор категории тикета
    // ───────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
        const category = interaction.values[0];
        const categoryInfo = TICKET_CATEGORIES.find(c => c.id === category);
        
        const modal = new ModalBuilder()
            .setCustomId(`modal_ticket_${category}`)
            .setTitle(`${categoryInfo.name}`);

        const components = [
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ticket_nick')
                    .setLabel('Ваш игровой никнейм')
                    .setPlaceholder('Например: RustyPlayer')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ticket_description')
                    .setLabel('Описание проблемы')
                    .setPlaceholder('Опишите вашу проблему как можно подробнее')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            )
        ];

        if (category === 'complaint') {
            components.push(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('ticket_target')
                        .setLabel('Игрок, на которого жалуетесь')
                        .setPlaceholder('Никнейм нарушителя')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            );
        }

        if (category === 'whitelist') {
            components.push(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('ticket_steam')
                        .setLabel('Steam ID (ссылка на профиль)')
                        .setPlaceholder('https://steamcommunity.com/profiles/xxx')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            );
        }

        modal.addComponents(...components);
        await interaction.showModal(modal);
        return;
    }

    // ───────────────────────────────────────────
    // Кнопка "Закрыть тикет"
    // ───────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'ticket_close') {
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_close_confirm')
                .setLabel('Да, закрыть тикет')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket_close_cancel')
                .setLabel('Отмена')
                .setStyle(ButtonStyle.Secondary)
        );

        const recentMessages = await interaction.channel.messages.fetch({ limit: 20 });
        const confirmMessages = recentMessages.filter(msg =>
            msg.author?.id === client.user.id &&
            msg.content === TICKET_CLOSE_CONFIRM_MESSAGE &&
            msg.components?.length
        );

        const [firstConfirm, ...extraConfirms] = [...confirmMessages.values()];

        for (const msg of extraConfirms) {
            await msg.delete().catch(() => {});
        }

        await interaction.deferUpdate();

        if (!firstConfirm) {
            await interaction.channel.send({
                content: TICKET_CLOSE_CONFIRM_MESSAGE,
                components: [confirmRow]
            });
        }

        return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket_close_cancel') {
        await interaction.deferUpdate();
        await interaction.message.delete().catch(() => {});
        return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket_close_confirm') {
        const channel = interaction.channel;
        const member = interaction.member;
        const isAdminCloser = member?.permissions?.has(PermissionFlagsBits.Administrator);
        const closerRoleText = isAdminCloser ? 'администратором' : 'игроком';

        await interaction.deferUpdate();

        const recentMessages = await channel.messages.fetch({ limit: 20 });
        const existingClosedMessage = recentMessages.find(msg =>
            msg.author?.id === client.user.id &&
            msg.embeds?.[0]?.description?.startsWith(TICKET_CLOSED_MESSAGE_PREFIX)
        );

        if (existingClosedMessage) {
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`Тикет закрыт ${closerRoleText} <@${interaction.user.id}>.`);

        await channel.send({ embeds: [embed] });
        await interaction.message.delete().catch(() => {});

        setTimeout(() => channel.delete().catch(() => {}), 5000);
        return;
    }

    // ───────────────────────────────────────────
    // Select Menu — /status
    // ───────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_status') {
        const value = interaction.values[0];
        const statusMap = {
            online:     { title: 'Сервер запущен',             color: 0x2ecc71, text: '🟢 Онлайн' },
            restarting: { title: 'Сервер перезапускается',     color: 0xf1c40f, text: '🟡 Перезапуск' },
            daily:      { title: 'Ежедневный рестарт сервера', color: 0xf1c40f, text: '🟡 Плановый рестарт' },
            offline:    { title: 'Сервер выключен',            color: 0xe74c3c, text: '🔴 Оффлайн' }
        };
        const chosen = statusMap[value];

        const logChannel = getStatusTextChannel(interaction.guild);
        if (!logChannel) {
            await interaction.update({ content: 'Канал статуса не найден.', components: [] });
            return;
        }

        if (value === 'offline') {
            serverStatusState.isOnline = false;
            serverStatusState.lastKnownOnline = 0;
        } else {
            serverStatusState.isOnline = true;
        }

        serverStatusState.lastChangeAt = new Date();

        try {
            const statusMessage = await getOrCreateStatusMessage(logChannel);
            await statusMessage.edit({ content: buildStatusMessageContent(), embeds: [] });
        } catch (e) {
            await logChannel.send({ content: buildStatusMessageContent() });
        }

        await interaction.update({ content: `Статус обновлён: **${chosen.title}**`, components: [] });
        return;
    }

    // ───────────────────────────────────────────
    // Modal — /radio
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_radio') {
        const freq = interaction.fields.getTextInputValue('radio_freq').trim();
        const text = interaction.fields.getTextInputValue('radio_text').trim();
        const embed = new EmbedBuilder()
            .setColor(0x1a1a1a)
            .setTitle(freq)
            .setDescription(text);
        const radioChannel = interaction.guild.channels.cache.get(RADIO_CHANNEL_ID);
        if (!radioChannel) {
            await interaction.reply({ content: 'Канал радио не найден.', flags: 64 });
            return;
        }

        const hasDuplicate = await hasRecentDuplicateRadioMessage(radioChannel, freq, text);
        if (hasDuplicate) {
            await interaction.reply({ content: 'Такое радиосообщение уже было только что отправлено.', flags: 64 });
            return;
        }

        await radioChannel.send({ embeds: [embed] });
        await interaction.reply({ content: 'Сообщение отправлено в эфир.', flags: 64 });
        return;
    }

    // ───────────────────────────────────────────
    // Modal — /news
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_news') {
        const title = interaction.fields.getTextInputValue('news_title');
        const text = interaction.fields.getTextInputValue('news_text');
        const channelId = interaction.fields.getTextInputValue('news_channel').trim();
        const targetChannel = interaction.guild.channels.cache.get(channelId);
        if (!targetChannel) {
            await interaction.reply({ content: `Канал \`${channelId}\` не найден.`, flags: 64 });
            return;
        }
        const embed = new EmbedBuilder()
            .setColor(0x1a1a1a)
            .setTitle(title)
            .setDescription(text);
        await targetChannel.send({ embeds: [embed] });
        await interaction.reply({ content: `Новость опубликована в <#${channelId}>.`, flags: 64 });
        return;
    }

    // ───────────────────────────────────────────
    // Modal — /announce
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_announce') {
        const title = interaction.fields.getTextInputValue('announce_title');
        const text = interaction.fields.getTextInputValue('announce_text');
        const channelId = interaction.fields.getTextInputValue('announce_channel').trim();
        const targetChannel = interaction.guild.channels.cache.get(channelId);
        if (!targetChannel) {
            await interaction.reply({ content: `Канал \`${channelId}\` не найден.`, flags: 64 });
            return;
        }
        const embed = new EmbedBuilder()
            .setColor(0x1a1a1a)
            .setTitle(title)
            .setDescription(text);
        await targetChannel.send({ embeds: [embed] });
        await interaction.reply({ content: `Объявление опубликовано в <#${channelId}>.`, flags: 64 });
        return;
    }

    // ───────────────────────────────────────────
    // Modal — /say
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_say') {
        const title = interaction.fields.getTextInputValue('say_title');
        const text = interaction.fields.getTextInputValue('say_text');
        const channelId = interaction.fields.getTextInputValue('say_channel').trim();
        const targetChannel = interaction.guild.channels.cache.get(channelId);
        if (!targetChannel) {
            await interaction.reply({ content: `Канал \`${channelId}\` не найден.`, flags: 64 });
            return;
        }
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle(title)
            .setDescription(text);
        await targetChannel.send({ embeds: [embed] });
        await interaction.reply({ content: `Сообщение отправлено в <#${channelId}>.`, flags: 64 });
        return;
    }

    // ───────────────────────────────────────────
    // Modal — /publish
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_publish') {
        const title = interaction.fields.getTextInputValue('publish_title');
        const description = interaction.fields.getTextInputValue('publish_description') || '';
        const imageUrl = interaction.fields.getTextInputValue('publish_image')?.trim() || null;
        const colorHex = interaction.fields.getTextInputValue('publish_color')?.trim() || null;
        const channelId = interaction.fields.getTextInputValue('publish_channel')?.trim() || DEFAULT_PUBLISH_CHANNEL;

        const targetChannel = interaction.guild.channels.cache.get(channelId);
        if (!targetChannel) {
            await interaction.reply({ content: `Канал \`${channelId}\` не найден.`, flags: 64 });
            return;
        }

        let color = 0x2b2d31;
        if (colorHex) {
            const hex = colorHex.replace('#', '');
            if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
                color = parseInt(hex, 16);
            }
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description);

        if (imageUrl) {
            embed.setImage(imageUrl);
        }

        await targetChannel.send({ embeds: [embed] });
        await interaction.reply({ content: `Опубликовано в <#${channelId}>.`, flags: 64 });
        return;
    }

    // ───────────────────────────────────────────
    // Modal — тикеты (Поддержка)
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_ticket_support') {
        await createTicket(interaction, 'support');
        return;
    }

    // ───────────────────────────────────────────
    // Modal — тикеты (Вайтлист)
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_ticket_whitelist') {
        await createTicket(interaction, 'whitelist');
        return;
    }

    // ───────────────────────────────────────────
    // Modal — тикеты (Жалоба)
    // ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_ticket_complaint') {
        await createTicket(interaction, 'complaint');
        return;
    }
});

// ===================== ФУНКЦИЯ СОЗДАНИЯ ТИКЕТА =====================
async function createTicket(interaction, category) {
    const nick = interaction.fields.getTextInputValue('ticket_nick');
    const description = interaction.fields.getTextInputValue('ticket_description');
    
    let additionalInfo = '';
    let categoryEmoji = '';
    
    if (category === 'complaint') {
        const target = interaction.fields.getTextInputValue('ticket_target');
        additionalInfo = target;
        categoryEmoji = '⚠️';
    } else if (category === 'whitelist') {
        const steam = interaction.fields.getTextInputValue('ticket_steam');
        additionalInfo = steam;
        categoryEmoji = '✅';
    } else {
        categoryEmoji = '❓';
    }

    await interaction.deferReply({ flags: 64 });

    const guild = interaction.guild;
    const user = interaction.user;
    const categoryInfo = TICKET_CATEGORIES.find(c => c.id === category);

    const existing = guild.channels.cache.find(
        ch => ch.name.startsWith(`ticket-${category}-`) && 
              ch.name.includes(user.username.toLowerCase().replace(/[^a-z0-9]/g, '')) &&
              ch.parentId === TICKET_CATEGORY_ID
    );
    if (existing) {
        await interaction.editReply({ content: `У вас уже есть открытый тикет этой категории: <#${existing.id}>` });
        return;
    }

    const permissionOverwrites = [
        {
            id: guild.roles.everyone,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        }
    ];

    for (const roleId of TICKET_STAFF_ROLES) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            permissionOverwrites.push({
                id: roleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
            });
        }
    }

    const ticketChannel = await guild.channels.create({
        name: `ticket-${category}-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites
    });

    const roleMentions = `<@&${TICKET_PING_ROLE_ID}>`;

    const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(`${categoryEmoji} Тикет: ${categoryInfo.name}`)
        .addFields(
            { name: 'Пользователь', value: `${user} (\`${user.username}\`)`, inline: true },
            { name: 'Категория', value: categoryInfo.name, inline: true },
            { name: 'Игровой никнейм', value: nick, inline: true }
        )
        .addFields(
            { name: 'Описание', value: description }
        );

    if (additionalInfo) {
        if (category === 'complaint') {
            embed.addFields({ name: 'На кого жалуетесь', value: additionalInfo });
        } else if (category === 'whitelist') {
            embed.addFields({ name: 'Steam профиль', value: additionalInfo });
        }
    }

    embed.setFooter({ text: `${categoryInfo.name}` });

    const closeButton = new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Закрыть тикет')
        .setStyle(ButtonStyle.Danger);

    await ticketChannel.send({
        content: `${user} ${roleMentions}`,
        allowedMentions: {
            users: [user.id],
            roles: [TICKET_PING_ROLE_ID]
        },
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(closeButton)]
    });

    await interaction.editReply({ content: `${categoryEmoji} Тикет создан: <#${ticketChannel.id}>` });
}

// ===================== ЗАПУСК =====================
if (!TOKEN) {
    console.error('Не задан TOKEN в коде.');
    process.exit(1);
}

client.once('ready', () => {
    console.log(`Бот запущен: ${client.user.tag}`);
    
    // Запускаем обновление статуса сервера при старте
    updateServerStatus();
    
    // Обновляем каждые 5 минут (Discord rate limit: 2 rename/10min на канал)
    setInterval(updateServerStatus, STATUS_CHECK_INTERVAL_MS);
});

client.login(TOKEN);