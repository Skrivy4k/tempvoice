import { createVoiceEmbed } from '../utils/embedBuilder.js'
import 'dotenv/config'

export const embedSender = async channel => {
  const embed = createVoiceEmbed()

  // try to find an existing dashboard message from the bot
  let existingMessage
  try {
    const messages = await channel.messages.fetch({ limit: 20 })
    const botMessages = messages.filter(
      m => m.author.id === channel.client.user.id
    )
    existingMessage = botMessages.first()

    const duplicates = botMessages.filter(m => m.id !== existingMessage?.id)
    for (const [, msg] of duplicates) {
      await msg.delete().catch(() => {})
    }
  } catch (_) {
    existingMessage = null
  }

  const payload = { embeds: [embed] }

  if (existingMessage) {
    await existingMessage.edit(payload)
  } else {
    await channel.send(payload)
  }
}
