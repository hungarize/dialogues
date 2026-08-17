#!/usr/bin/env node
/* assets/build-exercise-lite.js - emits a DATA-ONLY exercise shell (v3.1)
 *
 * Usage: node assets/build-exercise-lite.js <source.json> <output.html>
 *
 * The published file carries only the content JSON. All markup, data-ids and
 * the answers object are built at load time by assets/exercise-render.js,
 * which is why the output is ~2 KB instead of ~12 KB.
 *
 * Validation kept here (build time, fails fast, writes nothing on error):
 *   - 3+ true/false statements, each igaz or hamis
 *   - 5+ dialogue lines
 *   - 10+ word-list items, at least 30% blanked, never two blanks in a row
 *   - no multi-word dialogue gaps
 * The dialogue GAP COUNT is deliberately never validated: the human chooses it
 * by underlining words in Notion, and any number is correct.
 */
const fs = require("fs")

const MIN_WORDLIST_RATIO = 0.3

const [srcPath, outPath] = process.argv.slice(2)
if (!srcPath || !outPath) {
	console.error("Usage: node assets/build-exercise-lite.js <source.json> <output.html>")
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

const esc = (s) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Escaping </ keeps the JSON from terminating the script element early.
const json = JSON.stringify(data).replace(/<\//g, "<\\/")

const html = `<!DOCTYPE html>
<html lang="hu">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(data.title)} - Hungarize Exercise</title>

    <!-- Lexend is the Hungarize brand typeface -->
    <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap" rel="stylesheet">

    <link rel="stylesheet" href="assets/exercise-style.css">
</head>
<body>
    <div id="exercise-root"></div>

    <!-- Content only. Markup, data-ids and the answers object are built at load
         time by assets/exercise-render.js - do not hand-edit this block. -->
    <script type="application/json" id="exercise-data">${json}</script>

    <script src="assets/exercise-render.js"></script>
    <script src="assets/exercise-script.js"></script>
</body>
</html>
`

fs.writeFileSync(outPath, html)

const fields = tf.length + gaps + blanks.length
console.log(
	`fields=${fields} dialogue-gaps=${gaps} word-blanks=${blanks.length}/${words.length} (${Math.round(ratio * 100)}%)`,
)
console.log(`OK wrote ${outPath} (${Buffer.byteLength(html)} bytes)`)
