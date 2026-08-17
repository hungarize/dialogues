#!/usr/bin/env node
"use strict"
/*
 * publish-dialogue.js — build data/<slug>.json for the Hungarize comprehension engine.
 *
 * Usage: node tools/publish-dialogue.js <page-id> [--date YYYY-MM-DD] [--check] [--out-dir DIR]
 *   <page-id>    Notion page UUID (resolve a compressed handle with get-uuid-from-compressed)
 *   --date       override the Audio-relation date (test runs only)
 *   --check      also run the headless browser self-check (only needed after an engine change)
 *   --out-dir    write the data file somewhere other than ./data (testing)
 *
 * GOVERNANCE — edit behaviour here, not in Notion:
 *   section slicing, gap extraction, blank choice, slug, patch text .... this file
 *   content invariants (3+ statements, 5+ lines, 10+ words, 30%, adjacency) .. assets/build-exercise-data.js
 *   markup, data-ids, answers object, accent twins ......... assets/exercise-render-fetch.js
 *   answer checking, Enter key, selfCheck() ................ assets/exercise-script.js
 *   colours, fonts, inputs, tooltips ....................... assets/exercise-style.css
 *   engine shell (head, mount point, one script tag) ....... comprehension.html
 * A change to any assets/* or comprehension.html file is retroactive across every
 * published dialogue, and the engine-bundle.zip attached to the skill page must be
 * regenerated afterwards or cold sessions will self-check against a stale copy.
 *
 * Blank selection is deterministic (every 3rd word-list item from index 0), so
 * re-running an unchanged dialogue produces byte-identical output and needs no push.
 * Nothing here interprets meaning: every string is copied from the page as-is.
 */

const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

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
	if (a === "--date" || a === "--out-dir") opts[a] = argv[++i]
	else if (a === "--check") opts[a] = true
	else positional.push(a)
}
const pageId = positional[0]
if (!pageId) stop("no page id (usage: node tools/publish-dialogue.js <page-id> [--date YYYY-MM-DD])")

// ---------- read the page (one local call, underline markup preserved) ----------
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

// ---------- slug: Audio relation date + title (--date overrides for test runs) ----------
function audioDate() {
	if (opts["--date"]) return opts["--date"]
	const key = Object.keys(props).find(function (k) {
		return /audio/i.test(k)
	})
	if (!key) return null
	const rel = (props[key] && props[key].relation) || []
	for (let i = 0; i < rel.length; i++) {
		try {
			const linked = JSON.parse(
				execFileSync("ntn", ["api", "/v1/pages/" + rel[i].id], { encoding: "utf8" }),
			)
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

// ---------- section slicing ----------
const lines = md.split("\n")
const isHeading = function (l) {
	return /^#{1,6}\s/.test(l)
}
function section(re) {
	const start = lines.findIndex(function (l) {
		return isHeading(l) && re.test(l)
	})
	if (start === -1) return null
	let end = lines.length
	for (let i = start + 1; i < lines.length; i++) {
		if (isHeading(lines[i])) {
			end = i
			break
		}
	}
	return { heading: lines[start], body: lines.slice(start + 1, end) }
}
const comp = section(/SZÖVEGÉRTÉS/i)
if (!comp) stop("no SZÖVEGÉRTÉS section on the page")
const wordSection = section(/SZÓLISTA/i)
if (!wordSection) stop("no SZÓLISTA section on the page")

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

// ---------- 1. true/false ----------
const tfAt = comp.body.findIndex(function (l) {
	return /Igaz vagy hamis/i.test(l)
})
const dlgAt = comp.body.findIndex(function (l) {
	return /Dial[óo]gus/i.test(l)
})
if (tfAt === -1) stop("no 'Igaz vagy hamis?' subsection under SZÖVEGÉRTÉS")
if (dlgAt === -1) stop("no 'Dialógus' subsection under SZÖVEGÉRTÉS")
const trueFalse = listItems(comp.body.slice(tfAt + 1, dlgAt)).map(function (raw) {
	const m = stripBold(raw).match(/^(.*?)\s*-([12])-\s*$/)
	if (!m) stop("true/false statement has no -1-/-2- marker: " + raw)
	return { text: m[1].trim(), answer: m[2] === "1" ? "igaz" : "hamis" }
})
if (trueFalse.length < 3) stop("only " + trueFalse.length + " true/false statements; 3 are required")

// ---------- 2. dialogue (underline = gap, nothing else) ----------
const warnings = []
let gapCount = 0
const dialogue = listItems(comp.body.slice(dlgAt + 1)).map(function (raw) {
	let line = raw.replace(/<span[^>]*underline="true"[^>]*>([\s\S]*?)<\/span>/g, function (_, inner) {
		const word = stripBold(inner).trim()
		if (/\s/.test(word)) {
			warnings.push(
				"Multi-word underline skipped: " +
					word +
					" — underline a single word in Notion if you want it gapped, then re-run.",
			)
			return word
		}
		gapCount++
		return "[[" + word + "]]"
	})
	line = line.replace(/<\/?[a-zA-Z][^>]*>/g, "")
	return stripBold(line).trim()
})
if (dialogue.length < 5) stop("only " + dialogue.length + " dialogue lines; 5 are required")
if (gapCount === 0)
	stop("no single-word underlines in the SZÖVEGÉRTÉS dialogue; underline the gap words in Notion, then re-run")

// ---------- 3. word list (deterministic blanks) ----------
const words = listItems(wordSection.body)
	.filter(function (l) {
		return l.indexOf("=") !== -1
	})
	.map(function (raw, i) {
		const clean = stripBold(raw.replace(/<\/?[a-zA-Z][^>]*>/g, ""))
		const at = clean.indexOf("=")
		return {
			term: clean.slice(0, at).trim(),
			gloss: clean.slice(at + 1).trim(),
			blank: i % 3 === 0,
		}
	})
if (words.length < 10) stop("only " + words.length + " word-list items; 10 are required")
const blankCount = words.filter(function (w) {
	return w.blank
}).length

// ---------- write + validate ----------
const json = JSON.stringify({ title: title, trueFalse: trueFalse, dialogue: dialogue, words: words })
const outDir = opts["--out-dir"] || "data"
fs.mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, slug + ".json")
fs.writeFileSync(file, json)

try {
	execFileSync("node", ["assets/build-exercise-data.js", file], { encoding: "utf8" })
} catch (e) {
	console.log(String(e.stdout || "") + String(e.stderr || ""))
	stop("validator rejected " + file + " (see ERROR lines above)")
}

let checkLine = ""
if (opts["--check"]) {
	try {
		const o = execFileSync("node", ["tools/serve-and-check.js", slug], { encoding: "utf8" })
		if (!/CHECK_PASSED/.test(o)) {
			console.log(o)
			stop("browser self-check failed")
		}
		checkLine = "CHECK=PASSED"
	} catch (e) {
		console.log(String(e.stdout || "") + String(e.stderr || ""))
		stop("browser self-check failed")
	}
}

const sha = execFileSync("git", ["hash-object", file], { encoding: "utf8" }).trim()
const bytes = fs.statSync(file).size

// ---------- write-back patch for the SZÖVEGÉRTÉS section ----------
const url = "https://hungarize.github.io/dialogues/comprehension.html?dialogue=" + slug
const linkLine =
	"Test yourself with these [comprehension exercises](" +
	url +
	") while listening to the dialogue multiple times."
const existingAt = comp.body.findIndex(function (l) {
	return /^Test yourself with these \[comprehension exercises\]\(/.test(l.trim())
})
let patchOld = null
let patchNew = null
if (existingAt !== -1) {
	if (comp.body[existingAt].trim() !== linkLine) {
		patchOld = comp.body[existingAt]
		patchNew = linkLine
	}
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
r.push("URL=" + url)
if (checkLine) r.push(checkLine)
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
