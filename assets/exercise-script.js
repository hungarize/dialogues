/* assets/exercise-script.js - Hungarize exercise runtime + self-check.
 *
 * Injected by assets/exercise-render-fetch.js only after the exercise DOM has
 * been built, so it always finds a populated page and a global `answers`
 * object.
 *
 * NOTE: MIN_WORDLIST_RATIO below duplicates the same threshold in
 * assets/build-exercise-data.js. The build-time copy is the gate that actually
 * blocks a bad publish; this runtime copy only catches a data file that was
 * hand-edited after validation. Change one and you must change the other.
 *
 * The self-check reports through the console only. It is read by
 * tools/serve-and-check.js, which fails the run on any line matching ERROR.
 */

// Strips punctuation from an answer before comparing, so a missing full
// stop/comma/quote etc. doesn't fail an otherwise-correct answer. Slash and
// ampersand are word separators, so they become a space (not deleted) to
// avoid fusing two words together (e.g. "és/vagy" must stay "és vagy", not
// become "ésvagy"). Hyphens and en/em dashes are deliberately left alone -
// Hungarian compound/prefixed words are meaningfully hyphenated, and dashes
// carry meaning in reported speech, so folding them risks turning a
// genuinely wrong answer into a false "correct".
function stripPunctuation(s) {
	return String(s)
		.replace(/[\/&]/g, ' ')
		.replace(/[.,!?;:…"'()\[\]{}‘’“”„«»·]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// ~3 line-heights below the top of the viewport, so a wrong answer that's
// scrolled to lands near the top instead of dead-centre.
var SCROLL_TOP_OFFSET = 80;

function scrollToWithOffset(el) {
	var rect = el.getBoundingClientRect();
	var targetY = rect.top + window.pageYOffset - SCROLL_TOP_OFFSET;
	window.scrollTo({ top: Math.max(targetY, 0), behavior: 'smooth' });
}

function clearCelebration() {
	var banner = document.getElementById('celebrate-banner');
	if (banner) banner.remove();
	document.querySelectorAll('.confetti-piece').forEach(function (p) { p.remove(); });
}

function celebrate() {
	clearCelebration();

	var banner = document.createElement('div');
	banner.id = 'celebrate-banner';
	banner.textContent = '\u{1F389} Gratulálunk! Minden válasz helyes! \u{1F389}';
	var container = document.querySelector('.container');
	container.insertBefore(banner, container.firstChild);

	var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (reduceMotion) return;

	// Green shades only - colourblind-friendly, matches the green already
	// used for "correct" fields.
	var colors = ['#00CC00', '#1B5E20', '#66BB6A', '#A5D6A7', '#2E7D32', '#B2FF59'];
	for (var i = 0; i < 56; i++) {
		var p = document.createElement('div');
		p.className = 'confetti-piece';
		p.style.left = (Math.random() * 100) + 'vw';
		p.style.background = colors[Math.floor(Math.random() * colors.length)];
		p.style.animationDuration = (3 + Math.random() * 2) + 's';
		p.style.animationDelay = (0.5 + Math.random() * 0.3) + 's';
		document.body.appendChild(p);
		p.addEventListener('animationend', function () { this.remove(); });
	}
}

function checkAnswers() {
	// A pinned spelling bubble belongs to the previous check - close it.
	hideAllAnswers();

	var inputs = document.querySelectorAll('.answer-input, .answer-select');

	inputs.forEach(function (input) {
		var id = input.getAttribute('data-id');
		var raw = input.value.toLowerCase().trim();
		var correctList = (answers[id] || []).map(function (a) { return String(a).toLowerCase(); });
		// index 0 is always the canonical, accented/authored form - see
		// variants() in exercise-render-fetch.js.
		var canonical = correctList.length ? correctList[0] : null;

		var literalMatch = canonical !== null && raw === canonical;
		var lenientMatch = !literalMatch && correctList.some(function (a) {
			return raw === a || stripPunctuation(raw) === stripPunctuation(a);
		});

		input.classList.remove('correct', 'incorrect', 'correct-lenient');
		var infoBtn = input.nextElementSibling; // .info-btn, per the DOM contract in exercise-render-fetch.js

		if (literalMatch) {
			input.classList.add('correct');
			if (infoBtn) infoBtn.textContent = '?';
		} else if (lenientMatch) {
			// Correct, but only because an accent variant and/or punctuation
			// was folded away - show the canonical spelling so the student
			// still sees it.
			input.classList.add('correct', 'correct-lenient');
			if (infoBtn) infoBtn.textContent = 'i';
		} else if (raw.length > 0) {
			input.classList.add('incorrect');
			if (infoBtn) infoBtn.textContent = '?';
		} else if (infoBtn) {
			infoBtn.textContent = '?';
		}
	});

	var fields = Array.prototype.slice.call(inputs);
	var allCorrect = fields.length > 0 && fields.every(function (f) {
		return f.value.trim() !== '' && f.classList.contains('correct');
	});

	var container = document.querySelector('.container');
	container.classList.remove('state-correct', 'state-incorrect');

	if (allCorrect) {
		container.classList.add('state-correct');
		celebrate();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	} else {
		container.classList.add('state-incorrect');
		clearCelebration();
		var firstWrong = fields.find(function (f) { return f.classList.contains('incorrect'); });
		if (firstWrong) {
			scrollToWithOffset(firstWrong);
		} else {
			// nothing marked incorrect (e.g. everything left blank)
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	}
}

document.getElementById('exerciseForm').addEventListener('keypress', function (event) {
	if (event.key === 'Enter') {
		// Enter on a focused info button should toggle its spelling bubble
		// (the button's own click), not check the whole exercise.
		if (event.target.classList && event.target.classList.contains('info-btn')) return;
		event.preventDefault();
		checkAnswers();
	}
});

/* ----- Spelling bubble: click/tap to pin -----
 * The correct spelling lives in each .info-btn's data-answer attribute and is
 * drawn by CSS (.info-btn::after). Hover alone was not discoverable - on a
 * Mac you had to rest the pointer on the button and clicking did nothing - so
 * a click/tap (or Enter/Space, since it's a <button>) now pins the bubble by
 * adding .show-answer. Only one bubble is pinned at a time. It closes on a
 * second click, a click anywhere else, Escape, editing that answer, or Check
 * Answers.
 *
 * Event delegation on document, because the buttons are built by
 * exercise-render-fetch.js. Nothing here touches the button's visible text
 * ("?" / "i", set by checkAnswers) or data-answer (read by the self-check).
 */
var ANSWER_LABEL_HIDDEN = 'Show the correct spelling';
var ANSWER_LABEL_SHOWN = 'Correct spelling: ';
// Keep in step with the bubble's max-width in exercise-style.css.
var ANSWER_BUBBLE_MAX_WIDTH = 260;
var ANSWER_BUBBLE_PADDING = 24; // 12px left + 12px right
var ANSWER_BUBBLE_EDGE_GAP = 8; // keep at least this far from the screen edge

var answerMeasureCtx = null;

// Nudges the bubble sideways (CSS variable --answer-bubble-shift) when a
// centred bubble would stick out of the window - a gap near the edge of a
// narrow screen. The bubble is a pseudo-element and can't be measured
// directly, so its width is estimated from the answer text in the button's
// own font.
function placeAnswerBubble(btn) {
	var viewport = document.documentElement.clientWidth || window.innerWidth;
	var maxWidth = Math.min(ANSWER_BUBBLE_MAX_WIDTH, viewport - 48); // same cap as the CSS
	var bubbleWidth = maxWidth;
	try {
		if (!answerMeasureCtx) answerMeasureCtx = document.createElement('canvas').getContext('2d');
		var cs = window.getComputedStyle(btn);
		answerMeasureCtx.font = cs.fontWeight + ' 14px ' + cs.fontFamily;
		var textWidth = answerMeasureCtx.measureText(btn.getAttribute('data-answer') || '').width;
		bubbleWidth = Math.min(maxWidth, Math.ceil(textWidth) + ANSWER_BUBBLE_PADDING);
	} catch (err) {
		// no canvas: assume the widest bubble, which only errs on the safe side
	}
	var rect = btn.getBoundingClientRect();
	var left = rect.left + rect.width / 2 - bubbleWidth / 2;
	var shift = 0;
	if (left < ANSWER_BUBBLE_EDGE_GAP) {
		shift = ANSWER_BUBBLE_EDGE_GAP - left;
	} else if (left + bubbleWidth > viewport - ANSWER_BUBBLE_EDGE_GAP) {
		shift = viewport - ANSWER_BUBBLE_EDGE_GAP - (left + bubbleWidth);
	}
	btn.style.setProperty('--answer-bubble-shift', Math.round(shift) + 'px');
}

function showAnswer(btn) {
	placeAnswerBubble(btn);
	btn.classList.add('show-answer');
	btn.setAttribute('aria-expanded', 'true');
	// Screen readers don't see the CSS bubble, so put the spelling in the label.
	btn.setAttribute('aria-label', ANSWER_LABEL_SHOWN + (btn.getAttribute('data-answer') || ''));
}

function hideAnswer(btn) {
	btn.classList.remove('show-answer');
	btn.setAttribute('aria-expanded', 'false');
	btn.setAttribute('aria-label', ANSWER_LABEL_HIDDEN);
}

function hideAllAnswers() {
	document.querySelectorAll('.info-btn.show-answer').forEach(hideAnswer);
}

document.querySelectorAll('.info-btn').forEach(function (btn) {
	btn.setAttribute('aria-label', ANSWER_LABEL_HIDDEN);
	btn.setAttribute('aria-expanded', 'false');
});

document.addEventListener('click', function (event) {
	var btn = event.target.closest ? event.target.closest('.info-btn') : null;
	if (!btn) {
		hideAllAnswers();
		return;
	}
	var wasShown = btn.classList.contains('show-answer');
	hideAllAnswers();
	if (!wasShown) showAnswer(btn);
});

// Hover still works without a click (CSS :hover); this just keeps that
// bubble on screen too, before it appears.
document.addEventListener('mouseover', function (event) {
	var btn = event.target.closest ? event.target.closest('.info-btn') : null;
	if (btn && !btn.classList.contains('show-answer')) placeAnswerBubble(btn);
});

document.addEventListener('keydown', function (event) {
	if (event.key === 'Escape' || event.key === 'Esc') hideAllAnswers();
});

// Editing an answer makes its bubble stale, so close the one next to it.
function hideAnswerForField(event) {
	var field = event.target;
	if (!field.classList || !(field.classList.contains('answer-input') || field.classList.contains('answer-select'))) return;
	var btn = field.nextElementSibling; // .info-btn, per the DOM contract in exercise-render-fetch.js
	if (btn && btn.classList.contains('show-answer')) hideAnswer(btn);
}
document.addEventListener('input', hideAnswerForField);
document.addEventListener('change', hideAnswerForField);

window.addEventListener('resize', function () {
	document.querySelectorAll('.info-btn.show-answer').forEach(placeAnswerBubble);
});

(function selfCheck() {
	try {
		var MIN_WORDLIST_RATIO = 0.30;

		var fold = function (s) {
			return String(s).toLowerCase().trim()
				.normalize('NFD').replace(/[̀-ͯ]/g, '');
		};
		var errors = [], warnings = [];
		var q = function (sel, root) {
			return [].slice.call((root || document).querySelectorAll(sel));
		};

		var ids = q('[data-id]').map(function (el) { return el.getAttribute('data-id'); });
		var seen = {}, dupes = {};
		ids.forEach(function (id) { if (seen[id]) { dupes[id] = true; } else { seen[id] = true; } });
		if (Object.keys(dupes).length)
			errors.push('Duplicate data-id: ' + Object.keys(dupes).join(', '));

		var missing = Object.keys(seen).filter(function (id) { return !(id in answers); });
		if (missing.length)
			errors.push('data-id in the page but missing from answers: ' + missing.join(', '));

		var orphans = Object.keys(answers).filter(function (id) { return !seen[id]; });
		if (orphans.length)
			errors.push('answers key with no matching field: ' + orphans.join(', '));

		Object.keys(answers).forEach(function (id) {
			var list = (answers[id] || []).map(String);
			list.forEach(function (v) {
				if (v !== v.toLowerCase())
					errors.push('answers[' + id + '] is not lowercase: "' + v + '"');
			});
			if (new Set(list).size !== list.length)
				warnings.push('answers[' + id + '] lists the same spelling twice');
			list.forEach(function (v) {
				if (/[áéíóöőúüű]/.test(v)
					&& !list.some(function (o) { return o !== v && fold(o) === fold(v); }))
					warnings.push('answers[' + id + ']: "' + v + '" has accents but no accent-free variant');
			});
		});

		q('.answer-wrapper').forEach(function (w) {
			var field = w.querySelector('[data-id]'), btn = w.querySelector('.info-btn');
			if (!field || !btn) return;
			var id = field.getAttribute('data-id');
			var shown = btn.getAttribute('data-answer') || '';
			var list = (answers[id] || []).map(fold);
			if (shown && list.length && list.indexOf(fold(shown)) === -1)
				errors.push('data-id ' + id + ': info button shows "' + shown
					+ '" but answers has [' + (answers[id] || []).join(', ') + ']');
		});

		// Dialogue gaps are user-chosen by underlining in SZOVEGERTES and their
		// number varies per dialogue, so they are accepted as given - no count,
		// clustering, spacing or word-list-overlap checks here. gapCount below is
		// reported for information only and is never compared against anything.
		var wordItems = q('.word-item');
		var gapCount = q('.dialogue-line [data-id]').length;

		var blanked = wordItems.map(function (it) { return !!it.querySelector('[data-id]'); });
		var nBlank = blanked.filter(Boolean).length;
		if (wordItems.length) {
			var ratio = nBlank / wordItems.length;
			if (ratio < MIN_WORDLIST_RATIO)
				errors.push('Only ' + nBlank + ' of ' + wordItems.length + ' word-list items blanked ('
					+ Math.round(ratio * 100) + '%) — at least '
					+ Math.round(MIN_WORDLIST_RATIO * 100) + '% required');
		}
		for (var j = 1; j < blanked.length; j++) {
			if (blanked[j] && blanked[j - 1])
				errors.push('Word list items ' + j + ' and ' + (j + 1)
					+ ' are both blanked — leave at least one visible between blanks');
		}

		if (!errors.length && !warnings.length) {
			console.log('%c[self-check] All checks passed. '
				+ gapCount + ' dialogue gaps, ' + nBlank + '/' + wordItems.length
				+ ' word-list blanks.', 'color:#00CC00;font-weight:bold');
			return;
		}
		errors.forEach(function (e) { console.error('[self-check] ERROR: ' + e); });
		warnings.forEach(function (w) { console.warn('[self-check] warning: ' + w); });
	} catch (err) {
		console.error('[self-check] the checker itself failed:', err);
	}
})();
