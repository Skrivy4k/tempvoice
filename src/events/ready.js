import { logStartup } from '../utils/logger.js'
import config from '../../config/config.js'
import { validateBotPermissions, validateChannels } from '../utils/validatePermissions.js'
import { startAutoCleanup } from '../utils/autoCleanup.js'

/**
 * Handles the 'ready' event when bot successfully connects
 * @param {Client} client - Discord client instance
 */
export default async client => {
  // Validate channels exist and are accessible
  const channelValidation = await validateChannels(client)
  if (!channelValidation.valid) {
    for (const error of channelValidation.errors) {
      logStartup(`❌ ${error}`)
    }
    logStartup('Please check your .env configuration and try again.')
    process.exit(1)
  }

  // Validate bot permissions
  const hasPermissions = await validateBotPermissions(client)
  if (!hasPermissions) {
    logStartup('Cannot start without required permissions.')
    process.exit(1)
  }

  const guild = await client.guilds.fetch(process.env.GUILD_ID)
  const channels = await guild.channels.fetch()

  const category = channels.get(process.env.CATEGORY_CHANNEL_ID)
  const voice = channels.get(process.env.VOICE_CHANNEL_ID)
  const log = process.env.LOG_CHANNEL_ID
    ? channels.get(process.env.LOG_CHANNEL_ID)
    : null

  logStartup(`Logged in as ${client.user.tag}`)
  logStartup(`Category: ${category.name} (${category.id})`)
  logStartup(`Voice: ${voice.name} (${voice.id})`)
  logStartup(`Log: ${log ? `${log.name} (${log.id})` : '[not set]'}`)
  logStartup(`Lang: ${config.language}`)
  logStartup(`Log Channel: ${config.log ? 'true' : 'false'}`)
  logStartup('Loaded modals:')

  for (const name of client.modals.keys()) {
    logStartup(`  - ${name}`)
  }

  // Start auto-cleanup scheduler
  startAutoCleanup(client)

  logStartup('🚀 Bot is ready!')
}
