const dgram = require('dgram');
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===================== НАСТРОЙКИ =====================
const TOKEN = 'MTExMTIxNzkzNjE4Nzc5MzQ5OA.GlU2QQ.6D9OSfqSlLSkbrPH7Uts0fCGljiiw3OzbYOo2g';

const GUILD_ID = '1503811091933954189';

const SERVER_IP = '89.248.236.141';
const SERVER_PORT = 27416;
const MAX_PLAYERS = 30;

const ONLINE_CHANNEL_ID = '1510679770302513364';
const STATUS_CHANNEL_ID = '1510679960530981075';

// Команда /radio перенесена в bot.js.
// Оставляем здесь только автообновление онлайна, чтобы не было двойной обработки интеракций.

// ===================== STEAM QUERY =====================
function readString(buffer, offset) {
    let end = offset;

    while (end < buffer.length && buffer[end] !== 0x00) {
        end++;
    }

    return {
        value: buffer.toString('utf8', offset, end),
        offset: end + 1
    };
}

function parseInfo(buffer) {
    let offset = 0;

    const header = buffer.readInt32LE(offset);
    offset += 4;

    if (header !== -1) {
        throw new Error('Ответ сервера разделён на части');
    }

    const type = buffer.readUInt8(offset);
    offset += 1;

    if (type === 0x41) {
        const challenge = buffer.slice(offset, offset + 4);
        return { challenge };
    }

    if (type !== 0x49) {
        throw new Error(`Неожиданный тип ответа: ${type}`);
    }

    offset += 1;

    let result;

    result = readString(buffer, offset);
    const name = result.value;
    offset = result.offset;

    result = readString(buffer, offset);
    const map = result.value;
    offset = result.offset;

    result = readString(buffer, offset);
    const folder = result.value;
    offset = result.offset;

    result = readString(buffer, offset);
    const game = result.value;
    offset = result.offset;

    offset += 2;

    const players = buffer.readUInt8(offset);
    offset += 1;

    const maxPlayers = buffer.readUInt8(offset);

    return {
        name,
        map,
        folder,
        game,
        players,
        maxPlayers
    };
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

        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error('Сервер не ответил на UDP-запрос'));
        }, 7000);

        socket.on('error', error => {
            clearTimeout(timeout);
            socket.close();
            reject(error);
        });

        socket.on('message', message => {
            try {
                const parsed = parseInfo(message);

                if (parsed.challenge) {
                    sendQuery(socket, parsed.challenge);
                    return;
                }

                clearTimeout(timeout);
                socket.close();
                resolve(parsed);

            } catch (error) {
                clearTimeout(timeout);
                socket.close();
                reject(error);
            }
        });

        sendQuery(socket);
    });
}

// ===================== АВТООНЛАЙН =====================
async function updateOnline() {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const onlineChannel = guild.channels.cache.get(ONLINE_CHANNEL_ID);
    const statusChannel = guild.channels.cache.get(STATUS_CHANNEL_ID);

    try {
        const server = await queryServer();

        const online = server.players ?? 0;
        const max = server.maxPlayers || MAX_PLAYERS;

        if (onlineChannel) {
            await onlineChannel.setName(`👥 Онлайн: ${online}/${max}`);
        }

        if (statusChannel) {
            await statusChannel.setName('🖥 Сервер: 🟢');
        }

        console.log(`Онлайн обновлён: ${online}/${max}`);

    } catch (error) {
        console.error('Ошибка проверки сервера:', error.message);

        if (onlineChannel) {
            await onlineChannel.setName(`👥 Онлайн: 0/${MAX_PLAYERS}`);
        }

        if (statusChannel) {
            await statusChannel.setName('🖥 Сервер: 🔴');
        }
    }
}

// ===================== ЗАПУСК =====================
client.once('clientReady', () => {
    console.log(`Бот запущен: ${client.user.tag}`);

    updateOnline();
    setInterval(updateOnline, 60000);
});

client.login(TOKEN);