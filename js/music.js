// ============================================================================
// Volt Defense — Music Module
// Manages background music playback with shuffle/cycle between tracks.
// ============================================================================

var Music = (function () {
    var STORAGE_KEY = 'voltdefense_music';
    var _tracks = ['assets/music/track1.mp3', 'assets/music/track2.mp3'];
    var _bossTracks = ['assets/music/boss1.mp3', 'assets/music/boss2.mp3'];
    var _audio = null;
    var _bossAudio = null;
    var _enabled = true;
    var _volume = 0.5;
    var _currentIndex = -1;
    var _shuffleOrder = [];
    var _shufflePos = 0;
    var _bossActive = false;
    var _fadingIn = false;
    var _fadingOut = false;
    var _fadeInterval = null;
    var FADE_DURATION = 2000; // 2 second crossfade
    var FADE_STEP = 50; // ms per fade tick

    // ---- Settings persistence -----------------------------------------------

    function _loadSettings() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var data = JSON.parse(raw);
                if (typeof data.enabled === 'boolean') _enabled = data.enabled;
                if (typeof data.volume === 'number') _volume = data.volume;
            }
        } catch (e) {
            // use defaults
        }
    }

    function _saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                enabled: _enabled,
                volume: _volume
            }));
        } catch (e) {
            // silent
        }
    }

    // ---- Shuffle logic ------------------------------------------------------

    function _buildShuffleOrder() {
        _shuffleOrder = [];
        var i;
        for (i = 0; i < _tracks.length; i++) {
            _shuffleOrder.push(i);
        }
        // Fisher-Yates shuffle
        for (i = _shuffleOrder.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = _shuffleOrder[i];
            _shuffleOrder[i] = _shuffleOrder[j];
            _shuffleOrder[j] = tmp;
        }
        _shufflePos = 0;
    }

    function _nextTrackIndex() {
        if (_shuffleOrder.length === 0 || _shufflePos >= _shuffleOrder.length) {
            _buildShuffleOrder();
            // Avoid repeating last track
            if (_shuffleOrder.length > 1 && _shuffleOrder[0] === _currentIndex) {
                var tmp = _shuffleOrder[0];
                _shuffleOrder[0] = _shuffleOrder[_shuffleOrder.length - 1];
                _shuffleOrder[_shuffleOrder.length - 1] = tmp;
            }
        }
        var idx = _shuffleOrder[_shufflePos];
        _shufflePos++;
        return idx;
    }

    // ---- Audio management ---------------------------------------------------

    function _ensureAudio() {
        if (!_audio) {
            _audio = new Audio();
            _audio.volume = _volume;
            _audio.addEventListener('ended', function () {
                _playNext();
            });
        }
    }

    function _playNext() {
        _ensureAudio();
        _currentIndex = _nextTrackIndex();
        _audio.src = _tracks[_currentIndex];
        _audio.volume = _volume;
        _audio.play().catch(function () {
            // Autoplay blocked — will retry on user interaction
        });
    }

    // ---- Boss music management ------------------------------------------------

    function _ensureBossAudio() {
        if (!_bossAudio) {
            _bossAudio = new Audio();
            _bossAudio.volume = 0;
            _bossAudio.loop = true;
        }
    }

    function _clearFade() {
        if (_fadeInterval) {
            clearInterval(_fadeInterval);
            _fadeInterval = null;
        }
        _fadingIn = false;
        _fadingOut = false;
    }

    function _crossfadeToBoss() {
        if (!_enabled) return;
        _ensureBossAudio();

        // Pick a random boss track
        var bossIdx = Math.floor(Math.random() * _bossTracks.length);
        _bossAudio.src = _bossTracks[bossIdx];
        _bossAudio.volume = 0;
        _bossAudio.play().catch(function() {});

        _bossActive = true;
        _clearFade();
        _fadingIn = true;

        var steps = Math.ceil(FADE_DURATION / FADE_STEP);
        var step = 0;
        var normalStartVol = _audio ? _audio.volume : _volume;

        _fadeInterval = setInterval(function() {
            step++;
            var progress = Math.min(step / steps, 1);

            // Fade normal music down
            if (_audio) {
                _audio.volume = Math.max(0, normalStartVol * (1 - progress));
            }
            // Fade boss music up
            if (_bossAudio) {
                _bossAudio.volume = _volume * progress;
            }

            if (progress >= 1) {
                _clearFade();
                if (_audio) _audio.pause();
            }
        }, FADE_STEP);
    }

    function _crossfadeFromBoss() {
        if (!_bossActive) return;
        _bossActive = false;
        _clearFade();
        _fadingOut = true;

        // Resume normal music
        if (_audio && _enabled) {
            _audio.volume = 0;
            _audio.play().catch(function() {});
        }

        var steps = Math.ceil(FADE_DURATION / FADE_STEP);
        var step = 0;
        var bossStartVol = _bossAudio ? _bossAudio.volume : _volume;

        _fadeInterval = setInterval(function() {
            step++;
            var progress = Math.min(step / steps, 1);

            // Fade boss music down
            if (_bossAudio) {
                _bossAudio.volume = Math.max(0, bossStartVol * (1 - progress));
            }
            // Fade normal music up
            if (_audio) {
                _audio.volume = _volume * progress;
            }

            if (progress >= 1) {
                _clearFade();
                if (_bossAudio) {
                    _bossAudio.pause();
                    _bossAudio.currentTime = 0;
                }
            }
        }, FADE_STEP);
    }

    // ---- Init ---------------------------------------------------------------

    _loadSettings();

    // ---- Public API ---------------------------------------------------------

    return {
        play: function () {
            if (!_enabled) return;
            _ensureAudio();
            // Don't interrupt if already playing (normal or boss)
            if (_bossActive && _bossAudio && !_bossAudio.paused) return;
            if (_audio.src && !_audio.paused) return;
            if (_audio.src && !_audio.ended && _audio.currentTime > 0) {
                _audio.play().catch(function () {});
            } else {
                _playNext();
            }
        },

        pause: function () {
            if (_audio) {
                _audio.pause();
            }
            if (_bossAudio) {
                _bossAudio.pause();
            }
            _clearFade();
        },

        toggle: function () {
            _enabled = !_enabled;
            _saveSettings();
            if (_enabled) {
                if (_bossActive) {
                    _ensureBossAudio();
                    _bossAudio.volume = _volume;
                    _bossAudio.play().catch(function () {});
                } else {
                    Music.play();
                }
            } else {
                Music.pause();
            }
            return _enabled;
        },

        setVolume: function (val) {
            _volume = Math.max(0, Math.min(1, val));
            if (_bossActive && _bossAudio && !_fadingIn && !_fadingOut) {
                _bossAudio.volume = _volume;
            } else if (_audio && !_fadingIn && !_fadingOut) {
                _audio.volume = _volume;
            }
            _saveSettings();
        },

        getVolume: function () {
            return _volume;
        },

        isEnabled: function () {
            return _enabled;
        },

        playBossMusic: function () {
            _crossfadeToBoss();
        },

        stopBossMusic: function () {
            _crossfadeFromBoss();
        },

        isBossActive: function () {
            return _bossActive;
        }
    };
})();
