/* Hungarize exercise runtime - shared by every generated exercise page.
   Expects a page-local `const answers = {...}` declared in an inline
   <script> BEFORE this file is loaded (classic scripts share one global
   scope, so order matters).
   Editing this file changes behaviour for ALL published exercises at
   once. Do not inline a modified copy into a single exercise file. */

function checkAnswers() {
    const inputs = document.querySelectorAll('.answer-input, .answer-select');

    inputs.forEach(input => {
        const id = input.getAttribute('data-id');
        const userAnswer = input.value.toLowerCase().trim();
        // '|| []' keeps a missing answers entry from throwing and killing
        // the scroll-to-top. The self-check below reports it instead.
        const correctAnswers = answers[id] || [];

        input.classList.remove('correct', 'incorrect');

        if (correctAnswers.includes(userAnswer)) {
            input.classList.add('correct');
        } else if (userAnswer.length > 0) {
            input.classList.add('incorrect');
        }
    });

    // Smooth scroll to top so the learner sees feedback from the start
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Enter key submits
document.getElementById('exerciseForm').addEventListener('keypress', function (event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        checkAnswers();
    }
});

/* ===== SELF-CHECK (rev. 2026-08-17) ==========================
   Verifies the exercise against the current rules on load.
     - ALWAYS logs to the browser console.
     - Shows an on-page banner ONLY on file:// (local preview), so
       learners never see diagnostics on a published copy.
============================================================== */
(function selfCheck() {
    try {
        var MIN_DIALOGUE_GAPS = 5;
        var MIN_WORDLIST_RATIO = 0.30;

        var fold = function (s) {
            return String(s).toLowerCase().trim()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        };
        var esc = function (s) {
            return String(s).replace(/[&<>]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
            });
        };
        var errors = [], warnings = [];
        var titleEl = document.querySelector('.title');
        var isTemplate = /DIALOGUE_TITLE/.test(titleEl ? titleEl.textContent : '');
        var q = function (sel, root) {
            return [].slice.call((root || document).querySelectorAll(sel));
        };

        /* --- data-id integrity ---------------------------------- */
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

        /* --- answers hygiene ------------------------------------ */
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

        /* --- info button vs answers ----------------------------- */
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

        /* --- build the Szolista vocabulary ---------------------- */
        var vocabExact = {}, vocabStem = {};
        var addVocab = function (raw) {
            var f = fold(raw);
            if (!f) return;
            vocabExact[f] = true;
            if (f.length >= 4) vocabStem[f] = true;
            f.split(/\s+/).forEach(function (tok) {
                if (tok.length >= 4) { vocabExact[tok] = true; vocabStem[tok] = true; }
            });
        };
        var wordItems = q('.word-item');
        wordItems.forEach(function (item) {
            q('.word-term', item).forEach(function (t) { addVocab(t.textContent); });
            var inp = item.querySelector('[data-id]');
            if (inp) (answers[inp.getAttribute('data-id')] || []).forEach(addVocab);
        });

        /* --- dialogue ------------------------------------------- */
        var lines = q('.dialogue-line');
        var gapped = lines.map(function (l) { return !!l.querySelector('[data-id]'); });
        var gapCount = gapped.filter(Boolean).length;

        if (!isTemplate && gapCount < MIN_DIALOGUE_GAPS)
            errors.push('Only ' + gapCount + ' dialogue gap(s) - at least '
                + MIN_DIALOGUE_GAPS + ' required');

        var run = 0, pairs = 0;
        for (var i = 0; i <= gapped.length; i++) {
            if (gapped[i]) { run++; continue; }
            if (run >= 3)
                errors.push('Lines ' + (i - run + 1) + '-' + i
                    + ' all have gaps - a run of ' + run
                    + ' is clustering, not conflict avoidance');
            else if (run === 2) {
                pairs++;
                warnings.push('Lines ' + (i - 1) + ' and ' + i
                    + ' both have gaps - allowed only if unavoidable; confirm there was no alternative');
            }
            run = 0;
        }
        if (pairs > 1)
            warnings.push(pairs + ' consecutive pairs in one dialogue - that is more often than expected');

        lines.forEach(function (line) {
            var inp = line.querySelector('[data-id]');
            if (!inp) return;
            var id = inp.getAttribute('data-id');
            (answers[id] || []).forEach(function (v) {
                var f = fold(v);
                if (vocabExact[f]) {
                    errors.push('data-id ' + id + ': gap word "' + v + '" is in the word list');
                    return;
                }
                if (f.length < 4) return;
                for (var k in vocabStem) {
                    if (f.startsWith(k) || k.startsWith(f)) {
                        warnings.push('data-id ' + id + ': gap word "' + v
                            + '" looks like a form of the word-list entry "' + k + '"');
                        return;
                    }
                }
            });
        });

        /* --- word list ------------------------------------------ */
        var blanked = wordItems.map(function (it) { return !!it.querySelector('[data-id]'); });
        var nBlank = blanked.filter(Boolean).length;
        if (wordItems.length) {
            var ratio = nBlank / wordItems.length;
            if (!isTemplate && ratio < MIN_WORDLIST_RATIO)
                errors.push('Only ' + nBlank + ' of ' + wordItems.length + ' word-list items blanked ('
                    + Math.round(ratio * 100) + '%) - at least '
                    + Math.round(MIN_WORDLIST_RATIO * 100) + '% required');
        }
        for (var j = 1; j < blanked.length; j++) {
            if (blanked[j] && blanked[j - 1])
                errors.push('Word list items ' + j + ' and ' + (j + 1)
                    + ' are both blanked - leave at least one visible between blanks');
        }

        /* --- report --------------------------------------------- */
        if (!errors.length && !warnings.length) {
            console.log('%c[self-check] All checks passed'
                + (isTemplate ? ' (template mode: count minimums skipped). ' : '. ')
                + gapCount + ' dialogue gaps, ' + nBlank + '/' + wordItems.length
                + ' word-list blanks.', 'color:#00CC00;font-weight:bold');
            return;
        }
        errors.forEach(function (e) { console.error('[self-check] ERROR: ' + e); });
        warnings.forEach(function (w) { console.warn('[self-check] warning: ' + w); });

        if (location.protocol !== 'file:') return;   // silent on a published copy

        var box = document.createElement('div');
        box.style.cssText = 'position:sticky;top:0;z-index:9999;background:#FFB3B3;'
            + 'border:3px solid #FF0000;color:#660000;padding:14px 18px;margin:0 0 16px;'
            + 'font-family:Lexend,sans-serif;font-size:14px;line-height:1.5;border-radius:8px';
        box.innerHTML = '<strong>&#9888; Self-check: ' + errors.length + ' error(s), '
            + warnings.length + ' warning(s)</strong>'
            + '<div style="font-size:12px;margin:4px 0 8px">Shown only when opened locally &mdash; learners never see this.</div>'
            + '<ul style="margin:0;padding-left:20px">'
            + errors.map(function (e) { return '<li><strong>ERROR:</strong> ' + esc(e) + '</li>'; }).join('')
            + warnings.map(function (w) { return '<li>warning: ' + esc(w) + '</li>'; }).join('')
            + '</ul>';
        document.body.insertBefore(box, document.body.firstChild);
    } catch (err) {
        console.error('[self-check] the checker itself failed:', err);
    }
})();
