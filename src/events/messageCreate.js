import t from '../utils/t.js'
import config from '../../config/config.js'
import { log } from '../utils/logger.js'
import { getSafeChannelName } from '../utils/contentFilter.js'
import { MAX_CHANNEL_NAME_LENGTH } from '../constants.js'

const PREFIX = '!'

/**
 * Handles text command based voice management
 * @param {Client} client - Discord client instance
 * @param {Message} message - Discord message
 */
export default async (client, message) => {
  if (!message.guild || message.author.bot) return
  if (!message.content?.startsWith(PREFIX)) return

  const lang = config.language
  const [rawCommand, ...argParts] = message.content.slice(PREFIX.length).trim().split(/\s+/)
  const command = rawCommand?.toLowerCase()

  if (command !== 'name') return

  const member = message.member
  const channel = member?.voice?.channel
  const ownerId = client.tempVoiceOwners?.get(channel?.id)

  if (!channel || ownerId !== member.id) {
    await message.reply(t('not_owner', lang)).catch(() => {})
    return
  }

  const input = argParts.join(' ').trim()
  if (!input || input.length < 2 || input.length > MAX_CHANNEL_NAME_LENGTH) {
    await message.reply(t('invalid_name', lang)).catch(() => {})
    return
  }

  const { safe, name: safeName } = getSafeChannelName(input)
  if (!safe) {
    await message.reply(
      t('inappropriate_name', lang) ||
      'That channel name contains inappropriate content. Please choose a different name.'
    ).catch(() => {})
    return
  }

  try {
    await channel.setName(safeName)
    channel.renamedByModal = true

    log('log_renamed', client, {
      user: member.user.username,
      name: safeName
    })

    await message.reply(t('channel_renamed', lang, { name: safeName })).catch(() => {})
  } catch (err) {
    console.warn('error_name', err.message)
    await message.reply(t('error_name', lang)).catch(() => {})
  }
}
