import { matchReply, type CannedReply } from '../data/assistant'

/** Canned, keyword-matched replies. A real LLM-backed endpoint can replace this later. */
export async function getReply(input: string): Promise<CannedReply> {
  const reply = matchReply(input)
  return new Promise((resolve) => setTimeout(() => resolve(reply), 950))
}
