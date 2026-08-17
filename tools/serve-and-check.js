#!/usr/bin/env node
/* tools/serve-and-check.js - local self-check harness. This file is never
 * fetched by anything published: it is a development tool only.
 *
 * Serves the working directory over HTTP (mirroring the repo-root layout:
 * comprehension.html, assets/, data/) and drives a headless check against
 * comprehension.html?dialogue=<slug>, exactly as GitHub Pages would serve it.
 * fetch() is blocked by CORS when a page is opened via file://, so the engine
 * can only be tested over a real HTTP origin - a plain Node http server, with
 * no dependencies, does that without needing network access.
 *
 * Usage: node tools/serve-and-check.js <slug>       (run from the repo root)
 *
 * Prints every console line the page produces, then CHECK_PASSED or
 * CHECK_FAILED. A missing-logo 404 and a Google Fonts DNS failure are expected
 * in a sandbox and are not failures.
 */
const http = require("http")
const fs = require("fs")
const path = require("path")
const { chromium } = require("playwright")

const ROOT = process.cwd()
const PORT = 8973
const SLUG = process.argv[2]
if (!SLUG) {
	console.error("Usage: node tools/serve-and-check.js <slug>")
	process.exit(1)
}

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" }

const server = http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split("?")[0])
	if (p === "/") p = "/comprehension.html"
	const full = path.join(ROOT, p)
	fs.readFile(full, (err, data) => {
		if (err) {
			res.statusCode = 404
			res.end("not found: " + p)
			return
		}
		res.setHeader("Content-Type", MIME[path.extname(full)] || "application/octet-stream")
		res.end(data)
	})
})

server.listen(PORT, async () => {
	const browser = await chromium.launch({ executablePath: "/usr/local/bin/chromium", args: ["--no-sandbox"] })
	const page = await browser.newPage()
	let failed = false
	page.on("console", (msg) => {
		const text = msg.text()
		console.log(`[console:${msg.type()}] ${text}`)
		if (/ERROR/.test(text) || /is not defined/.test(text)) failed = true
	})
	page.on("pageerror", (err) => {
		console.log("[pageerror] " + err.message)
		failed = true
	})
	await page.goto(`http://127.0.0.1:${PORT}/comprehension.html?dialogue=${SLUG}`, { waitUntil: "networkidle" })
	await page.waitForTimeout(500)
	await browser.close()
	server.close()
	console.log(failed ? "CHECK_FAILED" : "CHECK_PASSED")
	process.exit(failed ? 1 : 0)
})
