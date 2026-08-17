#!/usr/bin/env node
/*
 * assets/build-exercise.js - Hungarize comprehension exercise generator.
 *
 * Usage:  node assets/build-exercise.js source.json output.html
 *
 * Takes a compact JSON source and emits the full exercise HTML, assigning every
 * data-id, building the `answers` object (including accent-free twins) and
 * validating the AI-chosen word-list blanks. Exits 1 if validation finds errors.
 *
 * Source format:
 * {
 *   "title": "kajszibarack",
 *   "trueFalse": [ { "text": "...", "answer": "igaz" | "hamis" }, ... ],
 *   "dialogue": [ "Plain line", "[[MarkedWord]] rest of line", ... ],
 *   "words":    [ { "term": "életem", "gloss": "my love" },
 *                 { "term": "akciós", "gloss": "on sale", "blank": true } ]
 * }
 *
 * NOTE: styling lives in assets/exercise-style.css and behaviour in
 * assets/exercise-script.js. Never inline them into generated files.
 */

const fs = require("fs")

const MIN_WORDLIST_RATIO = 0.3

const ACC = { á: "a", é: "e", í: "i", ó: "o", ö: "o", ő: "o", ú: "u", ü: "u", ű: "u" }
const deaccent = (s) => s.replace(/[áéíóöőúüű]/g, (c) => ACC[c])
const esc = (s) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function variants(word) {
	const w = word.toLowerCase()
	const d = deaccent(w)
	return d === w ? [w] : [w, d]
}

function build(src) {
	const errors = []
	const warnings = []
	const answers = {}
	let id = 0

	// ---------- section 1: true / false ----------
	const tfParts = []
	for (const [i, st] of (src.trueFalse || []).entries()) {
		id += 1
		const val = String(st.answer).toLowerCase()
		if (val !== "igaz" && val !== "hamis") {
			errors.push(`statement ${i + 1}: answer must be "igaz" or "hamis", got "${st.answer}"`)
		}
		answers[id] = [val]
		const label = val === "igaz" ? "Igaz" : "Hamis"
		tfParts.push(
			`                <div class="statement">\n` +
			`                    <span class="statement-num">${i + 1}.</span> ${esc(st.text)}\n` +
			`                    <div class="answer-wrapper">\n` +
			`                        <select class="answer-select" data-id="${id}">\n` +
			`                            <option value="">?</option>\n` +
			`                            <option value="igaz">Igaz</option>\n` +
			`                            <option value="hamis">Hamis</option>\n` +
			`                        </select>\n` +
			`                        <button type="button" class="info-btn" data-answer="${label}">?</button>\n` +
			`                    </div>\n` +
			`                </div>`
		)
	}

	// ---------- section 2: dialogue ----------
	// Gaps are whatever the user underlined, marked here as [[word]]. Any number,
	// any position, including consecutive lines. Never assume a count.
	const gapWords = []
	const dlgParts = []
	for (const raw of src.dialogue || []) {
		const pieces = []
		let rest = raw
		let m
		while ((m = /\[\[(.+?)\]\]/.exec(rest)) !== null) {
			id += 1
			const word = m[1]
			gapWords.push(word.toLowerCase())
			answers[id] = variants(word)
			const maxlen = Math.max(10, word.length + 1)
			if (m.index > 0) pieces.push(esc(rest.slice(0, m.index)).trimEnd())
			pieces.push(
				`\n                    <div class="answer-wrapper">\n` +
				`                        <input type="text" class="answer-input" data-id="${id}" maxlength="${maxlen}" placeholder="...">\n` +
				`                        <button type="button" class="info-btn" data-answer="${esc(word)}">?</button>\n` +
				`                    </div>\n                    `
			)
			rest = rest.slice(m.index + m[0].length).replace(/^\s+/, "")
		}
		if (rest) pieces.push(esc(rest))
		dlgParts.push(
			`                <div class="dialogue-line">\n` +
			`                    <span class="dialogue-dash">-</span> ` +
			pieces.join("").replace(/\s+$/, "") +
			`\n                </div>`
		)
	}

	// ---------- section 3: words and expressions ----------
	const wordParts = []
	let blanks = 0
	for (const w of src.words || []) {
		if (w.blank) {
			blanks += 1
			id += 1
			answers[id] = variants(w.term)
			const maxlen = Math.max(15, w.term.length + 1)
			wordParts.push(
				`                <div class="word-item">\n` +
				`                    <div class="answer-wrapper">\n` +
				`                        <input type="text" class="answer-input" data-id="${id}" maxlength="${maxlen}" placeholder="...">\n` +
				`                        <button type="button" class="info-btn" data-answer="${esc(w.term)}">?</button>\n` +
				`                    </div>\n` +
				`                    = ${esc(w.gloss)}\n` +
				`                </div>`
			)
		} else {
			wordParts.push(
				`                <div class="word-item">\n` +
				`                    <span class="word-term">${esc(w.term)}</span> = ${esc(w.gloss)}\n` +
				`                </div>`
			)
		}
	}

	// ---------- validation ----------
	// Dialogue gaps are chosen by the user (underlined in SZOVEGERTES), so they are
	// taken as given: no count, clustering, spacing or word-list-overlap checks.
	// The word-list blanks are chosen by the AI, so they ARE validated.
	if (gapWords.length === 0) {
		errors.push("no underlined gap words found in the dialogue - check the source markers")
	}
	const ratio = src.words && src.words.length ? blanks / src.words.length : 0
	if (ratio < MIN_WORDLIST_RATIO) {
		errors.push(
			`word-list blank ratio ${(ratio * 100).toFixed(0)}% is below the required ${MIN_WORDLIST_RATIO * 100}% (${blanks}/${(src.words || []).length})`
		)
	}
	if (ratio > 0.5) {
		warnings.push(`word-list blank ratio ${(ratio * 100).toFixed(0)}% is unusually high (${blanks}/${(src.words || []).length})`)
	}

	// ---------- assemble ----------
	const answersLines = Object.keys(answers)
		.map((k) => `            '${k}': [${answers[k].map((v) => `'${v}'`).join(", ")}]`)
		.join(",\n")

	const html =
		`<!DOCTYPE html>\n<html lang="hu">\n<head>\n` +
		`    <meta charset="UTF-8">\n` +
		`    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
		`    <title>${esc(src.title)} - Hungarize Exercise</title>\n\n` +
		`    <!-- Lexend is the Hungarize brand typeface -->\n` +
		`    <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap" rel="stylesheet">\n\n` +
		`    <link rel="stylesheet" href="assets/exercise-style.css">\n` +
		`</head>\n<body>\n` +
		`    <div class="container">\n` +
		`        <div class="logo">\n` +
		`            <img src="assets/hungarize-logo-small.png" alt="Hungarize Logo">\n` +
		`        </div>\n\n` +
		`        <div class="title">🎯 ${esc(src.title)}</div>\n\n` +
		`        <form id="exerciseForm">\n` +
		`            <div class="section">\n` +
		`                <div class="section-title">Igaz vagy hamis? ❖ True or false?</div>\n\n` +
		tfParts.join("\n\n") +
		`\n            </div>\n\n` +
		`            <div class="section">\n` +
		`                <div class="section-title">Dialógus ❖ Dialogue</div>\n\n` +
		dlgParts.join("\n\n") +
		`\n            </div>\n\n` +
		`            <div class="section">\n` +
		`                <div class="section-title">Szavak és kifejezések ❖ Words and expressions</div>\n\n` +
		wordParts.join("\n\n") +
		`\n            </div>\n\n` +
		`            <div class="button-group">\n` +
		`                <button type="button" class="check-btn" onclick="checkAnswers()">Check Answers</button>\n` +
		`            </div>\n` +
		`        </form>\n\n` +
		`        <div class="credit">\n` +
		`            Created by <span class="credit-bold">Hungarize</span><br>\n` +
		`            hungarize.com\n` +
		`        </div>\n` +
		`    </div>\n\n` +
		`    <script>\n` +
		`        // Answers are generated by assets/build-exercise.js - do not hand-edit.\n` +
		`        // This inline block MUST stay above exercise-script.js.\n` +
		`        const answers = {\n${answersLines}\n        };\n` +
		`    </script>\n\n` +
		`    <script src="assets/exercise-script.js"></script>\n` +
		`</body>\n</html>\n`

	return {
		html,
		answers,
		errors,
		warnings,
		stats: {
			fields: id,
			gaps: gapWords.length,
			blanks,
			wordCount: (src.words || []).length,
			ratio,
		},
	}
}

// ---------- CLI ----------
const [srcPath, outPath] = process.argv.slice(2)
if (!srcPath || !outPath) {
	console.error("usage: node build-exercise.js source.json output.html")
	process.exit(2)
}
const src = JSON.parse(fs.readFileSync(srcPath, "utf8"))
const r = build(src)

console.log(`fields=${r.stats.fields} dialogue-gaps=${r.stats.gaps} word-blanks=${r.stats.blanks}/${r.stats.wordCount} (${(r.stats.ratio * 100).toFixed(0)}%)`)
for (const w of r.warnings) console.log(`warning: ${w}`)
for (const e of r.errors) console.log(`ERROR: ${e}`)

if (r.errors.length) {
	console.log(`FAILED with ${r.errors.length} error(s) - no file written`)
	process.exit(1)
}
fs.writeFileSync(outPath, r.html, "utf8")
console.log(`OK wrote ${outPath} (${Buffer.byteLength(r.html, "utf8")} bytes)`)
