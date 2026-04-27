/**
 * leaderboard.js — Firebase Firestore leaderboard for Volt Defense
 *
 * Stores top 100 scores per difficulty. Scores include player name,
 * score, waves, kills, time, difficulty, and timestamp.
 */

/* global firebase */

var Leaderboard = (function () {
    'use strict';

    var _db = null;
    var _initialized = false;
    var _collectionName = 'highscores';

    // ---- Firebase config ----
    // Replace with your own Firebase project config
    var _firebaseConfig = {
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: ''
    };

    function _init() {
        if (_initialized) return true;
        if (!_firebaseConfig.projectId) {
            console.warn('[Leaderboard] Firebase not configured — leaderboard disabled.');
            return false;
        }
        try {
            if (typeof firebase === 'undefined') {
                console.warn('[Leaderboard] Firebase SDK not loaded.');
                return false;
            }
            if (!firebase.apps || firebase.apps.length === 0) {
                firebase.initializeApp(_firebaseConfig);
            }
            _db = firebase.firestore();
            _initialized = true;
            return true;
        } catch (e) {
            console.error('[Leaderboard] Init failed:', e);
            return false;
        }
    }

    function _isConfigured() {
        return !!_firebaseConfig.projectId;
    }

    /**
     * Submit a score to the leaderboard.
     * @param {Object} entry - { name, score, waves, kills, time, difficulty, victory }
     * @param {Function} callback - function(err)
     */
    function _submitScore(entry, callback) {
        if (!_init()) {
            if (callback) callback('Leaderboard not configured');
            return;
        }

        var doc = {
            name: (entry.name || 'Anonymous').substring(0, 20),
            score: entry.score || 0,
            waves: entry.waves || 0,
            kills: entry.kills || 0,
            time: entry.time || 0,
            difficulty: entry.difficulty || 'unknown',
            victory: !!entry.victory,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        _db.collection(_collectionName).add(doc)
            .then(function () {
                if (callback) callback(null);
            })
            .catch(function (err) {
                console.error('[Leaderboard] Submit failed:', err);
                if (callback) callback(err);
            });
    }

    /**
     * Fetch top scores for a given difficulty (or all).
     * @param {string|null} difficulty - 'watt','volt','amp','lightning', or null for all
     * @param {number} limit - max results (default 100)
     * @param {Function} callback - function(err, scores[])
     */
    function _fetchScores(difficulty, limit, callback) {
        if (!_init()) {
            if (callback) callback('Leaderboard not configured', []);
            return;
        }

        var query = _db.collection(_collectionName)
            .orderBy('score', 'desc')
            .limit(limit || 100);

        if (difficulty) {
            query = query.where('difficulty', '==', difficulty);
        }

        query.get()
            .then(function (snapshot) {
                var scores = [];
                snapshot.forEach(function (doc) {
                    var data = doc.data();
                    data.id = doc.id;
                    scores.push(data);
                });
                if (callback) callback(null, scores);
            })
            .catch(function (err) {
                console.error('[Leaderboard] Fetch failed:', err);
                if (callback) callback(err, []);
            });
    }

    /**
     * Show the leaderboard modal UI.
     * @param {string|null} filterDifficulty - initial difficulty filter
     */
    function _showLeaderboard(filterDifficulty) {
        if (!_isConfigured()) {
            if (typeof UI !== 'undefined' && UI.showModal) {
                UI.showModal('🏆 Leaderboard', '<p style="text-align:center;color:#aaa;">Leaderboard is not configured yet.<br>Firebase setup required.</p>', [
                    { label: 'Close', action: 'close-modal', className: 'menu-btn' }
                ]);
            }
            return;
        }

        // Show loading state
        if (typeof UI !== 'undefined' && UI.showModal) {
            UI.showModal('🏆 Leaderboard', '<p style="text-align:center;color:#aaa;">Loading scores...</p>', [
                { label: 'Close', action: 'close-modal', className: 'menu-btn' }
            ]);
        }

        _fetchScores(filterDifficulty || null, 100, function (err, scores) {
            if (err) {
                _renderLeaderboard([], filterDifficulty);
                return;
            }
            _renderLeaderboard(scores, filterDifficulty);
        });
    }

    function _renderLeaderboard(scores, activeDifficulty) {
        var diffOptions = [
            { key: null, label: 'All' },
            { key: 'watt', label: '💡 Watt' },
            { key: 'volt', label: '🔌 Volt' },
            { key: 'amp', label: '🔥 Amp' },
            { key: 'lightning', label: '🌩️ Lightning' }
        ];

        var html = '<div style="margin-bottom:10px;text-align:center;">';
        for (var d = 0; d < diffOptions.length; d++) {
            var opt = diffOptions[d];
            var isActive = (activeDifficulty === opt.key) || (!activeDifficulty && !opt.key);
            html += '<button class="lb-filter-btn' + (isActive ? ' lb-active' : '') + '" data-lb-filter="' + (opt.key || 'all') + '" style="';
            html += 'background:' + (isActive ? '#3a7bd5' : '#1a1e2e') + ';border:1px solid ' + (isActive ? '#5a9bf5' : '#333') + ';';
            html += 'color:#fff;padding:4px 10px;margin:2px;border-radius:4px;cursor:pointer;font-size:12px;">';
            html += opt.label + '</button>';
        }
        html += '</div>';

        if (scores.length === 0) {
            html += '<p style="text-align:center;color:#888;">No scores yet. Be the first!</p>';
        } else {
            html += '<div style="max-height:400px;overflow-y:auto;">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += '<thead><tr style="color:#aaa;border-bottom:1px solid #333;">';
            html += '<th style="padding:4px;text-align:left;">#</th>';
            html += '<th style="padding:4px;text-align:left;">Name</th>';
            html += '<th style="padding:4px;text-align:right;">Score</th>';
            html += '<th style="padding:4px;text-align:center;">Waves</th>';
            html += '<th style="padding:4px;text-align:right;">Kills</th>';
            html += '<th style="padding:4px;text-align:center;">Diff</th>';
            html += '<th style="padding:4px;text-align:center;">W</th>';
            html += '</tr></thead><tbody>';

            var diffIcons = { watt: '💡', volt: '🔌', amp: '🔥', lightning: '🌩️' };

            for (var i = 0; i < scores.length; i++) {
                var s = scores[i];
                var rowColor = i < 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][i] : '#ccc';
                html += '<tr style="border-bottom:1px solid #222;color:' + rowColor + ';">';
                html += '<td style="padding:3px 4px;">' + (i + 1) + '</td>';
                html += '<td style="padding:3px 4px;">' + _escapeHtml(s.name || 'Anon') + '</td>';
                html += '<td style="padding:3px 4px;text-align:right;">' + _formatNum(s.score) + '</td>';
                html += '<td style="padding:3px 4px;text-align:center;">' + (s.waves || 0) + '</td>';
                html += '<td style="padding:3px 4px;text-align:right;">' + _formatNum(s.kills) + '</td>';
                html += '<td style="padding:3px 4px;text-align:center;">' + (diffIcons[s.difficulty] || '?') + '</td>';
                html += '<td style="padding:3px 4px;text-align:center;">' + (s.victory ? '✅' : '❌') + '</td>';
                html += '</tr>';
            }

            html += '</tbody></table></div>';
        }

        if (typeof UI !== 'undefined' && UI.showModal) {
            UI.showModal('🏆 Leaderboard — Top 100', html, [
                { label: 'Close', action: 'close-modal', className: 'menu-btn' }
            ]);
        }

        // Attach filter button handlers
        setTimeout(function () {
            var modalBody = document.getElementById('modal-body');
            if (!modalBody) return;
            var btns = modalBody.querySelectorAll('.lb-filter-btn');
            for (var b = 0; b < btns.length; b++) {
                btns[b].addEventListener('click', function () {
                    var filter = this.getAttribute('data-lb-filter');
                    _showLeaderboard(filter === 'all' ? null : filter);
                });
            }
        }, 50);
    }

    /**
     * Show score submission prompt (name input + submit).
     */
    function _showSubmitPrompt(stats, isVictory) {
        if (!_isConfigured()) return;

        var score = stats.score || 0;

        // Retrieve saved player name
        var savedName = '';
        try { savedName = localStorage.getItem('voltdefense_playerName') || ''; } catch (e) { /* ignore */ }

        var html = '';
        html += '<div style="text-align:center;margin-bottom:12px;">';
        html += '<div class="gameover-stat">🏆 Score: <strong>' + _formatNum(score) + '</strong></div>';
        html += '</div>';
        html += '<div style="text-align:center;">';
        html += '<label style="color:#aaa;font-size:13px;">Enter your name for the leaderboard:</label><br>';
        html += '<input type="text" id="lb-name-input" maxlength="20" value="' + _escapeHtml(savedName) + '" placeholder="Your Name" ';
        html += 'style="margin-top:6px;padding:6px 12px;width:200px;background:#1a1e2e;border:1px solid #444;color:#fff;border-radius:4px;font-size:14px;text-align:center;">';
        html += '</div>';

        if (typeof UI !== 'undefined' && UI.showModal) {
            UI.showModal(isVictory ? '🏆 Submit Score' : '⚡ Submit Score', html, [
                { label: '📤 Submit Score', action: 'lb-submit', className: 'modal-btn modal-btn-primary' },
                { label: 'Skip', action: 'return-to-menu', className: 'modal-btn' }
            ]);

            // Focus input
            setTimeout(function () {
                var input = document.getElementById('lb-name-input');
                if (input) input.focus();
            }, 100);
        }

        // Store stats for submit handler
        Leaderboard._pendingSubmit = {
            score: score,
            waves: stats.wave || 0,
            kills: stats.kills || 0,
            time: stats.time || 0,
            difficulty: stats.difficulty || 'unknown',
            victory: isVictory
        };
    }

    /**
     * Handle the actual submission (called from UI action handler).
     */
    function _handleSubmit(callback) {
        var input = document.getElementById('lb-name-input');
        var name = input ? input.value.trim() : 'Anonymous';
        if (!name) name = 'Anonymous';

        // Save name for next time
        try { localStorage.setItem('voltdefense_playerName', name); } catch (e) { /* ignore */ }

        var pending = Leaderboard._pendingSubmit;
        if (!pending) {
            if (callback) callback('No pending score');
            return;
        }

        pending.name = name;

        _submitScore(pending, function (err) {
            Leaderboard._pendingSubmit = null;
            if (callback) callback(err);
        });
    }

    function _formatNum(n) {
        if (n == null) return '0';
        n = Math.floor(n);
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
        return n.toLocaleString ? n.toLocaleString() : String(n);
    }

    function _escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ---- Public API ----

    return {
        isConfigured: _isConfigured,
        submitScore: _submitScore,
        fetchScores: _fetchScores,
        showLeaderboard: _showLeaderboard,
        showSubmitPrompt: _showSubmitPrompt,
        handleSubmit: _handleSubmit,
        _pendingSubmit: null
    };
})();
