import { EmbedBuilder } from 'discord.js'
import config from '../../config/config.js'
import t from './t.js'
import 'dotenv/config'

const { GUILD_ID, VOICE_CHANNEL_ID, BANNER_URL } = process.env

const unicodeEmojis = {
  setting: '⚙️',
  name: '📝',
  limit: '🔢',
  privacy: '🔒',
  dnd: '🔕',
  region: '🌐',
  trust: '✅',
  untrust: '🚫',
  block: '⛔',
  unblock: '⭕',
  bitrate: '🎚️',
  invite: '📨',
  kick: '👢',
  claim: '🙋',
  transfer: '🔄',
  delete: '🗑️'
}

export const createVoiceEmbed = () => {
  const hex = config.embedcode || '#2f3136'
  const color = parseInt(hex.replace('#', ''), 16)
  const lang = config.language

  const commands = [
    ['name', '`!name <new name>`'],
    ['limit', '`!limit <0-99>`'],
    ['privacy', '`!privacy <lock|unlock|invisible|visible|closechat|openchat>`'],
    ['dnd', '`!dnd`'],
    ['region', '`!region <region>`'],
    ['trust', '`!trust @user`'],
    ['untrust', '`!untrust @user`'],
    ['block', '`!block @user`'],
    ['unblock', '`!unblock @user`'],
    ['bitrate', '`!bitrate <32|48|64|80|96>`'],
    ['invite', '`!invite @user`'],
    ['kick', '`!kick @user`'],
    ['claim', '`!claim`'],
    ['transfer', '`!transfer @user`'],
    ['delete', '`!delete`']
  ]

  const desc = [
    t('dashboard_description', lang),
    '',
    ...commands.map(([k, usage]) => `${unicodeEmojis[k]} ${usage} — ${t(`${k}_desc`, lang)}`),
    '',
    t('dashboard_create_link', lang, {
      guildId: GUILD_ID,
      channelId: VOICE_CHANNEL_ID
    })
  ].join('\n')

  const image = BANNER_URL ||
    'https://media.discordapp.net/attachments/1357016908611715284/1357016929142964376/tempvoice-dashboard.png'

  return new EmbedBuilder()
    .setTitle(`${unicodeEmojis.setting} ${t('dashboard_title', lang)}`)
    .setDescription(desc)
    .setImage(image)
    .setFooter({ text: t('dashboard_footer', lang) })
    .setColor(color)
}
