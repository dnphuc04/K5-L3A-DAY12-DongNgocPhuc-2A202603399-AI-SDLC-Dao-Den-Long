import { readFile, rename, writeFile } from 'node:fs/promises'

const storage = process.env.LEADERBOARD_FILE || new URL('./.leaderboard.json', import.meta.url)
const temporary = process.env.LEADERBOARD_FILE ? storage + '.tmp' : new URL('./.leaderboard.json.tmp', import.meta.url)
const validName = name => typeof name === 'string' && /^[A-Za-z0-9_]{3,12}$/.test(name)
const validScore = entry => entry && validName(entry.name) &&
  Number.isSafeInteger(entry.score) && entry.score >= 0 &&
  Number.isInteger(entry.nights_won) && entry.nights_won >= 0 && entry.nights_won <= 3 &&
  Number.isSafeInteger(entry.seed)
const ordered = entries => [...entries].sort((a, b) =>
  b.score - a.score || Date.parse(a.achieved_at) - Date.parse(b.achieved_at)).slice(0, 10)

export async function readLeaderboard() {
  try {
    const { entries } = JSON.parse(await readFile(storage, 'utf8'))
    return { entries: ordered(entries.filter(entry => validScore(entry) && Number.isFinite(Date.parse(entry.achieved_at)))) }
  } catch (error) {
    if (error.code === 'ENOENT') return { entries: [] }
    throw error
  }
}

let pending = Promise.resolve()
export function saveScore(entry) {
  if (!validScore(entry)) return Promise.reject(new TypeError('Invalid score entry'))
  const update = pending.then(async () => {
    const { entries } = await readLeaderboard()
    const { name, score, nights_won, seed } = entry
    entries.push({ name, score, nights_won, achieved_at: new Date().toISOString(), seed })
    const data = { entries: ordered(entries) }
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n')
    await rename(temporary, storage)
    return data
  })
  pending = update.catch(() => {})
  return update
}
