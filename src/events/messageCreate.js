import { PermissionsBitField, PermissionFlagsBits } from 'discord.js'
import t from '../utils/t.js'
import config from '../../config/config.js'
import checkOwner from '../utils/checkOwner.js'
import { log } from '../utils/logger.js'
import { getSafeChannelName } from '../utils/contentFilter.js'
import {
  MAX_CHANNEL_NAME_LENGTH,
  BITRATE_OPTIONS,
  VOICE_REGIONS,
  PRIVACY_OPTIONS
} from '../constants.js'
import { globalRateLimiter } from '../utils/rateLimit.js'

const PREFIX = '!'

/**
 * Parses a user mention string (e.g. <@123456789> or <@!123456789>) into a user ID.
 * Returns null if the string is not a valid mention.
 * @param {string} str
 * @returns {string|null}
 */
function parseMention(str) {
  if (!str) return null
  const match = str.match(/^<@!?(\d+)>$/)
  return match ? match[1] : null
}

/**
 * Sends a temporary reply in the channel that auto-deletes after a delay.
 * @param {TextChannel} channel
 * @param {string} content
 * @param {number} [delayMs=8000]
 */
async function tempReply(channel, content, delayMs = 8000) {
  const msg = await channel.send(content).catch(() => null)
  if (msg) setTimeout(() => msg.delete().catch(() => {}), delayMs)
}

/**
 * Handles messageCreate events for text-based voice channel commands.
 * Commands are only active in the dedicated text channel for a temp voice channel.
 * @param {Client} client
 * @param {Message} message
 */
export default async (client, message) => {
  if (message.author.bot) return
  if (!message.content.startsWith(PREFIX)) return

  // Only handle messages in the dedicated text channel of a temp voice channel
  const voiceChannelId = [...(client.tempVoiceTextChannels?.entries() ?? [])].find(
    ([, textId]) => textId === message.channel.id
  )?.[0]

  if (!voiceChannelId) return

  const lang = config.language
  const userId = message.author.id
  const channel = message.channel

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/)
  const command = args.shift().toLowerCase()

  // Always delete the user's command message to keep the channel tidy
  await message.delete().catch(() => {})

  // Rate limiting
  if (globalRateLimiter.isRateLimited(userId)) {
    const resetTime = Math.ceil(globalRateLimiter.getTimeUntilReset(userId) / 1000)
    return tempReply(channel, t('rate_limited', lang, { seconds: resetTime }))
  }

  const voiceChannel = client.channels.cache.get(voiceChannelId)
  if (!voiceChannel) return

  const isOwner = checkOwner(client, voiceChannelId, userId)
  const ownerlessCommands = ['claim', 'help']

  if (!isOwner && !ownerlessCommands.includes(command)) {
    return tempReply(channel, t('not_owner', lang))
  }

  switch (command) {
    // !name <new name>
    case 'name': {
      const newName = args.join(' ').trim()
      if (!newName || newName.length < 2 || newName.length > MAX_CHANNEL_NAME_LENGTH) {
        return tempReply(channel, t('invalid_name', lang))
      }
      const { safe, name: safeName } = getSafeChannelName(newName)
      if (!safe) {
        return tempReply(channel, t('inappropriate_name', lang))
      }
      try {
        await voiceChannel.setName(safeName)
        voiceChannel.renamedByModal = true
        log('log_renamed', client, { user: message.author.username, name: safeName })
        return tempReply(channel, t('channel_renamed', lang, { name: safeName }))
      } catch (err) {
        return tempReply(channel, t('error_name', lang))
      }
    }

    // !limit <0-99>
    case 'limit': {
      const limit = parseInt(args[0], 10)
      if (isNaN(limit) || limit < 0 || limit > 99) {
        return tempReply(channel, t('invalid_limit', lang))
      }
      await voiceChannel.setUserLimit(limit)
      log('log_limit', client, { user: message.author.username, limit, channel: voiceChannel.name })
      return tempReply(channel, t('limit_updated', lang, { limit }))
    }

    // !privacy <lock|unlock|invisible|visible|closechat|openchat>
    case 'privacy': {
      const selected = args[0]?.toLowerCase()
      if (!selected || !PRIVACY_OPTIONS.includes(selected)) {
        return tempReply(channel, t('cmd_privacy_usage', lang, { options: PRIVACY_OPTIONS.join(', ') }))
      }

      const everyone = voiceChannel.guild.roles.everyone.id
      const trusted = voiceChannel.permissionOverwrites.cache
        .filter(p => p.allow.has(PermissionsBitField.Flags.Connect) && p.type === 'member')
        .map(p => p.id)

      const map = {
        unlock: {
          [everyone]: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel]
        },
        lock: {
          [everyone]: [],
          ...trusted.reduce((acc, id) => {
            acc[id] = [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel]
            return acc
          }, {})
        },
        invisible: {
          [everyone]: [],
          ...trusted.reduce((acc, id) => {
            acc[id] = [PermissionsBitField.Flags.ViewChannel]
            return acc
          }, {})
        },
        visible: {
          [everyone]: [PermissionsBitField.Flags.ViewChannel]
        },
        closechat: {
          [everyone]: [],
          ...trusted.reduce((acc, id) => {
            acc[id] = [PermissionsBitField.Flags.SendMessages]
            return acc
          }, {})
        },
        openchat: {
          [everyone]: [PermissionsBitField.Flags.SendMessages]
        }
      }

      const rules = map[selected]
      for (const [id, allow] of Object.entries(rules ?? {})) {
        await voiceChannel.permissionOverwrites.edit(id, {
          ViewChannel: allow.includes(PermissionsBitField.Flags.ViewChannel),
          Connect: allow.includes(PermissionsBitField.Flags.Connect),
          SendMessages: allow.includes(PermissionsBitField.Flags.SendMessages)
        })
      }

      log('log_privacy', client, {
        user: message.author.username,
        value: t(`privacy_${selected}_label`, lang),
        channel: voiceChannel.name
      })
      return tempReply(channel, t(`privacy_${selected}`, lang))
    }

    // !dnd
    case 'dnd': {
      const everyone = voiceChannel.guild.roles.everyone
      const perms = voiceChannel.permissionOverwrites.cache.get(everyone.id)
      const isDND = perms && perms.deny.has(PermissionFlagsBits.Speak)

      const permsToUpdate = {
        Speak: isDND ? null : false,
        Stream: isDND ? null : false,
        UseVAD: isDND ? null : false,
        PrioritySpeaker: isDND ? null : false,
        UseSoundboard: isDND ? null : false,
        UseEmbeddedActivities: isDND ? null : false
      }

      await voiceChannel.permissionOverwrites.edit(everyone, permsToUpdate)
      return tempReply(channel, t(isDND ? 'dnd_off' : 'dnd_on', lang))
    }

    // !region <region>
    case 'region': {
      const selected = args[0]?.toLowerCase()
      if (!selected || !VOICE_REGIONS.includes(selected)) {
        return tempReply(channel, t('cmd_region_usage', lang, { options: VOICE_REGIONS.join(', ') }))
      }
      try {
        await voiceChannel.setRTCRegion(selected === 'auto' ? null : selected)
        log('log_region', client, { user: message.author.username, region: selected, channel: voiceChannel.name })
        return tempReply(channel, t('region_updated', lang, { region: selected }))
      } catch (err) {
        return tempReply(channel, t('error_region', lang))
      }
    }

    // !bitrate <kbps>
    case 'bitrate': {
      const kbps = parseInt(args[0], 10)
      const bps = kbps * 1000
      if (isNaN(kbps) || !BITRATE_OPTIONS.includes(bps)) {
        return tempReply(channel, t('cmd_bitrate_usage', lang, { options: BITRATE_OPTIONS.map(b => b / 1000).join(', ') }))
      }
      try {
        await voiceChannel.setBitrate(bps)
        log('log_bitrate', client, { user: message.author.username, bitrate: kbps, channel: voiceChannel.name })
        return tempReply(channel, t('bitrate_updated', lang, { bitrate: kbps }))
      } catch (err) {
        return tempReply(channel, t('error_bitrate', lang))
      }
    }

    // !trust @user
    case 'trust': {
      const targetId = parseMention(args[0])
      if (!targetId) return tempReply(channel, t('cmd_user_usage', lang, { cmd: 'trust' }))
      const target = await client.users.fetch(targetId).catch(() => null)
      if (!target) return tempReply(channel, t('invalid_user', lang))
      await voiceChannel.permissionOverwrites.edit(target.id, { Connect: true, ViewChannel: true })
      log('log_trust', client, { user: target.username, channel: voiceChannel.name })
      return tempReply(channel, t('trusted', lang, { user: `<@${target.id}>` }))
    }

    // !untrust @user
    case 'untrust': {
      const targetId = parseMention(args[0])
      if (!targetId) return tempReply(channel, t('cmd_user_usage', lang, { cmd: 'untrust' }))
      const target = await client.users.fetch(targetId).catch(() => null)
      if (!target) return tempReply(channel, t('invalid_user', lang))
      await voiceChannel.permissionOverwrites.delete(target.id)
      log('log_untrust', client, { user: target.username, channel: voiceChannel.name })
      return tempReply(channel, t('untrusted', lang, { user: `<@${target.id}>` }))
    }

    // !block @user
    case 'block': {
      const targetId = parseMention(args[0])
      if (!targetId) return tempReply(channel, t('cmd_user_usage', lang, { cmd: 'block' }))
      const target = await client.users.fetch(targetId).catch(() => null)
      if (!target) return tempReply(channel, t('invalid_user', lang))
      await voiceChannel.permissionOverwrites.edit(target.id, {
        ViewChannel: false,
        Connect: false,
        Speak: false,
        Stream: false,
        UseVAD: false,
        SendMessages: false
      })
      log('log_block', client, { user: target.username, channel: voiceChannel.name })
      return tempReply(channel, t('blocked', lang, { user: `<@${target.id}>` }))
    }

    // !unblock @user
    case 'unblock': {
      const targetId = parseMention(args[0])
      if (!targetId) return tempReply(channel, t('cmd_user_usage', lang, { cmd: 'unblock' }))
      const target = await client.users.fetch(targetId).catch(() => null)
      if (!target) return tempReply(channel, t('invalid_user', lang))
      await voiceChannel.permissionOverwrites.delete(target.id)
      log('log_unblock', client, { user: target.username, channel: voiceChannel.name })
      return tempReply(channel, t('unblocked', lang, { user: `<@${target.id}>` }))
    }

    // !invite @user
    case 'invite': {
      const targetId = parseMention(args[0])
      if (!targetId) return tempReply(channel, t('cmd_user_usage', lang, { cmd: 'invite' }))
      try {
        const user = await client.users.fetch(targetId)
        const invite = await voiceChannel.createInvite({ maxAge: 86400, unique: true })
        await user.send({
          content: t('invite_message', lang)
            .replace('{name}', voiceChannel.name)
            .replace('{voiceLink}', invite.url)
        })
        log('log_invite', client, { user: user.username, channel: voiceChannel.name })
        return tempReply(channel, t('invited_user', lang, { user: `<@${user.id}>` }))
      } catch (err) {
        const isDM = err.code === 50007
        return tempReply(channel, isDM ? t('error_user_dms_closed', lang) : t('error_send_invite', lang))
      }
    }

    // !kick @user
    case 'kick': {
      const targetId = parseMention(args[0])
      if (!targetId) return tempReply(channel, t('cmd_user_usage', lang, { cmd: 'kick' }))
      const member = voiceChannel.members.get(targetId)
      if (!member) return tempReply(channel, t('user_not_found', lang))
      await member.voice.disconnect().catch(() => {})
      log('log_kick', client, { user: member.user.username, channel: voiceChannel.name })
      return tempReply(channel, t('log_kick', lang, { user: `<@${member.user.id}>`, channel: voiceChannel.name }))
    }

    // !claim
    case 'claim': {
      const current = client.tempVoiceOwners?.get(voiceChannelId)
      if (!current) return tempReply(channel, t('not_in_channel', lang))
      if (current === userId) return tempReply(channel, t('already_owner', lang))

      // User must be in the voice channel to claim
      const member = voiceChannel.members.get(userId)
      if (!member) return tempReply(channel, t('not_in_channel', lang))

      if (voiceChannel.members.has(current)) return tempReply(channel, t('owner_still_present', lang))

      client.tempVoiceOwners.set(voiceChannelId, userId)
      await voiceChannel.permissionOverwrites.edit(userId, {
        ManageChannels: true,
        MuteMembers: true,
        DeafenMembers: true,
        MoveMembers: true
      })
      log('log_claimed', client, { user: message.author.username, channel: voiceChannel.name })
      return tempReply(channel, t('log_claimed', lang, { user: message.author.username, channel: voiceChannel.name }))
    }

    // !transfer @user
    case 'transfer': {
      const targetId = parseMention(args[0])
      if (!targetId) return tempReply(channel, t('cmd_user_usage', lang, { cmd: 'transfer' }))
      const target = voiceChannel.members.get(targetId)
      if (!target) return tempReply(channel, t('user_not_found', lang))
      client.tempVoiceOwners.set(voiceChannelId, targetId)
      await voiceChannel.permissionOverwrites.edit(targetId, {
        ManageChannels: true,
        MuteMembers: true,
        DeafenMembers: true,
        MoveMembers: true
      }).catch(() => {})
      log('log_transfer', client, { user: target.user.username, channel: voiceChannel.name })
      return tempReply(channel, t('log_transfer', lang, { user: `<@${target.user.id}>`, channel: voiceChannel.name }))
    }

    // !delete
    case 'delete': {
      log('log_deleted', client, { channel: voiceChannel.name })
      client.deletedByInteraction = client.deletedByInteraction || new Set()
      client.deletedByInteraction.add(voiceChannelId)

      // Send confirmation first, then schedule channel deletion so user can see it
      await channel.send(t('deleted', lang)).catch(() => {})

      setTimeout(async () => {
        const textChannelId = client.tempVoiceTextChannels?.get(voiceChannelId)
        if (textChannelId) {
          const textCh = client.channels.cache.get(textChannelId)
          if (textCh) await textCh.delete().catch(() => {})
          client.tempVoiceTextChannels?.delete(voiceChannelId)
        }
        voiceChannel.delete().catch(() => {})
        client.tempVoiceOwners?.delete(voiceChannelId)
      }, 1500)
      break
    }

    // !help
    case 'help': {
      const helpLines = [
        `**!name** <${t('name', lang)}> — ${t('name_desc', lang)}`,
        `**!limit** <0-99> — ${t('limit_desc', lang)}`,
        `**!privacy** <${PRIVACY_OPTIONS.join('|')}> — ${t('privacy_desc', lang)}`,
        `**!dnd** — ${t('dnd_desc', lang)}`,
        `**!region** <${VOICE_REGIONS.join('|')}> — ${t('region_desc', lang)}`,
        `**!bitrate** <${BITRATE_OPTIONS.map(b => b / 1000).join('|')}> — ${t('bitrate_desc', lang)}`,
        `**!trust** @user — ${t('trust_desc', lang)}`,
        `**!untrust** @user — ${t('untrust_desc', lang)}`,
        `**!block** @user — ${t('block_desc', lang)}`,
        `**!unblock** @user — ${t('unblock_desc', lang)}`,
        `**!invite** @user — ${t('invite_desc', lang)}`,
        `**!kick** @user — ${t('kick_desc', lang)}`,
        `**!claim** — ${t('claim_desc', lang)}`,
        `**!transfer** @user — ${t('transfer_desc', lang)}`,
        `**!delete** — ${t('delete_desc', lang)}`
      ]
      return tempReply(channel, helpLines.join('\n'), 30000)
    }

    default:
      break
  }
}
