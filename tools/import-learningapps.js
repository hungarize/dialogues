#!/usr/bin/env node
"use strict"
/*
 * import-learningapps.js — rebuild a legacy LearningApps cloze app as data/<slug>.json.
 *
 * Usage: node tools/import-learningapps.js <page-id> --app FILE [--date YYYY-MM-DD]
 *                                          [--keep-legacy-link] [--out-dir DIR]
 *   <page-id>            Notion page UUID (resolve a compressed handle with get-uuid-from-compressed)
 *   --app FILE           body of https://learningapps.org/data?id=GUID (whole JSON, or just
 *                        the initparameters string). The sandbox has no network, so the
 *                        agent fetches that URL and saves the body to a file.
 *   --date               override the Audio-relation date (test runs only)
 *   --keep-legacy-link   keep the learningapps.org line on the page and add the new one below it
 *                        (default: the legacy line is replaced)
 *   --out-dir            write the data file somewhere other than ./data (testing)
 *
 * The app data carries its own answer key: clozetext holds -1-, -2- ... placeholders and
 * cloze1, cloze2 ... hold the answers. Gaps and blanks are therefore COPIED from the legacy
 * app, not re-derived — a migrated dialogue keeps the exact gaps learners already saw.
 * Output contract is identical to tools/publish-dialogue.js: same slug (Audio-relation date
 * + title, --date for test runs), same RESULT block, same data/<slug>.json, same page patch.
 * Publishing is the same push + patch afterwards.
 *
 * GOVERNANCE — edit behaviour here, not in Notion:
 *   app parsing, gap/blank copying, page cross-check, patch text ............ this file
 *   dialogue-side invariants (title, 3+ statements, 5+ lines, single-word gaps) .. this file
 * Word-list rules (10+ items, 30% blanked, no adjacent blanks) are deliberately NOT enforced
 * on imports — legacy apps predate them. They are reported as WARN and the word list is
 * migrated exactly as its author left it. assets/build-exercise-data.js and the engine's
 * selfCheck() do enforce them, so an imported dialogue must never be run through
 * --check / tools/serve-and-check.js. The renderer has no threshold: it only reads w.blank
 * per item, so a sparse or adjacent legacy word list renders correctly.
 */

const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const warnings = []
function warn(m) {
	warnings.push(m)
}
function stop(msg) {
	console.log("STOP: " + msg)
	process.exit(2)
}

// ---------- args ----------
const argv = process.argv.slice(2)
const opts = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]
	if (a === "--date" || a === "--out-dir" || a === "--app") opts[a] = argv[++i]
	else if (a === "--keep-legacy-link") opts[a] = true
	else positional.push(a)
}
const pageId = positional[0]
if (!pageId) stop("no page id (usage: node tools/import-learningapps.js <page-id> --app FILE)")
if (!opts["--app"]) stop("no --app FILE: save the body of https://learningapps.org/data?id=GUID to a file first")

// ---------- app data: initparameters -> clozetext + answer key ----------
let rawApp
try {
	rawApp = fs.readFileSync(opts["--app"], "utf8").trim()
} catch (e) {
	stop("could not read " + opts["--app"])
}
let init = null
let guid = ""
if (rawApp.charAt(0) === "{") {
	let o
	try {
		o = JSON.parse(rawApp)
	} catch (e) {
		stop("--app file starts with a brace but is not valid JSON (truncated download?)")
	}
	if (o.result && String(o.result).toUpperCase() !== "SUCCESS") stop("LearningApps returned result=" + o.result)
	init = o.initparameters
	guid = o.guid || o.id || ""
} else {
	init = rawApp
}
if (!init || init.indexOf("clozetext=") === -1)
	stop("no clozetext in the app data — only cloze-type apps (LearningApps tool 140) can be imported")

const params = new URLSearchParams(init)
const answers = {}
for (const entry of params.entries()) {
	const m = entry[0].match(/^cloze(\d+)$/)
	if (m) answers[m[1]] = entry[1]
}
if (Object.keys(answers).length === 0) stop("the app data has no cloze1, cloze2 ... answer key")

const used = {}
function clozeValue(n) {
	const v = answers[n]
	if (v === undefined) stop("the text references -" + n + "- but the app data has no cloze" + n + " (truncated download?)")
	used[n] = true
	const parts = String(v).split(";")
	if (parts.length > 1) warn("Cloze -" + n + "- accepted several answers (" + v + "); kept the first one.")
	return parts[0].trim()
}

let text = params.get("clozetext") || ""
text = text
	.replace(/<br\s*\/?>/gi, "\n")
	.replace(/<\/?[a-zA-Z][^>]*>/g, "")
	.replace(/&nbsp;/g, " ")
	.replace(/&amp;/g, "&")
	.replace(/&lt;/g, "<")
	.replace(/&gt;/g, ">")
	.replace(/&quot;/g, '"')
	.replace(/&#0?39;/g, "'")

// ---------- read the Notion page (title, date, cross-check, patch anchor) ----------
let doc
try {
	doc = JSON.parse(
		execFileSync("ntn", ["pages", "get", pageId, "--json"], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		}),
	)
} catch (e) {
	stop("could not read page " + pageId + " (" + String(e.message).split("\n")[0] + ")")
}
const md = (doc.markdown && doc.markdown.markdown) || ""
const props = (doc.page && doc.page.properties) || {}
if (!md.trim()) stop("page " + pageId + " has no readable content")

function richText(node) {
	if (Array.isArray(node)) return node.map(richText).join("")
	if (node && typeof node === "object") {
		if (typeof node.plain_text === "string") return node.plain_text
		return Object.keys(node)
			.map(function (k) {
				return richText(node[k])
			})
			.join("")
	}
	return ""
}
const title = (richText(props.title) || (doc.page && doc.page.title) || "").trim()
if (!title) stop("page has no title")

function audioDate() {
	if (opts["--date"]) return opts["--date"]
	const key = Object.keys(props).find(function (k) {
		return /audio/i.test(k)
	})
	if (!key) return null
	const rel = (props[key] && props[key].relation) || []
	for (let i = 0; i < rel.length; i++) {
		try {
			const linked = JSON.parse(execFileSync("ntn", ["api", "/v1/pages/" + rel[i].id], { encoding: "utf8" }))
			const m = richText(linked.properties).match(/(\d{4}-\d{2}-\d{2})/)
			if (m) return m[1]
		} catch (e) {
			/* try the next linked record */
		}
	}
	return null
}
const date = audioDate()
if (!date) stop("no Audio date: link the Audio relation on the page, or pass --date YYYY-MM-DD")
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) stop("Audio date is not YYYY-MM-DD: " + date)
const slug = date + "-" + title.replace(/\s+/g, "-")

const pageLines = md.split("\n")
function isHeading(l) {
	return /^#{1,6}\s/.test(l)
}
function section(re) {
	const start = pageLines.findIndex(function (l) {
		return isHeading(l) && re.test(l)
	})
	if (start === -1) return null
	let end = pageLines.length
	for (let i = start + 1; i < pageLines.length; i++) {
		if (isHeading(pageLines[i])) {
			end = i
			break
		}
	}
	return { heading: pageLines[start], body: pageLines.slice(start + 1, end) }
}
const comp = section(/SZÖVEGÉRTÉS/i)
if (!comp) stop("no SZÖVEGÉRTÉS section on the page")

const LIST = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/
function listItems(arr) {
	const out = []
	for (let i = 0; i < arr.length; i++) {
		const m = arr[i].match(LIST)
		if (m) out.push(m[1])
	}
	return out
}
function stripBold(s) {
	return s.replace(/\*\*/g, "")
}
function plain(s) {
	return stripBold(String(s))
		.replace(/\[\[|\]\]/g, "")
		.replace(/<\/?[a-zA-Z][^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
}

// ---------- slice the cloze text ----------
const tl = text.split("\n")
function findLine(re, from) {
	for (let i = from || 0; i < tl.length; i++) if (re.test(tl[i])) return i
	return -1
}
const tfAt = findLine(/Igaz vagy hamis/i)
const dlgAt = findLine(/Dial[óo]gus/i)
const wordsAt = findLine(/(Szavak és kifejezések|SZÓLISTA|Words and expressions)/i)
if (tfAt === -1) stop("the app text has no 'Igaz vagy hamis?' block")
if (dlgAt === -1) stop("the app text has no 'Dialógus' block")
if (wordsAt === -1) stop("the app text has no word-list block")
let endAt = findLine(/Created by|hungarize\.com/i, wordsAt + 1)
if (endAt === -1) endAt = tl.length

// ---------- 1. true/false ----------
const trueFalse = listItems(tl.slice(tfAt + 1, dlgAt)).map(function (raw) {
	const m = raw.match(/^(.*?)\s*-(\d+)-\s*$/)
	if (!m) stop("true/false statement has no -N- placeholder: " + raw)
	const v = clozeValue(m[2]).toLowerCase()
	if (v !== "igaz" && v !== "hamis") stop('true/false answer for -' + m[2] + '- is "' + v + '", expected igaz or hamis')
	return { text: m[1].trim(), answer: v }
})
if (trueFalse.length < 3) stop("only " + trueFalse.length + " true/false statements; 3 are required")

// ---------- 2. dialogue (gaps copied from the app) ----------
let gapCount = 0
const dialogue = listItems(tl.slice(dlgAt + 1, wordsAt)).map(function (raw) {
	const line = raw.replace(/-(\d+)-/g, function (_, n) {
		const w = clozeValue(n)
		if (/\s/.test(w)) {
			warn("Multi-word cloze -" + n + "- filled in as plain text: " + w)
			return w
		}
		gapCount++
		return "[[" + w + "]]"
	})
	return line.trim()
})
if (dialogue.length < 5) stop("only " + dialogue.length + " dialogue lines; 5 are required")
if (gapCount === 0) stop("the app has no single-word dialogue gaps")

// ---------- 3. word list (blanks copied from the app) ----------
let words = listItems(tl.slice(wordsAt + 1, endAt))
	.filter(function (l) {
		return l.indexOf("=") !== -1
	})
	.map(function (raw) {
		const at = raw.indexOf("=")
		let blank = false
		const term = raw.slice(0, at).replace(/-(\d+)-/g, function (_, n) {
			blank = true
			return clozeValue(n)
		})
		const gloss = raw.slice(at + 1).replace(/-(\d+)-/g, function (_, n) {
			warn("Cloze -" + n + "- was on the English side of a word-list row; filled in, not blanked.")
			return clozeValue(n)
		})
		return { term: term.trim(), gloss: gloss.trim(), blank: blank }
	})
if (words.length < 10)
	warn("only " + words.length + " word-list items (the new engine's own rule is 10 or more); migrated as-is.")

Object.keys(answers).forEach(function (n) {
	if (!used[n]) warn("cloze" + n + ' ("' + answers[n] + '") is in the app data but never referenced in its text.')
})
const leftover = [trueFalse.map((t) => t.text).join(" "), dialogue.join(" "), words.map((w) => w.term + w.gloss).join(" ")]
	.join(" ")
	.match(/-\d+-/g)
if (leftover) stop("unresolved placeholders remain: " + leftover.join(" "))

// ---------- 4. cross-check the dialogue against the page's SZÖVEG section ----------
const textSection = section(/SZÖVEG(?!ÉRTÉS)/i)
if (!textSection) {
	warn("no SZÖVEG section on the page, so the app text could not be cross-checked.")
} else {
	const onPage = listItems(textSection.body).map(plain)
	const missing = dialogue.filter(function (l) {
		return onPage.indexOf(plain(l)) === -1
	})
	if (missing.length > dialogue.length / 2)
		stop(
			"the app text does not match this page: " +
				missing.length +
			" of " +
				dialogue.length +
				" dialogue lines are absent from the SZÖVEG section — wrong app for this dialogue?",
		)
	missing.slice(0, 3).forEach(function (l) {
		warn("Dialogue line is not in the page's SZÖVEG section: " + l)
	})
	if (missing.length > 3) warn(missing.length - 3 + " more dialogue lines differ from the SZÖVEG section.")
}

// ---------- dialogue-side checks only, then write (word list is migrated as-is) ----------
trueFalse.forEach(function (s, i) {
	if (!s.text) stop("true/false statement " + (i + 1) + " has no text")
})
words.forEach(function (w, i) {
	if (!w.term) stop("word-list item " + (i + 1) + " has no term")
	if (!w.gloss) stop("word-list item " + (i + 1) + " has no gloss")
})
const blankCount = words.filter(function (w) {
	return w.blank
}).length
const ratio = words.length ? Math.round((blankCount / words.length) * 100) : 0
if (ratio < 30)
	warn("word list is only " + ratio + "% blanked (the new engine's own rule is 30%); migrated as-is.")
for (let i = 1; i < words.length; i++) {
	if (words[i].blank && words[i - 1].blank) {
		warn("adjacent word-list blanks (items " + i + " and " + (i + 1) + "); migrated as-is.")
		break
	}
}
const outDir = opts["--out-dir"] || "data"
fs.mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, slug + ".json")
const json = JSON.stringify({ title: title, trueFalse: trueFalse, dialogue: dialogue, words: words })
fs.writeFileSync(file, json)
const sha = execFileSync("git", ["hash-object", file], { encoding: "utf8" }).trim()
const bytes = fs.statSync(file).size

// ---------- page patch: the new line replaces the learningapps.org link ----------
const url = "https://hungarize.github.io/dialogues/comprehension.html?dialogue=" + slug
const linkLine =
	"Test yourself with these [comprehension exercises](" + url + ") while listening to the dialogue multiple times."
const existingAt = comp.body.findIndex(function (l) {
	return /^Test yourself with these \[comprehension exercises\]\(/.test(l.trim())
})
const legacyAt = comp.body.findIndex(function (l) {
	return /learningapps\.org/i.test(l)
})
let patchOld = null
let patchNew = null
if (existingAt !== -1) {
	if (comp.body[existingAt].trim() !== linkLine) {
		patchOld = comp.body[existingAt]
		patchNew = linkLine
	}
} else if (legacyAt !== -1) {
	patchOld = comp.body[legacyAt]
	patchNew = opts["--keep-legacy-link"] ? comp.body[legacyAt] + "\n" + linkLine : linkLine
} else {
	const anchor = comp.body.find(function (l) {
		return l.trim() !== ""
	})
	if (!anchor) stop("SZÖVEGÉRTÉS section is empty; cannot place the link")
	patchOld = comp.heading + "\n" + anchor
	patchNew = comp.heading + "\n" + linkLine + "\n\n💬\n\n" + anchor
}

// ---------- one machine-readable result block ----------
const r = []
r.push("RESULT")
r.push("SLUG=" + slug)
r.push("FILE=" + file)
r.push("BYTES=" + bytes)
r.push("SHA=" + sha)
r.push("GAPS=" + gapCount)
r.push("BLANKS=" + blankCount + "/" + words.length)
r.push("SOURCE=learningapps" + (guid ? ":" + guid : ""))
r.push("URL=" + url)
warnings.forEach(function (w) {
	r.push("WARN: " + w)
})
r.push("JSON<<<")
r.push(json)
r.push(">>>")
if (patchOld === null) {
	r.push("PATCH_NONE (page already links to this slug)")
} else {
	r.push("PATCH_OLD<<<")
	r.push(patchOld)
	r.push(">>>")
	r.push("PATCH_NEW<<<")
	r.push(patchNew)
	r.push(">>>")
}
console.log(r.join("\n"))
