#!/usr/bin/env node
/* assets/build-exercise-data.js - validates and writes a dialogue DATA FILE for
 * the fetch-based engine (comprehension.html + assets/exercise-render-fetch.js).
 *
 * Usage: node assets/build-exercise-data.js <source.json> <output.json>
 *
 * Unlike build-exercise-lite.js this writes NOTHING but the content JSON -
 * no HTML wrapper, no boilerplate, at all. The engine page is uploaded once
 * and reused by every dialogue; only this small data file changes per run.
 *
 * Validation is identical to build-exercise-lite.js - see that file's header
 * for the invariants enforced here:
 *   - 3+ true/false statements, each igaz or hamis
 *   - 5+ dialogue lines, no multi-word [[gaps]]
 *   - 10+ word-list items, at least 30% blanked, never two blanks in a row
 * The dialogue GAP COUNT is deliberately never validated: the human chooses
 * it by underlining words in Notion, and any number is correct.
 */
const fs = require("fs")
const path = require("path")

const MIN_WORDLIST_RATIO = 0.3

const [srcPath, outPath] = process.argv.slice(2)
if (!srcPath || !outPath) {
	console.error("Usage: node assets/build-exercise-data.js <source.json> <output.json>")
	process.exit(1)
}

let data
try {
	data = JSON.parse(fs.readFileSync(srcPath, "utf8"))
} catch (e) {
	console.error("ERROR: cannot parse " + srcPath + ": " + e.message)
	process.exit(1)
}

const errors = []

if (!data.title) errors.push("ERROR: missing title")

const tf = data.trueFalse || []
if (tf.length < 3) {
	errors.push(`ERROR: need at least 3 true/false statements, got ${tf.length}`)
}
tf.forEach((s, i) => {
	const a = String(s.answer).toLowerCase()
	if (a !== "igaz" && a !== "hamis") {
		errors.push(`ERROR: statement ${i + 1} answer must be igaz or hamis, got "${s.answer}"`)
	}
	if (!s.text) errors.push(`ERROR: statement ${i + 1} has no text`)
})

const dialogue = data.dialogue || []
if (dialogue.length < 5) {
	errors.push(`ERROR: dialogue needs at least 5 lines, got ${dialogue.length}`)
}

let gaps = 0
dialogue.forEach((line, i) => {
	const found = String(line).match(/\[\[(.+?)\]\]/g) || []
	gaps += found.length
	found.forEach((g) => {
		const inner = g.slice(2, -2)
		if (/\s/.test(inner)) {
			errors.push(
				`ERROR: multi-word gap "${inner}" on dialogue line ${i + 1} - gap a single word, or skip it and report a warning`,
			)
		}
	})
})
if (gaps === 0) errors.push("ERROR: dialogue has no [[gaps]] marked")

const words = data.words || []
if (words.length < 10) {
	errors.push(`ERROR: word list needs at least 10 items, got ${words.length}`)
}
words.forEach((w, i) => {
	if (!w.term) errors.push(`ERROR: word-list item ${i + 1} has no term`)
	if (!w.gloss) errors.push(`ERROR: word-list item ${i + 1} has no gloss`)
})

const blanks = words.filter((w) => w.blank)
const ratio = words.length ? blanks.length / words.length : 0
if (ratio < MIN_WORDLIST_RATIO) {
	errors.push(
		`ERROR: word list only ${Math.round(ratio * 100)}% blanked (${blanks.length}/${words.length}), need at least ${MIN_WORDLIST_RATIO * 100}%`,
	)
}
for (let i = 1; i < words.length; i++) {
	if (words[i].blank && words[i - 1].blank) {
		errors.push(`ERROR: adjacent word-list blanks at items ${i} and ${i + 1}`)
	}
}

if (errors.length) {
	errors.forEach((e) => console.error(e))
	process.exit(1)
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
const json = JSON.stringify(data)
fs.writeFileSync(outPath, json)

const fields = tf.length + gaps + blanks.length
console.log(
	`fields=${fields} dialogue-gaps=${gaps} word-blanks=${blanks.length}/${words.length} (${Math.round(ratio * 100)}%)`,
)
console.log(`OK wrote ${outPath} (${Buffer.byteLength(json)} bytes)`)
