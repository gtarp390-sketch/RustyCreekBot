const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const TOKEN = 'MTExMTIxNzkzNjE4Nzc5MzQ5OA.GlU2QQ.6D9OSfqSlLSkbrPH7Uts0fCGljiiw3OzbYOo2g';
const CLIENT_ID = '1111217936187793498';
const GUILD_ID = '1503811091933954189';

const commands = [
    new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Отправить IC-сообщение по радио'),

    new SlashCommandBuilder()
        .setName('news')
        .setDescription('Опубликовать IC-новость')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Опубликовать объявление сервера')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('say')
        .setDescription('Отправить сообщение от лица бота')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Опубликовать статус сервера')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('tickets_admin')
        .setDescription('Опубликовать панель создания тикетов')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('publish')
        .setDescription('Красивая публикация в канал')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Регистрируем команды...');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('Готово! Все команды зарегистрированы.');
    } catch (error) {
        console.error('Ошибка:', error);
    }
})();