/* Assets/exercise-render-fetch.js - Hungarize dialogue-engine renderer (v4)
 *
 * Loaded only by the shared engine page (comprehension.html at the repo
 * root). Reads the ?dialogue=<slug> query parameter, fetches
 * data/<slug>.json (same origin, relative to the engine page), and builds
 * the exact same DOM structure as Assets/exercise-render.js (the v3
 * inline-JSON renderer) - same classes, same data-id ordering, same
 * info-button contract - so Assets/exercise-style.css and
 * Assets/exercise-script.js work completely unmodified.
 *
 * exercise-script.js is deliberately never included as a static <script>
 * tag on the engine page: this file injects it only AFTER the fetched
 * exercise has finished rendering, so its answer-checking and self-check
 * logic always finds a populated DOM. This keeps exercise-script.js itself
 * untouched - no shared, retroactive asset is modified by this version.
 */
(function () {
	var root = document.getElementById("exercise-root")
	if (!root) return

	var slug = new URLSearchParams(location.search).get("dialogue")
	if (!slug) {
		root.textContent = "No dialogue specified - use ?dialogue=<name> in the URL."
		return
	}

	fetch("data/" + slug + ".json")
		.then(function (res) {
			if (!res.ok) throw new Error("HTTP " + res.status)
			return res.json()
		})
		.then(function (data) {
			render(data)
			loadRuntime()
		})
		.catch(function (err) {
			root.textContent = "Couldn't load this exercise (" + slug + "): " + err.message
			console.error("[engine] ERROR: " + err.message)
		})

	function loadRuntime() {
		var s = document.createElement("script")
		s.src = "Assets/exercise-script.js"
		document.body.appendChild(s)
	}

	var ACCENTS = {
		"\u00e1": "a", "\u00e9": "e", "\u00ed": "i", "\u00f3": "o",
		"\u00f6": "o", "\u0151": "o", "\u00fa": "u", "\u00fc": "u", "\u0171": "u"
	}
	function stripAccents(s) {
		return s.replace(/[\u00e1\u00e9\u00ed\u00f3\u00f6\u0151\u00fa\u00fc\u0171]/g, function (c) {
			return ACCENTS[c]
		})
	}
	function variants(word) {
		var lower = String(word).toLowerCase()
		var bare = stripAccents(lower)
		return bare === lower ? [lower] : [lower, bare]
	}

	function h(tag, cls, text) {
		var n = document.createElement(tag)
		if (cls) n.className = cls
		if (text != null) n.textContent = text
		return n
	}
	function text(s) {
		return document.createTextNode(s)
	}

	function render(data) {
		var answers = {}
		var nextId = 1

		function field(kind, answerList, display, maxlength) {
			var id = String(nextId++)
			answers[id] = answerList
			var wrap = h("div", "answer-wrapper")
			var input
			if (kind === "select") {
				input = h("select", "answer-select")
				;[["", "?"], ["igaz", "Igaz"], ["hamis", "Hamis"]].forEach(function (o) {
					var opt = document.createElement("option")
					opt.value = o[0]
					opt.textContent = o[1]
					input.appendChild(opt)
				})
			} else {
				input = h("input", "answer-input")
				input.type = "text"
				input.maxLength = maxlength
				input.placeholder = "..."
			}
			input.setAttribute("data-id", id)
			var btn = h("button", "info-btn", "?")
			btn.type = "button"
			btn.setAttribute("data-answer", display)
			wrap.appendChild(input)
			wrap.appendChild(btn)
			return wrap
		}

		function appendMarked(row, str, maxlength, plainClass) {
			String(str).split(/\[\[(.+?)\]\]/).forEach(function (part, i) {
				if (i % 2 === 1) {
					row.appendChild(field("input", variants(part), part, maxlength))
				} else if (part) {
					row.appendChild(plainClass ? h("span", plainClass, part) : text(part))
				}
			})
		}

		function section(title) {
			var s = h("div", "section")
			s.appendChild(h("div", "section-title", title))
			return s
		}

		var container = h("div", "container")

		var logo = h("div", "logo")
		var img = document.createElement("img")
		img.src = "Assets/hungarize-logo-small.png"
		img.alt = "Hungarize Logo"
		logo.appendChild(img)
		container.appendChild(logo)

		container.appendChild(h("div", "title", data.title))

		var form = document.createElement("form")
		form.id = "exerciseForm"

		var tfSection = section("Igaz vagy hamis? \u2756 True or false?")
		;(data.trueFalse || []).forEach(function (st, i) {
			var row = h("div", "statement")
			row.appendChild(h("span", "statement-num", i + 1 + "."))
			row.appendChild(text(" " + st.text + " "))
			var ans = String(st.answer).toLowerCase()
			row.appendChild(field("select", [ans], ans === "igaz" ? "Igaz" : "Hamis"))
			tfSection.appendChild(row)
		})
		form.appendChild(tfSection)

		var dlgSection = section("Dial\u00f3gus \u2756 Dialogue")
		;(data.dialogue || []).forEach(function (line) {
			var row = h("div", "dialogue-line")
			row.appendChild(h("span", "dialogue-dash", "-"))
			row.appendChild(text(" "))
			appendMarked(row, line, 10, null)
			dlgSection.appendChild(row)
		})
		form.appendChild(dlgSection)

		var wlSection = section("Szavak \u00e9s kifejez\u00e9sek \u2756 Words and expressions")
		;(data.words || []).forEach(function (w) {
			var row = h("div", "word-item")
			var term = String(w.term)
			if (w.blank) {
				var marked = /\[\[.+?\]\]/.test(term) ? term : "[[" + term + "]]"
				appendMarked(row, marked, 15, "word-term")
				row.appendChild(text(" = " + w.gloss))
			} else {
				row.appendChild(h("span", "word-term", term.replace(/\[\[|\]\]/g, "")))
				row.appendChild(text(" = " + w.gloss))
			}
			wlSection.appendChild(row)
		})
		form.appendChild(wlSection)

		var group = h("div", "button-group")
		var checkBtn = h("button", "check-btn", "Check Answers")
		checkBtn.type = "button"
		checkBtn.setAttribute("onclick", "checkAnswers()")
		group.appendChild(checkBtn)
		form.appendChild(group)

		container.appendChild(form)

		var credit = h("div", "credit")
		credit.appendChild(text("Created by "))
		credit.appendChild(h("span", "credit-bold", "Hungarize"))
		credit.appendChild(document.createElement("br"))
		credit.appendChild(text("hungarize.com"))
		container.appendChild(credit)

		root.replaceWith(container)
		window.answers = answers
	}
})()
