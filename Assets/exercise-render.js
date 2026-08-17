/* Assets/exercise-render.js - Hungarize data-only exercise renderer (v3.1)
 *
 * OPT-IN BY DESIGN: this file only does something on a page that contains
 *   <script type="application/json" id="exercise-data">
 * Exercises published in the older self-contained format never load it, so
 * adding this asset cannot change or break a single already-published file.
 *
 * LOAD ORDER MATTERS: this must be loaded BEFORE Assets/exercise-script.js.
 * It builds the DOM and defines the global `answers` object that the shared
 * runtime's checkAnswers() and selfCheck() both read.
 *
 * The DOM it produces is byte-for-byte equivalent in structure to what
 * Assets/build-exercise.js emits statically: same classes, same data-id
 * ordering (statements -> dialogue gaps -> word-list blanks, document order),
 * same info-button contract.
 */
(function () {
	var dataEl = document.getElementById("exercise-data")
	if (!dataEl) return // static-format exercise: nothing to do

	var data
	try {
		data = JSON.parse(dataEl.textContent)
	} catch (e) {
		console.error("[render] ERROR: exercise-data is not valid JSON: " + e.message)
		return
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

	// Lowercase answer, plus an accent-free twin only when it actually differs.
	function variants(word) {
		var lower = String(word).toLowerCase()
		var bare = stripAccents(lower)
		return bare === lower ? [lower] : [lower, bare]
	}

	var answers = {}
	var nextId = 1

	function h(tag, cls, text) {
		var n = document.createElement(tag)
		if (cls) n.className = cls
		if (text != null) n.textContent = text
		return n
	}

	function text(s) {
		return document.createTextNode(s)
	}

	// Builds one answer field + its "?" info button and claims the next data-id.
	function field(kind, answerList, display, maxlength) {
		var id = String(nextId++)
		answers[id] = answerList

		var wrap = h("div", "answer-wrapper")
		var input

		if (kind === "select") {
			input = h("select", "answer-select")
			var opts = [["", "?"], ["igaz", "Igaz"], ["hamis", "Hamis"]]
			opts.forEach(function (o) {
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

	// Appends a string, turning every [[marked]] run into a gap field.
	// plainClass wraps the untouched text (used to keep .word-term styling).
	function appendMarked(row, str, maxlength, plainClass) {
		var parts = String(str).split(/\[\[(.+?)\]\]/)
		parts.forEach(function (part, i) {
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

	container.appendChild(h("div", "title", "\ud83c\udfaf " + data.title))

	var form = document.createElement("form")
	form.id = "exerciseForm"

	// 1. Igaz vagy hamis?
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

	// 2. Dialogue - every [[marked]] word is a human-selected gap, any number.
	var dlgSection = section("Dial\u00f3gus \u2756 Dialogue")
	;(data.dialogue || []).forEach(function (line) {
		var row = h("div", "dialogue-line")
		row.appendChild(h("span", "dialogue-dash", "-"))
		row.appendChild(text(" "))
		appendMarked(row, line, 10, null)
		dlgSection.appendChild(row)
	})
	form.appendChild(dlgSection)

	// 3. Word list - blank flag, or [[marker]] inside a multi-word term.
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

	// Replace the mount point rather than filling it, so .container stays a
	// DIRECT child of <body> exactly as in the static build - the stylesheet
	// may rely on that relationship.
	var root = document.getElementById("exercise-root")
	if (root && root.replaceWith) {
		root.replaceWith(container)
	} else {
		;(root || document.body).appendChild(container)
	}

	// The shared runtime reads this as a global, exactly as in static exercises.
	window.answers = answers
})()
